import test from "node:test";
import assert from "node:assert/strict";
import { Matter } from "../src/merge/vendor.js";
import { fixture, advance } from "./helpers/merge.js";

test("one body cannot be merged twice in a simultaneous three-way contact", () => {
  const game = fixture();
  game.addPiece(0, 4.1, 12);
  game.addPiece(0, 5, 12);
  game.addPiece(0, 5.9, 12);
  advance(game, 0.5);
  assert.equal(game.pieces.size, 2);
  assert.deepEqual(
    [...game.pieces.values()].map((p) => p.level).sort(),
    [0, 1],
  );
  assert.equal(game.score, 10);
  game.destroy();
});
test("the default ninth tier is the goal, while the eighth tier can keep merging", () => {
  const game = fixture();
  assert.equal(game.config.rules.n, 9);
  assert.ok(game.config.items[8].image.endsWith("/grown1.png"));
  game.addPiece(6, 4.4, 12);
  game.addPiece(6, 5.6, 12);
  advance(game, 1);
  assert.equal(game.state, "playing");
  assert.equal([...game.pieces.values()][0].level, 7);
  game.destroy();
});

test("highest tier wins, preserves the result for rewards and restart clears it", () => {
  const game = fixture(),
    events = [];
  game.subscribe((e) => events.push(e.type));
  const penultimateLevel = game.config.rules.n - 2;
  game.addPiece(penultimateLevel, 4.4, 12);
  game.addPiece(penultimateLevel, 5.6, 12);
  advance(game, 1);
  assert.equal(game.state, "won");
  assert.equal(game.pieces.size, 1);
  assert.equal(game.score, game.config.items.at(-1).score);
  advance(game, 5);
  assert.equal(game.state, "won");
  assert.equal(game.pieces.size, 1);
  assert.equal(game.drop(5), false);
  assert.equal(events.filter((t) => t === "win").length, 1);
  game.reset();
  assert.equal(game.state, "playing");
  assert.equal(game.pieces.size, 0);
  assert.equal(game.score, 0);
  assert.equal(game.engine.world.bodies.length, 3);
  game.destroy();
});
test("drop cooldown and fresh airborne pieces do not cause immediate overflow", () => {
  const game = fixture();
  assert.equal(game.drop(5), true);
  assert.equal(game.drop(5), false);
  advance(game, 0.5);
  assert.equal(game.state, "playing");
  assert.equal(game.drop(5), true);
  game.destroy();
});
test("grounded stack deforms, settles to sleep and stops drifting", () => {
  const game = fixture();
  let impacts = 0,
    maxStrain = 0;
  game.subscribe((e) => {
    if (e.type === "bounce") impacts++;
  });
  const a = game.addPiece(1, 5, 13),
    b = game.addPiece(0, 5, 8);
  for (let i = 0; i < 60 * 20; i++) {
    game.step();
    maxStrain = Math.max(
      maxStrain,
      Math.abs(a.appliedStrain),
      Math.abs(b.appliedStrain),
    );
  }
  assert.ok(maxStrain > 0.01, "impact actually deforms colliders");
  assert.ok(
    [...game.pieces.values()].every((p) => p.body.isSleeping),
    "resting pile sleeps",
  );
  const before = [...game.pieces.values()].map((p) => ({ ...p.body.position }));
  const impactCount = impacts;
  advance(game, 5);
  [...game.pieces.values()].forEach((p, i) =>
    assert.ok(
      Math.hypot(
        p.body.position.x - before[i].x,
        p.body.position.y - before[i].y,
      ) < 0.001,
    ),
  );
  assert.equal(
    impacts,
    impactCount,
    "resting contact cannot repeatedly emit bounce events",
  );
  game.destroy();
});
test("persistent supported piece above line loses only after grace period", () => {
  const game = fixture();
  game.config.world.dangerY = 14.9;
  game.addPiece(0, 5, 14);
  advance(game, 1);
  assert.equal(game.state, "playing");
  advance(game, 4);
  assert.equal(game.state, "lost");
  game.destroy();
});

test("successful merge wakes nearby sleepers and launches them outward/upward only once", () => {
  const game = fixture();
  const left = game.addPiece(2, 2.4, 12),
    right = game.addPiece(3, 7.8, 12),
    far = game.addPiece(0, 1, 3);
  for (const p of [left, right, far]) Matter.Sleeping.set(p.body, true);
  game.addPiece(0, 4.5, 12);
  game.addPiece(0, 5.4, 12);
  let bursts = 0;
  const apply = game.burst.bind(game);
  game.burst = (source) => {
    bursts++;
    apply(source);
  };
  for (let i = 0; i < 60 && game.score === 0; i++) game.step();
  assert.equal(game.score, 10);
  assert.equal(bursts, 1);
  assert.ok(left.body.velocity.x < 0 && right.body.velocity.x > 0);
  assert.ok(left.body.velocity.y < 0 && right.body.velocity.y < 0);
  assert.equal(left.body.isSleeping, false);
  assert.equal(right.body.isSleeping, false);
  assert.equal(far.body.isSleeping, true);
  advance(game, 0.2);
  assert.equal(bursts, 1);
  game.destroy();
});

