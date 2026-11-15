// @ts-check
/** @typedef {import('./physics.js').MergeWorld} MergeWorld */
/** @typedef {import('./types.js').GameEvent} GameEvent */
const FULL_TURN = Math.PI * 2;
const GRID_SPACING = 0.5;
const GRID_RADIUS = 0.012;
export class Renderer {
  /** @param {HTMLCanvasElement} canvas @param {HTMLElement} board @param {MergeWorld} game @param {boolean} debug */
  constructor(canvas, board, game, debug) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建绘图上下文");
    this.canvas = canvas;
    this.board = board;
    this.game = game;
    this.ctx = ctx;
    this.debug = debug;
    this.scale = 1;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Cache the static raster at the same resolution as the main canvas.
    // Separate dot fills preserve the original edge antialiasing exactly.
    this.background = document.createElement("canvas");
    /** @type {import('./types.js').Particle[]} */ this.particles = [];
    this.observer = new ResizeObserver(() => this.resize());
    if (board.parentElement) this.observer.observe(board.parentElement);
    this.resize();
  }
  resize() {
    const parent = this.board.parentElement;
    if (!parent) return;
    const { width, height } = this.game.config.world;
    this.scale = Math.min(
      parent.clientWidth / width,
      parent.clientHeight / height,
    );
    const cssWidth = width * this.scale,
      cssHeight = height * this.scale;
    this.board.style.width = `${cssWidth}px`;
    this.board.style.height = `${cssHeight}px`;
    const dpr = Math.min(
      devicePixelRatio || 1,
      this.game.config.rendering.maxDpr,
    );
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    if (
      this.background.width !== this.canvas.width ||
      this.background.height !== this.canvas.height
    ) {
      this.background.width = this.canvas.width;
      this.background.height = this.canvas.height;
      const background = this.background.getContext("2d");
      if (!background) throw new Error("无法创建背景绘图上下文");
      background.setTransform(
        this.canvas.width / width,
        0,
        0,
        this.canvas.height / height,
        0,
        0,
      );
      background.fillStyle = this.game.config.theme.accent;
      background.globalAlpha = 0.09;
      for (let y = GRID_SPACING; y < height; y += GRID_SPACING)
        for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
          background.beginPath();
          background.arc(x, y, GRID_RADIUS, 0, FULL_TURN);
          background.fill();
        }
    }
  }
  /** @param {GameEvent} event @param {() => number} [random] */
  effect(event, random = Math.random) {
    if (event.type === "reset") {
      this.particles = [];
      return;
    }
    if (event.type !== "merge" || this.reducedMotion) return;
    const r = this.game.config.rendering;
    const colors = this.game.sprites[event.level].particleColors;
    for (let i = 0; i < r.particleCount; i++) {
      const color = colors[Math.floor(random() * colors.length)];
      const angle = FULL_TURN * random();
      const speed =
        r.particleSpeed *
        (r.particleMinSpeedRatio + random() * (1 - r.particleMinSpeedRatio));
      this.particles.push({
        x: event.x,
        y: event.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life:
          r.particleLifetime *
          (r.particleMinLifetimeRatio +
            random() * (1 - r.particleMinLifetimeRatio)),
        color,
        opacity:
          r.particleOpacityMin +
          random() * (r.particleOpacityMax - r.particleOpacityMin),
      });
    }
    if (this.particles.length > r.maxParticles)
      this.particles.splice(0, this.particles.length - r.maxParticles);
  }
  /** Pure visual motion: never creates bodies or queries collision geometry.
   * @param {number} dt
   */
  updateParticles(dt) {
    const gravity = this.game.config.rendering.particleGravity;
    let alive = 0;
    for (const particle of this.particles) {
      particle.age += dt;
      if (particle.age >= particle.life) continue;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt + 0.5 * gravity * dt * dt;
      particle.vy += gravity * dt;
      this.particles[alive++] = particle;
    }
    this.particles.length = alive;
  }
  /** @param {number} level @param {number} x @param {number} y @param {number} angle @param {number} strain @param {number} [alpha] */
  sprite(level, x, y, angle, strain, alpha = 1) {
    const sprite = this.game.sprites[level],
      ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(Math.exp(strain), Math.exp(-strain));
    ctx.drawImage(
      sprite.image,
      -sprite.center.x,
      -sprite.center.y,
      sprite.width,
      sprite.height,
    );
    ctx.restore();
  }
  /** @param {number} aim @param {number} dt @param {boolean} paused */
  draw(aim, dt, paused) {
    const ctx = this.ctx,
      { world: w, theme, rendering: r } = this.game.config,
      u = this.game.unit;
    ctx.setTransform(
      this.canvas.width / w.width,
      0,
      0,
      this.canvas.height / w.height,
      0,
      0,
    );
    ctx.clearRect(0, 0, w.width, w.height);
    // Small marks give the container a quiet sense of scale.
    ctx.globalAlpha = 1;
    ctx.drawImage(this.background, 0, 0, w.width, w.height);
    let danger = false;
    for (const piece of this.game.pieces.values())
      if (piece.overflow > 0) {
        danger = true;
        break;
      }
    this.board.classList.toggle("danger", danger);
    ctx.strokeStyle = danger ? theme.danger : theme.accent;
    ctx.globalAlpha = danger ? 0.9 : 0.45;
    ctx.lineWidth = r.lineWidth;
    ctx.setLineDash([r.guideDash, r.guideDash]);
    ctx.beginPath();
    ctx.moveTo(0, w.dangerY);
    ctx.lineTo(w.width, w.dangerY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "0.21px sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = danger ? theme.danger : theme.accent;
    ctx.fillText(
      danger ? "留意警戒线" : "警戒线",
      w.width - 0.25,
      w.dangerY - 0.16,
    );
    ctx.globalAlpha = 1;
    if (this.game.state === "playing") {
      const x = this.game.clampX(aim);
      ctx.save();
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 0.2;
      ctx.setLineDash([r.guideDash, r.guideDash]);
      ctx.beginPath();
      ctx.moveTo(x, w.spawnY);
      ctx.lineTo(x, w.height);
      ctx.stroke();
      ctx.restore();
      this.sprite(
        this.game.current,
        x,
        w.spawnY,
        0,
        0,
        this.game.canDrop ? 0.85 : 0.3,
      );
    }
    for (const piece of this.game.pieces.values()) {
      const b = piece.body;
      this.sprite(
        piece.level,
        b.position.x / u,
        b.position.y / u,
        b.angle,
        piece.appliedStrain,
      );
      if (this.debug) {
        ctx.strokeStyle = b.isSleeping ? "#2288ee" : "#ff4477";
        ctx.lineWidth = r.lineWidth / 2;
        for (let i = b.parts.length > 1 ? 1 : 0; i < b.parts.length; i++) {
          const part = b.parts[i];
          ctx.beginPath();
          part.vertices.forEach((p, i) =>
            i ? ctx.lineTo(p.x / u, p.y / u) : ctx.moveTo(p.x / u, p.y / u),
          );
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    if (!paused) this.updateParticles(dt);
    for (const particle of this.particles) {
      ctx.globalAlpha = particle.opacity * (1 - particle.age / particle.life);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, r.lineWidth * 2, 0, FULL_TURN);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  destroy() {
    this.observer.disconnect();
  }
}
