import React, { useMemo, useRef } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Ellipse, G, Image as SvgImage, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { KAYKIT_SPRITES, type KayKitSpriteName } from './kaykit-sprites';
import {
  STREET_DRAWN_HEIGHT,
  STREET_ROOF_COLORS,
  STREET_WALL_COLORS,
  streetHides,
  type StreetBuildingId,
  type StreetLayout,
  type StreetRoofColor,
  type StreetWallColor,
} from '@repo/validators/street';

import type { StreetLotData } from '@/lib/api';
import {
  CircleHallArt,
  BoardArt,
  HouseArt,
  iso,
  Label,
  PersonArt,
  SageStreetArt,
  type PersonColors,
  polygonPoints,
  ShopArt,
  TownHallArt,
  TH,
  TW,
  WalkerNameTag,
} from './street-art';

export type StreetPlace = { kind: 'lot'; lotNumber: number } | { kind: 'building'; id: StreetBuildingId };

export interface ScenePerson {
  id: string;
  name: string;
  look: PersonColors;
  isYou: boolean;
  isSage: boolean;
  x: number;
  y: number;
  moving: boolean;
}

export const BUILDING_NAMES: Record<StreetBuildingId, string> = {
  'circle-hall': 'Circle Hall',
  'group-buys': 'Group Buys',
  'town-hall': 'Town Hall',
  'corner-store': 'Corner Store',
  board: 'Community Board',
};

const BUILDING_HEIGHT: Record<StreetBuildingId, number> = {
  'circle-hall': 74,
  'group-buys': 36,
  'town-hall': 49,
  'corner-store': 36,
  board: 42,
};
/** How far a building's sign floats above its roof. */
const LABEL_LIFT: Partial<Record<StreetBuildingId, number>> = { board: 14 };

const GROUND = { grass: '#9CCB86', grassAlt: '#95C47F', plaza: '#E3DCCF', road: '#717780', walk: '#DCD6CC', lawn: '#A9D592', lawnLine: 'rgba(0,0,0,0.08)' };

function placeKey(place: StreetPlace) {
  return place.kind === 'lot' ? `lot:${place.lotNumber}` : `b:${place.id}`;
}

/** Screen box (in world units) of a footprint plus its height, for tapping. */
function hitBox(p: { i: number; j: number; w: number; d: number }, top: number) {
  return {
    x0: iso(p.i, p.j + p.d)[0],
    x1: iso(p.i + p.w, p.j)[0],
    y0: iso(p.i, p.j, top + 20)[1],
    y1: iso(p.i + p.w, p.j + p.d)[1],
  };
}

/** What was tapped at a world point: a building or house first (front to back), then a tile. */
export function hitTest(layout: StreetLayout, lots: Map<number, StreetLotData>, wx: number, wy: number) {
  const places: Array<{ place: StreetPlace; depth: number; box: ReturnType<typeof hitBox> }> = [];
  for (const b of layout.buildings) places.push({ place: { kind: 'building', id: b.id }, depth: b.i + b.j, box: hitBox(b, BUILDING_HEIGHT[b.id]) });
  for (const lot of layout.lots) {
    if (!lots.has(lot.lotNumber)) continue;
    const floors = lots.get(lot.lotNumber)!.houseStyle === 'b' ? 2 : 1;
    places.push({ place: { kind: 'lot', lotNumber: lot.lotNumber }, depth: lot.i + lot.j, box: hitBox(lot, 24 * floors + 20) });
  }
  places.sort((a, b) => b.depth - a.depth);
  for (const { place, box } of places) {
    if (wx >= box.x0 && wx <= box.x1 && wy >= box.y0 && wy <= box.y1) return { place };
  }
  const ax = wx / (TW / 2);
  const ay = wy / (TH / 2);
  return { tile: { i: Math.floor((ax + ay) / 2), j: Math.floor((ay - ax) / 2) } };
}

/** A KayKit image placed so its ground point lands on screen point (x, y). */
function KayKitImage({ name, x, y }: { name: KayKitSpriteName; x: number; y: number }) {
  const s = KAYKIT_SPRITES[name];
  return <SvgImage href={s.source} x={x - s.ax} y={y - s.ay} width={s.w} height={s.h} />;
}

