// @ts-check
import { fetchResource } from "./resources.js";
/** Audio is independent of physics; decoded clips support overlapping effects. */
const AUDIO = {
  sounds: {
    merge: ["./assets/merge/pop.mp3", "./assets/merge/pop2.mp3"],
    drop: ["./assets/merge/drop-soft.wav"],
  },
  volume: 0.6,
  dropVolume: 0.5,
  dropLowpassHz: 1600,
  maxVoices: 4,
  unlockGraceSeconds: 0.15,
  pitchChance: 0.5,
  pitchSemitones: 3,
  // Match the short pop itself, not the average of its mostly silent tail.
  loudnessWindowSeconds: 0.05,
  targetRms: 0.2,
  peakCeiling: 0.9,
  maxNormalizationGain: 4,
  // Linear amplitude: -60 dBFS ignores the clip's near-silent MP3 pre-roll.
  silenceThreshold: 0.001,
  onsetPaddingSeconds: 0.004,
  fadeInSeconds: 0.002,
  retryCooldownMs: 3000,
};
const CENTS_PER_SEMITONE = 100;

/**
 * Trim once after decoding, across all channels. Keep the attack and entire tail.
 * The original file is unchanged; playback never needs to scan or decode again.
 * @param {BaseAudioContext} context
 * @param {AudioBuffer} buffer
 */
export function trimLeadingSilence(context, buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  let onset = buffer.length;
  for (const channel of channels) {
    for (let index = 0; index < onset; index++) {
      if (Math.abs(channel[index]) >= AUDIO.silenceThreshold) {
        onset = index;
        break;
      }
    }
  }
  // Leave silent/very quiet clips and clips with immediate attacks intact.
  if (onset === buffer.length) return buffer;
  const padding = Math.ceil(AUDIO.onsetPaddingSeconds * buffer.sampleRate);
  const start = Math.max(0, onset - padding);
  if (!start) return buffer;
  const trimmed = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length - start,
    buffer.sampleRate,
  );
  const fade = Math.min(
    padding,
    trimmed.length,
    Math.ceil(AUDIO.fadeInSeconds * buffer.sampleRate),
  );
  channels.forEach((channel, index) => {
    const output = trimmed.getChannelData(index);
    output.set(channel.subarray(start));
    // Fade only the retained pre-roll so the cut cannot introduce a click.
    for (let sample = 0; sample < fade; sample++)
      output[sample] *= sample / fade;
  });
  return trimmed;
}

/**
 * Match the loudest short-window RMS once at load time. A fixed gain preserves
 * the transient; peak/gain limits protect against clipping and amplified noise.
 * @param {AudioBuffer} buffer
 */
export function normalizeLoudness(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const windowSamples = Math.min(
    buffer.length,
    Math.max(1, Math.round(AUDIO.loudnessWindowSeconds * buffer.sampleRate)),
  );
  let energy = 0,
    maxEnergy = 0,
    peak = 0;
  for (let sample = 0; sample < buffer.length; sample++) {
    for (const channel of channels) {
      const value = channel[sample];
      energy += value * value;
      if (sample >= windowSamples) {
        const previous = channel[sample - windowSamples];
        energy -= previous * previous;
      }
      peak = Math.max(peak, Math.abs(value));
    }
    maxEnergy = Math.max(maxEnergy, energy);
  }
  const rms = Math.sqrt(maxEnergy / (windowSamples * channels.length));
  if (rms <= AUDIO.silenceThreshold) return buffer;
  const gain = Math.min(
    AUDIO.targetRms / rms,
    AUDIO.peakCeiling / peak,
    AUDIO.maxNormalizationGain,
  );
  for (const channel of channels)
    for (let sample = 0; sample < channel.length; sample++)
      channel[sample] *= gain;
  return buffer;
}

/** Soften transients once after normalization, with no per-playback filter.
 * @param {AudioBuffer} buffer
 * @param {number} volume
 * @param {number} cutoffHz
 */
function softenEffect(buffer, volume, cutoffHz) {
  const response = 1 - Math.exp((-2 * Math.PI * cutoffHz) / buffer.sampleRate);
  for (let index = 0; index < buffer.numberOfChannels; index++) {
    const channel = buffer.getChannelData(index);
    let previous = 0;
    for (let sample = 0; sample < channel.length; sample++) {
      previous += response * (channel[sample] - previous);
      channel[sample] = previous * volume;
    }
  }
  return buffer;
}

