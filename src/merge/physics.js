// @ts-check
import { Matter } from "./vendor.js";
import { chooseLevel, chooseNextLevel } from "./config.js";
import { centerOfMass } from "./geometry.js";
/** @typedef {import('./types.js').Skin} Skin */
/** @typedef {import('./types.js').Sprite} Sprite */
/** @typedef {import('./types.js').Piece} Piece */
/** @typedef {import('./types.js').GameEvent} GameEvent */
const MILLISECONDS_PER_SECOND = 1000;
// Matter normalizes velocities to a 60 Hz base tick, independent of fixedHz.
const MATTER_BASE_HZ = 60;
const STATIC_VELOCITY = Object.freeze({ x: 0, y: 0 });
const { Engine, Body, Bodies, Composite, Events, Sleeping } = Matter;
/** @param {number} value @param {number} min @param {number} max */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class MergeWorld {
  /** @param {Skin} config @param {Sprite[]} sprites @param {() => number} [random] */
  constructor(config, sprites, random = Math.random) {
    this.config = config;
    this.sprites = sprites;
    // Cache skin geometry; only the deformation multiplier changes each tick.
    this.radii = sprites.map((sprite) =>
      Math.hypot(
        Math.max(sprite.center.x, sprite.width - sprite.center.x),
        Math.max(sprite.center.y, sprite.height - sprite.center.y),
      ),
    );
    this.random = random;
    this.unit = config.physics.unitsPerWorldUnit;
    this.engine = Engine.create({
      enableSleeping: true,
      positionIterations: config.physics.positionIterations,
      velocityIterations: config.physics.velocityIterations,
    });
    this.engine.gravity.y = 1;
    this.engine.gravity.scale =
      (config.physics.gravity * this.unit) / MILLISECONDS_PER_SECOND ** 2;
    /** @type {Map<number,Piece>} */ this.pieces = new Map();
    /** @type {Set<(event:GameEvent)=>void>} */ this.listeners = new Set();
    /** @type {Map<string,[Piece,Piece]>} */ this.mergeQueue = new Map();
    /** @type {Map<number,{x:number,y:number}>} */ this.velocities = new Map();
    /** @type {'playing'|'won'|'lost'} */ this.state = "playing";
    this.time = 0;
    this.celebrationRemaining = 0;
    this.score = 0;
    this.drops = 0;
    this.lastDrop = -Infinity;
    this.current = 0;
    this.next = 0;
    Events.on(this.engine, "collisionStart", (event) =>
      this.contacts(event.pairs, true),
    );
    Events.on(this.engine, "collisionActive", (event) =>
      this.contacts(event.pairs, false),
    );
    Events.on(this.engine, "beforeSolve", () => this.updateRestitution());
    this.reset();
  }
  /** Audio and other effects subscribe here; physics never depends on a player.
   * @param {(event:GameEvent)=>void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** @param {GameEvent} event */
  emit(event) {
    for (const listener of this.listeners) listener(event);
  }
  reset() {
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
    this.engine.timing.timestamp = 0;
    this.pieces.clear();
    this.mergeQueue.clear();
    this.velocities.clear();
    this.state = "playing";
    this.time = 0;
    this.celebrationRemaining = 0;
    this.score = 0;
    this.drops = 0;
    this.lastDrop = -Infinity;
    this.current = chooseLevel(this.config, this.random);
    this.next = chooseNextLevel(this.config, this.random, this.current);
    const { width, height, wallThickness: t } = this.config.world,
      u = this.unit;
    const options = {
      isStatic: true,
      friction: this.config.physics.friction,
      restitution: 0,
      label: "container",
    };
    Composite.add(this.engine.world, [
      Bodies.rectangle(
        (-t * u) / 2,
        (height * u) / 2,
        t * u,
        (height + 2 * t) * u,
        options,
      ),
      Bodies.rectangle(
        (width + t / 2) * u,
        (height * u) / 2,
        t * u,
        (height + 2 * t) * u,
        options,
      ),
      Bodies.rectangle(
        (width * u) / 2,
        (height + t / 2) * u,
        (width + 2 * t) * u,
        t * u,
        options,
      ),
    ]);
    this.emit({ type: "reset", x: 0, y: 0, level: 0, strength: 0 });
  }
  /** @param {number} x @param {number} [level] */
  clampX(x, level = this.current) {
    const sprite = this.sprites[level],
      padding = Math.exp(this.config.jelly.maxStrain);
    return clamp(
      x,
      sprite.center.x * padding,
      this.config.world.width - (sprite.width - sprite.center.x) * padding,
    );
  }
  get isSimulating() {
    return this.state === "playing" || this.celebrationRemaining > 0;
  }
  get canDrop() {
    return (
      this.state === "playing" &&
      this.time - this.lastDrop >= this.config.rules.dropCooldown
    );
  }
  /** @param {number} x */
  drop(x) {
    if (!this.canDrop) return false;
    if (this.pieces.size >= this.config.rules.maxBodies) {
      this.finish("lost");
      return false;
    }
    const level = this.current;
    this.addPiece(level, this.clampX(x), this.config.world.spawnY);
    this.lastDrop = this.time;
    this.drops++;
    this.current = this.next;
    this.next = chooseNextLevel(this.config, this.random, this.current);
    this.emit({
      type: "drop",
      x,
      y: this.config.world.spawnY,
      level,
      strength: 1,
    });
    return true;
  }
  /** Public deterministic construction is also used by simulation tests.
   * @param {number} level @param {number} x @param {number} y @returns {Piece} */
  addPiece(level, x, y) {
    const sprite = this.sprites[level],
      p = this.config.physics,
      u = this.unit;
    const options = {
      restitution: p.restitution,
      friction: p.friction,
      frictionStatic: p.frictionStatic,
      frictionAir: p.airDrag,
      density: p.density,
      slop: p.slop * u,
      sleepThreshold: p.sleepFrames,
    };
    const parts = sprite.polygons.map((polygon) => {
      const vertices = polygon.map((point) => ({
        x: point.x * u,
        y: point.y * u,
      }));
      return Body.create({
        ...options,
        position: centerOfMass([vertices]),
        vertices,
      });
    });
    // Flag shared internal edges of the convex decomposition for contact support selection.
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++)
        for (const a of parts[i].vertices)
          for (const b of parts[j].vertices)
            if (Math.hypot(a.x - b.x, a.y - b.y) < p.slop * u) {
              Reflect.set(a, "isInternal", true);
              Reflect.set(b, "isInternal", true);
            }
    const body =
      parts.length === 1 ? parts[0] : Body.create({ ...options, parts });
    body.label = `merge:${level}`;
    Body.setPosition(body, { x: x * u, y: y * u });
    const piece = {
      body,
      level,
      born: this.time,
      touched: false,
      overflow: 0,
      strain: 0,
      strainVelocity: 0,
      restStrain: 0,
      contactStrain: 0,
      contactCount: 0,
      lastImpact: -Infinity,
      appliedStrain: 0,
    };
    this.pieces.set(body.id, piece);
    Composite.add(this.engine.world, body);
    return piece;
  }
  /** @param {import('./matter-types.js').Pair[]} pairs @param {boolean} started */
  contacts(pairs, started) {
    const j = this.config.jelly;
    for (const pair of pairs) {
      const a = this.pieces.get(pair.bodyA.parent.id),
        b = this.pieces.get(pair.bodyB.parent.id);
      if (a) a.touched = true;
      if (b) b.touched = true;
      const normal = pair.collision.normal;
      for (const piece of [a, b])
        if (piece && !piece.body.isSleeping) {
          const angle = piece.body.angle;
          const cos = Math.cos(angle),
            sin = Math.sin(angle);
          const nx = normal.x * cos + normal.y * sin;
          const ny = -normal.x * sin + normal.y * cos;
          const directional = ny * ny - nx * nx;
          const rest = directional * j.restCompression;
          // Average simultaneous contact directions rather than choosing the
          // first equally strong one (whose order can change between frames).
          piece.contactStrain += rest;
          piece.contactCount++;
          if (started && this.time - piece.lastImpact >= j.impactCooldown) {
            const va =
              this.velocities.get(pair.bodyA.parent.id) || STATIC_VELOCITY;
            const vb =
              this.velocities.get(pair.bodyB.parent.id) || STATIC_VELOCITY;
            const speed =
              (Math.abs((va.x - vb.x) * normal.x + (va.y - vb.y) * normal.y) *
                MATTER_BASE_HZ) /
              this.unit;
            if (speed >= j.minImpactSpeed) {
              piece.lastImpact = this.time;
              if (j.enabled)
                piece.strainVelocity +=
                  directional *
                  Math.min(speed, this.config.physics.maxSpeed) *
                  j.impactGain;
              this.emit({
                type: "bounce",
                x: piece.body.position.x / this.unit,
                y: piece.body.position.y / this.unit,
                level: piece.level,
                strength: speed,
              });
            }
          }
        }
      if (
        a &&
        b &&
        a.level === b.level &&
        a.level < this.config.rules.n - 1 &&
        this.time - a.born >= this.config.rules.mergeCooldown &&
        this.time - b.born >= this.config.rules.mergeCooldown
      ) {
        this.mergeQueue.set(
          [a.body.id, b.body.id].sort((x, y) => x - y).join(":"),
          [a, b],
        );
      }
    }
  }
  /** Called after gravity integration but before contact pairs are built.
   * The engine reads restitution from the parent of every convex part. Use a
   * conservative surface-speed bound so fast spinning pieces still bounce. */
  updateRestitution() {
    const physics = this.config.physics;
    for (const piece of this.pieces.values()) {
      const body = piece.body;
      const velocity = Body.getVelocity(body);
      const radius =
        this.radii[piece.level] * Math.exp(Math.abs(piece.appliedStrain));
      const surfaceSpeed =
        (Math.hypot(velocity.x, velocity.y) * MATTER_BASE_HZ) / this.unit +
        Math.abs(Body.getAngularVelocity(body)) * MATTER_BASE_HZ * radius;
      body.restitution =
        !body.isSleeping && surfaceSpeed >= physics.bounceThreshold
          ? physics.restitution
          : 0;
    }
  }
  /** @param {Piece} piece @param {number} dt */
  deform(piece, dt) {
    const j = this.config.jelly;
    if (!j.enabled || piece.body.isSleeping) return;
    const target = piece.contactCount
      ? piece.contactStrain / piece.contactCount
      : 0;
    // Ignore tiny changes in resting contact normals; ease genuine changes.
    const restDelta = target - piece.restStrain;
    if (Math.abs(restDelta) > j.restDeadband) {
      piece.restStrain += restDelta * (1 - Math.exp(-j.restResponse * dt));
    }
    piece.strainVelocity +=
      (j.stiffness * (piece.restStrain - piece.strain) -
        j.damping * piece.strainVelocity) *
      dt;
    piece.strain = clamp(
      piece.strain + piece.strainVelocity * dt,
      -j.maxStrain,
      j.maxStrain,
    );
    if (Math.abs(piece.strain) === j.maxStrain) piece.strainVelocity = 0;
    if (
      Math.abs(piece.strain - piece.restStrain) < j.settleEpsilon &&
      Math.abs(piece.strainVelocity) < j.settleEpsilon
    ) {
      piece.strain = piece.restStrain;
      piece.strainVelocity = 0;
    }
    const delta = piece.strain - piece.appliedStrain;
    if (Math.abs(delta) < j.scaleEpsilon) return;
    const body = piece.body,
      angle = body.angle;
    // Scale in local axes; reciprocal scales conserve area/mass. Rendering uses
    // exactly appliedStrain, so the alpha shape and collider deform together.
    Body.rotate(body, -angle);
    Body.scale(body, Math.exp(delta), Math.exp(-delta));
    Body.rotate(body, angle);
    piece.appliedStrain = piece.strain;
  }
  /** Local radial impulse, expressed in world units/second, not pixels.
   * @param {Piece} source */
  burst(source) {
    const burst = this.config.mergeBurst;
    if (!burst.enabled || burst.speed === 0) return;
    const center = source.body.position;
    const range =
      this.config.items[source.level].size * burst.rangeMultiplier +
      burst.rangePadding;
    if (this.config.jelly.enabled) source.strainVelocity += burst.strainKick;
    for (const piece of this.pieces.values()) {
      if (piece === source) continue;
      const body = piece.body;
      // Distance to the nearest point of the target's bounds keeps tall and
      // large silhouettes in range even when their center is farther away.
      const nearX = clamp(center.x, body.bounds.min.x, body.bounds.max.x);
      const nearY = clamp(center.y, body.bounds.min.y, body.bounds.max.y);
      const distance =
        Math.hypot(nearX - center.x, nearY - center.y) / this.unit;
      if (distance >= range) continue;
      let nx = body.position.x - center.x,
        ny = body.position.y - center.y;
      const length = Math.hypot(nx, ny);
      if (length > 0) {
        nx /= length;
        ny /= length;
      } else {
        nx = 0;
        ny = -1;
      }
      ny -= burst.upwardBias;
      const directionLength = Math.hypot(nx, ny);
      if (directionLength === 0) {
        nx = 0;
        ny = -1;
      } else {
        nx /= directionLength;
        ny /= directionLength;
      }
      const falloff = 1 - distance / range;
      const massScale = clamp(
        (source.body.mass / body.mass) ** burst.massExponent,
        burst.minMassScale,
        burst.maxMassScale,
      );
      const kick =
        (burst.speed * falloff * massScale * this.unit) / MATTER_BASE_HZ;
      Sleeping.set(body, false);
      let vx = body.velocity.x + nx * kick,
        vy = body.velocity.y + ny * kick;
      const maxVelocity =
        (this.config.physics.maxSpeed * this.unit) / MATTER_BASE_HZ;
      const limit = Math.min(1, maxVelocity / (Math.hypot(vx, vy) || 1));
      Body.setVelocity(body, { x: vx * limit, y: vy * limit });
      Body.setAngularVelocity(
        body,
        clamp(
          body.angularVelocity + nx * burst.spin * falloff,
          -burst.spin,
          burst.spin,
        ),
      );
      if (this.config.jelly.enabled) {
        const angle = body.angle;
        const localX = nx * Math.cos(angle) + ny * Math.sin(angle);
        const localY = -nx * Math.sin(angle) + ny * Math.cos(angle);
        piece.strainVelocity +=
          (localY * localY - localX * localX) * burst.strainKick * falloff;
      }
    }
  }
  /** One fixed physics tick. Never pass variable browser frame intervals. */
  step() {
    if (!this.isSimulating) return;
    const dt = 1 / this.config.physics.fixedHz;
    this.time += dt;
    this.celebrationRemaining = Math.max(0, this.celebrationRemaining - dt);
    for (const piece of this.pieces.values()) {
      this.deform(piece, dt);
      // Snapshot before integration, reusing storage until this body is removed.
      let velocity = this.velocities.get(piece.body.id);
      if (!velocity) {
        velocity = { x: 0, y: 0 };
        this.velocities.set(piece.body.id, velocity);
      }
      velocity.x = piece.body.velocity.x;
      velocity.y = piece.body.velocity.y;
      piece.contactStrain = 0;
      piece.contactCount = 0;
    }
    Engine.update(this.engine, dt * MILLISECONDS_PER_SECOND);
    /** @type {Piece[]} */ const bursts = [];
    for (const [a, b] of this.mergeQueue.values()) {
      if (
        this.state !== "playing" ||
        !this.pieces.has(a.body.id) ||
        !this.pieces.has(b.body.id)
      )
        continue;
      const total = a.body.mass + b.body.mass;
      const x =
        (a.body.position.x * a.body.mass + b.body.position.x * b.body.mass) /
        total /
        this.unit;
      const y =
        (a.body.position.y * a.body.mass + b.body.position.y * b.body.mass) /
        total /
        this.unit;
      const vx =
        (a.body.velocity.x * a.body.mass + b.body.velocity.x * b.body.mass) /
        total;
      const vy =
        (a.body.velocity.y * a.body.mass + b.body.velocity.y * b.body.mass) /
        total;
      this.pieces.delete(a.body.id);
      this.pieces.delete(b.body.id);
      this.velocities.delete(a.body.id);
      this.velocities.delete(b.body.id);
      Composite.remove(this.engine.world, [a.body, b.body]);
      const level = a.level + 1,
        sprite = this.sprites[level];
      const merged = this.addPiece(
        level,
        this.clampX(x, level),
        Math.min(
          y,
          this.config.world.height - (sprite.height - sprite.center.y),
        ),
      );
      merged.touched = true;
      Body.setVelocity(merged.body, { x: vx, y: vy });
      bursts.push(merged);
      this.score += this.config.items[level].score;
      this.emit({ type: "merge", x, y, level, strength: 1 });
      if (level === this.config.rules.n - 1) this.finish("won");
    }
    this.mergeQueue.clear();
    // Apply once per successful merge, after the full merge transaction.
    for (const source of bursts)
      if (this.pieces.has(source.body.id)) this.burst(source);
    for (const piece of this.pieces.values()) {
      const speed = (piece.body.speed * MATTER_BASE_HZ) / this.unit;
      if (speed > this.config.physics.maxSpeed) {
        const factor = this.config.physics.maxSpeed / speed;
        Body.setVelocity(piece.body, {
          x: piece.body.velocity.x * factor,
          y: piece.body.velocity.y * factor,
        });
      }
      const oldEnough = this.time - piece.born > this.config.rules.newbornGrace;
      const above =
        piece.body.bounds.min.y / this.unit < this.config.world.dangerY;
      piece.overflow =
        piece.touched && oldEnough && above ? piece.overflow + dt : 0;
      if (
        piece.overflow >= this.config.rules.overflowGrace &&
        this.state === "playing"
      )
        this.finish("lost");
    }
  }
  /** @param {'won'|'lost'} state */
  finish(state) {
    this.state = state;
    this.celebrationRemaining =
      state === "won" && this.config.mergeBurst.enabled
        ? this.config.mergeBurst.victorySeconds
        : 0;
    this.emit({
      type: state === "won" ? "win" : "lose",
      x: this.config.world.width / 2,
      y: this.config.world.height / 2,
      level: this.config.rules.n - 1,
      strength: 1,
    });
  }
  destroy() {
    Events.off(this.engine, "beforeSolve");
    Events.off(this.engine, "collisionStart");
    Events.off(this.engine, "collisionActive");
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
    this.pieces.clear();
    this.mergeQueue.clear();
    this.velocities.clear();
    this.listeners.clear();
  }
}