function Ground({ layout, lots, selected }: { layout: StreetLayout; lots: Map<number, StreetLotData>; selected: string | null }) {
  const { width: W, height: H } = layout;
  const tiles: React.ReactNode[] = [];
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      const t = layout.tileType(i, j);
      // Roads are KayKit pieces below; only grass and the Green are drawn tile by tile.
      const fill = t === 'grass' ? ((i + j) % 2 ? GROUND.grassAlt : null) : t === 'plaza' ? GROUND.plaza : null;
      if (!fill) continue;
      tiles.push(<Polygon key={`t${i},${j}`} points={polygonPoints([iso(i, j), iso(i + 1, j), iso(i + 1, j + 1), iso(i, j + 1)])} fill={fill} />);
    }
  }
  // The road: KayKit City Builder Bits pieces, each covering 2x2 tiles.
  const roads = [...layout.roadPieces]
    .sort((a, b) => a.i + a.j - (b.i + b.j))
    .map((p) => {
      const [x, y] = iso(p.i + 1, p.j + 1);
      return <KayKitImage key={`r${p.i},${p.j}`} name={`road-${p.piece}` as KayKitSpriteName} x={x} y={y} />;
    });
  const lawns = layout.lots
    .filter((lot) => lots.has(lot.lotNumber))
    .map((lot) => {
      const isSelected = selected === `lot:${lot.lotNumber}`;
      return (
        <Polygon
          key={`l${lot.lotNumber}`}
          points={polygonPoints([iso(lot.i, lot.j), iso(lot.i + 2, lot.j), iso(lot.i + 2, lot.j + 2), iso(lot.i, lot.j + 2)])}
          fill={GROUND.lawn}
          stroke={isSelected ? '#B94614' : GROUND.lawnLine}
          strokeWidth={isSelected ? 2.5 : 1}
        />
      );
    });
  const outlines = layout.buildings
    .filter((b) => selected === `b:${b.id}`)
    .map((b) => (
      <Polygon key={`s${b.id}`} points={polygonPoints([iso(b.i, b.j), iso(b.i + 2, b.j), iso(b.i + 2, b.j + 2), iso(b.i, b.j + 2)])} fill="none" stroke="#B94614" strokeWidth={2.5} />
    ));
  return (
    <G>
      <Polygon points={polygonPoints([iso(W, 0), iso(W, H), iso(W, H, -18), iso(W, 0, -18)])} fill="#8B6B4A" />
      <Polygon points={polygonPoints([iso(0, H), iso(W, H), iso(W, H, -18), iso(0, H, -18)])} fill="#A07D58" />
      <Polygon points={polygonPoints([iso(0, 0), iso(W, 0), iso(W, H), iso(0, H)])} fill={GROUND.grass} />
      {tiles}
      {roads}
      {lawns}
      {outlines}
    </G>
  );
}

