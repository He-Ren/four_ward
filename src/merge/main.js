// @ts-check
import { loadSkin, loadLocalSkin } from "./config.js";
import { loadSprites } from "./assets.js";
import { MergeWorld } from "./physics.js";
import { Renderer } from "./renderer.js";
import { bindInput } from "./input.js";
import { MergeAudio } from "./audio.js";

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
const pauseButton = /** @type {HTMLButtonElement} */ (element("pause"));
const restartButton = /** @type {HTMLButtonElement} */ (element("restart"));
const rewardDialog = /** @type {HTMLDialogElement} */ (
  element("reward-dialog")
);
const rewardImage = /** @type {HTMLImageElement} */ (element("reward-image"));
const rewardRestart = /** @type {HTMLButtonElement} */ (
  element("reward-restart")
);

let dispose = () => {};
const sound = new MergeAudio();
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) sound.destroy();
});

/** @param {import('./types.js').Skin} [selectedSkin] */
async function start(selectedSkin) {
  const query = new URLSearchParams(location.search);
  const config =
    selectedSkin ||
    (await loadSkin(query.get("skin") || "./config/merge/default.json"));
  const sprites = await loadSprites(config);
  dispose();
  sound.stop();
  const lifecycle = new AbortController();
  for (const [key, value] of Object.entries(config.theme))
    document.documentElement.style.setProperty(`--${key}`, value);
  const game = new MergeWorld(config, sprites);
  const canvas = /** @type {HTMLCanvasElement} */ (element("game"));
  const renderer = new Renderer(
    canvas,
    element("board"),
    game,
    query.has("debug"),
  );
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
    bestLabel = element("best"),
    status = element("status");
  const nextImage = /** @type {HTMLImageElement} */ (element("next-image"));
  const progression = element("progression");
  progression.replaceChildren();
  const thumbnails = sprites.map((sprite) => sprite.image.toDataURL());
  sprites.forEach((sprite, index) => {
    const li = document.createElement("li"),
      img = document.createElement("img");
    img.src = thumbnails[index];
    img.alt = `第 ${index + 1} 阶`;
    img.title = img.alt;
    li.append(img);
    progression.append(li);
  });
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
    if (game.state === "won") {
      overlay.hidden = true;
      status.textContent = "合成成功，请向工作人员展示本页领奖";
      if (!rewardDialog.open) {
        rewardDialog.showModal();
        element("reward-title").focus({ preventScroll: true });
      }
    } else if (game.state === "playing" && !paused) {
      overlay.hidden = true;
      status.textContent = `合成五哥 · 合成第 ${config.rules.n} 阶即可获胜`;
    } else {
      overlay.hidden = false;
      action.hidden = false;
      if (paused && game.state === "playing") {
        icon.textContent = "Ⅱ";
        title.textContent = "歇一小会儿";
        message.textContent = "准备好后，继续让它们相遇。";
        action.textContent = "继续游戏";
        status.textContent = "游戏已暂停";
      } else {
        icon.textContent = "↻";
        title.textContent = "已经装得满满当当";
        message.textContent = `本局 ${game.score} 分，再试一种摆法吧。`;
        action.textContent = "再玩一次";
        status.textContent = "本局结束";
      }
    }
    document.body.dataset.state = paused ? "paused" : game.state;
  }
  function pause() {
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
  restartButton.onclick = restart;
  rewardRestart.onclick = restart;
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
  icon.textContent = "!";
  title.textContent = "暂时没能开始";
  message.textContent =
    error instanceof Error ? error.message : "加载失败，请刷新重试。";
  action.hidden = false;
  action.textContent = "重新加载";
  action.onclick = () => location.reload();
  document.body.dataset.state = "error";
  element("status").textContent = "资源加载失败";
}

const importButton = /** @type {HTMLButtonElement} */ (element("import-skin"));
const fileInput = /** @type {HTMLInputElement} */ (element("skin-files"));
importButton.onclick = () => fileInput.click();
fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  importButton.disabled = true;
  try {
    const skin = await loadLocalSkin(files);
    await start(skin);
  } catch (error) {
    // Invalid imports leave the current game intact for retry.
    element("status").textContent =
      error instanceof Error ? error.message : "皮肤导入失败";
  } finally {
    importButton.disabled = false;
    fileInput.value = "";
  }
});
start().catch(showError);
