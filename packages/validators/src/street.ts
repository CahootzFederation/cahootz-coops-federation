/**
 * Commons Street: the shared layout and palette for a Commons' walkable
 * street. The server stores only each member's lot number and colors; the app
 * and the server both place lots, buildings, roads and trees from this file so
 * they always agree on where things are and which tiles can be walked on.
 *
 * Grid: tile (i, j) covers [i, i+1] x [j, j+1]. The app draws it as 2:1
 * isometric (screen x = (i - j) * TW/2, screen y = (i + j) * TH/2).
 */

export const STREET_WALL_COLORS = {
  cream: "#F2D7B6",
  sky: "#CFE3EA",
  sage: "#DDE8CF",
  rose: "#EAD0D8",
  white: "#FFFFFF",
} as const;
export const STREET_ROOF_COLORS = {
  terracotta: "#B94614",
  slate: "#4A4A55",
  blue: "#3E6A86",
  green: "#5B7F4E",
} as const;
export const STREET_HOUSE_STYLES = ["a", "b", "c"] as const;

export type StreetWallColor = keyof typeof STREET_WALL_COLORS;
export type StreetRoofColor = keyof typeof STREET_ROOF_COLORS;
export type StreetHouseStyle = (typeof STREET_HOUSE_STYLES)[number];

export const STREET_WALL_KEYS = Object.keys(STREET_WALL_COLORS) as StreetWallColor[];
export const STREET_ROOF_KEYS = Object.keys(STREET_ROOF_COLORS) as StreetRoofColor[];

/** People count as "on the street" for this long after their last check-in. */
export const STREET_ONLINE_WINDOW_MS = 90_000;
/** One knock per person per neighbor in this window. */
export const STREET_KNOCK_COOLDOWN_MS = 30 * 60_000;

/** A new lot's starting look, varied by lot number so the street isn't uniform. */
export function defaultHouseLook(lotNumber: number): {
  houseStyle: StreetHouseStyle;
  wallColor: StreetWallColor;
  roofColor: StreetRoofColor;
} {
  const n = Math.max(0, Math.floor(lotNumber));
  return {
    houseStyle: STREET_HOUSE_STYLES[n % STREET_HOUSE_STYLES.length]!,
    wallColor: STREET_WALL_KEYS[n % STREET_WALL_KEYS.length]!,
    roofColor: STREET_ROOF_KEYS[(n * 3) % STREET_ROOF_KEYS.length]!,
  };
}

export type StreetTileType = "grass" | "green" | "road" | "walk";
export type StreetBuildingId = "circle-hall" | "group-buys" | "town-hall" | "corner-store" | "green";

export interface StreetPlacement {
  i: number;
  j: number;
  w: number;
  d: number;
}

export interface StreetLayout {
  width: number;
  height: number;
  center: { x: number; y: number };
  lots: Array<StreetPlacement & { lotNumber: number }>;
  buildings: Array<StreetPlacement & { id: StreetBuildingId }>;
  trees: Array<{ i: number; j: number }>;
  tileType(i: number, j: number): StreetTileType;
  isBlocked(i: number, j: number): boolean;
  inBounds(i: number, j: number): boolean;
}

const HEIGHT = 16;
const CENTER = 8;
const BULB_LOTS: Array<[number, number]> = [
  [10, 12], [6, 12], [3, 11], [2, 7], [3, 3], [6, 2], [10, 2],
];
const BUILDINGS: Array<StreetPlacement & { id: StreetBuildingId }> = [
  { id: "group-buys", i: 12, j: 3, w: 2, d: 2 },
  { id: "town-hall", i: 14, j: 3, w: 2, d: 2 },
  { id: "corner-store", i: 12, j: 11, w: 2, d: 2 },
  { id: "circle-hall", i: 14, j: 11, w: 2, d: 2 },
  { id: "green", i: 7, j: 7, w: 2, d: 2 },
];
const ROAD_START = 17; // first column of road lots, after the buildings
const BLOCK = 3; // each block of road holds 4 lots: front and back rows on each side
const BLOCK_ROWS = [4, 10, 1, 13];
const BASE_TREES: Array<[number, number]> = [
  [1, 1], [0, 4], [1, 14], [4, 15], [9, 15], [8, 0], [0, 10], [0, 7], [5, 0], [12, 15], [12, 0], [16, 15],
];

