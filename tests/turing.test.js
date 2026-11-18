import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "../src/turing/core.js";

const { validateConfig, validateScenarios, drawRound, Round, boldSegments } = globalThis.TuringCore;
const bank = JSON.parse(readFileSync(new URL("../assets/turing/scenarios.json", import.meta.url), "utf8"));

function random(seed = 42) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("draws ten distinct scenes with a genuine answer and one distinct decoy", () => {
  const unchanged = JSON.stringify(bank);
  const rng = random();
  const counts = { gpt: 0, deepseek: 0, doubao: 0 };
  const positions = [0, 0];
  for (let iteration = 0; iteration < 100; iteration++) {
    const questions = drawRound(bank, rng);
    assert.equal(questions.length, 10);
    assert.equal(new Set(questions.map((q) => q.sceneIndex)).size, 10);
    for (const question of questions) {
      assert.equal(question.answer, bank[question.sceneIndex].responses[question.correctModel]);
      assert.equal(new Set(question.options).size, 2);
      assert.ok(question.options.includes(question.correctModel));
      counts[question.correctModel]++;
      positions[question.options.indexOf(question.correctModel)]++;
    }
  }
  assert.ok(Object.values(counts).every((count) => count > 200));
  assert.ok(positions.every((count) => count > 350));
  assert.equal(JSON.stringify(bank), unchanged);
  assert.notDeepEqual(drawRound(bank, rng), drawRound(bank, rng));
});

test("scores once per question, waits for advance, and applies the inclusive threshold", () => {
  for (const targetScore of [0, 6, 7, 10]) {
    const round = new Round(drawRound(bank, random()));
    assert.equal(round.advance(), false);
    assert.equal(round.choose("unknown-model"), null);
    assert.equal(round.won(0), false);
    for (let index = 0; index < 10; index++) {
      const model = index < targetScore ? round.current.correctModel
        : round.current.options.find((option) => option !== round.current.correctModel);
      assert.equal(round.choose(model).correct, index < targetScore);
      assert.equal(round.choose(model), null, "double taps cannot score twice");
      assert.equal(round.phase, "feedback");
      assert.equal(round.index, index);
      assert.equal(round.advance(), true);
    }
    assert.equal(round.phase, "finished");
    assert.equal(round.score, targetScore);
    assert.equal(round.won(7), targetScore >= 7);
    assert.equal(round.advance(), false);
    assert.equal(round.choose("gpt"), null);
  }
});

test("configuration rejects invalid values and incomplete banks", () => {
  assert.deepEqual(validateConfig({ k: 7, s: 0.5 }), { k: 7, s: 0.5 });
  for (const k of [-1, 11, 1.5, "7", null]) assert.throws(() => validateConfig({ k, s: 2 }));
  for (const s of [-1, 61, NaN, Infinity, "2"]) assert.throws(() => validateConfig({ k: 7, s }));
  assert.throws(() => validateScenarios(bank.slice(0, 9)));
  assert.throws(() => validateScenarios([...bank.slice(0, 10), bank[0]]));
  const incomplete = structuredClone(bank);
  delete incomplete[0].responses.doubao;
  assert.throws(() => validateScenarios(incomplete));
});

test("only paired bold markers receive styling; HTML stays plain data", () => {
  assert.deepEqual(boldSegments('先说**重点**，再说**另一个**。'), [
    { text: '先说', bold: false }, { text: '重点', bold: true },
    { text: '，再说', bold: false }, { text: '另一个', bold: true }, { text: '。', bold: false },
  ]);
  assert.deepEqual(boldSegments('**好**'), [{ text: '好', bold: true }]);
  assert.deepEqual(boldSegments('<img src=x onerror=alert(1)> **未闭合'), [
    { text: '<img src=x onerror=alert(1)> **未闭合', bold: false },
  ]);
});
