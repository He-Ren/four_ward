// @ts-check
import { maskToPolygons, centerOfMass } from "./geometry.js";
/** @typedef {import('./types.js').Skin} Skin */
/** @typedef {import('./types.js').Sprite} Sprite */
// Bounded reservoir of actual visible-pixel colors, sampled once at load time.
const PARTICLE_PALETTE_SIZE = 512;

/** @param {HTMLCanvasElement} canvas */
function context(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D");
  return ctx;
}
/** @param {Skin} config @returns {Promise<Sprite[]>} */
export async function loadSprites(config) {
  return Promise.all(
    config.items.map(async (item) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = item.image;
      try {
        await image.decode();
      } catch {
        throw new Error(`无法加载图片：${item.image}`);
      }
      const source = document.createElement("canvas");
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const sourceContext = context(source);
      sourceContext.drawImage(image, 0, 0);
      const { data } = sourceContext.getImageData(
        0,
        0,
        source.width,
        source.height,
      );
      let left = source.width,
        top = source.height,
        right = -1,
        bottom = -1;
      /** @type {string[]} */ const particleColors = [];
      let visiblePixels = 0;
      for (let y = 0; y < source.height; y++)
        for (let x = 0; x < source.width; x++) {
          if (
            data[(y * source.width + x) * 4 + 3] >=
            config.collision.alphaThreshold
          ) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            visiblePixels++;
            const slot =
              visiblePixels <= PARTICLE_PALETTE_SIZE
                ? visiblePixels - 1
                : Math.floor(Math.random() * visiblePixels);
            if (slot < PARTICLE_PALETTE_SIZE) {
              const offset = (y * source.width + x) * 4;
              particleColors[slot] =
                `rgb(${data[offset]}, ${data[offset + 1]}, ${data[offset + 2]})`;
            }
          }
        }
      if (right < left) throw new Error(`${item.name} 是全透明图片`);
      const width = right - left + 1,
        height = bottom - top + 1;
      const cropped = document.createElement("canvas");
      cropped.width = width;
      cropped.height = height;
      context(cropped).drawImage(
        source,
        left,
        top,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      const sample = document.createElement("canvas");
      sample.width = Math.max(
        1,
        Math.round(
          (config.collision.resolution * width) / Math.max(width, height),
        ),
      );
      sample.height = Math.max(
        1,
        Math.round(
          (config.collision.resolution * height) / Math.max(width, height),
        ),
      );
      const sampleContext = context(sample);
      sampleContext.drawImage(cropped, 0, 0, sample.width, sample.height);
      const pixels = sampleContext.getImageData(
        0,
        0,
        sample.width,
        sample.height,
      ).data;
      const mask = Uint8Array.from(
        { length: sample.width * sample.height },
        (_, i) =>
          pixels[i * 4 + 3] >= config.collision.alphaThreshold ? 1 : 0,
      );
      const worldWidth = (item.size * width) / Math.max(width, height),
        worldHeight = (item.size * height) / Math.max(width, height);
      const polygons = maskToPolygons(
        mask,
        sample.width,
        sample.height,
        config.collision.simplifyTolerance,
      ).map((polygon) =>
        polygon.map((p) => ({
          x: (p.x / sample.width) * worldWidth,
          y: (p.y / sample.height) * worldHeight,
        })),
      );
      if (polygons.length > config.collision.maxParts)
        throw new Error(
          `${item.name} 轮廓过于复杂：${polygons.length} 个凸片，请简化 PNG 或降低 collision.resolution`,
        );
      const center = centerOfMass(polygons);
      return {
        image: cropped,
        polygons,
        width: worldWidth,
        height: worldHeight,
        center,
        source: item.image,
        particleColors,
      };
    }),
  );
}
