import { describe, expect, it } from "vitest";

import {
  buildStreetLayout,
  defaultHouseLook,
  streetDoorTile,
  streetLotPlacement,
  streetPath,
  streetWidthFor,
  STREET_ROOF_KEYS,
  STREET_WALL_KEYS,
} from "../street.js";

type Box = { i: number; j: number; w: number; d: number };
const overlaps = (a: Box, b: Box) => a.i < b.i + b.w && b.i < a.i + a.w && a.j < b.j + b.d && b.j < a.j + a.d;

describe("street layout", () => {
  it("never overlaps lots, buildings or trees, even for a big Commons", () => {
    const layout = buildStreetLayout(149);
    const footprints: Box[] = [...layout.lots, ...layout.buildings];
    for (let a = 0; a < footprints.length; a++) {
      for (let b = a + 1; b < footprints.length; b++) {
        expect(overlaps(footprints[a]!, footprints[b]!), `${a} vs ${b}`).toBe(false);
      }
    }
    for (const tree of layout.trees) {
      expect(footprints.some((p) => overlaps(p, { ...tree, w: 1, d: 1 }))).toBe(false);
    }
  });

  it("keeps every lot and building on solid ground, never on the road", () => {
    const layout = buildStreetLayout(60);
    for (const p of [...layout.lots, ...layout.buildings.filter((b) => b.id !== "green")]) {
      for (let a = 0; a < p.w; a++) {
        for (let b = 0; b < p.d; b++) {
          expect(layout.inBounds(p.i + a, p.j + b)).toBe(true);
          expect(layout.tileType(p.i + a, p.j + b)).toBe("grass");
        }
      }
    }
  });

  it("grows the road as the Commons grows", () => {
    expect(streetWidthFor(0)).toBe(streetWidthFor(7));
    expect(streetWidthFor(8)).toBeGreaterThan(streetWidthFor(7));
    expect(streetWidthFor(11)).toBe(streetWidthFor(8));
    expect(streetWidthFor(12)).toBeGreaterThan(streetWidthFor(11));
    expect(streetLotPlacement(0)).toEqual({ i: 10, j: 12, w: 2, d: 2 });
  });

  it("lets you walk from the Green to every front door", () => {
    const layout = buildStreetLayout(40);
    const green = layout.buildings.find((b) => b.id === "green")!;
    const start = streetDoorTile(layout, green, { x: 11.5, y: 8.5 })!;
    for (const p of [...layout.lots, ...layout.buildings]) {
      const door = streetDoorTile(layout, p, layout.center);
      expect(door, `door for ${JSON.stringify(p)}`).not.toBeNull();
      if (door!.i === start.i && door!.j === start.j) continue;
      expect(streetPath(layout, start, door!), `path to ${JSON.stringify(p)}`).not.toBeNull();
    }
  });

  it("starts houses with a varied look from the palette", () => {
    const looks = [0, 1, 2, 3].map(defaultHouseLook);
    expect(new Set(looks.map((l) => `${l.houseStyle}${l.wallColor}${l.roofColor}`)).size).toBe(4);
    for (const look of looks) {
      expect(STREET_WALL_KEYS).toContain(look.wallColor);
      expect(STREET_ROOF_KEYS).toContain(look.roofColor);
    }
  });
});