export function StreetScene({
  layout,
  lots,
  circleCount,
  circleUnread,
  boardNotes,
  people,
  camera,
  selected,
  bobPhase,
  onTap,
  onPan,
  onLayout,
}: {
  layout: StreetLayout;
  lots: Map<number, StreetLotData>;
  circleCount: number;
  /** New messages across your circles, shown on the Circle Hall. */
  circleUnread: number;
  /** Recent Board posts, shown as notes pinned to the community board. */
  boardNotes: number;
  people: ScenePerson[];
  camera: { x: number; y: number };
  selected: StreetPlace | null;
  bobPhase: number;
  onTap: (worldX: number, worldY: number) => void;
  onPan: (dx: number, dy: number, done: boolean) => void;
  onLayout: (width: number, height: number) => void;
}) {
  const selectedKey = selected ? placeKey(selected) : null;
  const origin = useRef({ x: 0, y: 0 });
  const viewRef = useRef<View>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const responder = useMemo(
    () => {
      let moved = false;
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          moved = false;
          viewRef.current?.measureInWindow((x, y) => {
            origin.current = { x, y };
          });
        },
        onPanResponderMove: (_e, g) => {
          if (!moved && Math.hypot(g.dx, g.dy) > 8) moved = true;
          if (moved) onPan(g.dx, g.dy, false);
        },
        onPanResponderRelease: (e, g) => {
          if (moved) {
            onPan(g.dx, g.dy, true);
            return;
          }
          const sx = e.nativeEvent.pageX - origin.current.x;
          const sy = e.nativeEvent.pageY - origin.current.y;
          onTap(sx - cameraRef.current.x, sy - cameraRef.current.y);
        },
        onPanResponderTerminationRequest: () => false,
      });
    },
    [onPan, onTap],
  );

  const ground = useMemo(() => <Ground layout={layout} lots={lots} selected={selectedKey} />, [layout, lots, selectedKey]);

  // Each building, house and tree is drawn once and reused every frame; only
  // people change while someone walks, so React skips everything else.
  const objects = useMemo(() => {
    const list: Array<{ depth: number; node: React.ReactNode; footprint?: { i: number; j: number; w: number; d: number }; height?: number }> = [];
    for (const b of layout.buildings) {
      const node =
        b.id === 'circle-hall' ? <CircleHallArt i={b.i} j={b.j} circleCount={circleCount} />
        : b.id === 'town-hall' ? <TownHallArt i={b.i} j={b.j} />
        : b.id === 'corner-store' ? <ShopArt i={b.i} j={b.j} trim="#B94614" />
        : b.id === 'group-buys' ? <ShopArt i={b.i} j={b.j} trim="#2F7D4F" />
        : <BoardArt i={b.i} j={b.j} notes={boardNotes} />;
      list.push({ depth: b.i + b.j + 2, node: <G key={`b${b.id}`}>{node}</G>, footprint: b, height: BUILDING_HEIGHT[b.id] });
    }
    for (const lot of layout.lots) {
      const data = lots.get(lot.lotNumber);
      if (!data) continue;
      list.push({
        depth: lot.i + lot.j + 2,
        footprint: lot,
        height: STREET_DRAWN_HEIGHT.house,
        node: (
          <G key={`h${lot.lotNumber}-${data.houseStyle}${data.wallColor}${data.roofColor}`}>
            <HouseArt
              i={lot.i}
              j={lot.j}
              style={data.houseStyle}
              wall={STREET_WALL_COLORS[data.wallColor as StreetWallColor] ?? STREET_WALL_COLORS.cream}
              roof={STREET_ROOF_COLORS[data.roofColor as StreetRoofColor] ?? STREET_ROOF_COLORS.terracotta}
            />
          </G>
        ),
      });
    }
    for (const t of layout.trees) {
      const [tx, ty] = iso(t.i + 0.5, t.j + 0.5);
      list.push({
        depth: t.i + t.j + 1,
        node: (
          <G key={`t${t.i},${t.j}`}>
            <Ellipse cx={tx} cy={ty} rx={10} ry={5} fill="rgba(20,40,20,0.15)" />
            <KayKitImage name="tree" x={tx} y={ty} />
          </G>
        ),
        footprint: { ...t, w: 1, d: 1 },
        height: STREET_DRAWN_HEIGHT.tree,
      });
    }
    // Streetlights along the far curb of the road out, behind the road so they never block anyone.
    for (let i = 12; i < layout.width - 1; i += 4) {
      const [sx, sy] = iso(i + 0.5, 6.75);
      list.push({ depth: i + 7.25, node: <G key={`sl${i}`}><KayKitImage name="streetlight" x={sx} y={sy} /></G> });
    }
    return list;
  }, [layout, lots, circleCount, boardNotes]);

  const labels = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    for (const b of layout.buildings) {
      const name = b.id === 'circle-hall' ? `Circle Hall · ${circleCount}` : BUILDING_NAMES[b.id];
      // The shops stand side by side along the road, so every other sign floats higher to keep all of them readable.
      const lift = LABEL_LIFT[b.id] ?? (b.id === 'corner-store' || b.id === 'town-hall' ? 44 : 18);
      const at = iso(b.i + 1, b.j + 1, BUILDING_HEIGHT[b.id] + lift);
      nodes.push(<G key={`lb${b.id}`}><Label at={at} text={name} fill={b.id === 'circle-hall' ? '#4B4680' : '#1F2937'} /></G>);
      // New messages in your circles show as a red bubble on the Circle Hall's sign.
      if (b.id === 'circle-hall' && circleUnread > 0) {
        const bx = at[0] + (name.length * 6.4 + 16) / 2;
        const by = at[1] - 10;
        const text = circleUnread > 99 ? '99+' : String(circleUnread);
        const w = Math.max(18, text.length * 7 + 8);
        nodes.push(
          <G key="unread-hall">
            <Rect x={bx - w / 2} y={by - 9} width={w} height={18} rx={9} fill="#DC2626" stroke="#FFFFFF" strokeWidth={2} />
            <SvgText x={bx} y={by + 4} fontSize={11} fontWeight="800" fill="#FFFFFF" textAnchor="middle">{text}</SvgText>
          </G>,
        );
      }
    }
    for (const lot of layout.lots) {
      const data = lots.get(lot.lotNumber);
      if (!data) continue;
      const top = (data.houseStyle === 'b' ? 48 : 24) + 30;
      nodes.push(
        <G key={`ll${lot.lotNumber}`}>
          <Label
            at={iso(lot.i + 1, lot.j + 1, top)}
            text={data.isYou ? 'Your house' : data.user.name}
            fill={data.isYou ? '#B94614' : 'rgba(255,255,255,0.94)'}
            color={data.isYou ? '#FFFFFF' : '#1F2937'}
          />
        </G>,
      );
    }
    return nodes;
  }, [layout, lots, circleCount, circleUnread]);

  // The layout keeps roads in clear view. If you wander behind something
  // anyway (a back garden), it turns see-through until you come out. The
  // community board stands in the middle of the circle, so it turns
  // see-through whenever anyone at all is behind it.
  const tileOf = (p: ScenePerson) => ({ i: Math.floor(p.x), j: Math.floor(p.y) });
  const you = people.find((p) => p.isYou);
  const youTile = you ? tileOf(you) : null;
  const isBoard = (o: (typeof objects)[number]) => (o.node as React.ReactElement).key === 'bboard';
  const drawn = [
    ...objects.map((o) => {
      if (!o.footprint || !o.height) return o;
      const watchers = isBoard(o) ? people.map(tileOf) : youTile ? [youTile] : [];
      const hides = watchers.some((t) => streetHides(o.footprint!, o.height!, t));
      return hides ? { depth: o.depth, node: <G key={`fade-${(o.node as React.ReactElement).key}`} opacity={0.35}>{o.node}</G> } : o;
    }),
    ...people.map((p) => ({
      depth: p.x + p.y + 0.01,
      node: (
        <G key={`p${p.id}`} testID={`street-walker-${p.isSage ? 'sage' : p.id}`}>
          {p.isSage ? (
            <SageStreetArt
              x={p.x}
              y={p.y}
              bob={p.moving ? Math.abs(Math.sin(bobPhase * 12)) * 2 : 0}
            />
          ) : (
            <PersonArt
              x={p.x}
              y={p.y}
              look={p.look}
              isYou={p.isYou}
              bob={p.moving ? Math.abs(Math.sin(bobPhase * 12)) * 2 : 0}
            />
          )}
        </G>
      ),
    })),
  ].sort((a, b) => a.depth - b.depth);

  return (
    <View
      ref={viewRef}
      style={{ flex: 1, backgroundColor: '#DDEBF1', overflow: 'hidden' }}
      onLayout={(e: LayoutChangeEvent) => onLayout(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
      accessibilityLabel="Map of the street. Tap a house or building to visit. Use the list for every place."
      {...responder.panHandlers}
    >
      <Svg width="100%" height="100%" pointerEvents="none">
        <G transform={`translate(${camera.x.toFixed(1)}, ${camera.y.toFixed(1)})`}>
          {ground}
          {drawn.map((d) => d.node)}
          {labels}
          {people.map((person) => (
            <G key={`walker-label-${person.id}`} testID={`street-walker-label-${person.isSage ? 'sage' : person.id}`}>
              <WalkerNameTag
                x={person.x}
                y={person.y}
                name={person.name}
                bob={person.moving ? Math.abs(Math.sin(bobPhase * 12)) * 2 : 0}
              />
            </G>
          ))}
        </G>
      </Svg>
    </View>
  );
}
