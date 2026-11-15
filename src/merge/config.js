// @ts-check
import { fetchResource } from "./resources.js";
/** @typedef {import('./types.js').Skin} Skin */

/** Validate untrusted JSON before constructing images, arrays or physics bodies.
 * @param {unknown} input @returns {Skin} */
export function validateSkin(input) {
  if (!input || typeof input !== "object")
    throw new Error("皮肤必须是 JSON 对象");
  const c = /** @type {Skin} */ (input);
  /** @param {unknown} value @param {string} name @param {number} min @param {number} max */
  const number = (value, name, min, max) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new Error(`${name} 必须在 ${min}–${max} 之间`);
  };
  /** @param {unknown} value @param {string} name */
  const integer = (value, name) => {
    if (!Number.isInteger(value)) throw new Error(`${name} 必须是整数`);
  };
  if (c.version !== 1) throw new Error("不支持的皮肤版本");
  if (typeof c.name !== "string" || !c.name.trim())
    throw new Error("皮肤缺少 name");
  for (const key of [
    "world",
    "rules",
    "physics",
    "jelly",
    "collision",
    "rendering",
    "theme",
  ]) {
    if (!Reflect.get(c, key) || typeof Reflect.get(c, key) !== "object")
      throw new Error(`皮肤缺少 ${key}`);
  }
  number(c.world.width, "world.width", 2, 100);
  number(c.world.height, "world.height", c.world.width, 200);
  number(c.world.dangerY, "world.dangerY", 0.1, c.world.height);
  number(c.world.spawnY, "world.spawnY", 0, c.world.dangerY);
  number(c.world.wallThickness, "world.wallThickness", 0.1, c.world.width);
  number(c.rules.n, "rules.n", 2, 32);
  integer(c.rules.n, "rules.n");
  number(c.rules.m, "rules.m", 1, c.rules.n - 1);
  integer(c.rules.m, "rules.m");
  if (!Array.isArray(c.items) || c.items.length !== c.rules.n)
    throw new Error("items 数量必须等于 n");
  for (const [i, item] of c.items.entries()) {
    if (
      !item ||
      typeof item.name !== "string" ||
      typeof item.image !== "string" ||
      !item.image
    )
      throw new Error(`items[${i}] 缺少名称或图片`);
    number(item.size, `items[${i}].size`, 0.1, c.world.width * 0.8);
    if (i && item.size <= c.items[i - 1].size)
      throw new Error("物品 size 必须逐级递增");
    number(item.weight, `items[${i}].weight`, 0, 1e6);
    number(item.score, `items[${i}].score`, 0, 1e9);
  }
  if (!c.items.slice(0, c.rules.m).some((item) => item.weight > 0))
    throw new Error("前 m 项权重之和必须大于零");
  if (c.items[c.rules.m - 1].size / 2 > c.world.spawnY)
    throw new Error("spawnY 太小，待掉落物品会超出画面");
  for (const key of [
    "dropCooldown",
    "mergeCooldown",
    "overflowGrace",
    "newbornGrace",
    "keyboardStep",
  ])
    number(Reflect.get(c.rules, key), `rules.${key}`, 0.01, 60);
  number(c.rules.maxBodies, "rules.maxBodies", 2, 500);
  integer(c.rules.maxBodies, "rules.maxBodies");
  // Older imported skins keep their original independent draws and no burst.
  c.rules.avoidRepeat ??= false;
  c.rules.repeatRetries ??= 6;
  if (typeof c.rules.avoidRepeat !== "boolean")
    throw new Error("rules.avoidRepeat 必须是布尔值");
  number(c.rules.repeatRetries, "rules.repeatRetries", 0, 32);
  integer(c.rules.repeatRetries, "rules.repeatRetries");
  c.mergeBurst ??= {
    enabled: false,
    rangeMultiplier: 1.1,
    rangePadding: 0.7,
    speed: 9,
    upwardBias: 0.6,
    massExponent: 0.5,
    minMassScale: 0.35,
    maxMassScale: 1.5,
    spin: 0.06,
    strainKick: 0.7,
    victorySeconds: 0.8,
  };
  const burst = c.mergeBurst;
  if (typeof burst.enabled !== "boolean")
    throw new Error("mergeBurst.enabled 必须是布尔值");
  number(burst.rangeMultiplier, "mergeBurst.rangeMultiplier", 0.01, 5);
  number(burst.rangePadding, "mergeBurst.rangePadding", 0, 20);
  number(burst.speed, "mergeBurst.speed", 0, 40);
  number(burst.upwardBias, "mergeBurst.upwardBias", 0, 2);
  number(burst.massExponent, "mergeBurst.massExponent", 0, 1);
  number(burst.minMassScale, "mergeBurst.minMassScale", 0.01, 2);
  number(burst.maxMassScale, "mergeBurst.maxMassScale", burst.minMassScale, 3);
  number(burst.spin, "mergeBurst.spin", 0, 0.2);
  number(burst.strainKick, "mergeBurst.strainKick", 0, 2);
  number(burst.victorySeconds, "mergeBurst.victorySeconds", 0, 3);
  const p = c.physics;
  p.bounceThreshold ??= 1.2;
  number(p.bounceThreshold, "physics.bounceThreshold", 0, 10);
  c.jelly.restResponse ??= 10;
  c.jelly.restDeadband ??= 0.002;
  number(c.jelly.restResponse, "jelly.restResponse", 0.1, 60);
  number(c.jelly.restDeadband, "jelly.restDeadband", 0, 0.02);
  for (const key of ["unitsPerWorldUnit", "gravity", "density", "maxSpeed"])
    number(Reflect.get(p, key), `physics.${key}`, 0.0001, 1000);
  number(p.fixedHz, "physics.fixedHz", 60, 240);
  for (const key of [
    "maxSubSteps",
    "positionIterations",
    "velocityIterations",
    "sleepFrames",
  ]) {
    number(Reflect.get(p, key), `physics.${key}`, 1, 300);
    integer(Reflect.get(p, key), `physics.${key}`);
  }
  number(p.maxFrameDelta, "physics.maxFrameDelta", 0.01, 0.5);
  for (const key of [
    "restitution",
    "friction",
    "frictionStatic",
    "airDrag",
    "slop",
  ])
    number(Reflect.get(p, key), `physics.${key}`, 0, 1);
  if (typeof c.jelly.enabled !== "boolean")
    throw new Error("jelly.enabled 必须是布尔值");
  number(c.jelly.maxStrain, "jelly.maxStrain", 0, 0.2);
  for (const key of [
    "stiffness",
    "damping",
    "impactGain",
    "minImpactSpeed",
    "impactCooldown",
    "restCompression",
    "settleEpsilon",
    "scaleEpsilon",
  ])
    number(Reflect.get(c.jelly, key), `jelly.${key}`, 0.000001, 1000);
  number(c.collision.resolution, "collision.resolution", 16, 128);
  integer(c.collision.resolution, "collision.resolution");
  number(c.collision.alphaThreshold, "collision.alphaThreshold", 1, 255);
  number(c.collision.simplifyTolerance, "collision.simplifyTolerance", 0, 1);
  number(c.collision.maxParts, "collision.maxParts", 1, 256);
  integer(c.collision.maxParts, "collision.maxParts");
  number(c.rendering.maxDpr, "rendering.maxDpr", 1, 3);
  number(c.rendering.particleCount, "rendering.particleCount", 0, 64);
  integer(c.rendering.particleCount, "rendering.particleCount");
  const r = c.rendering;
  r.particleMinLifetimeRatio ??= 0.5;
  r.particleMinSpeedRatio ??= 0.35;
  r.particleOpacityMin ??= 0.45;
  r.particleOpacityMax ??= 0.75;
  r.particleGravity ??= c.physics.gravity;
  r.maxParticles ??= 512;
  number(
    r.particleMinLifetimeRatio,
    "rendering.particleMinLifetimeRatio",
    0.01,
    1,
  );
  number(r.particleMinSpeedRatio, "rendering.particleMinSpeedRatio", 0, 1);
  number(r.particleOpacityMin, "rendering.particleOpacityMin", 0, 1);
  number(
    r.particleOpacityMax,
    "rendering.particleOpacityMax",
    r.particleOpacityMin,
    1,
  );
  number(r.particleGravity, "rendering.particleGravity", 0, 1000);
  number(r.maxParticles, "rendering.maxParticles", 1, 4096);
  integer(r.maxParticles, "rendering.maxParticles");
  for (const key of [
    "guideDash",
    "lineWidth",
    "particleLifetime",
    "particleSpeed",
  ])
    number(Reflect.get(c.rendering, key), `rendering.${key}`, 0.001, 10);
  for (const value of Object.values(c.theme))
    if (!/^#[0-9a-f]{6}$/i.test(value))
      throw new Error("主题颜色需要 #RRGGBB 格式");
  for (const key of ["background", "surface", "ink", "accent", "danger"])
    if (!Reflect.get(c.theme, key)) throw new Error(`theme 缺少 ${key}`);
  return c;
}

