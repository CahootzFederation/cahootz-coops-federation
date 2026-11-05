import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { List, X } from 'lucide-react-native';
import {
  buildStreetLayout,
  STREET_HOUSE_STYLES,
  STREET_ROOF_COLORS,
  STREET_ROOF_KEYS,
  STREET_WALL_COLORS,
  STREET_WALL_KEYS,
  streetDoorTile,
  streetPath,
  type StreetBuildingId,
  type StreetHouseStyle,
} from '@repo/validators/street';

import CircleView from '@/components/circle-view';
import { CommonsHeader, useCommonsDirectory } from '@/components/commons-header';
import { CommonsInvitationsCard } from '@/components/commons-invitations-card';
import { LoadError } from '@/components/load-error';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api, type StreetData, type StreetLotData } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { CircleHallSheet } from './circle-hall-sheet';
import { iso } from './street-art';
import { BUILDING_NAMES, hitTest, StreetScene, type ScenePerson, type StreetPlace } from './street-scene';

const THEME = { ...DESIGN, primary: DESIGN.actionText };
const POLL_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const SHIRTS = ['#B94614', '#3E6A86', '#5B7F4E', '#C2557A', '#5B5FAF', '#C98A1B', '#2F8F8A'];
const STYLE_NAMES: Record<StreetHouseStyle, string> = { a: 'Cottage', b: 'Two-story', c: 'Bungalow' };
const COLOR_NAMES: Record<string, string> = {
  cream: 'Cream', sky: 'Sky', sage: 'Sage', rose: 'Rose', white: 'White',
  terracotta: 'Terracotta', slate: 'Slate', blue: 'Blue', green: 'Green',
};

interface Walker {
  id: string;
  name: string;
  shirt: string;
  isYou: boolean;
  x: number;
  y: number;
  path: Array<{ i: number; j: number }>;
  target: { i: number; j: number } | null;
}

function shirtFor(id: string, avatarColor: string | null) {
  if (avatarColor && /^#[0-9a-f]{6}$/i.test(avatarColor)) return avatarColor;
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) | 0;
  return SHIRTS[Math.abs(h) % SHIRTS.length]!;
}

function isForbidden(error: unknown) {
  const text = String((error as { message?: string })?.message ?? error);
  return /only members of this commons/i.test(text) || (error as { code?: string })?.code === 'FORBIDDEN';
}

