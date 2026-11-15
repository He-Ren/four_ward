import test from "node:test";
import assert from "node:assert/strict";
import {
  MergeAudio,
  normalizeLoudness,
  trimLeadingSilence,
} from "../src/merge/audio.js";

function buffer(channels = 1, length = 1000, sampleRate = 1000) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: (i) => data[i],
  };
}

test("audio trimming respects the earliest channel, pre-roll and original tail", () => {
  const source = buffer(2);
  source.getChannelData(0)[200] = 0.5;
  source.getChannelData(1)[100] = 0.25;
  source.getChannelData(1)[999] = -0.1;
  const result = trimLeadingSilence({ createBuffer: buffer }, source);
  assert.equal(result.length, 904);
  assert.equal(result.getChannelData(1)[4], 0.25);
  assert.equal(result.getChannelData(0)[104], 0.5);
  assert.equal(
    result.getChannelData(1).at(-1),
    source.getChannelData(1).at(-1),
  );
  assert.equal(source.length, 1000);
  const silent = buffer();
  assert.equal(trimLeadingSilence({ createBuffer: buffer }, silent), silent);
});

test("normalization matches loudness while retaining silence and protecting peaks", () => {
  for (const amplitude of [0.1, 0.4]) {
    const sound = buffer();
    sound.getChannelData(0).fill(amplitude, 100, 300);
    normalizeLoudness(sound);
    assert.ok(Math.abs(sound.getChannelData(0)[150] - 0.2) < 1e-6);
    assert.equal(sound.getChannelData(0)[0], 0);
  }
  const impulse = buffer();
  impulse.getChannelData(0)[100] = 1;
  normalizeLoudness(impulse);
  assert.ok(Math.max(...impulse.getChannelData(0)) <= 0.900001);
  const silent = buffer();
  normalizeLoudness(silent);
  assert.ok(silent.getChannelData(0).every((v) => v === 0));
});

test("merge sound choice and pitch are independent; drop, voice cap and reset stay bounded", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, "document", previous)
      : delete globalThis.document,
  );
  const audio = Object.create(MergeAudio.prototype);
  const created = [];
  Object.assign(audio, {
    disposed: false,
    gain: {},
    voices: new Set(),
    playbackGeneration: 0,
    clips: [{ type: "merge" }, { type: "merge" }, { type: "drop" }],
    buffers: [buffer(), buffer(), buffer()],
    context: {
      state: "running",
      createBufferSource() {
        const source = {
          detune: { value: 0 },
          connect() {},
          disconnect() {},
          start() {},
          stop() {
            this.stopped = true;
          },
        };
        created.push(source);
        return source;
      },
    },
  });
  const event = { type: "merge", x: 0, y: 0, level: 1, strength: 1 };
  const draws = [0.1, 0.1, 0.1, 0.9, 0.9, 0.1, 0.9, 0.9, 0.5];
  t.mock.method(Math, "random", () => {
    assert.ok(draws.length);
    return draws.shift();
  });
  for (let i = 0; i < 4; i++) audio.onEvent(event);
  assert.deepEqual(
    created.map((s) => audio.buffers.indexOf(s.buffer)),
    [0, 0, 1, 1],
  );
  assert.deepEqual(
    created.map((s) => s.detune.value),
    [300, 0, 300, 0],
  );
  audio.onEvent({ ...event, type: "drop" });
  assert.equal(created[4].buffer, audio.buffers[2]);
  assert.equal(created[4].detune.value, 0);
  assert.equal(created[0].stopped, true);
  assert.equal(audio.voices.size, 4);
  audio.onEvent({ ...event, type: "bounce" });
  assert.equal(created.length, 5);
  audio.onEvent({ ...event, type: "reset" });
  assert.equal(audio.voices.size, 0);
  assert.ok(created.every((s) => s.stopped));
  assert.equal(draws.length, 0);
});

function audioEnvironment(t, Context) {
  const document = new EventTarget();
  document.hidden = false;
  for (const [name, value] of Object.entries({
    document,
    window: { AudioContext: Context },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, name, previous)
        : delete globalThis[name],
    );
  }
  t.mock.method(
    MergeAudio.prototype,
    "loadBytes",
    async () => new ArrayBuffer(8),
  );
  return document;
}

class FakeContext {
  state = "suspended";
  sampleRate = 1000;
  createGain() {
    return { gain: { value: 0 }, connect() {} };
  }
  createBuffer = buffer;
  async decodeAudioData() {
    return buffer();
  }
  createBufferSource() {
    return { connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  async close() {}
}

test("touch release retries a pending resume; later touch can recover interrupted audio", async (t) => {
  let calls = 0;
  class Context extends FakeContext {
    resume() {
      calls++;
      if (calls === 1) return new Promise(() => {}); // Safari before touch activation.
      this.state = "running";
      return Promise.resolve();
    }
  }
  const document = audioEnvironment(t, Context);
  const audio = new MergeAudio();
  t.after(() => audio.destroy());
  await audio.ready;
  document.dispatchEvent(new Event("pointerdown"));
  assert.equal(calls, 1);
  assert.equal(audio.context.state, "suspended");
  document.dispatchEvent(new Event("touchend"));
  await audio.resuming;
  assert.equal(calls, 2);
  assert.equal(audio.context.state, "running");
  audio.context.state = "interrupted";
  document.dispatchEvent(new Event("pointerup"));
  await audio.resuming;
  assert.equal(calls, 3);
  assert.equal(audio.context.state, "running");
  audio.destroy();
  audio.context.state = "suspended";
  document.dispatchEvent(new Event("touchend"));
  assert.equal(calls, 3, "disposed listeners are removed");
});

test("failed audio loads can recover without decoding successful clips again", async (t) => {
  class Context extends FakeContext {
    async resume() {
      this.state = "running";
    }
  }
  audioEnvironment(t, Context);
  let fail = true;
  const calls = new Map();
  t.mock.method(MergeAudio.prototype, "loadBytes", async function (url) {
    calls.set(url, (calls.get(url) || 0) + 1);
    if (fail && url.endsWith("pop.mp3")) throw new Error("offline");
    return new ArrayBuffer(8);
  });
  const audio = new MergeAudio();
  t.after(() => audio.destroy());
  await audio.ready;
  assert.equal(audio.buffers.filter(Boolean).length, 2);
  audio.prepare();
  await audio.ready;
  assert.equal(
    calls.get("./assets/merge/pop.mp3"),
    1,
    "cooldown prevents request storms",
  );
  fail = false;
  audio.retryAfter.fill(0);
  audio.prepare();
  audio.prepare();
  await audio.ready;
  assert.equal(audio.buffers.filter(Boolean).length, 3);
  assert.equal(calls.get("./assets/merge/pop.mp3"), 2);
  assert.equal(calls.get("./assets/merge/pop2.mp3"), 1);
  assert.equal(calls.get("./assets/merge/drop-soft.wav"), 1);
});
