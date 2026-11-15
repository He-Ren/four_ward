import { readFileSync } from "node:fs";
import { MergeWorld } from "../../src/merge/physics.js";

export const base = JSON.parse(
  readFileSync(new URL("../../config/merge/default.json", import.meta.url)),
);
export function skin() {
  return structuredClone(base);
}
export function fixture() {
  const config = structuredClone(base);
  const sprites = config.items.map((item) => {
    const radius = item.size / 2;
    const polygon = Array.from({ length: 24 }, (_, i) => ({
      x: radius + Math.cos((i / 24) * Math.PI * 2) * radius,
      y: radius + Math.sin((i / 24) * Math.PI * 2) * radius,
    }));
    return {
      polygons: [polygon],
      width: item.size,
      height: item.size,
      center: { x: radius, y: radius },
    };
  });
  return new MergeWorld(config, sprites, () => 0);
}
export function advance(game, seconds) {
  for (let i = 0; i < seconds * game.config.physics.fixedHz; i++) game.step();
}
