// Optional developer check: requires an existing Playwright installation and
// Edge (or BROWSER_EXECUTABLE). Runs entirely through file://, with no server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const entry = new URL("../../merge.html?debug=1", import.meta.url).href;
const skin = JSON.parse(
  await readFile(
    new URL("../../config/merge/default.json", import.meta.url),
    "utf8",
  ),
);
const browser = await chromium.launch(
  process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : { channel: "msedge" },
);
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
      hasTouch: mobile,
      offline: true,
    });
    try {
      const page = await context.newPage();
      const errors = [],
        network = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("request", (request) => {
        if (/^https?:/.test(request.url())) network.push(request.url());
      });
      await page.goto(entry);
      await page.waitForFunction(
        () => window.__merge && document.body.dataset.state === "playing",
      );
      assert.equal(await page.title(), "合成五哥");
      assert.equal(await page.locator("#progression li").count(), 9);
      await page.evaluate(() => window.__merge.sound.ready);
      assert.equal(
        await page.evaluate(
          () => window.__merge.sound.buffers.filter(Boolean).length,
        ),
        3,
      );

      const canvas = page.locator("#game");
      if (mobile) await canvas.tap();
      else {
        await canvas.focus();
        await page.keyboard.press("Space");
      }
      assert.equal(await page.evaluate(() => window.__merge.game.drops), 1);
      await page.locator("#pause").click();
      assert.equal(
        await page.locator("body").getAttribute("data-state"),
        "paused",
      );
      await page.locator("#restart").click();
      assert.equal(
        await page.evaluate(() => window.__merge.game.pieces.size),
        0,
      );

      assert.equal(
        await page
          .locator(
            "#sound-preview, #import-skin, #skin-files, .instructions, .tip, .footer-note",
          )
          .count(),
        0,
      );

      // Drive the actual merge transaction without timers or browser frame races.
      await page.evaluate(() => {
        const { game } = window.__merge;
        game.reset();
        game.addPiece(7, 4.4, 12);
        game.addPiece(7, 5.6, 12);
        for (let i = 0; i < 120 && game.state === "playing"; i++) game.step();
      });
      assert.equal(await page.evaluate(() => window.__merge.game.state), "won");
      assert.equal(
        await page.locator("#reward-dialog").evaluate((dialog) => dialog.open),
        true,
      );
      assert.equal(
        await page.locator("#reward-title").textContent(),
        "你合成了五哥！",
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Space");
      assert.equal(
        await page.locator("#reward-dialog").evaluate((dialog) => dialog.open),
        true,
      );
      await page.locator("#reward-restart").click();
      assert.equal(
        await page.evaluate(() => window.__merge.game.state),
        "playing",
      );
      assert.equal(
        await page.evaluate(() => window.__merge.game.pieces.size),
        0,
      );

      const ratio = await canvas.evaluate(
        (node) => node.clientWidth / node.clientHeight,
      );
      assert.ok(Math.abs(ratio - skin.world.width / skin.world.height) < 0.005);
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
      console.log(
        `${mobile ? "Mobile touch" : "Desktop keyboard"}: offline load, audio, drop, pause, restart, simplified UI, reward passed`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