/** @param {string} url */
export async function loadSkin(url) {
  if (location.protocol === "file:") {
    if (url !== "./config/merge/default.json")
      throw new Error("双击模式请使用“导入皮肤”选择 JSON 和 PNG 文件。");
    const offline = Reflect.get(window, "MergeOffline");
    if (!offline) throw new Error("缺少离线皮肤数据，请保留完整的游戏文件夹。");
    const config = validateSkin(structuredClone(offline.skin));
    config.items = config.items.map((item) => ({
      ...item,
      image: offline.images[item.image],
    }));
    return config;
  }
  const absolute = new URL(url, location.href);
  const config = validateSkin(
    await fetchResource(absolute, (response) => response.json()),
  );
  config.items = config.items.map((item) => ({
    ...item,
    image: new URL(item.image, absolute).href,
  }));
  return config;
}

/** Read selected files without a server. @param {File[]} files @returns {Promise<Skin>} */
export async function loadLocalSkin(files) {
  const jsonFiles = files.filter((file) =>
    file.name.toLowerCase().endsWith(".json"),
  );
  if (jsonFiles.length !== 1)
    throw new Error("请选择一个皮肤 JSON，以及它使用的 PNG 图片（可多选）。");
  const config = validateSkin(JSON.parse(await jsonFiles[0].text()));
  const offline = Reflect.get(window, "MergeOffline");
  /** @type {Map<string, string>} */
  const images = new Map();
  for (const [name, data] of Object.entries(offline?.images || {}))
    images.set(name.split("/").pop() || name, /** @type {string} */ (data));
  // Online play no longer downloads the offline bundle. Keep JSON-only imports
  // working by resolving the shipped skin's images to their normal URLs.
  if (!offline && location.protocol !== "file:") {
    const defaults = await loadSkin("./config/merge/default.json");
    for (const item of defaults.items) {
      const name = new URL(item.image).pathname.split("/").pop() || "";
      images.set(decodeURIComponent(name), item.image);
    }
  }
  const selectedNames = new Set();
  for (const file of files.filter((file) =>
    file.name.toLowerCase().endsWith(".png"),
  )) {
    if (selectedNames.has(file.name))
      throw new Error(`图片文件名重复：${file.name}`);
    selectedNames.add(file.name);
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
      reader.readAsDataURL(file);
    });
    images.set(file.name, data);
  }
  config.items = config.items.map((item) => {
    const name = item.image.replaceAll("\\", "/").split("/").pop() || "";
    const image = images.get(name);
    if (!image)
      throw new Error(`缺少 ${name}：请同时选择 JSON 和所需 PNG 文件。`);
    return { ...item, image };
  });
  return config;
}

/** @param {Skin} config @param {() => number} [random] */
export function chooseLevel(config, random = Math.random) {
  const choices = config.items,
    count = config.rules.m;
  let weight = 0;
  for (let i = 0; i < count; i++) weight += choices[i].weight;
  let ticket = random() * weight;
  for (let i = 0; i < count; i++) {
    ticket -= choices[i].weight;
    if (ticket < 0) return i;
  }
  for (let i = count - 1; i >= 0; i--) if (choices[i].weight > 0) return i;
  return 0;
}

/** Bounded rejection sampling: six rejected repeats, then accept the next draw.
 * @param {Skin} config @param {() => number} [random] @param {number} [avoid] */
export function chooseNextLevel(config, random = Math.random, avoid) {
  if (config.rules.avoidRepeat && avoid !== undefined) {
    for (let attempt = 0; attempt < config.rules.repeatRetries; attempt++) {
      const level = chooseLevel(config, random);
      if (level !== avoid) return level;
    }
  }
  return chooseLevel(config, random);
}
