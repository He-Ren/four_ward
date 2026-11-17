// @ts-check
import { maskToPolygons, centerOfMass } from "./geometry.js";
import { loadImage, fetchResource } from "./resources.js";
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
  // Limit concurrent decodes to protect mobile memory, while overlapping requests.
  const IMAGE_BATCH_SIZE = 3;
  /** @type {Sprite[]} */ const sprites = [];
  const objectURLs = new Set();
  try {
    for (
      let start = 0;
      start < config.items.length;
      start += IMAGE_BATCH_SIZE
    ) {
      const batch = config.items.slice(start, start + IMAGE_BATCH_SIZE);
      const images = await Promise.all(
        batch.map(async (item) => {
          try {
            let source = item.image;
            if (/^https?:/.test(source)) {
              source = URL.createObjectURL(
                await fetchResource(source, (response) => response.blob()),
              );
              objectURLs.add(source);
            }
            return await loadImage(source);
          } catch {
            return null;
          }
        }),
      );
      try {
        for (const [index, item] of batch.entries()) {
          const image = images[index];
          if (!image)
            throw new Error(
              `无法加载第 ${start + index + 1} 阶图片，请检查网络后重试。`,
            );
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
          sprites.push({
            image: cropped,
            polygons,
            width: worldWidth,
            height: worldHeight,
            center,
            source: image.currentSrc || image.src,
            particleColors,
          });
          // Release scratch backing stores immediately instead of waiting for GC.
          source.width = source.height = sample.width = sample.height = 0;
        }
      } finally {
        for (const image of images) if (image) image.src = "";
      }
    }
    return sprites;
  } catch (error) {
    for (const url of objectURLs) URL.revokeObjectURL(url);
    throw error;
  }
}

/** Release downloaded bytes when the world is disposed.
 * @param {Sprite[]} sprites */
export function releaseSprites(sprites) {
  for (const sprite of sprites)
    if (sprite.source.startsWith("blob:")) URL.revokeObjectURL(sprite.source);
}
