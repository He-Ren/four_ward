// Online-mode regression with intercepted HTTP responses; no local server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
const root = new URL("../../", import.meta.url);
const skin = JSON.parse(
  await readFile(new URL("config/merge/default.json", root), "utf8"),
);
const browser = await chromium.launch(
  process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : { channel: "msedge" },
);
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const requests = new Map(),
    errors = [];
  let audioUnavailable = true;
  let releaseImage;
  const imageGate = new Promise((resolve) => {
    releaseImage = resolve;
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "merge.test") return route.abort();
    const path = decodeURIComponent(url.pathname).replace(/^\/four_ward\//, "");
    requests.set(path, (requests.get(path) || 0) + 1);
    if (path === "assets/stickers/sticker1_remove_edge.png") await imageGate;
    if (
      (path.endsWith("form2.png") && requests.get(path) === 1) ||
      (path.endsWith("pop.mp3") && audioUnavailable)
    )
      return route.fulfill({ status: 503, body: "temporary network failure" });
    const types = {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      json: "application/json",
      png: "image/png",
      webp: "image/webp",
      mp3: "audio/mpeg",
      wav: "audio/wav",
    };
    try {
      await route.fulfill({
        status: 200,
        contentType: types[path.split(".").at(-1)],
        body: await readFile(new URL(path, root)),
      });
    } catch {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://merge.test/four_ward/merge.html?debug=1", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => document.getElementById("board").style.width !== "",
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(({ width, height }) => {
      const board = document.getElementById("board");
      const parent = board.parentElement;
      const scale = Math.min(
        parent.clientWidth / width,
        parent.clientHeight / height,
      );
      return (
        Math.abs(board.getBoundingClientRect().width - width * scale) < 1 &&
        Math.abs(board.getBoundingClientRect().height - height * scale) < 1
      );
    }, skin.world);
    assert.equal(
      await page.locator("body").getAttribute("data-state"),
      "loading",
    );
  }
  await page.waitForFunction(() => {
    const logo = document.querySelector(".brand-image");
    return logo.complete && logo.naturalWidth > 0;
  });
  assert.equal(
    await page.locator("body").getAttribute("data-state"),
    "loading",
  );
  assert.equal(
    requests.get("assets/ui/brand.webp"),
    1,
    "preload reuses one independent header image request",
  );
  assert.equal(await page.locator("#help").isVisible(), false);
  const loadingBoard = await page.locator("#board").boundingBox();
  releaseImage();
  await page.waitForFunction(
    () => window.__merge && document.body.dataset.state === "playing",
  );
  const playingBoard = await page.locator("#board").boundingBox();
  assert.ok(Math.abs(loadingBoard.width - playingBoard.width) < 1);
  assert.ok(Math.abs(loadingBoard.height - playingBoard.height) < 1);
  await page.evaluate(() => window.__merge.sound.ready);
  assert.equal(
    requests.has("src/merge/offline-data.js"),
    false,
    "online startup must not download offline data",
  );
  assert.equal(
    requests.get("assets/stickers/form2.png"),
    2,
    "PNG recovers on retry",
  );
  assert.equal(
    requests.get("assets/merge/pop.mp3"),
    3,
    "audio has bounded automatic retries",
  );
  assert.equal(
    await page.evaluate(
      () => window.__merge.sound.buffers.filter(Boolean).length,
    ),
    2,
  );
  audioUnavailable = false;
  await page.waitForFunction(
    () => performance.now() >= window.__merge.sound.retryAfter[0],
  );
  await page.locator("#game").tap();
  await page.waitForFunction(() => window.__merge.sound.buffers.every(Boolean));
  await page.waitForFunction(
    () => window.__merge.sound.context.state === "running",
    null,
    { timeout: 5000 },
  );
  assert.equal(
    await page.evaluate(() => window.__merge.sound.context.state),
    "running",
  );
  assert.equal(
    requests.get("assets/merge/pop.mp3"),
    4,
    "normal game tap recovers the failed clip",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Online mobile: no offline bundle, transient PNG recovery, failed audio retry, normal touch audio activation passed",
  );
  await context.close();
} finally {
  await browser.close();
}