export default function StreetView({ coopId }: { coopId: string }) {
  const { sessionToken } = useAuth();
  const directory = useCommonsDirectory(coopId);
  const commonsName = directory.activeCommonsName;

  const [street, setStreet] = useState<StreetData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notMember, setNotMember] = useState(false);
  const [selected, setSelected] = useState<StreetPlace | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setFrame] = useState(0);

  const walkers = useRef(new Map<string, Walker>());
  const viewSize = useRef({ w: 0, h: 0 });
  const camera = useRef({ x: 0, y: 0, ready: false });
  const pan = useRef({ x: 0, y: 0, startX: 0, startY: 0, dragging: false });
  const youId = useRef<string | null>(null);
  const lastSentTile = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(() => buildStreetLayout(street?.maxLotNumber ?? 0), [street?.maxLotNumber]);
  const lots = useMemo(() => new Map((street?.lots ?? []).map((lot) => [lot.lotNumber, lot])), [street?.lots]);
  const yourLot = street?.lots.find((lot) => lot.isYou) ?? null;

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  };

  const sendPosition = useCallback(
    (force = false) => {
      const you = youId.current ? walkers.current.get(youId.current) : null;
      if (!you || !sessionToken) return;
      const i = Math.floor(you.x);
      const j = Math.floor(you.y);
      const key = `${i},${j}`;
      if (!force && key === lastSentTile.current) return;
      lastSentTile.current = key;
      api.moveOnStreet(coopId, i, j, sessionToken).catch((err) => console.warn('Street move not saved:', err));
    },
    [coopId, sessionToken],
  );

  const applyStreet = useCallback((data: StreetData) => {
    const nextLayout = buildStreetLayout(data.maxLotNumber);
    const mineLot = data.lots.find((lot) => lot.isYou);
    const map = walkers.current;
    const seen = new Set<string>();
    for (const person of data.online) {
      seen.add(person.userId);
      if (person.isYou) continue; // you move yourself; the server only echoes it back
      const existing = map.get(person.userId);
      if (!existing) {
        map.set(person.userId, {
          id: person.userId,
          name: person.name,
          shirt: shirtFor(person.userId, person.avatarColor),
          isYou: false,
          x: person.x + 0.5,
          y: person.y + 0.5,
          path: [],
          target: { i: person.x, j: person.y },
        });
      } else if (!existing.target || existing.target.i !== person.x || existing.target.j !== person.y) {
        const from = { i: Math.floor(existing.x), j: Math.floor(existing.y) };
        const path = streetPath(nextLayout, from, { i: person.x, j: person.y });
        existing.target = { i: person.x, j: person.y };
        if (path) existing.path = path;
        else {
          existing.x = person.x + 0.5;
          existing.y = person.y + 0.5;
          existing.path = [];
        }
      }
    }
    for (const id of [...map.keys()]) {
      const walker = map.get(id)!;
      if (!walker.isYou && !seen.has(id)) map.delete(id);
    }
    if (mineLot && !youId.current) {
      youId.current = mineLot.user.id;
      const fromServer = data.online.find((p) => p.isYou);
      const placement = nextLayout.lots.find((lot) => lot.lotNumber === mineLot.lotNumber);
      const door = placement ? streetDoorTile(nextLayout, placement, nextLayout.center) : null;
      const startTile = fromServer ? { i: fromServer.x, j: fromServer.y } : door ?? { i: 11, j: 8 };
      map.set(mineLot.user.id, {
        id: mineLot.user.id,
        name: 'You',
        shirt: shirtFor(mineLot.user.id, mineLot.user.avatarColor),
        isYou: true,
        x: startTile.i + 0.5,
        y: startTile.j + 0.5,
        path: [],
        target: null,
      });
    }
    setStreet(data);
  }, []);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const data = await api.getStreet(coopId, sessionToken);
      setLoadError(null);
      applyStreet(data);
      sendPosition();
    } catch (err) {
      if (isForbidden(err)) {
        setNotMember(true);
        return;
      }
      console.error('Failed to load street:', err);
      setLoadError(friendlyError(err, "We couldn't load the street. Check your connection and try again."));
    }
  }, [applyStreet, coopId, sendPosition, sessionToken]);

  // Load and keep the street fresh while it's on screen; check in so others
  // see you; leave when you go elsewhere or the app goes to the background.
  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) return;
      let active = true;
      load();
      const poll = setInterval(() => active && load(), POLL_MS);
      const heartbeat = setInterval(() => active && sendPosition(true), HEARTBEAT_MS);
      const leave = () => api.leaveStreet(coopId, sessionToken).catch(() => undefined);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'background' || state === 'inactive') leave();
        else if (state === 'active') sendPosition(true);
      });
      return () => {
        active = false;
        clearInterval(poll);
        clearInterval(heartbeat);
        sub.remove();
        lastSentTile.current = null;
        leave();
      };
    }, [coopId, load, sendPosition, sessionToken]),
  );

  // Start over when switching to another Commons.
  useEffect(() => {
    walkers.current.clear();
    youId.current = null;
    camera.current.ready = false;
    pan.current = { x: 0, y: 0, startX: 0, startY: 0, dragging: false };
    setStreet(null);
    setSelected(null);
    setNotMember(false);
    setLoadError(null);
  }, [coopId]);

  // Walk everyone and glide the camera; re-render only when something moved.
  useEffect(() => {
    let raf = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let changed = false;
      for (const w of walkers.current.values()) {
        if (!w.path.length) continue;
        const next = w.path[0]!;
        const tx = next.i + 0.5;
        const ty = next.j + 0.5;
        const dx = tx - w.x;
        const dy = ty - w.y;
        const dist = Math.hypot(dx, dy);
        const step = (w.isYou ? 3.4 : 2.4) * dt;
        if (dist <= step) {
          w.x = tx;
          w.y = ty;
          w.path.shift();
          if (w.isYou && !w.path.length) sendPosition();
        } else {
          w.x += (dx / dist) * step;
          w.y += (dy / dist) * step;
        }
        changed = true;
      }
      const you = youId.current ? walkers.current.get(youId.current) : null;
      const { w: vw, h: vh } = viewSize.current;
      if (you && vw > 0) {
        if (you.path.length && !pan.current.dragging) {
          pan.current.x *= 0.9;
          pan.current.y *= 0.9;
        }
        const [px, py] = iso(you.x, you.y);
        const tx = vw / 2 - px + pan.current.x;
        const ty = vh * 0.58 - py + pan.current.y;
        if (!camera.current.ready) {
          camera.current = { x: tx, y: ty, ready: true };
          changed = true;
        } else {
          const k = Math.min(1, dt * 6);
          const nx = camera.current.x + (tx - camera.current.x) * k;
          const ny = camera.current.y + (ty - camera.current.y) * k;
          if (Math.abs(nx - camera.current.x) > 0.2 || Math.abs(ny - camera.current.y) > 0.2) changed = true;
          camera.current.x = nx;
          camera.current.y = ny;
        }
      }
      if (changed) setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sendPosition]);

  const walkYouTo = (tile: { i: number; j: number }) => {
    const you = youId.current ? walkers.current.get(youId.current) : null;
    if (!you) return false;
    const path = streetPath(layout, { i: Math.floor(you.x), j: Math.floor(you.y) }, tile);
    if (!path) return false;
    you.path = path;
    you.target = tile;
    return true;
  };

  const visit = (place: StreetPlace) => {
    setActionError(null);
    setListOpen(false);
    setSelected(place);
    pan.current.x = 0;
    pan.current.y = 0;
    const footprint =
      place.kind === 'lot' ? layout.lots.find((lot) => lot.lotNumber === place.lotNumber) : layout.buildings.find((b) => b.id === place.id);
    if (!footprint) return;
    // Shops and lots along the road out open toward the road; the rest face the circle.
    const onRoadOut = footprint.i >= 11;
    const door = streetDoorTile(layout, footprint, onRoadOut ? { x: footprint.i + 1, y: 8 } : layout.center);
    if (door) walkYouTo(door);
  };

  const onTap = useCallback(
    (wx: number, wy: number) => {
      const hit = hitTest(layout, lots, wx, wy);
      if (hit.place) visit(hit.place);
      else if (hit.tile && !layout.isBlocked(hit.tile.i, hit.tile.j)) walkYouTo(hit.tile);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, lots],
  );

  const onPan = useCallback((dx: number, dy: number, done: boolean) => {
    if (!pan.current.dragging) {
      pan.current.dragging = true;
      pan.current.startX = pan.current.x;
      pan.current.startY = pan.current.y;
    }
    pan.current.x = pan.current.startX + dx;
    pan.current.y = pan.current.startY + dy;
    if (done) pan.current.dragging = false;
  }, []);

  const onLayout = useCallback((w: number, h: number) => {
    viewSize.current = { w, h };
  }, []);

  const paint = async (look: { houseStyle?: string; wallColor?: string; roofColor?: string }) => {
    if (!sessionToken || !street) return;
    const before = street;
    setActionError(null);
    setStreet({ ...street, lots: street.lots.map((lot) => (lot.isYou ? ({ ...lot, ...look } as StreetLotData) : lot)) });
    try {
      await api.paintHouse(coopId, look, sessionToken);
      showNotice('Saved. Your neighbors can see it now.');
    } catch (err) {
      setStreet(before);
      setActionError(friendlyError(err, "We couldn't save your house colors. Try again."));
    }
  };

  const knock = async (lot: StreetLotData) => {
    if (!sessionToken || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.knockOnDoor(coopId, lot.user.id, sessionToken);
      showNotice(`You knocked. ${lot.user.name} will see that you stopped by.`);
    } catch (err) {
      // The knock limit's own message says what to do instead; the shared
      // "too many tries" wording is meant for sign-in lockouts.
      const tooSoon = (err as { code?: string })?.code === 'TOO_MANY_REQUESTS' && (err as Error).message;
      setActionError(tooSoon || friendlyError(err, "We couldn't knock just now. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (notMember) return <CircleView coopId={coopId} />;

  const lotCenterByUser = new Map<string, { x: number; y: number }>();
  for (const lot of street?.lots ?? []) {
    const placement = layout.lots.find((p) => p.lotNumber === lot.lotNumber);
    if (placement) lotCenterByUser.set(lot.user.id, { x: placement.i + 1, y: placement.j + 1 });
  }
  const people: ScenePerson[] = [...walkers.current.values()].map((w) => {
    const moving = w.path.length > 0;
    // Someone standing at home already has their name on the house; skip the
    // second tag so the two don't pile up.
    const home = lotCenterByUser.get(w.id);
    const atHome = !moving && home ? Math.hypot(w.x - home.x, w.y - home.y) < 2.6 : false;
    return { id: w.id, name: atHome ? '' : w.name, shirt: w.shirt, isYou: w.isYou, x: w.x, y: w.y, moving };
  });
  const onlineIds = new Set((street?.online ?? []).map((p) => p.userId));
  const neighborsOut = (street?.lots ?? []).filter((lot) => !lot.isYou && onlineIds.has(lot.user.id));
  const neighbors = (street?.lots ?? []).filter((lot) => !lot.isYou);

  const listButton = (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={listOpen ? 'Close the list' : 'Open the list'}
      onPress={() => setListOpen((open) => !open)}
      className="h-11 w-11 items-center justify-center rounded-full"
      style={{ backgroundColor: THEME.primarySoft }}
    >
      {listOpen ? <X size={18} color={THEME.primary} /> : <List size={19} color={THEME.primary} />}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <CommonsHeader coopId={coopId} directory={directory} right={listButton} />
      <View className="flex-1" style={{ width: '100%', maxWidth: 800, alignSelf: 'center' }}>
        {!street ? (
          <View className="flex-1 items-center justify-center px-5">
            {loadError ? (
              <LoadError message={loadError} onRetry={load} />
            ) : (
              <>
                <ActivityIndicator color={THEME.primary} />
                <Text className="mt-3 text-sm font-semibold text-gray-500">Walking you to the street…</Text>
              </>
            )}
          </View>
        ) : (
          <>
            <View style={{ flex: 1, minHeight: 280 }}>
              <StreetScene
                layout={layout}
                lots={lots}
                circleCount={street.circleCount}
                people={people}
                camera={camera.current}
                selected={selected}
                bobPhase={Date.now() / 1000}
                onTap={onTap}
                onPan={onPan}
                onLayout={onLayout}
              />
              {notice ? (
                <View className="absolute bottom-3 left-3 right-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: '#111827' }} accessibilityLiveRegion="polite">
                  <Text className="text-sm font-semibold text-white">{notice}</Text>
                </View>
              ) : null}
            </View>
            <ScrollView
              style={{
                maxHeight: listOpen || (selected?.kind === 'building' && selected.id === 'circle-hall') ? '62%' : '44%',
                borderTopWidth: 1,
                borderColor: THEME.border,
              }}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              {actionError ? <Text className="text-sm font-semibold text-red-600">{actionError}</Text> : null}
              {listOpen ? (
                <StreetList
                  yourLot={yourLot}
                  neighborsOut={neighborsOut}
                  neighbors={neighbors}
                  circleCount={street.circleCount}
                  onVisit={visit}
                />
              ) : (
                <PlaceSheet
                  coopId={coopId}
                  commonsName={commonsName}
                  street={street}
                  selected={selected}
                  yourLot={yourLot}
                  lots={lots}
                  onlineIds={onlineIds}
                  busy={busy}
                  onGoHome={() => yourLot && visit({ kind: 'lot', lotNumber: yourLot.lotNumber })}
                  onOpenList={() => setListOpen(true)}
                  onPaint={paint}
                  onKnock={knock}
                />
              )}
            </ScrollView>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function Button({ label, onPress, quiet, disabled, a11y }: { label: string; onPress: () => void; quiet?: boolean; disabled?: boolean; a11y?: string }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 items-center justify-center rounded-xl px-4"
      style={{
        borderWidth: 1,
        borderColor: THEME.primary,
        backgroundColor: quiet ? 'transparent' : THEME.primary,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text className="text-[15px] font-semibold" style={{ color: quiet ? THEME.primary : '#FFFFFF' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <View>
      <Text accessibilityRole="header" className="text-xl font-bold text-gray-950">
        {title}
      </Text>
      {sub ? <Text className="mt-0.5 text-sm text-gray-500">{sub}</Text> : null}
    </View>
  );
}

function Swatch({ color, label, selected, onPress }: { color: string; label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      aria-selected={selected}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-full"
      style={{ borderWidth: 2, borderColor: selected ? '#111827' : THEME.border }}
    >
      <View className="h-8 w-8 rounded-full" style={{ backgroundColor: color, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }} />
    </TouchableOpacity>
  );
}

const BUILDING_COPY: Record<Exclude<StreetBuildingId, 'circle-hall'>, { body: (name: string) => string; action: string }> = {
  'group-buys': { body: () => 'Team up with neighbors to buy together and pay less.', action: 'See group buys' },
  'corner-store': { body: (name) => `Shops run by members of ${name}.`, action: 'Browse stores' },
  'town-hall': { body: (name) => `Read proposals and vote on how ${name} runs.`, action: 'Read proposals' },
  green: { body: () => 'Neighbors get together here. See what events are coming up.', action: 'See events' },
};

function openBuilding(id: StreetBuildingId, coopId: string) {
  // Replace rather than push, the same way the circles screen opens a circle,
  // so the street and the circles screen are never both mounted (two headers).
  if (id === 'circle-hall') router.replace({ pathname: '/[coopId]/circles', params: { coopId } } as any);
  else if (id === 'group-buys') router.push('/(authenticated)/group-buys' as any);
  else if (id === 'corner-store') router.push({ pathname: '/(tabs)/board', params: { coopId, lane: 'marketplace' } } as any);
  else if (id === 'town-hall') router.push({ pathname: '/(tabs)/proposals', params: { coopId } } as any);
  else router.push({ pathname: '/(tabs)/board', params: { coopId, lane: 'events' } } as any);
}

function PlaceSheet({
  coopId,
  commonsName,
  street,
  selected,
  yourLot,
  lots,
  onlineIds,
  busy,
  onGoHome,
  onOpenList,
  onPaint,
  onKnock,
}: {
  coopId: string;
  commonsName: string;
  street: StreetData;
  selected: StreetPlace | null;
  yourLot: StreetLotData | null;
  lots: Map<number, StreetLotData>;
  onlineIds: Set<string>;
  busy: boolean;
  onGoHome: () => void;
  onOpenList: () => void;
  onPaint: (look: { houseStyle?: string; wallColor?: string; roofColor?: string }) => void;
  onKnock: (lot: StreetLotData) => void;
}) {
  if (!selected) {
    const neighborCount = street.lots.length - 1;
    const out = street.online.filter((p) => !p.isYou).length;
    return (
      <>
        <Heading
          title={`Welcome to ${commonsName}`}
          sub={`${neighborCount} ${neighborCount === 1 ? 'neighbor lives' : 'neighbors live'} here · ${out} out on the street now`}
        />
        <Text className="text-[15px] text-gray-600">
          This is your Commons as a street. Tap the road to walk, or tap a house or building to visit. Your circles meet in the Circle Hall.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button label="Go home" onPress={onGoHome} />
          <Button label="See every place" quiet onPress={onOpenList} />
        </View>
        {/* Invitations waiting for you used to show on the circles screen when it was the landing page. */}
        <CommonsInvitationsCard />
      </>
    );
  }

  if (selected.kind === 'building') {
    if (selected.id === 'circle-hall') return <CircleHallSheet coopId={coopId} commonsName={commonsName} />;
    const copy = BUILDING_COPY[selected.id];
    return (
      <>
        <Heading title={BUILDING_NAMES[selected.id]} />
        <Text className="text-[15px] text-gray-600">{copy.body(commonsName)}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Button label={copy.action} onPress={() => openBuilding(selected.id, coopId)} />
        </View>
      </>
    );
  }

  const lot = lots.get(selected.lotNumber);
  if (!lot) return <Heading title="Empty lot" sub="Nobody lives here right now." />;

  if (lot.isYou && yourLot) {
    return (
      <>
        <Heading title="Your house" sub={`Lot ${lot.lotNumber + 1} · Free to change anytime`} />
        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wider text-gray-500">House style</Text>
          <View className="flex-row flex-wrap gap-2">
            {STREET_HOUSE_STYLES.map((style) => (
              <TouchableOpacity
                key={style}
                accessibilityRole="button"
                accessibilityLabel={`House style ${STYLE_NAMES[style]}`}
                accessibilityState={{ selected: lot.houseStyle === style }}
                aria-selected={lot.houseStyle === style}
                onPress={() => onPaint({ houseStyle: style })}
                className="min-h-11 justify-center rounded-xl px-3"
                style={{ borderWidth: 2, borderColor: lot.houseStyle === style ? '#111827' : THEME.border }}
              >
                <Text className="text-sm font-semibold text-gray-900">{STYLE_NAMES[style]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wider text-gray-500">Wall color</Text>
          <View className="flex-row flex-wrap gap-2">
            {STREET_WALL_KEYS.map((key) => (
              <Swatch key={key} color={STREET_WALL_COLORS[key]} label={`Wall color ${COLOR_NAMES[key]}`} selected={lot.wallColor === key} onPress={() => onPaint({ wallColor: key })} />
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wider text-gray-500">Roof color</Text>
          <View className="flex-row flex-wrap gap-2">
            {STREET_ROOF_KEYS.map((key) => (
              <Swatch key={key} color={STREET_ROOF_COLORS[key]} label={`Roof color ${COLOR_NAMES[key]}`} selected={lot.roofColor === key} onPress={() => onPaint({ roofColor: key })} />
            ))}
          </View>
        </View>
      </>
    );
  }

  const isOut = onlineIds.has(lot.user.id);
  return (
    <>
      <Heading title={`${lot.user.name}'s house`} sub={`@${lot.user.handle}${isOut ? ' · Out on the street now' : ''}`} />
      <View className="flex-row flex-wrap gap-2">
        <Button label="Knock" a11y={`Knock on ${lot.user.name}'s door`} disabled={busy} onPress={() => onKnock(lot)} />
        <Button
          label="Send a message"
          quiet
          onPress={() => router.push({ pathname: '/(tabs)/messages', params: { userId: lot.user.id, name: lot.user.name } } as any)}
        />
        <Button
          label="View profile"
          quiet
          onPress={() => router.push({ pathname: '/people/[handle]', params: { handle: lot.user.handle, name: lot.user.name } } as any)}
        />
      </View>
    </>
  );
}

function ListRow({ title, sub, a11y, onPress }: { title: string; sub?: string; a11y: string; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} className="min-h-12 justify-center border-t py-2" style={{ borderColor: THEME.border }}>
      <Text className="text-[15px] font-semibold text-gray-900">{title}</Text>
      {sub ? <Text className="text-sm text-gray-500">{sub}</Text> : null}
    </TouchableOpacity>
  );
}

function StreetList({
  yourLot,
  neighborsOut,
  neighbors,
  circleCount,
  onVisit,
}: {
  yourLot: StreetLotData | null;
  neighborsOut: StreetLotData[];
  neighbors: StreetLotData[];
  circleCount: number;
  onVisit: (place: StreetPlace) => void;
}) {
  const places: StreetBuildingId[] = ['circle-hall', 'corner-store', 'group-buys', 'town-hall', 'green'];
  return (
    <>
      <Heading title="Every place on the street" />
      <View>
        <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Places</Text>
        {places.map((id) => (
          <ListRow
            key={id}
            title={BUILDING_NAMES[id]}
            sub={id === 'circle-hall' ? `${circleCount} circles` : undefined}
            a11y={`Visit ${BUILDING_NAMES[id]}`}
            onPress={() => onVisit({ kind: 'building', id })}
          />
        ))}
        {yourLot ? (
          <ListRow title="Your house" sub={`Lot ${yourLot.lotNumber + 1}`} a11y="Visit your house" onPress={() => onVisit({ kind: 'lot', lotNumber: yourLot.lotNumber })} />
        ) : null}
      </View>
      <View>
        <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Out on the street now</Text>
        {neighborsOut.length === 0 ? (
          <Text className="py-2 text-sm text-gray-500">Nobody else is out right now.</Text>
        ) : (
          neighborsOut.map((lot) => (
            <ListRow key={lot.user.id} title={lot.user.name} sub="Out now" a11y={`Visit ${lot.user.name}, out now`} onPress={() => onVisit({ kind: 'lot', lotNumber: lot.lotNumber })} />
          ))
        )}
      </View>
      <View>
        <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Neighbors</Text>
        {neighbors.length === 0 ? (
          <Text className="py-2 text-sm text-gray-500">No neighbors yet. Invite someone to move in.</Text>
        ) : (
          neighbors.map((lot) => (
            <ListRow key={lot.user.id} title={`${lot.user.name}'s house`} sub={`Lot ${lot.lotNumber + 1}`} a11y={`Visit ${lot.user.name}'s house`} onPress={() => onVisit({ kind: 'lot', lotNumber: lot.lotNumber })} />
          ))
        )}
      </View>
    </>
  );
}
