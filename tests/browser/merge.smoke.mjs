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
      assert.equal(await page.title(), "合成小红帽");
      assert.equal(
        await page.locator("#progression, .evolution, .heading").count(),
        0,
      );
      assert.equal(
        await page.locator(".topbar h1").textContent(),
        "合成小红帽",
      );
      assert.equal(await page.locator("h1").count(), 1);
      await page.waitForFunction(
        () => document.querySelector(".brand-image").naturalWidth > 0,
      );
      assert.equal(
        await page.locator('link[rel="icon"]').getAttribute("href"),
        "assets/ui/favicon.png",
      );
      if (mobile) {
        const leftGap = await page.locator(".next-card").evaluate((card) => {
          return (
            card.querySelector(".label").getBoundingClientRect().left -
            card.getBoundingClientRect().left
          );
        });
        assert.ok(
          leftGap <= 13,
          "next label aligns with the card's left padding",
        );
      }
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
      assert.ok(
        (await page.locator("#state-image").getAttribute("src")).endsWith(
          "/sticker3.png",
        ),
      );
      await page.waitForFunction(() => {
        const image = document.getElementById("state-image");
        return !image.hidden && image.complete && image.naturalWidth > 0;
      });
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
        "你合成了小红帽！",
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Space");
      assert.equal(
        await page.locator("#reward-dialog").evaluate((dialog) => dialog.open),
        true,
      );
      assert.equal(
        await page.locator("#reward-dialog .reward-theme").count(),
        0,
      );
      const rewardSize = await page.locator("#reward-image").boundingBox();
      assert.equal(rewardSize.width, 130);
      assert.equal(rewardSize.height, 143);
      const beforeContinue = await page.evaluate(() => ({
        score: window.__merge.game.score,
        ids: [...window.__merge.game.pieces.keys()],
      }));
      assert.equal(
        await page.locator("#reward-continue").textContent(),
        "继续游戏",
      );
      await page.locator("#reward-continue").click();
      assert.equal(
        await page.evaluate(() => window.__merge.game.state),
        "playing",
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          score: window.__merge.game.score,
          ids: [...window.__merge.game.pieces.keys()],
        })),
        beforeContinue,
      );
      assert.equal(
        await page.locator("#reward-dialog").evaluate((dialog) => dialog.open),
        false,
      );
      if (mobile) await canvas.tap();
      else await canvas.click();
      assert.equal(await page.evaluate(() => window.__merge.game.drops), 1);
      await page.evaluate(() => window.__merge.game.finish("lost"));
      assert.ok(
        (await page.locator("#state-image").getAttribute("src")).endsWith(
          "/sticker1.png",
        ),
      );
      await page.waitForFunction(() => {
        const image = document.getElementById("state-image");
        return !image.hidden && image.complete && image.naturalWidth > 0;
      });
      assert.equal(
        await page.locator("#overlay-message").textContent(),
        `本局 ${beforeContinue.score} 分，再试一次吧`,
      );
      await page.locator("#overlay-action").click();
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
