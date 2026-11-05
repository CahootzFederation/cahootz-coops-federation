/**
 * Drawn art for Commons Street: isometric boxes, roofs, houses, buildings,
 * trees and the oval people. Everything is plain react-native-svg so it ships
 * over the air. Kenney building sprites (assets/street) can replace the
 * buildings later; people stay hand-drawn ovals.
 */
import React from 'react';
import { Circle, Ellipse, G, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';

export const TW = 48;
export const TH = 24;

export type Pt = [number, number];
export const iso = (x: number, y: number, z = 0): Pt => [((x - y) * TW) / 2, ((x + y) * TH) / 2 - z];

const pts = (list: Pt[]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function Box({ x, y, w, d, z = 0, h, color }: { x: number; y: number; w: number; d: number; z?: number; h: number; color: string }) {
  return (
    <G>
      <Polygon points={pts([iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)])} fill={shade(color, 0.9)} />
      <Polygon points={pts([iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)])} fill={shade(color, 0.76)} />
      <Polygon points={pts([iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)])} fill={shade(color, 1.03)} />
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
  return (
    <G>
      <Polygon points={pts([iso(xa, y - 0.06, base), iso(xb, y - 0.06, base), iso(xb, ym, base + rise), iso(xa, ym, base + rise)])} fill={shade(roof, 0.72)} />
      <Polygon points={pts([iso(x + w, y, base), iso(x + w, y + d, base), iso(x + w, ym, base + rise)])} fill={shade(wall, 0.76)} />
      <Polygon points={pts([iso(xa, y + d + 0.06, base), iso(xb, y + d + 0.06, base), iso(xb, ym, base + rise), iso(xa, ym, base + rise)])} fill={roof} />
      <Line x1={iso(xa, ym, base + rise)[0]} y1={iso(xa, ym, base + rise)[1]} x2={iso(xb, ym, base + rise)[0]} y2={iso(xb, ym, base + rise)[1]} stroke={shade(roof, 1.25)} strokeWidth={1} />
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
      <Polygon points={pts([e(x + w, y), e(x + w, y + d), top])} fill={shade(roof, 0.88)} />
      <Polygon points={pts([e(x, y + d), e(x + w, y + d), top])} fill={roof} />
    </G>
  );
}

/** Soft ground shadow under a footprint. */
function Shadow({ i, j, w, d }: { i: number; j: number; w: number; d: number }) {
  const [cx, cy] = iso(i + w / 2 + 0.15, j + d / 2 + 0.15);
  return <Ellipse cx={cx} cy={cy} rx={(w + d) * 12} ry={(w + d) * 6} fill="rgba(20,40,20,0.16)" />;
}

const WINDOW = '#FFF1C4';
const WINDOW_SIDE = '#FFE7A6';
const DOOR = '#6B4A33';

