import React, { useMemo, useRef } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Ellipse, G, Image as SvgImage, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { KAYKIT_SPRITES, type KayKitSpriteName } from './kaykit-sprites';
import {
  STREET_DRAWN_HEIGHT,
  STREET_ROOF_COLORS,
  STREET_WALL_COLORS,
  streetHides,
  streetTagsToShow,
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
  labelWidth,
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

export type StreetPlace =
  | { kind: 'lot'; lotNumber: number }
  | { kind: 'building'; id: StreetBuildingId }
  /** Someone out on the street (a neighbor or Sage). */
  | { kind: 'person'; id: string };

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

/** A press held longer than this is not a tap. */
const LONG_PRESS_MS = 600;

const GROUND = { grass: '#9CCB86', grassAlt: '#95C47F', plaza: '#E3DCCF', road: '#717780', walk: '#DCD6CC', lawn: '#A9D592', lawnLine: 'rgba(0,0,0,0.08)' };

function placeKey(place: StreetPlace) {
  return place.kind === 'lot' ? `lot:${place.lotNumber}` : place.kind === 'building' ? `b:${place.id}` : `p:${place.id}`;
}

/** Extra room (in screen points) around every house and building, so a near miss still counts. */
const TAP_PAD = 12;
/** How close (in screen points) to someone's body a tap counts as tapping them. */
const PERSON_TAP_RADIUS = 16;

/** Where each building's and house's sign floats, and what it says. */
function labelSpots(layout: StreetLayout, lots: Map<number, StreetLotData>, circleCount: number) {
  const spots: Array<{ place: StreetPlace; at: [number, number]; text: string; isYou?: boolean }> = [];
  for (const b of layout.buildings) {
    const text = b.id === 'circle-hall' ? `Circle Hall · ${circleCount}` : BUILDING_NAMES[b.id];
    // The shops stand side by side along the road, so every other sign floats higher to keep all of them readable.
    const lift = LABEL_LIFT[b.id] ?? (b.id === 'corner-store' || b.id === 'town-hall' ? 44 : 18);
    spots.push({ place: { kind: 'building', id: b.id }, at: iso(b.i + 1, b.j + 1, BUILDING_HEIGHT[b.id] + lift), text });
  }
  for (const lot of layout.lots) {
    const data = lots.get(lot.lotNumber);
    if (!data) continue;
    const top = (data.houseStyle === 'b' ? 48 : 24) + 30;
    spots.push({
      place: { kind: 'lot', lotNumber: lot.lotNumber },
      at: iso(lot.i + 1, lot.j + 1, top),
      text: data.isYou ? 'Your house' : data.user.name,
      isYou: data.isYou,
    });
  }
  return spots;
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

/**
 * What was tapped at a world point: a person first (front to back), then a
 * building or house (its sign counts too), then a tile. `zoom` turns the
 * screen-point tap padding into world units.
 */
export function hitTest(
  layout: StreetLayout,
  lots: Map<number, StreetLotData>,
  wx: number,
  wy: number,
  opts: { zoom?: number; people?: Array<{ id: string; x: number; y: number }>; circleCount?: number; fontScale?: number } = {},
): { person: string } | { place: StreetPlace } | { tile: { i: number; j: number } } {
  const zoom = opts.zoom ?? 1;
  const people = [...(opts.people ?? [])].sort((a, b) => b.x + b.y - (a.x + a.y));
  for (const p of people) {
    const [sx, sy] = iso(p.x, p.y);
    // The body runs from the feet (sy) to the top of the head (about sy - 32).
    const dy = wy < sy - 32 ? sy - 32 - wy : wy > sy ? wy - sy : 0;
    if (Math.hypot(wx - sx, dy) <= PERSON_TAP_RADIUS / zoom) return { person: p.id };
  }
  const fontScale = opts.fontScale ?? 1;
  for (const spot of labelSpots(layout, lots, opts.circleCount ?? 0)) {
    const half = (labelWidth(spot.text) * fontScale) / 2 + 4 / zoom;
    const halfH = 10 * fontScale + 4 / zoom;
    if (Math.abs(wx - spot.at[0]) <= half && Math.abs(wy - spot.at[1]) <= halfH) return { place: spot.place };
  }
  const pad = TAP_PAD / zoom;
  const places: Array<{ place: StreetPlace; depth: number; box: ReturnType<typeof hitBox> }> = [];
  for (const b of layout.buildings) places.push({ place: { kind: 'building', id: b.id }, depth: b.i + b.j, box: hitBox(b, BUILDING_HEIGHT[b.id]) });
  for (const lot of layout.lots) {
    if (!lots.has(lot.lotNumber)) continue;
    const floors = lots.get(lot.lotNumber)!.houseStyle === 'b' ? 2 : 1;
    places.push({ place: { kind: 'lot', lotNumber: lot.lotNumber }, depth: lot.i + lot.j, box: hitBox(lot, 24 * floors + 20) });
  }
  places.sort((a, b) => b.depth - a.depth);
  for (const { place, box } of places) {
    if (wx >= box.x0 - pad && wx <= box.x1 + pad && wy >= box.y0 - pad && wy <= box.y1 + pad) return { place };
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
  // Roads are KayKit pieces below; only grass and the plaza are drawn here.
  // One shape per color instead of one per tile: a few hundred separate
  // shapes become two, which phones draw far more cheaply.
  const paths: Record<string, string[]> = {};
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      const t = layout.tileType(i, j);
      const fill = t === 'grass' ? ((i + j) % 2 ? GROUND.grassAlt : null) : t === 'plaza' ? GROUND.plaza : null;
      if (!fill) continue;
      const [a, b, c, d] = [iso(i, j), iso(i + 1, j), iso(i + 1, j + 1), iso(i, j + 1)];
      (paths[fill] ??= []).push(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}L${c[0]} ${c[1]}L${d[0]} ${d[1]}Z`);
    }
  }
  const tiles = Object.entries(paths).map(([fill, parts]) => <Path key={fill} d={parts.join('')} fill={fill} />);
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
  zoom,
  fontScale,
  selected,
  bobPhase,
  onTap,
  onPan,
  onPinch,
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
  /** How far the map is zoomed in (1 is normal). */
  zoom: number;
  /** The phone's text size, already capped, for name tags and signs. */
  fontScale: number;
  selected: StreetPlace | null;
  /** Walking bob clock; null when Reduce Motion is on (nobody bobs). */
  bobPhase: number | null;
  onTap: (worldX: number, worldY: number) => void;
  onPan: (dx: number, dy: number, done: boolean) => void;
  /** Two fingers pinching: `scale` is the change since the pinch began. */
  onPinch: (scale: number, done: boolean) => void;
  onLayout: (width: number, height: number) => void;
}) {
  const selectedKey = selected ? placeKey(selected) : null;
  const origin = useRef({ x: 0, y: 0 });
  const viewRef = useRef<View>(null);
  const cameraRef = useRef({ ...camera, zoom });
  cameraRef.current = { ...camera, zoom };

  const responder = useMemo(
    () => {
      // A press is a tap only if it stayed put, used one finger, and let go
      // within LONG_PRESS_MS. Drags pan; two fingers pinch to zoom.
      let moved = false;
      let pinched = false;
      let pinchStart = 0;
      let startedAt = 0;
      const touchGap = (touches: ReadonlyArray<{ pageX: number; pageY: number }>) =>
        touches.length >= 2 ? Math.hypot(touches[0]!.pageX - touches[1]!.pageX, touches[0]!.pageY - touches[1]!.pageY) : 0;
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          moved = false;
          pinched = false;
          pinchStart = 0;
          startedAt = Date.now();
          viewRef.current?.measureInWindow((x, y) => {
            origin.current = { x, y };
          });
        },
        onPanResponderMove: (e, g) => {
          const touches = e.nativeEvent.touches ?? [];
          if (g.numberActiveTouches >= 2 && touches.length >= 2) {
            const gap = touchGap(touches);
            if (!pinched) {
              pinched = true;
              moved = true;
              pinchStart = gap;
            } else if (pinchStart > 0) {
              onPinch(gap / pinchStart, false);
            }
            return;
          }
          if (pinched) return; // lifting one finger after a pinch doesn't start a drag
          if (!moved && Math.hypot(g.dx, g.dy) > 8) moved = true;
          if (moved) onPan(g.dx, g.dy, false);
        },
        onPanResponderRelease: (e, g) => {
          if (pinched) {
            onPinch(1, true);
            return;
          }
          if (moved) {
            onPan(g.dx, g.dy, true);
            return;
          }
          if (Date.now() - startedAt > LONG_PRESS_MS) return;
          const sx = e.nativeEvent.pageX - origin.current.x;
          const sy = e.nativeEvent.pageY - origin.current.y;
          const cam = cameraRef.current;
          onTap((sx - cam.x) / cam.zoom, (sy - cam.y) / cam.zoom);
        },
        onPanResponderTerminate: () => {
          if (pinched) onPinch(1, true);
          else if (moved) onPan(0, 0, true);
        },
        onPanResponderTerminationRequest: () => false,
      });
    },
    [onPan, onPinch, onTap],
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
    for (const spot of labelSpots(layout, lots, circleCount)) {
      const { at, text: name } = spot;
      if (spot.place.kind === 'lot') {
        nodes.push(
          <G key={`ll${spot.place.lotNumber}`}>
            <Label
              at={at}
              text={name}
              fill={spot.isYou ? '#B94614' : 'rgba(255,255,255,0.94)'}
              color={spot.isYou ? '#FFFFFF' : '#1F2937'}
              scale={fontScale}
            />
          </G>,
        );
        continue;
      }
      if (spot.place.kind !== 'building') continue;
      const id = spot.place.id;
      nodes.push(<G key={`lb${id}`}><Label at={at} text={name} fill={id === 'circle-hall' ? '#4B4680' : '#1F2937'} scale={fontScale} /></G>);
      // New messages in your circles show as a red bubble on the Circle Hall's sign.
      if (id === 'circle-hall' && circleUnread > 0) {
        const bx = at[0] + (labelWidth(name) * fontScale) / 2;
        const by = at[1] - 10 * fontScale;
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
    return nodes;
  }, [layout, lots, circleCount, circleUnread, fontScale]);

  const bobOf = (p: ScenePerson) => (p.moving && bobPhase !== null ? Math.abs(Math.sin(bobPhase * 12)) * 2 : 0);
  // When people bunch up, show one name tag per crowd. Yours always shows,
  // then Sage's, then everyone else's.
  const rank = (p: ScenePerson) => (p.isYou ? 0 : p.isSage ? 1 : 2);
  const shownTags = streetTagsToShow(
    [...people]
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
      .map((p) => {
        const [sx, sy] = iso(p.x, p.y);
        return { id: p.id, x: sx * zoom, y: sy * zoom, keep: p.isYou };
      }),
    40,
  );

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
              bob={bobOf(p)}
            />
          ) : (
            <PersonArt
              x={p.x}
              y={p.y}
              look={p.look}
              isYou={p.isYou}
              bob={bobOf(p)}
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
      accessibilityLabel="Map of the street. Tap a house, building or person to visit. Use the list for every place."
      {...responder.panHandlers}
    >
      <Svg width="100%" height="100%" pointerEvents="none">
        <G
          testID="street-map-layer"
          transform={`translate(${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}) scale(${zoom.toFixed(3)})`}
        >
          {ground}
          {drawn.map((d) => d.node)}
          {labels}
          {people.filter((person) => shownTags.has(person.id)).map((person) => (
            <G key={`walker-label-${person.id}`} testID={`street-walker-label-${person.isSage ? 'sage' : person.id}`}>
              <WalkerNameTag x={person.x} y={person.y} name={person.name} bob={bobOf(person)} scale={fontScale} />
            </G>
          ))}
        </G>
      </Svg>
    </View>
  );
}
