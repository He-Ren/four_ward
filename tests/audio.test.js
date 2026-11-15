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
