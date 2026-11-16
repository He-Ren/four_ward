import test from "node:test";
import assert from "node:assert/strict";
import { base, skin } from "./helpers/merge.js";
import {
  validateSkin,
  chooseLevel,
  chooseNextLevel,
} from "../src/merge/config.js";

test("skin validates sizes, counts, numeric values and weighted spawn range", () => {
  validateSkin(skin());
  assert.equal(
    chooseLevel(base, () => 0),
    0,
  );
  assert.equal(
    chooseLevel(base, () => 0.279),
    0,
  );
  assert.equal(
    chooseLevel(base, () => 0.28),
    1,
  );
  assert.equal(
    chooseLevel(base, () => 0.9999),
    4,
  );
  for (const mutate of [
    (c) => (c.rules.n = c.items.length + 1),
    (c) => (c.rules.m = c.rules.n),
    (c) => (c.items[1].size = 0.5),
    (c) => (c.physics.gravity = NaN),
    (c) => (c.rules.overflowMaxSpeed = -1),
    (c) => c.items.forEach((i) => (i.weight = 0)),
  ]) {
    const config = skin();
    mutate(config);
    assert.throws(() => validateSkin(config));
  }
});
test("repeat avoidance has a bounded fallback and an independent mode", () => {
  let draws = [0.1, 0.2, 0.3];
  assert.equal(
    chooseNextLevel(base, () => draws.shift(), 0),
    1,
  );
  let calls = 0;
  assert.equal(
    chooseNextLevel(
      base,
      () => {
        calls++;
        return 0;
      },
      0,
    ),
    0,
  );
  assert.equal(calls, base.rules.repeatRetries + 1);
  const c = skin();
  c.rules.avoidRepeat = false;
  calls = 0;
  assert.equal(
    chooseNextLevel(
      c,
      () => {
        calls++;
        return 0;
      },
      0,
    ),
    0,
  );
  assert.equal(calls, 1);
  c.rules.avoidRepeat = true;
  c.rules.m = 1;
  assert.equal(
    chooseNextLevel(c, () => 0, 0),
    0,
  );
  const old = skin();
  delete old.rules.avoidRepeat;
  delete old.rules.repeatRetries;
  delete old.mergeBurst;
  validateSkin(old);
  assert.equal(old.rules.avoidRepeat, false);
  assert.equal(old.mergeBurst.enabled, false);
});

test("older skins receive a finite overflow speed threshold", () => {
  const config = skin();
  delete config.rules.overflowMaxSpeed;
  validateSkin(config);
  assert.equal(config.rules.overflowMaxSpeed, 1.2);
});