/** Where lot `lotNumber` sits: 7 around the cul-de-sac, the rest along the road out. */
export function streetLotPlacement(lotNumber: number): StreetPlacement {
  if (lotNumber < BULB_LOTS.length) {
    const [i, j] = BULB_LOTS[lotNumber]!;
    return { i, j, w: 2, d: 2 };
  }
  const m = lotNumber - BULB_LOTS.length;
  return { i: ROAD_START + Math.floor(m / 4) * BLOCK, j: BLOCK_ROWS[m % 4]!, w: 2, d: 2 };
}

export function streetWidthFor(lotCount: number): number {
  const extra = Math.max(0, lotCount - BULB_LOTS.length);
  return ROAD_START + Math.ceil(extra / 4) * BLOCK + 1;
}

/** Build the street for a Commons whose highest lot number is `maxLotNumber` (or -1 when empty). */
export function buildStreetLayout(maxLotNumber: number): StreetLayout {
  const lotCount = Math.max(0, maxLotNumber + 1);
  const width = streetWidthFor(lotCount);
  const lots = Array.from({ length: lotCount }, (_, n) => ({ lotNumber: n, ...streetLotPlacement(n) }));
  const footprints = [...lots, ...BUILDINGS];
  const covers = (p: StreetPlacement, i: number, j: number) => i >= p.i && i < p.i + p.w && j >= p.j && j < p.j + p.d;

  const tileType = (i: number, j: number): StreetTileType => {
    const r = Math.hypot(i + 0.5 - CENTER, j + 0.5 - CENTER);
    let t: StreetTileType = "grass";
    if (r < 2.2) t = "green";
    else if (r <= 3.6) t = "road";
    else if (r <= 4.3) t = "walk";
    if (i >= 11 && (j === 7 || j === 8)) t = "road";
    else if (i >= 11 && (j === 6 || j === 9)) t = "walk";
    return t;
  };
  const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < HEIGHT;

  const trees: Array<{ i: number; j: number }> = [];
  const treeCandidates: Array<[number, number]> = [...BASE_TREES];
  // A tree in each gap column along the road, front and back.
  for (let x = ROAD_START + 2; x < width; x += BLOCK) treeCandidates.push([x, 0], [x, 15]);
  for (const [i, j] of treeCandidates) {
    if (inBounds(i, j) && tileType(i, j) === "grass" && !footprints.some((p) => covers(p, i, j))) trees.push({ i, j });
  }

  const blocked = new Set<string>();
  for (const p of footprints) for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) blocked.add(`${p.i + a},${p.j + b}`);
  for (const t of trees) blocked.add(`${t.i},${t.j}`);

  return {
    width,
    height: HEIGHT,
    center: { x: CENTER, y: CENTER },
    lots,
    buildings: BUILDINGS,
    trees,
    tileType,
    inBounds,
    isBlocked: (i, j) => !inBounds(i, j) || blocked.has(`${i},${j}`),
  };
}

/** The walkable tile beside a footprint that is closest to `toward` (its front door). */
export function streetDoorTile(layout: StreetLayout, p: StreetPlacement, toward: { x: number; y: number }) {
  let best: { i: number; j: number } | null = null;
  let bestDistance = Infinity;
  for (let a = -1; a <= p.w; a++) {
    for (let b = -1; b <= p.d; b++) {
      const edgeA = a === -1 || a === p.w;
      const edgeB = b === -1 || b === p.d;
      if (edgeA === edgeB) continue; // skip the inside and the diagonal corners
      const i = p.i + a;
      const j = p.j + b;
      if (layout.isBlocked(i, j)) continue;
      const distance = Math.hypot(i + 0.5 - toward.x, j + 0.5 - toward.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { i, j };
      }
    }
  }
  return best;
}

/** Shortest walk between tiles (4-way), not counting the start. Null when unreachable. */
export function streetPath(layout: StreetLayout, from: { i: number; j: number }, to: { i: number; j: number }) {
  if (layout.isBlocked(to.i, to.j)) return null;
  const key = (i: number, j: number) => i * 1000 + j;
  const prev = new Map<number, number | null>([[key(from.i, from.j), null]]);
  const queue: Array<[number, number]> = [[from.i, from.j]];
  while (queue.length) {
    const [i, j] = queue.shift()!;
    if (i === to.i && j === to.j) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (layout.isBlocked(ni, nj) || prev.has(key(ni, nj))) continue;
      prev.set(key(ni, nj), key(i, j));
      queue.push([ni, nj]);
    }
  }
  if (!prev.has(key(to.i, to.j))) return null;
  const path: Array<{ i: number; j: number }> = [];
  let cur: number | null | undefined = key(to.i, to.j);
  while (cur != null) {
    path.unshift({ i: Math.floor(cur / 1000), j: cur % 1000 });
    cur = prev.get(cur);
  }
  path.shift();
  return path;
}
