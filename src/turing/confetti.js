// Native canvas celebration; no packages, images, or network requests.
(() => {
  "use strict";
  const COLORS = Object.freeze(["#ef7866", "#e9bc48", "#5b9c78", "#649bd1", "#aa7ec8", "#e48eaf"]);

  function createParticles(width, height, count = 160, random = Math.random) {
    const gravity = height * 1.05 + 240;
    // Tall screens launch more vertically so both fountains reach the middle.
    const baseAngle = Math.atan2(height * 0.9, width * 0.45);
    return Array.from({ length: count }, (_, index) => {
      const side = index % 2 === 0 ? "left" : "right";
      const angle = Math.max(Math.PI * 0.23, Math.min(Math.PI * 0.48,
        baseAngle + (random() - 0.5) * Math.PI * 0.16));
      // With unit mass, this random initial impulse becomes the launch speed.
      const impulse = Math.sqrt(2 * gravity * height) * (0.8 + random() * 0.3);
      return {
        side, angle, impulse, gravity,
        x: side === "left" ? -8 : width + 8,
        y: height + 8,
        vx: Math.cos(angle) * impulse * (side === "left" ? 1 : -1),
        vy: -Math.sin(angle) * impulse,
        width: 6 + random() * 7,
        height: 3 + random() * 5,
        rotation: random() * Math.PI * 2,
        spin: (random() - 0.5) * 14,
        color: COLORS[Math.floor(random() * COLORS.length)],
        delay: index / count * 0.65,
      };
    });
  }

  function stepParticle(particle, seconds) {
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds + particle.gravity * seconds * seconds / 2;
    particle.vy += particle.gravity * seconds;
    particle.rotation += particle.spin * seconds;
  }

  function createCelebration() {
    let canvas = null;
    let context = null;
    let particles = [];
    let frame = 0;
    let width = 0;
    let height = 0;
    let started = 0;
    let previous = 0;

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      canvas?.remove();
      canvas = null;
      context = null;
      particles = [];
      window.removeEventListener("resize", resize);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    function onVisibilityChange() {
      if (document.hidden) stop();
    }

    function resize() {
      if (!canvas || !context) return;
      const nextWidth = Math.max(1, window.innerWidth);
      const nextHeight = Math.max(1, window.innerHeight);
      if (width && height) {
        for (const particle of particles) {
          particle.x *= nextWidth / width;
          particle.vx *= nextWidth / width;
          particle.y *= nextHeight / height;
          particle.vy *= nextHeight / height;
          particle.gravity *= nextHeight / height;
        }
      }
      width = nextWidth;
      height = nextHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function tick(now) {
      if (!context || !canvas) return;
      const elapsed = (now - started) / 1000;
      const seconds = Math.min((now - previous) / 1000, 0.08);
      previous = now;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, Math.min(1, (6 - elapsed) / 0.6));
      let alive = 0;
      for (const particle of particles) {
        const age = elapsed - particle.delay;
        if (age < 0) {
          particles[alive++] = particle;
          continue;
        }
        stepParticle(particle, Math.min(seconds, age));
        if (particle.y > height + 30 && particle.vy > 0) continue;
        if (particle.x < -40 || particle.x > width + 40) continue;
        particles[alive++] = particle;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        const flutter = 0.35 + 0.65 * Math.abs(Math.cos(age * 5 + particle.rotation));
        context.fillRect(-particle.width / 2, -particle.height * flutter / 2,
          particle.width, particle.height * flutter);
        context.restore();
      }
      particles.length = alive;
      if (particles.length && elapsed < 6) frame = requestAnimationFrame(tick);
      else stop();
    }

    function start() {
      stop();
      if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      canvas = document.createElement("canvas");
      canvas.className = "confetti-layer";
      canvas.setAttribute("aria-hidden", "true");
      document.body.append(canvas);
      context = canvas.getContext("2d");
      if (!context) { stop(); return; }
      width = 0;
      height = 0;
      resize();
      particles = createParticles(width, height);
      started = performance.now();
      previous = started;
      window.addEventListener("resize", resize);
      window.addEventListener("pagehide", stop);
      document.addEventListener("visibilitychange", onVisibilityChange);
      frame = requestAnimationFrame(tick);
    }

    return Object.freeze({ start, stop });
  }

  globalThis.TuringConfetti = Object.freeze({ COLORS, createParticles, stepParticle, createCelebration });
})();
