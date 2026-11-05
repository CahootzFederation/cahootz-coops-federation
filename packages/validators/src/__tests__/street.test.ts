import { describe, expect, it } from "vitest";

import {
  buildStreetLayout,
  defaultHouseLook,
  STREET_DRAWN_HEIGHT,
  streetDoorTile,
  streetHides,
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
    for (const p of [...layout.lots, ...layout.buildings.filter((b) => b.id !== "board")]) {
      for (let a = 0; a < p.w; a++) {
        for (let b = 0; b < p.d; b++) {
          expect(layout.inBounds(p.i + a, p.j + b)).toBe(true);
          expect(layout.tileType(p.i + a, p.j + b)).toBe("grass");
        }
      }
    }
  });

  it("grows the road as the Commons grows", () => {
    expect(streetWidthFor(0)).toBe(streetWidthFor(4));
    expect(streetWidthFor(5)).toBeGreaterThan(streetWidthFor(4));
    expect(streetWidthFor(6)).toBe(streetWidthFor(5));
    expect(streetWidthFor(7)).toBeGreaterThan(streetWidthFor(6));
    expect(streetLotPlacement(0)).toEqual({ i: 2, j: 10, w: 2, d: 2 });
  });

  it("never lets a house, building or tree hide someone walking on the road or sidewalk", () => {
    const layout = buildStreetLayout(80);
    const walkways: Array<{ i: number; j: number }> = [];
    for (let i = 0; i < layout.width; i++) {
      for (let j = 0; j < layout.height; j++) {
        const t = layout.tileType(i, j);
        if (t === "road" || t === "walk") walkways.push({ i, j });
      }
    }
    expect(walkways.length).toBeGreaterThan(100);
    const things = [
      ...layout.lots.map((p) => ({ p, h: STREET_DRAWN_HEIGHT.house, what: `lot ${p.lotNumber}` })),
      // The community board stands in the middle of the circle, in front of the
      // back of the loop. The app turns it see-through whenever anyone stands
      // behind it (street-scene.tsx), so it's checked there instead of here.
      ...layout.buildings.filter((p) => p.id !== "board").map((p) => ({ p, h: STREET_DRAWN_HEIGHT.building, what: p.id })),
      ...layout.trees.map((t) => ({ p: { ...t, w: 1, d: 1 }, h: STREET_DRAWN_HEIGHT.tree, what: `tree ${t.i},${t.j}` })),
    ];
    for (const { p, h, what } of things) {
      const hidden = walkways.filter((t) => streetHides(p, h, t));
      expect(hidden, `${what} hides ${JSON.stringify(hidden)}`).toEqual([]);
    }
  });

  it("covers every road tile with exactly one 2x2 road piece", () => {
    for (const lastLot of [0, 7, 40]) {
      const layout = buildStreetLayout(lastLot);
      const covered = new Map<string, number>();
      for (const p of layout.roadPieces) {
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          const key = `${p.i + a},${p.j + b}`;
          covered.set(key, (covered.get(key) ?? 0) + 1);
        }
      }
      for (let i = 0; i < layout.width; i++) {
        for (let j = 0; j < layout.height; j++) {
          const isRoad = layout.tileType(i, j) === "road";
          expect(covered.get(`${i},${j}`) ?? 0, `tile ${i},${j} (lots up to ${lastLot})`).toBe(isRoad ? 1 : 0);
        }
      }
    }
  });

  it("knows a tall house hides someone standing right behind it", () => {
    expect(streetHides({ i: 5, j: 5, w: 2, d: 2 }, STREET_DRAWN_HEIGHT.house, { i: 4, j: 4 })).toBe(true);
    expect(streetHides({ i: 5, j: 5, w: 2, d: 2 }, STREET_DRAWN_HEIGHT.house, { i: 7, j: 7 })).toBe(false);
  });

  it("lets you walk from the community board to every front door", () => {
    const layout = buildStreetLayout(40);
    const board = layout.buildings.find((b) => b.id === "board")!;
    const start = streetDoorTile(layout, board, { x: 11.5, y: 8.5 })!;
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