test("burst falls off with distance, caps speed and can be disabled", () => {
  const game = fixture(),
    source = game.addPiece(1, 2, 8);
  const near = game.addPiece(0, 3.2, 8),
    far = game.addPiece(0, 4.8, 8),
    outside = game.addPiece(0, 9, 3);
  game.burst(source);
  assert.ok(near.body.speed > far.body.speed && far.body.speed > 0);
  assert.equal(outside.body.speed, 0);
  game.config.mergeBurst.speed = 40;
  for (let i = 0; i < 5; i++) game.burst(source);
  assert.ok(
    (near.body.speed * 60) / game.unit <= game.config.physics.maxSpeed + 1e-6,
  );
  const before = { ...near.body.velocity };
  game.config.mergeBurst.enabled = false;
  game.burst(source);
  assert.deepEqual(near.body.velocity, before);
  game.destroy();
});

test("gentle landing has no restitution but a real drop still rebounds", () => {
  const game = fixture();
  const piece = game.addPiece(
    0,
    5,
    game.config.world.height - game.sprites[0].height / 2,
  );
  Matter.Body.setVelocity(piece.body, { x: 0, y: (0.2 * game.unit) / 60 });
  game.step();
  assert.equal(piece.body.restitution, 0);
  assert.ok(
    game.engine.pairs.list
      .filter((p) => p.isActive)
      .every((p) => p.restitution === 0),
  );
  game.reset();
  const dropped = game.addPiece(0, 5, 7);
  let fastestUp = 0;
  for (let i = 0; i < 180; i++) {
    game.step();
    fastestUp = Math.min(fastestUp, (dropped.body.velocity.y * 60) / game.unit);
  }
  assert.ok(fastestUp < -1, "high energy landing must retain strong bounce");
  game.destroy();
});

test("resting compression is independent of contact enumeration order", () => {
  const results = [];
  for (const reverse of [false, true]) {
    const game = fixture(),
      piece = game.addPiece(0, 5, 10);
    const floor = game.engine.world.bodies[2];
    const pairs = [
      {
        bodyA: piece.body,
        bodyB: floor,
        collision: { normal: { x: 0, y: 1 } },
      },
      {
        bodyA: piece.body,
        bodyB: floor,
        collision: { normal: { x: 1, y: 0 } },
      },
    ];
    game.contacts(reverse ? pairs.reverse() : pairs, false);
    game.deform(piece, 1 / game.config.physics.fixedHz);
    results.push([piece.restStrain, piece.appliedStrain]);
    game.destroy();
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], [0, 0]);
});

test("merge jelly is visible, reverses direction and decays without perpetual wobble", () => {
  const game = fixture();
  const piece = game.addPiece(1, 5, 8);
  const mass = piece.body.mass;
  game.burst(piece);
  let peak = 0,
    trough = 0;
  for (let i = 0; i < game.config.physics.fixedHz * 3; i++) {
    // Isolate the spring from new impacts, so this tests its actual decay.
    game.deform(piece, 1 / game.config.physics.fixedHz);
    peak = Math.max(peak, piece.appliedStrain);
    trough = Math.min(trough, piece.appliedStrain);
    assert.ok(Math.abs(piece.appliedStrain) <= game.config.jelly.maxStrain);
  }
  assert.ok(Math.exp(peak) - 1 > 0.09, "merge stretches at least 9%");
  assert.ok(
    trough < -0.02,
    "visible reverse rebound rather than only shrinking back",
  );
  assert.ok(Math.abs(piece.appliedStrain) <= game.config.jelly.scaleEpsilon);
  assert.equal(piece.strainVelocity, 0);
  assert.ok(Math.abs(piece.body.mass / mass - 1) < 1e-8);
  game.destroy();
});

test("jelly ignores gentle contacts and limits repeat impact triggers", () => {
  const game = fixture(),
    piece = game.addPiece(0, 5, 8);
  const floor = game.engine.world.bodies[2];
  const pairs = [
    { bodyA: piece.body, bodyB: floor, collision: { normal: { x: 0, y: 1 } } },
  ];
  game.velocities.set(piece.body.id, {
    x: 0,
    y: (0.5 * game.config.jelly.minImpactSpeed * game.unit) / 60,
  });
  game.contacts(pairs, true);
  assert.equal(piece.strainVelocity, 0);
  game.velocities.set(piece.body.id, { x: 0, y: (5 * game.unit) / 60 });
  game.contacts(pairs, true);
  const kick = piece.strainVelocity;
  assert.ok(kick > 0);
  game.contacts(pairs, true);
  game.contacts(pairs, false);
  assert.equal(piece.strainVelocity, kick);
  game.destroy();
});

test("velocity snapshots are released on merge, reset and disposal", () => {
  const game = fixture();
  const a = game.addPiece(0, 4.55, 12),
    b = game.addPiece(0, 5.45, 12);
  advance(game, 1);
  assert.equal(game.pieces.size, 1);
  assert.equal(game.velocities.has(a.body.id), false);
  assert.equal(game.velocities.has(b.body.id), false);
  assert.equal(game.velocities.size, game.pieces.size);
  game.reset();
  assert.equal(game.velocities.size, 0);
  game.addPiece(0, 5, 8);
  game.step();
  game.destroy();
  assert.equal(game.velocities.size, 0);
  assert.equal(game.pieces.size, 0);
  assert.equal(game.mergeQueue.size, 0);
});
