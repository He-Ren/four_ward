// @ts-check
import { loadSkin } from "./config.js";
import { loadSprites } from "./assets.js";
import { MergeWorld } from "./physics.js";
import { Renderer, fitBoard } from "./renderer.js";
import { bindInput } from "./input.js";
import { MergeAudio } from "./audio.js";
import { bindHelp } from "./help.js";

/** @template {HTMLElement} T @param {string} id @returns {T} */
function element(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少页面元素 ${id}`);
  return /** @type {T} */ (node);
}
const overlay = element("overlay"),
  title = element("overlay-title"),
  message = element("overlay-message"),
  icon = element("overlay-icon");
const action = /** @type {HTMLButtonElement} */ (element("overlay-action"));
const stateImage = /** @type {HTMLImageElement} */ (element("state-image"));
const pauseButton = /** @type {HTMLButtonElement} */ (element("pause"));
const restartButton = /** @type {HTMLButtonElement} */ (element("restart"));
const rewardDialog = /** @type {HTMLDialogElement} */ (
  element("reward-dialog")
);
const rewardImage = /** @type {HTMLImageElement} */ (element("reward-image"));
const rewardContinue = /** @type {HTMLButtonElement} */ (
  element("reward-continue")
);

let dispose = () => {};
const sound = new MergeAudio();
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) sound.destroy();
});

async function start() {
  const query = new URLSearchParams(location.search);
  const config = await loadSkin(
    query.get("skin") || "./config/merge/default.json",
  );
  const board = element("board");
  const fitLoadingBoard = () => fitBoard(board, config.world);
  const loadingObserver = new ResizeObserver(fitLoadingBoard);
  if (board.parentElement) loadingObserver.observe(board.parentElement);
  fitLoadingBoard();
  const sprites = await loadSprites(config).finally(() =>
    loadingObserver.disconnect(),
  );
  dispose();
  sound.stop();
  const lifecycle = new AbortController();
  for (const [key, value] of Object.entries(config.theme))
    document.documentElement.style.setProperty(`--${key}`, value);
  const game = new MergeWorld(config, sprites);
  const canvas = /** @type {HTMLCanvasElement} */ (element("game"));
  const renderer = new Renderer(canvas, board, game, query.has("debug"));
  let aim = config.world.width / 2,
    paused = false,
    accumulator = 0,
    lastTime = 0,
    best = 0;
  const bestKey = `4Ward:merge:best:${config.name}`;
  try {
    best = Number(localStorage.getItem(bestKey)) || 0;
  } catch {
    /* Private mode may disable storage. */
  }
  const score = element("score"),
    bestLabel = element("best");
  const nextImage = /** @type {HTMLImageElement} */ (element("next-image"));
  const thumbnails = sprites.map((sprite) => sprite.image.toDataURL());
  rewardImage.src = thumbnails.at(-1) || "";
  rewardDialog.addEventListener("cancel", (event) => event.preventDefault(), {
    signal: lifecycle.signal,
  });
  function sync() {
    score.textContent = String(game.score);
    bestLabel.textContent = String(best);
    nextImage.src = thumbnails[game.next];
    nextImage.hidden = false;
    nextImage.alt = `下一个：第 ${game.next + 1} 阶`;
    pauseButton.textContent = paused ? "继续" : "暂停";
    pauseButton.disabled = game.state !== "playing";
    stateImage.hidden =
      !(paused && game.state === "playing") && game.state !== "lost";
    icon.hidden = !stateImage.hidden;
    if (game.state === "won") {
      overlay.hidden = true;
      if (!rewardDialog.open) {
        rewardDialog.showModal();
        element("reward-title").focus({ preventScroll: true });
      }
    } else if (game.state === "playing" && !paused) {
      overlay.hidden = true;
    } else {
      overlay.hidden = false;
      action.hidden = false;
      if (paused && game.state === "playing") {
        stateImage.src = "assets/stickers/sticker3.png";
        stateImage.alt = "暂停";
        title.textContent = "小红帽开小差中";
        message.textContent = "游戏已暂停";
        action.textContent = "继续游戏";
      } else {
        stateImage.src = "assets/stickers/sticker1.png";
        stateImage.alt = "本局结束";
        title.textContent = "已经装得满满当当";
        message.textContent = `本局 ${game.score} 分，再试一次吧`;
        action.textContent = "再玩一次";
      }
    }
    document.body.dataset.state = paused ? "paused" : game.state;
  }
  function pause() {
    if (document.querySelector("#help-dialog[open]")) return;
    if (game.state !== "playing") return;
    paused = !paused;
    accumulator = 0;
    lastTime = performance.now();
    sync();
  }
  function restart() {
    rewardDialog.close();
    paused = false;
    accumulator = 0;
    lastTime = performance.now();
    aim = config.world.width / 2;
    game.reset();
    sync();
    canvas.focus({ preventScroll: true });
  }
  const unbind = bindInput(canvas, {
    width: config.world.width,
    step: config.rules.keyboardStep,
    getAim: () => aim,
    aim: (x) => {
      aim = game.clampX(x);
    },
    drop: () => {
      game.drop(aim);
    },
    pause,
    enabled: () => !paused && game.state === "playing",
  });
  // Audio listens to successful drops/merges; collisions do not replay clips.
  game.subscribe((event) => {
    if (event.type === "bounce") return;
    renderer.effect(event);
    sound.onEvent(event);
    if (game.score > best) {
      best = game.score;
      try {
        localStorage.setItem(bestKey, String(best));
      } catch {}
    }
    sync();
  });
  pauseButton.onclick = pause;
  const unbindHelp = bindHelp(thumbnails, () => {
    if (game.state === "playing" && !paused) pause();
  });
  restartButton.onclick = restart;
  rewardContinue.onclick = () => {
    if (!game.continueAfterWin()) return;
    rewardDialog.close();
    paused = false;
    accumulator = 0;
    lastTime = performance.now();
    sync();
    canvas.focus({ preventScroll: true });
  };
  action.onclick = () => {
    if (paused && game.state === "playing") {
      pause();
      canvas.focus();
    } else restart();
  };
  document.addEventListener(
    "visibilitychange",
    () => {
      accumulator = 0;
      lastTime = performance.now();
      if (document.hidden && !paused && game.state === "playing") {
        paused = true;
        sync();
      }
    },
    { signal: lifecycle.signal },
  );
  let frameId = 0;
  /** @param {number} now */
  function frame(now) {
    const elapsed = lastTime
      ? Math.min((now - lastTime) / 1000, config.physics.maxFrameDelta)
      : 0;
    lastTime = now;
    if (!paused && game.isSimulating) {
      const fixed = 1 / config.physics.fixedHz;
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= fixed && steps < config.physics.maxSubSteps) {
        game.step();
        accumulator -= fixed;
        steps++;
      }
      if (steps === config.physics.maxSubSteps) accumulator = 0;
    }
    renderer.draw(aim, elapsed, paused);
    frameId = requestAnimationFrame(frame);
  }
  if (query.has("debug"))
    Reflect.set(window, "__merge", { game, renderer, config, sprites, sound });
  dispose = () => {
    unbindHelp();
    rewardDialog.close();
    lifecycle.abort();
    cancelAnimationFrame(frameId);
    unbind();
    renderer.destroy();
    game.destroy();
  };
  window.addEventListener(
    "pagehide",
    (event) => {
      if (event.persisted) return;
      dispose();
    },
    { once: true, signal: lifecycle.signal },
  );
  pauseButton.disabled = false;
  restartButton.disabled = false;
  sync();
  frameId = requestAnimationFrame(frame);
}

/** @param {unknown} error */
function showError(error) {
  console.error(error);
  overlay.hidden = false;
  stateImage.hidden = true;
  icon.hidden = false;
  icon.textContent = "!";
  title.textContent = "暂时没能开始";
  message.textContent =
    error instanceof Error ? error.message : "加载失败，请刷新重试。";
  action.hidden = false;
  action.textContent = "重新加载";
  action.onclick = () => location.reload();
  document.body.dataset.state = "error";
}

start().catch(showError);
