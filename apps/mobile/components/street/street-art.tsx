/**
 * Drawn art for Commons Street: isometric boxes, roofs, houses, buildings,
 * trees and the oval people. Everything is plain react-native-svg so it ships
 * over the air. Kenney building sprites (assets/street) can replace the
 * buildings later; people stay hand-drawn ovals.
 */
import React from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { STREET_HAIR_COLORS, STREET_SHIRT_COLORS, STREET_SKIN_TONES } from '@repo/validators/street';

export const TW = 48;
export const TH = 24;

export type Pt = [number, number];
export const iso = (x: number, y: number, z = 0): Pt => [((x - y) * TW) / 2, ((x + y) * TH) / 2 - z];

const pts = (list: Pt[]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** Lighten (f > 1) or darken (f < 1) a #rrggbb color. Returns #rrggbb so results can be shaded again. */
export function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/*
 * Light: the sun comes from the viewer's left and from above (the same light
 * the KayKit images were rendered with), so the left (+j) walls are lit, the
 * right (+i) walls are in shade, and shadows fall to the right on screen.
 */

/** How far a shadow reaches to the right per point of height, and how much it drops. */
const SHADOW_RUN = 0.72;
const SHADOW_DROP = 0.1;
export const SHADOW_FILL = 'rgba(24,46,34,0.22)';

/** Smallest convex shape around a set of points (monotone chain). */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The shadow a block standing on a footprint casts on the ground: the
 * footprint swept to the right by its height, in the block's own outline
 * (not a round blob), so things look planted instead of floating.
 */
export function castShadow(i: number, j: number, w: number, d: number, height: number) {
  const base: Pt[] = [iso(i, j), iso(i + w, j), iso(i + w, j + d), iso(i, j + d)];
  const tip = (p: Pt): Pt => [p[0] + height * SHADOW_RUN, p[1] + height * SHADOW_DROP];
  return pts(hull([...base, ...base.map(tip)]));
}

/** A darker line where walls meet the ground, plus a soft band of shade on the ground in front of them. */
function GroundContact({ x, y, w, d }: { x: number; y: number; w: number; d: number }) {
  const a = iso(x, y + d);
  const b = iso(x + w, y + d);
  const c = iso(x + w, y);
  const out = 0.07;
  return (
    <G>
      <Polygon points={pts([a, b, c, iso(x + w + out, y), iso(x + w + out, y + d + out), iso(x, y + d + out)])} fill="rgba(20,30,25,0.14)" />
      <Path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}L${c[0]} ${c[1]}`} stroke="rgba(20,25,20,0.32)" strokeWidth={1.4} fill="none" />
    </G>
  );
}

function Box({ x, y, w, d, z = 0, h, color }: { x: number; y: number; w: number; d: number; z?: number; h: number; color: string }) {
  return (
    <G>
      <Polygon points={pts([iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)])} fill={shade(color, 0.9)} />
      <Polygon points={pts([iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)])} fill={shade(color, 0.76)} />
      <Polygon points={pts([iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)])} fill={shade(color, 1.03)} />
      {/* The lit top edge of the front corner catches the light. */}
      <Path
        d={`M${iso(x, y + d, z + h)[0]} ${iso(x, y + d, z + h)[1]}L${iso(x + w, y + d, z + h)[0]} ${iso(x + w, y + d, z + h)[1]}`}
        stroke={shade(color, 1.12)}
        strokeWidth={0.8}
        fill="none"
      />
      {z === 0 ? <GroundContact x={x} y={y} w={w} d={d} /> : null}
    </G>
  );
}

/** A window on the lit (+j) wall: a darker frame, the glass, and a light streak across its top. */
function windowY(Y: number, xa: number, xb: number, za: number, zb: number, glass: string, frame: string, key: string) {
  return (
    <G key={key}>
      {faceY(Y, xa - 0.035, xb + 0.035, za - 1.2, zb + 1.2, frame)}
      {faceY(Y + 0.001, xa, xb, za, zb, glass)}
      {faceY(Y + 0.002, xa, xb, zb - (zb - za) * 0.35, zb, shade(glass, 1.08))}
    </G>
  );
}
/** A window on the shaded (+i) wall. */
function windowX(X: number, ya: number, yb: number, za: number, zb: number, glass: string, frame: string, key: string) {
  return (
    <G key={key}>
      {faceX(X, ya - 0.035, yb + 0.035, za - 1.2, zb + 1.2, frame)}
      {faceX(X + 0.001, ya, yb, za, zb, glass)}
      {faceX(X + 0.002, ya, yb, zb - (zb - za) * 0.35, zb, shade(glass, 1.06))}
    </G>
  );
}

/** A quad on the front-left (+y) face. */
const faceY = (Y: number, xa: number, xb: number, za: number, zb: number, fill: string, key?: string) => (
  <Polygon key={key} points={pts([iso(xa, Y, za), iso(xb, Y, za), iso(xb, Y, zb), iso(xa, Y, zb)])} fill={fill} />
);
/** A quad on the front-right (+x) face. */
const faceX = (X: number, ya: number, yb: number, za: number, zb: number, fill: string, key?: string) => (
  <Polygon key={key} points={pts([iso(X, ya, za), iso(X, yb, za), iso(X, yb, zb), iso(X, ya, zb)])} fill={fill} />
);

function GableRoof({ x, y, w, d, base, rise, roof, wall }: { x: number; y: number; w: number; d: number; base: number; rise: number; roof: string; wall: string }) {
  const xa = x - 0.06;
  const xb = x + w + 0.06;
  const ym = y + d / 2;
  const yb = y + d + 0.06;
  return (
    <G>
      <Polygon points={pts([iso(xa, y - 0.06, base), iso(xb, y - 0.06, base), iso(xb, ym, base + rise), iso(xa, ym, base + rise)])} fill={shade(roof, 0.72)} />
      <Polygon points={pts([iso(x + w, y, base), iso(x + w, y + d, base), iso(x + w, ym, base + rise)])} fill={shade(wall, 0.76)} />
      {/* The front slope faces the light: a touch lighter toward the ridge. */}
      <Polygon points={pts([iso(xa, yb, base), iso(xb, yb, base), iso(xb, ym, base + rise), iso(xa, ym, base + rise)])} fill={roof} />
      <Polygon
        points={pts([iso(xa, (yb + ym) / 2, base + rise / 2), iso(xb, (yb + ym) / 2, base + rise / 2), iso(xb, ym, base + rise), iso(xa, ym, base + rise)])}
        fill={shade(roof, 1.08)}
      />
      {/* Eave: the roof's front edge, a thin darker strip that gives it thickness. */}
      <Polygon points={pts([iso(xa, yb, base), iso(xb, yb, base), iso(xb, yb, base - 2.5), iso(xa, yb, base - 2.5)])} fill={shade(roof, 0.58)} />
      <Line x1={iso(xa, ym, base + rise)[0]} y1={iso(xa, ym, base + rise)[1]} x2={iso(xb, ym, base + rise)[0]} y2={iso(xb, ym, base + rise)[1]} stroke={shade(roof, 1.3)} strokeWidth={1.2} />
    </G>
  );
}

function PyramidRoof({ x, y, w, d, base, rise, roof }: { x: number; y: number; w: number; d: number; base: number; rise: number; roof: string }) {
  const top = iso(x + w / 2, y + d / 2, base + rise);
  const e = (px: number, py: number) => iso(px, py, base);
  return (
    <G>
      <Polygon points={pts([e(x, y), e(x + w, y), top])} fill={shade(roof, 0.7)} />
      <Polygon points={pts([e(x, y), e(x, y + d), top])} fill={shade(roof, 0.8)} />
      <Polygon points={pts([e(x + w, y), e(x + w, y + d), top])} fill={shade(roof, 0.82)} />
      <Polygon points={pts([e(x, y + d), e(x + w, y + d), top])} fill={shade(roof, 1.06)} />
      {/* Eaves along the two front edges, darker on the shaded right. */}
      <Polygon points={pts([e(x, y + d), e(x + w, y + d), iso(x + w, y + d, base - 2.5), iso(x, y + d, base - 2.5)])} fill={shade(roof, 0.6)} />
      <Polygon points={pts([e(x + w, y), e(x + w, y + d), iso(x + w, y + d, base - 2.5), iso(x + w, y, base - 2.5)])} fill={shade(roof, 0.5)} />
      <Line x1={e(x, y + d)[0]} y1={e(x, y + d)[1]} x2={top[0]} y2={top[1]} stroke={shade(roof, 1.25)} strokeWidth={0.9} />
    </G>
  );
}

const WINDOW = '#FFF1C4';
const WINDOW_SIDE = '#FFE7A6';
const DOOR = '#6B4A33';

/** Window glass: soft by day, warm and bright in the evening when lights are on inside. */
const glassFor = (night: boolean, side: boolean) => (night ? (side ? '#F6C24E' : '#FFD36E') : side ? WINDOW_SIDE : WINDOW);

export function HouseArt({ i, j, style, wall, roof, night = false }: { i: number; j: number; style: 'a' | 'b' | 'c'; wall: string; roof: string; night?: boolean }) {
  const x = i + 0.3;
  const y = j + 0.3;
  const floors = style === 'b' ? 2 : 1;
  const h = 24 * floors;
  const frame = shade(wall, 0.66);
  const windows: React.ReactNode[] = [];
  for (let f = 0; f < floors; f++) {
    const z = f * 24;
    windows.push(windowY(y + 1.401, x + 0.12, x + 0.34, z + 9, z + 17, glassFor(night, false), frame, `wy${f}`));
    windows.push(windowX(x + 1.401, y + 0.22, y + 0.46, z + 9, z + 17, glassFor(night, true), shade(frame, 0.85), `wx1${f}`));
    windows.push(windowX(x + 1.401, y + 0.94, y + 1.18, z + 9, z + 17, glassFor(night, true), shade(frame, 0.85), `wx2${f}`));
    if (f > 0) windows.push(windowY(y + 1.401, x + 0.6, x + 0.82, z + 9, z + 17, glassFor(night, false), frame, `wy2${f}`));
  }
  return (
    <G>
      <Box x={x} y={y} w={1.4} d={1.4} h={h} color={wall} />
      {windows}
      {faceY(y + 1.401, x + 0.74, x + 1.0, 0, 15, DOOR, 'door')}
      {style === 'c' ? (
        <PyramidRoof x={x - 0.08} y={y - 0.08} w={1.56} d={1.56} base={h} rise={22} roof={roof} />
      ) : (
        <GableRoof x={x} y={y} w={1.4} d={1.4} base={h} rise={16} roof={roof} wall={wall} />
      )}
    </G>
  );
}

export function ShopArt({ i, j, trim, night = false }: { i: number; j: number; trim: string; night?: boolean }) {
  const x = i + 0.15;
  const y = j + 0.15;
  const stripes: React.ReactNode[] = [];
  for (let k = 0; k < 7; k++) {
    const fill = k % 2 ? '#FFFFFF' : trim;
    stripes.push(faceY(y + 1.75, x + k * 0.243, x + (k + 1) * 0.243, 20, 27, fill, `sy${k}`));
    stripes.push(faceX(x + 1.75, y + k * 0.243, y + (k + 1) * 0.243, 20, 27, fill, `sx${k}`));
  }
  return (
    <G>
      <Box x={x} y={y} w={1.7} d={1.7} h={32} color="#FAF5EE" />
      {windowY(y + 1.701, x + 0.2, x + 0.85, 4, 18, night ? '#FFD36E' : '#BFE3F2', '#8A7F72', 'win')}
      {faceY(y + 1.701, x + 1.05, x + 1.4, 0, 18, '#5B4636', 'door')}
      {windowX(x + 1.701, y + 0.25, y + 1.45, 8, 20, night ? '#F6C24E' : '#AFD3E2', '#766C60', 'side')}
      {stripes}
      <Box x={x - 0.05} y={y - 0.05} w={1.8} d={1.8} z={32} h={4} color={shade(trim, 0.85)} />
    </G>
  );
}

export function TownHallArt({ i, j }: { i: number; j: number }) {
  const x = i + 0.3;
  const y = j + 0.3;
  const columns = [0, 1, 2, 3].map((k) => faceY(y + 1.45, x + 0.08 + k * 0.38, x + 0.18 + k * 0.38, 5, 35, '#FFFFFF', `c${k}`));
  return (
    <G>
      <Box x={i + 0.1} y={j + 0.1} w={1.8} d={1.8} h={5} color="#D7DBE0" />
      <Box x={x} y={y} w={1.4} d={1.4} z={5} h={30} color="#EEF0F3" />
      {columns}
      {faceY(y + 1.401, x + 0.55, x + 0.85, 5, 22, '#5B4636', 'door')}
      <GableRoof x={x} y={y} w={1.4} d={1.4} base={35} rise={14} roof="#6B7280" wall="#EEF0F3" />
    </G>
  );
}

const CIRCLE_WINDOW_COLORS = ['#B94614', '#C2557A', '#3E7CB1', '#4F8A4B', '#C98A1B', '#5B5FAF', '#8A4E6B', '#2F8F8A'];

export function CircleHallArt({ i, j, circleCount }: { i: number; j: number; circleCount: number }) {
  const x = i + 0.2;
  const y = j + 0.2;
  const lit = Math.min(8, circleCount);
  const windows: React.ReactNode[] = [];
  for (let k = 0; k < 8; k++) {
    const row = Math.floor(k / 4);
    const col = k % 4;
    const z = 28 - row * 14;
    const fill = k < lit ? CIRCLE_WINDOW_COLORS[k]! : '#D9DDE3';
    windows.push(faceY(y + 1.601, x + 0.12 + col * 0.36, x + 0.32 + col * 0.36, z, z + 9, fill, `y${k}`));
    windows.push(faceX(x + 1.601, y + 0.12 + col * 0.36, y + 0.32 + col * 0.36, z, z + 9, k < lit ? shade(fill, 0.85) : '#C9CDD3', `x${k}`));
  }
  return (
    <G>
      <Box x={i + 0.1} y={j + 0.1} w={1.8} d={1.8} h={4} color="#D7DBE0" />
      <Box x={x} y={y} w={1.6} d={1.6} z={4} h={44} color="#FFFFFF" />
      {windows}
      {faceY(y + 1.601, x + 0.68, x + 0.92, 4, 14, DOOR, 'door')}
      <PyramidRoof x={i + 0.1} y={j + 0.1} w={1.8} d={1.8} base={48} rise={26} roof="#5F59A0" />
    </G>
  );
}

const NOTE_COLORS = ['#FFF3A3', '#BFE3F2', '#F9C6D0', '#C9F2C7', '#FFFFFF', '#FFD8A8'];

/**
 * The community board: a cork board on two posts with a little roof, standing
 * on a paved plaza, with one paper note pinned up for each recent post.
 */
export function BoardArt({ i, j, notes }: { i: number; j: number; notes: number }) {
  const PY = j + 1.05; // the board faces the viewer's lower left (+j)
  const x0 = i + 0.22;
  const x1 = i + 1.78;
  const zLow = 7;
  const zHigh = 34;
  const post = (px: number, key: string) => {
    const [ax, ay] = iso(px, PY, 0);
    const [bx, by] = iso(px, PY, zHigh + 2);
    return <Line key={key} x1={ax} y1={ay} x2={bx} y2={by} stroke="#6B4A33" strokeWidth={3} strokeLinecap="round" />;
  };
  const slots: Array<[number, number]> = [
    [0.12, 0.55], [0.42, 0.6], [0.72, 0.52],
    [0.18, 0.12], [0.5, 0.15], [0.78, 0.1],
  ];
  const shown = Math.max(1, Math.min(slots.length, notes));
  const span = x1 - x0;
  return (
    <G>
      {/* Paved plaza with two low planters at the front corners. */}
      <Polygon points={pts([iso(i + 0.05, j + 0.05), iso(i + 1.95, j + 0.05), iso(i + 1.95, j + 1.95), iso(i + 0.05, j + 1.95)])} fill="#E3DCCF" />
      <Box x={i + 1.55} y={j + 1.55} w={0.35} d={0.35} h={5} color="#8B5E3C" />
      <Circle cx={iso(i + 1.72, j + 1.72, 9)[0]} cy={iso(i + 1.72, j + 1.72, 9)[1]} r={4} fill="#62A05B" />
      <Box x={i + 0.1} y={j + 1.55} w={0.35} d={0.35} h={5} color="#8B5E3C" />
      <Circle cx={iso(i + 0.27, j + 1.72, 9)[0]} cy={iso(i + 0.27, j + 1.72, 9)[1]} r={4} fill="#62A05B" />
      {post(x0 + 0.05, 'pl')}
      {post(x1 - 0.05, 'pr')}
      {/* Wood frame, cork face, and a small roof to keep the notes dry. */}
      {faceY(PY, x0 - 0.04, x1 + 0.04, zLow - 1.5, zHigh + 1.5, '#7A5636', 'frame')}
      {faceY(PY + 0.001, x0, x1, zLow, zHigh, '#C9A06B', 'cork')}
      <Polygon points={pts([iso(x0 - 0.1, PY - 0.12, zHigh + 2), iso(x1 + 0.1, PY - 0.12, zHigh + 2), iso(x1 + 0.1, PY + 0.14, zHigh + 6), iso(x0 - 0.1, PY + 0.14, zHigh + 6)])} fill="#8E3A16" />
      {slots.slice(0, shown).map(([fx, fz], k) => {
        const nx0 = x0 + span * fx;
        const nx1 = nx0 + span * 0.22;
        const nz0 = zLow + (zHigh - zLow) * fz + 1;
        const nz1 = nz0 + 7;
        const [pinX, pinY] = iso((nx0 + nx1) / 2, PY + 0.003, nz1 - 1);
        return (
          <G key={`n${k}`}>
            {faceY(PY + 0.002, nx0, nx1, nz0, nz1, NOTE_COLORS[k % NOTE_COLORS.length]!)}
            <Circle cx={pinX} cy={pinY} r={1.3} fill="#DC2626" />
          </G>
        );
      })}
    </G>
  );
}

export function TreeArt({ i, j }: { i: number; j: number }) {
  const [bx, by] = iso(i + 0.5, j + 0.5);
  return (
    <G>
      <Ellipse cx={bx} cy={by} rx={11} ry={5} fill="rgba(20,40,20,0.15)" />
      <Rect x={bx - 2} y={by - 12} width={4} height={12} fill="#7A5636" />
      <Circle cx={bx} cy={by - 20} r={11} fill="#4F8A4B" />
      <Circle cx={bx - 3} cy={by - 23} r={7} fill="#62A05B" />
    </G>
  );
}

/** The colors a person is drawn with (hex), from their saved look. */
export interface PersonColors {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'curly' | 'bun' | 'long' | 'none';
  shirt: string;
}

/**
 * People are shaded with soft gradients rather than hard light/dark splits:
 * lit on the left, gently darker on the right, so a body, face or hairdo
 * reads as round. One gradient per palette color, defined once for the
 * whole street (see PersonGradients) and shared by everyone.
 */
const personFill = (hex: string) => `url(#pg${hex.slice(1).toLowerCase()})`;

/** The shared gradients for every skin, hair and shirt color. Render once inside each Svg that draws people. */
export function PersonGradients() {
  const colors = new Set(
    [...Object.values(STREET_SKIN_TONES), ...Object.values(STREET_HAIR_COLORS), ...Object.values(STREET_SHIRT_COLORS)].map((c) => c.toLowerCase()),
  );
  return (
    <Defs>
      {[...colors].map((c) => (
        <LinearGradient key={c} id={`pg${c.slice(1)}`} x1="0" y1="0" x2="1" y2="0.35">
          <Stop offset="0" stopColor={shade(c, 1.1)} />
          <Stop offset="0.45" stopColor={c} />
          <Stop offset="1" stopColor={shade(c, 0.8)} />
        </LinearGradient>
      ))}
    </Defs>
  );
}

/** A cap of hair over the top of the head, with a soft hairline arching over the forehead. */
const sleekCap = (cx: number, cy: number) =>
  // Large arc (the 1 after the rotation) so it goes up over the top of the head, not under the chin.
  `M${cx - 6.5} ${cy + 0.8}A6.6 6.9 0 1 1 ${cx + 6.5} ${cy + 0.8}L${cx + 5.5} ${cy + 0.8}C${cx + 4.4} ${cy - 3} ${cx - 4.4} ${cy - 3} ${cx - 5.5} ${cy + 0.8}Z`;

/** Short hair: the cap with a fringe swept across the forehead. */
const shortHair = (cx: number, cy: number) =>
  `M${cx - 6.4} ${cy + 0.6}C${cx - 6.9} ${cy - 5} ${cx - 3.6} ${cy - 7.7} ${cx} ${cy - 7.5}C${cx + 3.8} ${cy - 7.7} ${cx + 6.9} ${cy - 5} ${cx + 6.4} ${cy + 0.6}L${cx + 5.4} ${cy + 0.6}C${cx + 4.8} ${cy - 2.4} ${cx + 1.4} ${cy - 3.4} ${cx - 0.8} ${cy - 2.3}C${cx - 2.8} ${cy - 1.4} ${cx - 4.6} ${cy - 1.8} ${cx - 5.3} ${cy + 0.6}Z`;

/** Long hair: falls past the ears to the shoulders, behind the face. */
const longHairBack = (cx: number, cy: number) =>
  `M${cx - 6.6} ${cy - 1}C${cx - 7.6} ${cy + 4} ${cx - 7.2} ${cy + 8} ${cx - 5.2} ${cy + 9.8}L${cx + 5.2} ${cy + 9.8}C${cx + 7.2} ${cy + 8} ${cx + 7.6} ${cy + 4} ${cx + 6.6} ${cy - 1}Z`;

/** Curls: small rounds ringing the top and sides of the head. Angles in degrees, 270 is straight up. */
const CURL_ANGLES = [160, 192, 224, 256, 288, 320, 352, 20];

/** Hair is drawn in two parts: behind the head (long hair) and over it (caps, fringe, curls, bun). */
function hairParts(cx: number, cy: number, look: PersonColors): { back: React.ReactNode; top: React.ReactNode } {
  const fill = personFill(look.hair);
  const back = look.hairStyle === 'long' ? <Path d={longHairBack(cx, cy)} fill={fill} /> : null;
  const top =
    look.hairStyle === 'short' ? <Path d={shortHair(cx, cy)} fill={fill} />
    : look.hairStyle === 'long' ? <Path d={sleekCap(cx, cy)} fill={fill} />
    : look.hairStyle === 'bun' ? (
      <G>
        <Circle cx={cx + 0.4} cy={cy - 8.6} r={3} fill={fill} />
        <Path d={sleekCap(cx, cy)} fill={fill} />
      </G>
    )
    : look.hairStyle === 'curly' ? (
      <G>
        <Path d={sleekCap(cx, cy)} fill={fill} />
        {CURL_ANGLES.map((deg) => {
          const a = (deg * Math.PI) / 180;
          return <Circle key={deg} cx={cx + Math.cos(a) * 6.1} cy={cy - 0.6 + Math.sin(a) * 6.1} r={2.5} fill={fill} />;
        })}
      </G>
    )
    : null;
  return { back, top };
}

/** A walker's name stays in the scene's top layer so buildings never cover it. */
export function WalkerNameTag({ x, y, name, bob, scale = 1 }: { x: number; y: number; name: string; bob: number; scale?: number }) {
  const [sx, sy] = iso(x, y);
  const width = Math.max(34, name.length * 6 + 14);
  return (
    // Grows with the phone's text size, from just above the person's head.
    <G transform={scale === 1 ? undefined : `translate(${sx} ${sy - 34}) scale(${scale}) translate(${-sx} ${-(sy - 34)})`}>
      <Rect x={sx - width / 2} y={sy - 50 - bob} width={width} height={16} rx={8} fill="rgba(255,255,255,0.96)" />
      <SvgText x={sx} y={sy - 38.5 - bob} fontSize={10} fontWeight="700" fill="#1F2937" textAnchor="middle">
        {name}
      </SvgText>
    </G>
  );
}

/**
 * A person in their chosen look: a rounded body like the Maple Court mockup,
 * a round head with two small eyes, and hair. Lit softly from the left like
 * the buildings (see PersonGradients). `shadow` is off in the look preview.
 */
export function PersonArt({ x, y, look, isYou, bob, shadow = true }: { x: number; y: number; look: PersonColors; isYou: boolean; bob: number; shadow?: boolean }) {
  const [sx, sy] = iso(x, y);
  const headY = sy - 25 - bob;
  const hair = hairParts(sx, headY, look);
  const top = sy - 19 - bob;
  return (
    <G>
      {shadow ? (
        <G>
          {/* A long faint shadow to the right (matching the buildings) and a tight one under the feet. */}
          <Ellipse cx={sx + 8} cy={sy + 0.5} rx={10} ry={3} fill="rgba(24,46,34,0.14)" />
          <Ellipse cx={sx} cy={sy} rx={5.5} ry={2.4} fill="rgba(0,0,0,0.26)" />
        </G>
      ) : null}
      {isYou ? <Ellipse cx={sx} cy={sy} rx={11} ry={5.5} fill="none" stroke="#B94614" strokeWidth={2} /> : null}
      {hair.back}
      <Rect x={sx - 6} y={top} width={12} height={16} rx={5} fill={personFill(look.shirt)} />
      <Circle cx={sx} cy={headY} r={6} fill={personFill(look.skin)} />
      {/* Eyes, looking out at you. */}
      <Circle cx={sx - 2.1} cy={headY + 1.2} r={0.85} fill="#2A211C" />
      <Circle cx={sx + 2.1} cy={headY + 1.2} r={0.85} fill="#2A211C" />
      {hair.top}
    </G>
  );
}

/** A close-up of a person, for the look picker: big enough to see the hair and colors. */
export function PersonPreview({ look, height = 72 }: { look: PersonColors; height?: number }) {
  return (
    <Svg width={(height * 26) / 42} height={height} viewBox="-13 -38 26 42">
      <PersonGradients />
      <PersonArt x={0} y={0} look={look} isYou={false} bob={0} shadow={false} />
    </Svg>
  );
}

/** Sage on the street, scaled down from the shared peach blob and round-glasses avatar. */
export function SageStreetArt({ x, y, bob }: { x: number; y: number; bob: number }) {
  const [sx, sy] = iso(x, y);
  const cy = sy - 18 - bob;
  return (
    <G>
      <Ellipse cx={sx} cy={sy} rx={8} ry={4} fill="rgba(0,0,0,0.2)" />
      <Ellipse cx={sx - 3.5} cy={sy - 5 - bob} rx={3.2} ry={2} fill="#7C2D12" />
      <Ellipse cx={sx + 3.5} cy={sy - 5 - bob} rx={3.2} ry={2} fill="#7C2D12" />
      <Path
        d={`M ${sx - 8.5} ${cy - 6} C ${sx - 6} ${cy - 14}, ${sx + 7} ${cy - 14}, ${sx + 9} ${cy - 4} C ${sx + 11} ${cy + 7}, ${sx + 5} ${cy + 13}, ${sx - 4} ${cy + 12} C ${sx - 12} ${cy + 10}, ${sx - 13} ${cy}, ${sx - 8.5} ${cy - 6} Z`}
        fill="#FB923C"
      />
      <Ellipse cx={sx - 4} cy={cy - 7} rx={3.2} ry={2} fill="#FED7AA" opacity={0.9} transform={`rotate(-25 ${sx - 4} ${cy - 7})`} />
      <Ellipse cx={sx - 5.5} cy={cy + 5} rx={2} ry={1.4} fill="#F472B6" opacity={0.55} />
      <Ellipse cx={sx + 5.5} cy={cy + 5} rx={2} ry={1.4} fill="#F472B6" opacity={0.55} />
      <G fill="rgba(255,255,255,0.58)" stroke="#7C2D12" strokeWidth={1.4}>
        <Circle cx={sx - 3.8} cy={cy} r={3.8} />
        <Circle cx={sx + 3.8} cy={cy} r={3.8} />
      </G>
      <Line x1={sx} y1={cy - 0.4} x2={sx} y2={cy - 0.4} stroke="#7C2D12" strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={sx - 3.8} cy={cy} r={1.5} fill="#1F2937" />
      <Circle cx={sx + 3.8} cy={cy} r={1.5} fill="#1F2937" />
      <Circle cx={sx - 3.3} cy={cy - 0.5} r={0.45} fill="#FFFFFF" />
      <Circle cx={sx + 4.3} cy={cy - 0.5} r={0.45} fill="#FFFFFF" />
      <Path d={`M ${sx - 3} ${cy + 6} Q ${sx} ${cy + 9} ${sx + 3} ${cy + 6}`} stroke="#1F2937" strokeWidth={1.4} fill="none" strokeLinecap="round" />
    </G>
  );
}

/** How wide a building or house label is at normal text size. */
export const labelWidth = (text: string) => text.length * 6.4 + 16;

/** A rounded name tag floating above a building. */
export function Label({ at, text, fill, color = '#FFFFFF', scale = 1 }: { at: Pt; text: string; fill: string; color?: string; scale?: number }) {
  const width = labelWidth(text);
  return (
    // Grows with the phone's text size, around the label's middle.
    <G transform={scale === 1 ? undefined : `translate(${at[0]} ${at[1]}) scale(${scale}) translate(${-at[0]} ${-at[1]})`}>
      {/* A soft shadow and a small pointer tie the sign to what it names. */}
      <Rect x={at[0] - width / 2} y={at[1] - 8} width={width} height={20} rx={10} fill="rgba(15,23,42,0.14)" />
      <Polygon points={pts([[at[0] - 5, at[1] + 9], [at[0] + 5, at[1] + 9], [at[0], at[1] + 15]])} fill={fill} />
      <Rect x={at[0] - width / 2} y={at[1] - 10} width={width} height={20} rx={10} fill={fill} />
      <SvgText x={at[0]} y={at[1] + 4} fontSize={11} fontWeight="700" fill={color} textAnchor="middle">
        {text}
      </SvgText>
    </G>
  );
}

export { pts as polygonPoints };
