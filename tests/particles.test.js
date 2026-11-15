import test from "node:test";
import assert from "node:assert/strict";
import { base, skin } from "./helpers/merge.js";
import { Renderer } from "../src/merge/renderer.js";
import { validateSkin } from "../src/merge/config.js";

const merge = { type: "merge", x: 5, y: 8, level: 1, strength: 1 };
function fixture() {
  const renderer = Object.create(Renderer.prototype);
  renderer.game = {
    config: validateSkin(skin()),
    sprites: [
      { particleColors: ["#ff0000"] },
      { particleColors: ["#112233", "#445566"] },
    ],
    state: "won",
    unit: 100,
    pieces: new Map(),
  };
  renderer.particles = [];
  renderer.reducedMotion = false;
  return renderer;
}

test("particles independently sample the resulting tier, direction, speed, life and opacity", () => {
  const renderer = fixture();
  renderer.game.config.rendering.particleCount = 2;
  // Exercise optional random opacity even though the shipped skin fixes it.
  renderer.game.config.rendering.particleOpacityMin = 0.45;
  renderer.game.config.rendering.particleOpacityMax = 0.75;
  // Five separate draws per particle; the source-tier red must never be used.
  const draws = [0.1, 0, 0, 0, 0, 0.9, 0.25, 0.99, 0.99, 0.99];
  renderer.effect(merge, () => draws.shift());
  assert.equal(draws.length, 0);
  const [a, b] = renderer.particles;
  assert.equal(a.color, "#112233");
  assert.equal(b.color, "#445566");
  assert.equal(a.vy, 0);
  assert.ok(b.vy > 0 && Math.abs(b.vx) < 1e-8);
  assert.ok(a.life < b.life && a.opacity < b.opacity);
  const r = renderer.game.config.rendering;
  for (const p of [a, b]) {
    assert.ok(
      Math.hypot(p.vx, p.vy) >= r.particleSpeed * r.particleMinSpeedRatio,
    );
    assert.ok(Math.hypot(p.vx, p.vy) <= r.particleSpeed);
    assert.ok(
      p.life >= r.particleLifetime * r.particleMinLifetimeRatio &&
        p.life <= r.particleLifetime,
    );
    assert.ok(
      p.opacity >= r.particleOpacityMin && p.opacity <= r.particleOpacityMax,
    );
  }
});

test("gravity follows a frame-rate-independent ballistic path, with no collision or body interaction", () => {
  const a = fixture(),
    b = fixture();
  a.effect(merge, () => 0.5);
  b.particles = structuredClone(a.particles);
  const initial = structuredClone(a.particles[0]);
  a.updateParticles(0.2);
  b.updateParticles(0.1);
  b.updateParticles(0.1);
  for (const key of ["x", "y", "vx", "vy", "age"])
    assert.ok(Math.abs(a.particles[0][key] - b.particles[0][key]) < 1e-8);
  assert.ok(
    Math.abs(
      a.particles[0].y -
        (initial.y +
          initial.vy * 0.2 +
          0.5 * base.rendering.particleGravity * 0.2 ** 2),
    ) < 1e-8,
  );
  assert.equal(a.game.pieces.size, 0);
  // Crossing the floor does not bounce, clamp or create a body.
  a.particles[0].y = base.world.height + 1;
  a.particles[0].vy = 2;
  a.updateParticles(0.1);
  assert.ok(a.particles[0].y > base.world.height + 1 && a.particles[0].vy > 2);
});

test("rendering fades initial opacity, pauses motion/age, and removes expired particles", () => {
  const renderer = fixture(),
    fills = [];
  renderer.game.config.rendering.particleCount = 1;
  renderer.effect(merge, () => 0.5);
  renderer.canvas = { width: 100, height: 150 };
  renderer.board = { classList: { toggle() {} } };
  renderer.ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key === "fill")
          return () =>
            fills.push({ color: target.fillStyle, alpha: target.globalAlpha });
        return key in target ? target[key] : () => {};
      },
    },
  );
  const initial = structuredClone(renderer.particles[0]);
  renderer.draw(5, 0.1, false);
  assert.equal(fills.at(-1).color, initial.color);
  assert.ok(
    Math.abs(fills.at(-1).alpha - initial.opacity * (1 - 0.1 / initial.life)) <
      1e-8,
  );
  const paused = structuredClone(renderer.particles);
  renderer.draw(5, 0.3, true);
  assert.deepEqual(renderer.particles, paused);
  renderer.draw(5, initial.life, false);
  assert.equal(renderer.particles.length, 0);
});

test("particle bursts respect the cap, reset and reduced-motion setting", () => {
  const renderer = fixture();
  renderer.game.config.rendering.maxParticles = 20;
  for (let i = 0; i < 10; i++) renderer.effect(merge);
  assert.equal(renderer.particles.length, 20);
  renderer.effect({ ...merge, type: "reset" });
  assert.equal(renderer.particles.length, 0);
  renderer.reducedMotion = true;
  renderer.effect(merge);
  assert.equal(renderer.particles.length, 0);
});

test("old skins receive particle defaults and invalid random ranges are rejected", () => {
  const old = structuredClone(base);
  for (const key of [
    "particleMinLifetimeRatio",
    "particleMinSpeedRatio",
    "particleOpacityMin",
    "particleOpacityMax",
    "particleGravity",
    "maxParticles",
  ])
    delete old.rendering[key];
  validateSkin(old);
  assert.equal(old.rendering.particleGravity, old.physics.gravity);
  assert.equal(old.rendering.maxParticles, 512);
  for (const patch of [
    { particleMinLifetimeRatio: 0 },
    { particleMinSpeedRatio: 1.1 },
    { particleOpacityMin: 0.9, particleOpacityMax: 0.2 },
    { particleGravity: -1 },
    { maxParticles: 1.5 },
  ]) {
    const config = structuredClone(base);
    Object.assign(config.rendering, patch);
    assert.throws(() => validateSkin(config));
  }
});
