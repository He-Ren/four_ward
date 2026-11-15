import test from "node:test";
import assert from "node:assert/strict";
import { maskToPolygons, area, centerOfMass } from "../src/merge/geometry.js";

test("alpha geometry preserves concavity, holes and disconnected/diagonal islands", () => {
  for (const rows of [
    ["11111", "10001", "10001", "10001", "11111"],
    ["1000", "1000", "1111"],
    ["110011", "110011"],
    ["10", "01"],
  ]) {
    const mask = Uint8Array.from(rows.join("").split("").map(Number));
    const polygons = maskToPolygons(mask, rows[0].length, rows.length, 0);
    assert.equal(
      polygons.reduce((sum, p) => sum + Math.abs(area(p)), 0),
      mask.reduce((a, b) => a + b, 0),
    );
    assert.ok(polygons.every((p) => p.length >= 3));
    assert.ok(Number.isFinite(centerOfMass(polygons).x));
  }
});
