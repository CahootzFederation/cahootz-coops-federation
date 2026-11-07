import { describe, expect, it } from "vitest";

import {
  buildStreetLayout,
  clampStreetPanAxis,
  clampStreetZoom,
  streetTagsToShow,
  STREET_ZOOM_MAX,
  STREET_ZOOM_MIN,
  defaultHouseLook,
  defaultStreetLook,
  STREET_DRAWN_HEIGHT,
  STREET_SKIN_TONES,
  streetDoorTile,
  streetHides,
  streetLotPlacement,
  streetPath,
  streetWidthFor,
  STREET_ROOF_KEYS,
  STREET_WALL_KEYS,
} from "../street.js";

interface Box {
  i: number;
  j: number;
  w: number;
  d: number;
}
const overlaps = (a: Box, b: Box) => a.i < b.i + b.w && b.i < a.i + a.w && a.j < b.j + b.d && b.j < a.j + a.d;

describe("street looks", () => {
  it("lists skin tones lightest to darkest", () => {
    const lightness = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    };
    const values = Object.values(STREET_SKIN_TONES).map(lightness);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("keeps everyone's starting skin tone when the list is reordered", () => {
    // Starting tones come from the same six tones as before the list was reordered.
    const starting = new Set(Array.from({ length: 200 }, (_, k) => defaultStreetLook(`user-${k}`).skin));
    expect([...starting].sort()).toEqual(["brown", "deep", "golden", "light", "tan", "warm"]);
    expect(defaultStreetLook("user_1").skin).toBe(["deep", "brown", "warm", "tan", "golden", "light"][Math.abs([..."user_1"].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 6]);
  });
});

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


describe("street zoom, drag and name tags", () => {
  it("keeps zoom between the limits", () => {
    expect(clampStreetZoom(5)).toBe(STREET_ZOOM_MAX);
    expect(clampStreetZoom(0.1)).toBe(STREET_ZOOM_MIN);
    expect(clampStreetZoom(1.3)).toBe(1.3);
    expect(clampStreetZoom(Number.NaN)).toBe(1);
  });

  it("keeps part of the map on screen however far you drag, at any zoom", () => {
    for (const zoom of [0.6, 1, 2]) {
      for (const pan of [-100000, 0, 100000]) {
        const p = clampStreetPanAxis(pan, 50, -400, 600, zoom, 390, 80);
        const left = 50 + p + zoom * -400;
        const right = 50 + p + zoom * 600;
        expect(right).toBeGreaterThanOrEqual(80 - 1e-9);
        expect(left).toBeLessThanOrEqual(390 - 80 + 1e-9);
      }
    }
    // A small drag is left alone.
    expect(clampStreetPanAxis(20, 50, -400, 600, 1, 390, 80)).toBe(20);
  });

  it("shows one tag per crowd and always keeps yours", () => {
    const shown = streetTagsToShow([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 5 },
      { id: "you", x: 20, y: 0, keep: true },
      { id: "far", x: 200, y: 0 },
    ]);
    expect([...shown].sort()).toEqual(["far", "you"]);
  });
});