export function HouseArt({ i, j, style, wall, roof }: { i: number; j: number; style: 'a' | 'b' | 'c'; wall: string; roof: string }) {
  const x = i + 0.3;
  const y = j + 0.3;
  const floors = style === 'b' ? 2 : 1;
  const h = 24 * floors;
  const windows: React.ReactNode[] = [];
  for (let f = 0; f < floors; f++) {
    const z = f * 24;
    windows.push(faceY(y + 1.401, x + 0.12, x + 0.34, z + 9, z + 17, WINDOW, `wy${f}`));
    windows.push(faceX(x + 1.401, y + 0.22, y + 0.46, z + 9, z + 17, WINDOW_SIDE, `wx1${f}`));
    windows.push(faceX(x + 1.401, y + 0.94, y + 1.18, z + 9, z + 17, WINDOW_SIDE, `wx2${f}`));
    if (f > 0) windows.push(faceY(y + 1.401, x + 0.6, x + 0.82, z + 9, z + 17, WINDOW, `wy2${f}`));
  }
  return (
    <G>
      <Shadow i={i} j={j} w={2} d={2} />
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

export function ShopArt({ i, j, trim }: { i: number; j: number; trim: string }) {
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
      <Shadow i={i} j={j} w={2} d={2} />
      <Box x={x} y={y} w={1.7} d={1.7} h={32} color="#FAF5EE" />
      {faceY(y + 1.701, x + 0.2, x + 0.85, 4, 18, '#BFE3F2', 'win')}
      {faceY(y + 1.701, x + 1.05, x + 1.4, 0, 18, '#5B4636', 'door')}
      {faceX(x + 1.701, y + 0.25, y + 1.45, 8, 20, '#BFE3F2', 'side')}
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
      <Shadow i={i} j={j} w={2} d={2} />
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
      <Shadow i={i} j={j} w={2} d={2} />
      <Box x={i + 0.1} y={j + 0.1} w={1.8} d={1.8} h={4} color="#D7DBE0" />
      <Box x={x} y={y} w={1.6} d={1.6} z={4} h={44} color="#FFFFFF" />
      {windows}
      {faceY(y + 1.601, x + 0.68, x + 0.92, 4, 14, DOOR, 'door')}
      <PyramidRoof x={i + 0.1} y={j + 0.1} w={1.8} d={1.8} base={48} rise={26} roof="#5F59A0" />
    </G>
  );
}

export function GreenArt({ i, j }: { i: number; j: number }) {
  const posts: Pt[] = [[i + 0.3, j + 0.3], [i + 1.7, j + 0.3], [i + 0.3, j + 1.7], [i + 1.7, j + 1.7]];
  const flowers = ['#E86A8A', '#F2C14E', '#B07CD8', '#F28B50'];
  return (
    <G>
      {[0, 1, 2, 3, 4].map((k) => {
        const a = -Math.PI * 0.85 + k * 0.45;
        const [fx, fy] = iso(8 + Math.cos(a) * 1.75, 8 + Math.sin(a) * 1.75, 3);
        return <Circle key={`f${k}`} cx={fx} cy={fy} r={4} fill={flowers[k % 4]} />;
      })}
      <Box x={i + 0.15} y={j + 0.15} w={1.7} d={1.7} h={5} color="#E9E2D6" />
      {posts.map(([px, py], k) => {
        const [ax, ay] = iso(px, py, 5);
        const [bx, by] = iso(px, py, 28);
        return <Line key={`p${k}`} x1={ax} y1={ay} x2={bx} y2={by} stroke="#FFFFFF" strokeWidth={3} />;
      })}
      <PyramidRoof x={i + 0.05} y={j + 0.05} w={1.9} d={1.9} base={28} rise={18} roof="#B94614" />
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

const SKIN_TONES = ['#8D5A3B', '#5C3A24', '#A06A45', '#C68E64', '#E0B08A', '#7A4B2E'];
const HAIR = ['#1F1A17', '#3B2A20', '#1F1A17', '#6B4A2E', '#2B2B2B'];

function hashOf(text: string) {
  let h = 0;
  for (let k = 0; k < text.length; k++) h = (h * 31 + text.charCodeAt(k)) | 0;
  return Math.abs(h);
}

/** The simple oval person: shadow, oval body, round head, hair. */
export function PersonArt({ x, y, id, shirt, isYou, name, bob }: { x: number; y: number; id: string; shirt: string; isYou: boolean; name?: string; bob: number }) {
  const [sx, sy] = iso(x, y);
  const h = hashOf(id);
  const skin = SKIN_TONES[h % SKIN_TONES.length]!;
  const hair = HAIR[h % HAIR.length]!;
  const nameWidth = name ? name.length * 6 + 14 : 0;
  return (
    <G>
      <Ellipse cx={sx} cy={sy} rx={8} ry={4} fill="rgba(0,0,0,0.2)" />
      {isYou ? <Ellipse cx={sx} cy={sy} rx={11} ry={5.5} fill="none" stroke="#B94614" strokeWidth={2} /> : null}
      <Ellipse cx={sx} cy={sy - 11 - bob} rx={6.5} ry={9} fill={shirt} />
      <Circle cx={sx} cy={sy - 25 - bob} r={6} fill={skin} />
      <Ellipse cx={sx} cy={sy - 28.5 - bob} rx={6} ry={3.2} fill={hair} />
      {name ? (
        <G>
          <Rect x={sx - nameWidth / 2} y={sy - 50 - bob} width={nameWidth} height={16} rx={8} fill="rgba(255,255,255,0.94)" />
          <SvgText x={sx} y={sy - 38.5 - bob} fontSize={10} fontWeight="600" fill="#1F2937" textAnchor="middle">
            {name}
          </SvgText>
        </G>
      ) : null}
    </G>
  );
}

/** A rounded name tag floating above a building. */
export function Label({ at, text, fill, color = '#FFFFFF' }: { at: Pt; text: string; fill: string; color?: string }) {
  const width = text.length * 6.4 + 16;
  return (
    <G>
      <Rect x={at[0] - width / 2} y={at[1] - 10} width={width} height={20} rx={10} fill={fill} />
      <SvgText x={at[0]} y={at[1] + 4} fontSize={11} fontWeight="700" fill={color} textAnchor="middle">
        {text}
      </SvgText>
    </G>
  );
}

export { pts as polygonPoints };
