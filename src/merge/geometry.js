// @ts-check
import { earcut } from "./vendor.js";
/** @typedef {import('./types.js').Point} Point */
const GEOMETRY_EPSILON = 1e-7;
/** @param {Point[]} polygon */
export function area(polygon) {
  return (
    polygon.reduce((sum, p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2
  );
}
/** @param {Point} a @param {Point} b @param {Point} c */
const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
/** @param {Point[]} points */
function hull(points) {
  const sorted = [
    ...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values(),
  ].sort((a, b) => a.x - b.x || a.y - b.y);
  /** @type {Point[]} */ const lower = [],
    upper = [];
  for (const p of sorted) {
    while (
      lower.length > 1 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (
      upper.length > 1 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** @param {Point} p @param {Point[]} polygon */
function contains(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
/** Remove raster stair steps, with a bounded error in mask cells.
 * @param {Point[]} input @param {number} tolerance */
function simplify(input, tolerance) {
  // Ramer–Douglas–Peucker on two open arcs. Unlike repeated local deletion,
  // every retained segment is bounded against the ORIGINAL pixel boundary.
  /** @param {Point[]} points @returns {Point[]} */
  function arc(points) {
    if (points.length <= 2) return points;
    const a = points[0],
      b = points[points.length - 1],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    let maximum = -1,
      index = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i],
        t = length2
          ? Math.max(
              0,
              Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2),
            )
          : 0;
      const distance = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (distance > maximum) {
        maximum = distance;
        index = i;
      }
    }
    return maximum > tolerance
      ? arc(points.slice(0, index + 1))
          .slice(0, -1)
          .concat(arc(points.slice(index)))
      : [a, b];
  }
  let farthest = 1;
  for (let i = 2; i < input.length; i++)
    if (
      Math.hypot(input[i].x - input[0].x, input[i].y - input[0].y) >
      Math.hypot(input[farthest].x - input[0].x, input[farthest].y - input[0].y)
    )
      farthest = i;
  const result = arc(input.slice(0, farthest + 1))
    .slice(0, -1)
    .concat(arc(input.slice(farthest).concat(input[0])).slice(0, -1));
  return result.length >= 3 ? result : input;
}
/** Extract directed grid boundaries, including holes and disconnected islands.
 * @param {Uint8Array} mask @param {number} width @param {number} height @param {number} tolerance
 * @returns {Point[][]} */
export function maskToPolygons(mask, width, height, tolerance) {
  /** @type {Map<string, {a:Point,b:Point,used:boolean}[]>} */ const edges =
    new Map();
  /** @param {number} x @param {number} y */
  const solid = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;
  /** @param {Point} a @param {Point} b */
  const edge = (a, b) => {
    const key = `${a.x},${a.y}`;
    const list = edges.get(key) || [];
    list.push({ a, b, used: false });
    edges.set(key, list);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (solid(x, y)) {
        if (!solid(x, y - 1)) edge({ x, y }, { x: x + 1, y });
        if (!solid(x + 1, y)) edge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
        if (!solid(x, y + 1)) edge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
        if (!solid(x - 1, y)) edge({ x, y: y + 1 }, { x, y });
      }
  /** @type {Point[][]} */ const loops = [];
  for (const list of edges.values())
    for (const first of list) {
      if (first.used) continue;
      const loop = [];
      let current = first;
      while (!current.used) {
        current.used = true;
        loop.push(current.a);
        const candidates = (
          edges.get(`${current.b.x},${current.b.y}`) || []
        ).filter((e) => !e.used);
        if (!candidates.length) break;
        // At diagonally touching cells, turn right to keep islands separate.
        const direction = {
          x: current.b.x - current.a.x,
          y: current.b.y - current.a.y,
        };
        candidates.sort((a, b) => {
          const turnA =
            direction.x * (a.b.y - a.a.y) - direction.y * (a.b.x - a.a.x);
          const turnB =
            direction.x * (b.b.y - b.a.y) - direction.y * (b.b.x - b.a.x);
          return turnB - turnA;
        });
        current = candidates[0];
      }
      const reduced = simplify(loop, tolerance);
      if (reduced.length >= 3 && Math.abs(area(reduced)) > GEOMETRY_EPSILON)
        loops.push(reduced);
    }
  const outers = loops.filter((p) => area(p) > 0),
    holes = loops.filter((p) => area(p) < 0);
  /** @type {Point[][]} */ const parts = [];
  for (const outer of outers) {
    const owned = holes.filter((hole) => {
      const owners = outers
        .filter((p) => contains(hole[0], p))
        .sort((a, b) => area(a) - area(b));
      return owners[0] === outer;
    });
    const points = [...outer],
      starts = [];
    for (const hole of owned) {
      starts.push(points.length);
      points.push(...hole);
    }
    const indices = earcut(
      points.flatMap((p) => [p.x, p.y]),
      starts,
      2,
    );
    /** @type {Point[][]} */ const polygons = [];
    for (let i = 0; i < indices.length; i += 3)
      polygons.push([
        points[indices[i]],
        points[indices[i + 1]],
        points[indices[i + 2]],
      ]);
    // Merge adjacent triangles only when the union is convex. Never fill holes
    // or replace concave silhouettes with their convex hull.
    let merged = true;
    while (merged) {
      merged = false;
      outerLoop: for (let i = 0; i < polygons.length; i++)
        for (let j = i + 1; j < polygons.length; j++) {
          const a = polygons[i],
            b = polygons[j];
          if (
            a.filter((p) => b.some((q) => p.x === q.x && p.y === q.y)).length <
            2
          )
            continue;
          const combined = hull(a.concat(b));
          if (
            Math.abs(
              Math.abs(area(combined)) - Math.abs(area(a)) - Math.abs(area(b)),
            ) < GEOMETRY_EPSILON
          ) {
            polygons[i] = combined;
            polygons.splice(j, 1);
            merged = true;
            break outerLoop;
          }
        }
    }
    parts.push(...polygons);
  }
  return parts;
}

/** @param {Point[][]} polygons */
export function centerOfMass(polygons) {
  let total = 0,
    x = 0,
    y = 0;
  for (const polygon of polygons) {
    let twiceArea = 0,
      cx = 0,
      cy = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        weight = a.x * b.y - b.x * a.y;
      twiceArea += weight;
      cx += (a.x + b.x) * weight;
      cy += (a.y + b.y) * weight;
    }
    const weight = Math.abs(twiceArea) / 2;
    if (weight > GEOMETRY_EPSILON) {
      x += (cx / (3 * twiceArea)) * weight;
      y += (cy / (3 * twiceArea)) * weight;
      total += weight;
    }
  }
  if (!total) throw new Error("图片没有可用的碰撞区域");
  return { x: x / total, y: y / total };
}