export class MergeAudio {
  constructor() {
    /** @type {AudioContext|null} */ this.context = null;
    /** @type {GainNode|null} */ this.gain = null;
    this.clips = Object.entries(AUDIO.sounds).flatMap(([type, urls]) =>
      urls.map((url) => ({ type, url })),
    );
    /** @type {(AudioBuffer|null)[]} */ this.buffers = this.clips.map(
      () => null,
    );
    /** @type {Set<AudioBufferSourceNode>} */ this.voices = new Set();
    /** @type {Promise<void>|null} */ this.ready = null;
    /** @type {Promise<void>|null} */ this.resuming = null;
    this.playbackGeneration = 0;
    this.disposed = false;
    this.warmed = false;
    this.listeners = new AbortController();
    /** @type {(Promise<void>|null)[]} */ this.pending = this.clips.map(
      () => null,
    );
    this.retryAfter = this.clips.map(() => 0);
    // Decode before the first gesture so the first keyboard drop has sound too.
    // Creating/decoding is allowed while suspended; unlock starts output later.
    this.prepare();
    // Resume synchronously from a real gesture, before any asynchronous decode.
    const unlock = () => this.unlock();
    document.addEventListener("pointerdown", unlock, {
      capture: true,
      signal: this.listeners.signal,
    });
    document.addEventListener("keydown", unlock, {
      capture: true,
      signal: this.listeners.signal,
    });
    // Touch activation is granted on release, not necessarily on pointerdown.
    // Keep all listeners: later gestures also recover interrupted iOS audio.
    for (const type of ["pointerup", "touchend", "click"])
      document.addEventListener(type, unlock, {
        capture: true,
        passive: true,
        signal: this.listeners.signal,
      });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.stop();
      },
      { signal: this.listeners.signal },
    );
  }

  /** @param {string} url */
  async loadBytes(url) {
    if (location.protocol === "file:") {
      const source = Reflect.get(window, "MergeOffline")?.audio?.[url];
      if (typeof source !== "string")
        throw new Error("Missing offline game audio");
      const binary = atob(source.slice(source.indexOf(",") + 1));
      return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
    }
    return fetchResource(new URL(url, location.href), (response) =>
      response.arrayBuffer(),
    );
  }

  /** @param {number} index @param {AudioContext} context */
  async loadClip(index, context) {
    try {
      const bytes = await this.loadBytes(this.clips[index].url);
      if (this.disposed) return;
      const buffer = await context.decodeAudioData(bytes);
      if (this.disposed) return;
      const prepared = normalizeLoudness(trimLeadingSilence(context, buffer));
      this.buffers[index] =
        this.clips[index].type === "drop"
          ? softenEffect(prepared, AUDIO.dropVolume, AUDIO.dropLowpassHz)
          : prepared;
    } catch {
      // A failed first request must not permanently disable this clip.
      this.retryAfter[index] = performance.now() + AUDIO.retryCooldownMs;
    } finally {
      this.pending[index] = null;
    }
  }

  prepare() {
    if (this.disposed) return;
    if (!this.context) {
      const Context =
        window.AudioContext || Reflect.get(window, "webkitAudioContext");
      if (!Context) return;
      try {
        this.context = new Context({ latencyHint: "interactive" });
        this.gain = this.context.createGain();
        this.gain.gain.value = AUDIO.volume;
        this.gain.connect(this.context.destination);
      } catch {
        void this.context?.close().catch(() => {});
        this.context = null;
        this.gain = null;
        return;
      }
    }
    const context = this.context;
    if (!context) return;
    this.ready = Promise.all(
      this.clips.map((_, index) => {
        if (
          !this.buffers[index] &&
          !this.pending[index] &&
          performance.now() >= this.retryAfter[index]
        )
          this.pending[index] = this.loadClip(index, context);
        return this.pending[index];
      }),
    ).then(() => {});
  }

  unlock() {
    if (this.disposed) return;
    this.prepare();
    const context = this.context;
    if (!context || !this.gain) return;
    if (context.state !== "running") {
      // Safari may leave an unactivated resume() pending. A later, valid
      // touchend/click must call resume() again instead of waiting forever.
      const resuming = context
        .resume()
        .catch(() => {})
        .finally(() => {
          if (this.resuming === resuming) this.resuming = null;
        });
      this.resuming = resuming;
    }
    if (!this.warmed || context.state !== "running") {
      // A silent one-sample source also unlocks audio on mobile WebKit.
      const warmup = context.createBufferSource();
      warmup.buffer = context.createBuffer(1, 1, context.sampleRate);
      warmup.connect(this.gain);
      warmup.onended = () => warmup.disconnect();
      warmup.start();
      this.warmed = true;
    }
  }

  /** @param {import('./types.js').GameEvent} event */
  onEvent(event) {
    if (event.type === "reset") {
      this.stop();
      return;
    }
    if (
      (event.type !== "merge" && event.type !== "drop") ||
      this.disposed ||
      document.hidden
    )
      return;
    if (!this.gain || !this.context) return;
    if (this.context.state !== "running") {
      // A first keydown can drop before resume completes. Only replay a fresh
      // event after that gesture's unlock; reset/hide cancels it immediately.
      if (this.resuming) {
        const generation = this.playbackGeneration;
        const expires = performance.now() + AUDIO.unlockGraceSeconds * 1000;
        void this.resuming.then(() => {
          if (
            generation === this.playbackGeneration &&
            performance.now() <= expires &&
            this.context?.state === "running"
          )
            this.onEvent(event);
        });
      }
      return;
    }
    const available = this.buffers.filter(
      /** @returns {buffer is AudioBuffer} */ (buffer, index) =>
        buffer !== null && this.clips[index].type === event.type,
    );
    if (!available.length) return;
    // Ready clips play immediately; blocked/stale events are not queued here.
    if (this.voices.size >= AUDIO.maxVoices) {
      const oldest = this.voices.values().next().value;
      if (oldest) {
        oldest.stop();
        this.voices.delete(oldest);
      }
    }
    const source = this.context.createBufferSource();
    // Equal-probability draw within this event's clips; repeats are allowed.
    source.buffer = available[Math.floor(Math.random() * available.length)];
    // Draw separately so either clip can play at its original or raised pitch.
    source.detune.value =
      event.type === "merge" && Math.random() < AUDIO.pitchChance
        ? AUDIO.pitchSemitones * CENTS_PER_SEMITONE
        : 0;
    source.connect(this.gain);
    source.onended = () => {
      source.disconnect();
      this.voices.delete(source);
    };
    this.voices.add(source);
    source.start();
  }

  stop() {
    this.playbackGeneration++;
    for (const source of this.voices) source.stop();
    this.voices.clear();
  }

  destroy() {
    this.disposed = true;
    this.listeners.abort();
    this.stop();
    void this.context?.close().catch(() => {});
  }
}
