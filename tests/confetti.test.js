import assert from "node:assert/strict";
import test from "node:test";
import "../src/turing/confetti.js";

const { COLORS, createParticles, stepParticle } = globalThis.TuringConfetti;
function seeded(seed = 32) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test("both lower corners launch colored rectangles inward with randomized impulses and angles", () => {
  for (const [width, height] of [[390, 844], [1280, 720]]) {
    const particles = createParticles(width, height, 160, seeded());
    assert.equal(particles.filter((p) => p.side === "left").length, 80);
    assert.equal(particles.filter((p) => p.side === "right").length, 80);
    assert.ok(new Set(particles.map((p) => p.angle)).size > 80);
    assert.ok(new Set(particles.map((p) => p.impulse)).size > 80);
    assert.ok(new Set(particles.map((p) => p.color)).size >= 5);
    for (const p of particles) {
      assert.equal(p.x, p.side === "left" ? -8 : width + 8);
      assert.equal(p.y, height + 8);
      assert.ok(p.side === "left" ? p.vx > 0 : p.vx < 0);
      assert.ok(p.vy < 0 && p.gravity > 0);
      assert.ok(p.width > 0 && p.height > 0 && COLORS.includes(p.color));
      assert.ok(p.delay >= 0 && p.delay < 0.65);
    }
  }
});

test("gravity produces a frame-rate-independent arc and brings particles back down", () => {
  for (const initial of createParticles(390, 844, 20, seeded())) {
    const coarse = { ...initial }, fine = { ...initial };
    for (let n = 0; n < 20; n++) stepParticle(coarse, 0.05);
    for (let n = 0; n < 100; n++) stepParticle(fine, 0.01);
    for (const key of ["x", "y", "vx", "vy", "rotation"]) {
      assert.ok(Math.abs(coarse[key] - fine[key]) < 1e-8, key);
    }
    assert.ok(coarse.y < initial.y);
    stepParticle(coarse, 9);
    assert.ok(coarse.vy > 0 && coarse.y > 844);
  }
});
