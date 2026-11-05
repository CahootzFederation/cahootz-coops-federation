import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, PixelRatio, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { List, LocateFixed, Minus, Plus, X } from 'lucide-react-native';
import {
  buildStreetLayout,
  clampStreetPanAxis,
  clampStreetZoom,
  STREET_HAIR_COLORS,
  STREET_HAIR_STYLES,
  STREET_HOUSE_STYLES,
  STREET_ROOF_COLORS,
  STREET_SHIRT_COLORS,
  STREET_SKIN_TONES,
  STREET_ROOF_KEYS,
  STREET_WALL_COLORS,
  STREET_WALL_KEYS,
  streetDoorTile,
  streetPath,
  type StreetBuildingId,
  type StreetHouseStyle,
  type StreetLayout,
} from '@repo/validators/street';

import CircleView from '@/components/circle-view';
import { CommonsHeader, useCommonsDirectory } from '@/components/commons-header';
import { CommonsInvitationsCard } from '@/components/commons-invitations-card';
import { LoadError } from '@/components/load-error';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsPost, type StreetData, type StreetLookData, type StreetLotData } from '@/lib/api';
import { ApiError, CONNECTION_MESSAGE, friendlyError } from '@/lib/friendly-error';
import { secureStorage } from '@/lib/secure-storage';
import { CircleHallSheet } from './circle-hall-sheet';
import { iso, TH, TW, type PersonColors } from './street-art';
import { BUILDING_NAMES, hitTest, StreetScene, type ScenePerson, type StreetPlace } from './street-scene';

const THEME = { ...DESIGN, primary: DESIGN.actionText };
const POLL_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const OFFLINE_RETRY_MS = 15_000;
const STYLE_NAMES: Record<StreetHouseStyle, string> = { a: 'Cottage', b: 'Two-story', c: 'Bungalow' };
const COLOR_NAMES: Record<string, string> = {
  cream: 'Cream', sky: 'Sky', sage: 'Sage', rose: 'Rose', white: 'White',
  terracotta: 'Terracotta', slate: 'Slate', blue: 'Blue', green: 'Green',
  deep: 'Deep', brown: 'Brown', warm: 'Warm', tan: 'Tan', golden: 'Golden', light: 'Light',
  olive: 'Olive', peach: 'Peach', fair: 'Fair', rosy: 'Rosy', pale: 'Pale',
  black: 'Black', auburn: 'Auburn', blond: 'Blond', gray: 'Gray',
  purple: 'Purple', gold: 'Gold', teal: 'Teal',
};
const HAIR_STYLE_NAMES: Record<string, string> = { short: 'Short', curly: 'Curly', bun: 'Bun', long: 'Long', none: 'None' };

/** Turn a saved look (palette keys) into the colors a person is drawn with. */
function lookColors(look: StreetLookData): PersonColors {
  return {
    skin: STREET_SKIN_TONES[look.skin as keyof typeof STREET_SKIN_TONES] ?? STREET_SKIN_TONES.warm,
    hair: STREET_HAIR_COLORS[look.hairColor as keyof typeof STREET_HAIR_COLORS] ?? STREET_HAIR_COLORS.black,
    hairStyle: look.hairStyle,
    shirt: STREET_SHIRT_COLORS[look.shirt as keyof typeof STREET_SHIRT_COLORS] ?? STREET_SHIRT_COLORS.terracotta,
  };
}
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const pinnedThisWeek = (post: { createdAt?: string }) =>
  !!post.createdAt && Date.now() - new Date(post.createdAt).getTime() < WEEK_MS;

/**
 * Someone out on the street. Nobody steers anyone, you included: everyone
 * who's online strolls on their own little errands (home, the community
 * board, the Circle Hall, a shop, a nearby stretch of road), pauses, then heads off again.
 */
interface Walker {
  id: string;
  name: string;
  look: StreetLookData;
  isYou: boolean;
  isSage: boolean;
  x: number;
  y: number;
  path: Array<{ i: number; j: number }>;
  /** When they're done pausing and pick their next errand. */
  restUntil: number;
  home: { i: number; j: number } | null;
}

const STROLL_SPEED = 1.5; // tiles per second
const SAGE_WALKER_ID = '__sage-street-guide__';
/** Set once you've opened something on the street, so the first-visit hint stays gone. */
const STREET_HINT_KEY = 'cahootz.streetHintSeen';
const ZOOM_STEP = 1.25;
/** At least this much of the map stays on screen however far you drag. */
const PAN_MARGIN = 80;
/** Name tags and signs grow with the phone's text size, up to this much. */
const MAX_FONT_SCALE = 1.6;
const pauseMs = () => 2000 + Math.random() * 5000;

/** Pick where someone strolls next: home, a building, a neighbor's door, or somewhere nearby. */
function nextErrand(
  w: Walker,
  layout: StreetLayout,
  doors: Array<{ i: number; j: number }>,
): Array<{ i: number; j: number }> | null {
  const from = { i: Math.floor(w.x), j: Math.floor(w.y) };
  for (let attempt = 0; attempt < 6; attempt++) {
    const roll = Math.random();
    let to: { i: number; j: number } | null = null;
    if (roll < 0.2 && w.home) to = w.home;
    else if (roll < 0.55 && doors.length) to = doors[Math.floor(Math.random() * doors.length)]!;
    else {
      const i = from.i + Math.round((Math.random() - 0.5) * 10);
      const j = from.j + Math.round((Math.random() - 0.5) * 10);
      if (!layout.isBlocked(i, j)) to = { i, j };
    }
    if (!to || (to.i === from.i && to.j === from.j)) continue;
    const path = streetPath(layout, from, to);
    if (path && path.length) return path;
  }
  return null;
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
  // Reduce Motion: nobody bobs as they walk and the view jumps instead of gliding.
  const [reduceMotion, setReduceMotion] = useState(false);
  const reduceMotionRef = useRef(false);
  reduceMotionRef.current = reduceMotion;
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => active && setReduceMotion(on))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      sub?.remove?.();
    };
  }, []);
  const fontScale = Math.min(MAX_FONT_SCALE, Math.max(1, PixelRatio.getFontScale() || 1));
  // The walking loop only runs while the street is on screen and the app is open.
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);
  const running = isFocused && appActive;
  // A first-visit hint on the map, until you open your first place or person.
  const [hintSeen, setHintSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    secureStorage
      .getItem(STREET_HINT_KEY)
      .then((value) => active && setHintSeen(!!value))
      .catch(() => active && setHintSeen(false));
    return () => {
      active = false;
    };
  }, []);
  const markHintSeen = () => {
    if (hintSeen) return;
    setHintSeen(true);
    secureStorage.setItem(STREET_HINT_KEY, '1').catch((err) => console.warn('Street hint not saved:', err));
  };

  const walkers = useRef(new Map<string, Walker>());
  const viewSize = useRef({ w: 0, h: 0 });
  const camera = useRef({ x: 0, y: 0, ready: false });
  const pan = useRef({ x: 0, y: 0, startX: 0, startY: 0, dragging: false });
  // How far you've zoomed: `target` is where you asked to be, `current` glides there.
  const zoom = useRef({ current: 1, target: 1, pinchFrom: 1 });
  // Someone the camera keeps up with (you after "Show me", or whoever's card is open).
  const follow = useRef<string | null>(null);
  // The point the camera centers on: the circle at first, then whatever you tap.
  const focus = useRef({ x: 8, y: 8 });
  const sheetOpenRef = useRef(false);
  const layoutRef = useRef<StreetLayout | null>(null);
  const doorsRef = useRef<Array<{ i: number; j: number }>>([]);
  const youId = useRef<string | null>(null);
  const lastSentTile = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(() => buildStreetLayout(street?.maxLotNumber ?? 0), [street?.maxLotNumber]);
  const lots = useMemo(() => new Map((street?.lots ?? []).map((lot) => [lot.lotNumber, lot])), [street?.lots]);
  const yourLot = street?.lots.find((lot) => lot.isYou) ?? null;

  // Front doors people stroll between: every building and every occupied house.
  useEffect(() => {
    layoutRef.current = layout;
    const doors: Array<{ i: number; j: number }> = [];
    for (const b of layout.buildings) {
      const door = streetDoorTile(layout, b, b.i >= 11 ? { x: b.i + 1, y: 8 } : layout.center);
      if (door) doors.push(door);
    }
    for (const lot of layout.lots) {
      if (!lots.has(lot.lotNumber)) continue;
      const door = streetDoorTile(layout, lot, lot.i >= 11 ? { x: lot.i + 1, y: 8 } : layout.center);
      if (door) doors.push(door);
    }
    doorsRef.current = doors;
  }, [layout, lots]);

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
    const map = walkers.current;
    const homeOf = (userId: string) => {
      const lot = data.lots.find((l) => l.user.id === userId);
      const placement = lot ? nextLayout.lots.find((p) => p.lotNumber === lot.lotNumber) : null;
      return placement ? streetDoorTile(nextLayout, placement, placement.i >= 11 ? { x: placement.i + 1, y: 8 } : nextLayout.center) : null;
    };
    // Who's online comes from the server; where they wander is up to each
    // phone. People appear where they were last seen and set off from there.
    const seen = new Set<string>();
    const mineLot = data.lots.find((lot) => lot.isYou);
    const people = [...data.online.filter((p) => !p.isYou)];
    for (const person of people) {
      seen.add(person.userId);
      const existing = map.get(person.userId);
      if (existing) {
        existing.look = person.look; // they may have changed how they look
        continue;
      }
      const start = nextLayout.isBlocked(person.x, person.y) ? homeOf(person.userId) ?? { i: 11, j: 8 } : { i: person.x, j: person.y };
      map.set(person.userId, {
        id: person.userId,
        name: person.name,
        look: person.look,
        isYou: false,
        isSage: false,
        x: start.i + 0.5,
        y: start.j + 0.5,
        path: [],
        restUntil: Date.now() + Math.random() * 1500,
        home: homeOf(person.userId),
      });
    }
    for (const id of [...map.keys()]) {
      const walker = map.get(id)!;
      if (!walker.isYou && !walker.isSage && !seen.has(id)) map.delete(id);
    }
    // You're out on the street too, strolling like everyone else, starting at your door.
    if (mineLot && !youId.current) {
      youId.current = mineLot.user.id;
      const home = homeOf(mineLot.user.id);
      const start = home ?? { i: 11, j: 8 };
      map.set(mineLot.user.id, {
        id: mineLot.user.id,
        name: 'You',
        look: mineLot.user.look,
        isYou: true,
        isSage: false,
        x: start.i + 0.5,
        y: start.j + 0.5,
        path: [],
        restUntil: Date.now() + 1200,
        home,
      });
    } else if (mineLot && youId.current) {
      const me = map.get(youId.current);
      if (me) me.look = mineLot.user.look;
    }
    // Sage is a street guide, not a member or presence record. Keeping this
    // local avoids inventing membership, online status, or a house for Sage.
    if (!map.has(SAGE_WALKER_ID)) {
      const board = nextLayout.buildings.find((building) => building.id === 'board');
      const start = board ? streetDoorTile(nextLayout, board, nextLayout.center) : null;
      map.set(SAGE_WALKER_ID, {
        id: SAGE_WALKER_ID,
        name: 'Sage',
        look: mineLot?.user.look ?? {
          skin: 'warm',
          hairStyle: 'none',
          hairColor: 'brown',
          shirt: 'terracotta',
        },
        isYou: false,
        isSage: true,
        x: (start?.i ?? 8) + 0.5,
        y: (start?.j ?? 6) + 0.5,
        path: [],
        restUntil: Date.now() + 800,
        home: start,
      });
    }
    setStreet(data);
  }, []);

  // Recent Board posts: one note each on the community board, and the latest
  // few in its card.
  const [boardPosts, setBoardPosts] = useState<CommonsPost[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) return;
      let active = true;
      api
        .listBoardItems({ coopId, lane: 'all', limit: 6 }, sessionToken)
        .then((result) => active && setBoardPosts(result.items))
        .catch((err) => {
          console.warn('Board posts for the street not loaded:', err);
          if (active) setBoardPosts([]);
        });
      return () => {
        active = false;
      };
    }, [coopId, sessionToken]),
  );
  const boardNotes = (boardPosts ?? []).filter(pinnedThisWeek).length;

  // New messages across your circles, for the red bubble on the Circle Hall.
  // Same counts as the circles screen; refreshed while the street is open.
  const [circleUnread, setCircleUnread] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) return;
      let active = true;
      const check = () =>
        api
          .listVisibleCircles(sessionToken, coopId)
          .then((result) => {
            if (!active) return;
            setCircleUnread(result.groups.filter((c) => c.isMember).reduce((sum, c) => sum + (c.unreadCount ?? 0), 0));
          })
          .catch((err) => console.warn('Circle unread counts not loaded:', err));
      check();
      const timer = setInterval(check, 30_000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [coopId, sessionToken]),
  );

  const setLook = async (change: Partial<StreetLookData>) => {
    if (!sessionToken || !street) return;
    const before = street;
    const mine = street.lots.find((lot) => lot.isYou);
    if (!mine) return;
    const look = { ...mine.user.look, ...change } as StreetLookData;
    setActionError(null);
    setStreet({ ...street, lots: street.lots.map((lot) => (lot.isYou ? { ...lot, user: { ...lot.user, look } } : lot)) });
    const me = youId.current ? walkers.current.get(youId.current) : null;
    if (me) me.look = look;
    try {
      await api.setStreetLook(change, sessionToken);
      showNotice('Saved. That’s how neighbors see you now.');
    } catch (err) {
      setStreet(before);
      if (me) me.look = mine.user.look;
      setActionError(friendlyError(err, "We couldn't save your look. Try again."));
    }
  };

  // One refresh at a time: on a slow connection, a refresh that's still on
  // its way isn't joined by another. While we can't reach Cahootz, the
  // regular refresh only tries every OFFLINE_RETRY_MS.
  const loading = useRef(false);
  const lastTry = useRef(0);
  const offlineRef = useRef(false);
  const [offline, setOffline] = useState(false);
  const load = useCallback(async (opts: { scheduled?: boolean } = {}) => {
    if (!sessionToken || loading.current) return;
    if (opts.scheduled && offlineRef.current && Date.now() - lastTry.current < OFFLINE_RETRY_MS) return;
    loading.current = true;
    lastTry.current = Date.now();
    try {
      const data = await api.getStreet(coopId, sessionToken);
      setLoadError(null);
      offlineRef.current = false;
      setOffline(false);
      applyStreet(data);
      sendPosition();
    } catch (err) {
      if (isForbidden(err)) {
        setNotMember(true);
        return;
      }
      console.error('Failed to load street:', err);
      const message = friendlyError(err, "We couldn't load the street. Check your connection and try again.");
      // A failure the server never answered (no ApiError) means we couldn't reach it.
      if (message === CONNECTION_MESSAGE || !(err instanceof ApiError)) {
        offlineRef.current = true;
        setOffline(true);
      }
      setLoadError(message);
    } finally {
      loading.current = false;
    }
  }, [applyStreet, coopId, sendPosition, sessionToken]);

  // Load and keep the street fresh while it's on screen; check in so others
  // see you; leave when you go elsewhere or the app goes to the background.
  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) return;
      let active = true;
      load();
      const poll = setInterval(() => active && load({ scheduled: true }), POLL_MS);
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
    focus.current = { x: 8, y: 8 };
    follow.current = null;
    setStreet(null);
    setSelected(null);
    setNotMember(false);
    setLoadError(null);
  }, [coopId]);

  // Everyone strolls on their own; the camera glides to whatever you're
  // looking at. Re-render only when something moved.
  useEffect(() => {
    // Save battery: no walking loop while you're on another screen or the app is in the background.
    if (!running) return;
    let raf = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let changed = false;
      const currentLayout = layoutRef.current;
      for (const w of walkers.current.values()) {
        if (!w.path.length) {
          if (!currentLayout || now < w.restUntil) continue;
          const path = nextErrand(w, currentLayout, doorsRef.current);
          if (path) w.path = path;
          else w.restUntil = now + pauseMs();
          continue;
        }
        const next = w.path[0]!;
        const tx = next.i + 0.5;
        const ty = next.j + 0.5;
        const dx = tx - w.x;
        const dy = ty - w.y;
        const dist = Math.hypot(dx, dy);
        const step = STROLL_SPEED * dt;
        if (dist <= step) {
          w.x = tx;
          w.y = ty;
          w.path.shift();
          if (!w.path.length) w.restUntil = now + pauseMs();
        } else {
          w.x += (dx / dist) * step;
          w.y += (dy / dist) * step;
        }
        changed = true;
      }
      const { w: vw, h: vh } = viewSize.current;
      const snap = reduceMotionRef.current;
      const z = zoom.current;
      if (z.current !== z.target) {
        const next = snap ? z.target : z.current + (z.target - z.current) * Math.min(1, dt * 10);
        z.current = Math.abs(next - z.target) < 0.002 ? z.target : next;
        changed = true;
      }
      const followed = follow.current ? walkers.current.get(follow.current) : null;
      if (followed) focus.current = { x: followed.x, y: followed.y };
      if (vw > 0) {
        const [px, py] = iso(focus.current.x, focus.current.y);
        const baseX = vw / 2 - px * z.current;
        // With a card open over the bottom of the map, keep the place you
        // opened in view above it.
        const baseY = vh * (sheetOpenRef.current ? 0.3 : 0.55) - py * z.current;
        // Keep part of the street on screen however far it's dragged.
        // The street is a diamond, so use the box that fits inside it: then
        // what stays on screen is real street, not an empty corner.
        const L = currentLayout;
        if (L) {
          const [cx, cy] = iso(L.width / 2, L.height / 2);
          const halfX = ((L.width + L.height) * TW) / 8;
          const halfY = ((L.width + L.height) * TH) / 8;
          pan.current.x = clampStreetPanAxis(pan.current.x, baseX, cx - halfX, cx + halfX, z.current, vw, PAN_MARGIN);
          pan.current.y = clampStreetPanAxis(pan.current.y, baseY, cy - halfY, cy + halfY, z.current, vh, PAN_MARGIN);
        }
        const tx = baseX + pan.current.x;
        const ty = baseY + pan.current.y;
        if (!camera.current.ready) {
          camera.current = { x: tx, y: ty, ready: true };
          changed = true;
        } else {
          const k = snap || pan.current.dragging ? 1 : Math.min(1, dt * 6);
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
  }, [running]);

  // Tapping a place opens it and glides the view over to it. Nobody walks
  // there because you tapped: people on the street go where they please.
  const visit = (place: StreetPlace) => {
    setActionError(null);
    setListOpen(false);
    setSelected(place);
    markHintSeen();
    if (place.kind === 'person') {
      // Keep the person you opened in view while they stroll.
      follow.current = place.id;
      pan.current.x = 0;
      pan.current.y = 0;
      return;
    }
    follow.current = null;
    const footprint =
      place.kind === 'lot' ? layout.lots.find((lot) => lot.lotNumber === place.lotNumber) : layout.buildings.find((b) => b.id === place.id);
    if (!footprint) return;
    pan.current.x = 0;
    pan.current.y = 0;
    focus.current = { x: footprint.i + footprint.w / 2, y: footprint.j + footprint.d / 2 };
  };

  const onTap = useCallback(
    (wx: number, wy: number) => {
      const people = [...walkers.current.values()].map((w) => ({ id: w.id, x: w.x, y: w.y }));
      const hit = hitTest(layout, lots, wx, wy, { zoom: zoom.current.current, people, circleCount: street?.circleCount ?? 0, fontScale });
      if ('person' in hit) {
        const mine = street?.lots.find((lot) => lot.isYou);
        // Tapping yourself opens your house.
        if (hit.person === youId.current && mine) visit({ kind: 'lot', lotNumber: mine.lotNumber });
        else visit({ kind: 'person', id: hit.person });
      } else if ('place' in hit) visit(hit.place);
      else {
        // Tapping open map puts the card away.
        setSelected(null);
        setListOpen(false);
        setActionError(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, lots, street, fontScale],
  );

  const onPan = useCallback((dx: number, dy: number, done: boolean) => {
    if (!pan.current.dragging) {
      pan.current.dragging = true;
      // Dragging means you're looking around: stop keeping up with anyone.
      const followed = follow.current ? walkers.current.get(follow.current) : null;
      if (followed) focus.current = { x: followed.x, y: followed.y };
      follow.current = null;
      pan.current.startX = pan.current.x;
      pan.current.startY = pan.current.y;
    }
    pan.current.x = pan.current.startX + dx;
    pan.current.y = pan.current.startY + dy;
    if (done) pan.current.dragging = false;
  }, []);

  const onPinch = useCallback((scale: number, done: boolean) => {
    const z = zoom.current;
    if (done) {
      z.pinchFrom = z.target;
      return;
    }
    z.target = clampStreetZoom(z.pinchFrom * scale);
    z.current = z.target; // follow the fingers directly
  }, []);

  const zoomBy = (factor: number) => {
    const z = zoom.current;
    z.target = clampStreetZoom(z.target * factor);
    z.pinchFrom = z.target;
    setFrame((f) => (f + 1) % 1_000_000);
  };

  // "Show me on the street": glide back to you and keep up with you.
  const findMe = () => {
    if (!youId.current) return;
    follow.current = youId.current;
    pan.current.x = 0;
    pan.current.y = 0;
    setFrame((f) => (f + 1) % 1_000_000);
  };

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

  const people: ScenePerson[] = [...walkers.current.values()].map((w) => {
    const moving = w.path.length > 0;
    return { id: w.id, name: w.name, look: lookColors(w.look), isYou: w.isYou, isSage: w.isSage, x: w.x, y: w.y, moving };
  });
  const onlineIds = new Set((street?.online ?? []).map((p) => p.userId));
  const neighborsOut = (street?.lots ?? []).filter((lot) => !lot.isYou && onlineIds.has(lot.user.id));
  const neighbors = (street?.lots ?? []).filter((lot) => !lot.isYou);
  // Everyone else out strolling right now, Sage first, for the list.
  const peopleOut = people
    .filter((p) => !p.isYou)
    .sort((a, b) => Number(b.isSage) - Number(a.isSage) || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name }));

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

  const sheetOpen = listOpen || selected !== null;
  sheetOpenRef.current = selected !== null;
  const closeSheet = () => {
    setListOpen(false);
    setSelected(null);
    setActionError(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <CommonsHeader coopId={coopId} directory={directory} right={listButton} />
      <View className="flex-1" style={{ width: '100%', maxWidth: 800, alignSelf: 'center' }}>
        {!street ? (
          <View className="flex-1 items-center justify-center px-5">
            {loadError ? (
              <LoadError message={loadError} onRetry={() => load()} />
            ) : (
              <>
                <ActivityIndicator color={THEME.primary} />
                <Text className="mt-3 text-sm font-semibold text-gray-500">Walking you to the street…</Text>
              </>
            )}
          </View>
        ) : (
          // The map fills the screen. A card slides up only when you open a
          // place or the list, sized to what it holds; tapping the map or ✕
          // puts it away.
          <View style={{ flex: 1 }}>
            <StreetScene
              layout={layout}
              lots={lots}
              circleCount={street.circleCount}
              boardNotes={boardNotes}
              circleUnread={circleUnread}
              people={people}
              camera={camera.current}
              zoom={zoom.current.current}
              fontScale={fontScale}
              selected={selected}
              bobPhase={reduceMotion ? null : Date.now() / 1000}
              onTap={onTap}
              onPan={onPan}
              onPinch={onPinch}
              onLayout={onLayout}
            />
            <View pointerEvents="none" className="absolute left-3 top-3 items-start gap-2" style={{ right: 64 }}>
              <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.92)' }}>
                <Text className="text-[13px] font-semibold text-gray-800">
                  {`Welcome to ${commonsName}`}
                  <Text className="text-[13px] text-gray-500">{` · ${street.online.filter((p) => !p.isYou).length} out now`}</Text>
                </Text>
              </View>
              {offline ? (
                // The street keeps showing what it last knew; say so plainly.
                <View accessibilityLiveRegion="polite" className="rounded-full px-3 py-1.5" style={{ backgroundColor: '#1F2937' }}>
                  <Text className="text-[13px] font-semibold text-white">{"You're offline. We'll catch up when you're back."}</Text>
                </View>
              ) : null}
              {hintSeen === false && !sheetOpen ? (
                <View testID="street-first-visit-hint" className="rounded-full px-3 py-1.5" style={{ backgroundColor: THEME.primary }}>
                  <Text className="text-[13px] font-semibold text-white">Tap a house, building or person to visit.</Text>
                </View>
              ) : null}
            </View>
            {!sheetOpen ? (
              <View className="absolute right-3 gap-2" style={{ top: 12 }}>
                <MapButton label="Show me on the street" onPress={findMe}>
                  <LocateFixed size={19} color={THEME.primary} />
                </MapButton>
                <MapButton label="Zoom in" onPress={() => zoomBy(ZOOM_STEP)}>
                  <Plus size={19} color={THEME.primary} />
                </MapButton>
                <MapButton label="Zoom out" onPress={() => zoomBy(1 / ZOOM_STEP)}>
                  <Minus size={19} color={THEME.primary} />
                </MapButton>
              </View>
            ) : null}
            {!sheetOpen ? (
              <View className="absolute bottom-3 left-3 right-3">
                <CommonsInvitationsCard />
              </View>
            ) : null}
            {notice ? (
              <View
                pointerEvents="none"
                className="absolute left-3 right-3 rounded-xl px-3 py-2.5"
                style={{ backgroundColor: '#111827', top: 52 }}
                accessibilityLiveRegion="polite"
              >
                <Text className="text-sm font-semibold text-white">{notice}</Text>
              </View>
            ) : null}
            {sheetOpen ? (
              <View
                className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white"
                style={{ maxHeight: '72%', boxShadow: '0 -6px 24px rgba(17, 24, 39, 0.14)' }}
              >
                <View className="items-center pt-2">
                  <View className="h-1 w-10 rounded-full" style={{ backgroundColor: THEME.border }} />
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={closeSheet}
                  className="absolute right-3 top-3 z-10 h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: '#F3F4F6' }}
                >
                  <X size={18} color={THEME.ink} />
                </TouchableOpacity>
                <ScrollView
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, gap: 12 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {actionError ? <Text className="pr-12 text-sm font-semibold text-red-600">{actionError}</Text> : null}
                  {listOpen ? (
                    <StreetList
                      yourLot={yourLot}
                      neighborsOut={neighborsOut}
                      neighbors={neighbors}
                      circleCount={street.circleCount}
                      circleUnread={circleUnread}
                      peopleOut={peopleOut}
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
                      onPaint={paint}
                      onSetLook={setLook}
                      boardPosts={boardPosts}
                      onKnock={knock}
                      walkerName={selected?.kind === 'person' ? walkers.current.get(selected.id)?.name ?? null : null}
                      sessionToken={sessionToken}
                    />
                  )}
                </ScrollView>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/** A round button floating on the map. */
function MapButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-full"
      style={{ backgroundColor: 'rgba(255,255,255,0.95)', boxShadow: '0 2px 8px rgba(17, 24, 39, 0.16)' }}
    >
      {children}
    </TouchableOpacity>
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
    // Room on the right for the card's close button.
    <View className="pr-12">
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

const BUILDING_COPY: Record<Exclude<StreetBuildingId, 'circle-hall' | 'board'>, { body: (name: string) => string; action: string }> = {
  'group-buys': { body: () => 'Team up with neighbors to buy together and pay less.', action: 'See group buys' },
  'corner-store': { body: (name) => `Shops run by members of ${name}.`, action: 'Browse stores' },
  'town-hall': { body: (name) => `Read proposals and vote on how ${name} runs.`, action: 'Read proposals' },
};

function openBuilding(id: StreetBuildingId, coopId: string) {
  // Replace rather than push, the same way the circles screen opens a circle,
  // so the street and the circles screen are never both mounted (two headers).
  if (id === 'circle-hall') router.replace({ pathname: '/[coopId]/circles', params: { coopId } } as any);
  else if (id === 'group-buys') router.push('/(authenticated)/group-buys' as any);
  else if (id === 'corner-store') router.push({ pathname: '/(tabs)/board', params: { coopId, lane: 'marketplace' } } as any);
  else if (id === 'town-hall') router.push({ pathname: '/(tabs)/proposals', params: { coopId } } as any);
  else router.push({ pathname: '/(tabs)/board', params: { coopId } } as any);
}

function ChipRow<T extends string>({ label, options, names, value, onPick }: { label: string; options: readonly T[]; names: Record<string, string>; value: string; onPick: (v: T) => void }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${names[option] ?? option}`}
          accessibilityState={{ selected: value === option }}
          aria-selected={value === option}
          onPress={() => onPick(option)}
          className="min-h-11 justify-center rounded-xl px-3"
          style={{ borderWidth: 2, borderColor: value === option ? '#111827' : THEME.border }}
        >
          <Text className="text-sm font-semibold text-gray-900">{names[option] ?? option}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** How your person looks on every Commons street. */
function YourLook({ look, onChange }: { look: StreetLookData; onChange: (change: Partial<StreetLookData>) => void }) {
  const section = (title: string, body: React.ReactNode) => (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</Text>
      {body}
    </View>
  );
  return (
    <View className="gap-3 border-t pt-3" style={{ borderColor: THEME.border }}>
      <View>
        <Text accessibilityRole="header" className="text-lg font-bold text-gray-950">
          Your look
        </Text>
        <Text className="text-sm text-gray-500">How neighbors see you strolling, on every Commons street.</Text>
      </View>
      {section(
        'Skin',
        <View className="flex-row flex-wrap gap-2">
          {(Object.keys(STREET_SKIN_TONES) as Array<keyof typeof STREET_SKIN_TONES>).map((key) => (
            <Swatch key={key} color={STREET_SKIN_TONES[key]} label={`Skin ${COLOR_NAMES[key]}`} selected={look.skin === key} onPress={() => onChange({ skin: key })} />
          ))}
        </View>,
      )}
      {section(
        'Hair',
        <ChipRow label="Hair" options={STREET_HAIR_STYLES} names={HAIR_STYLE_NAMES} value={look.hairStyle} onPick={(hairStyle) => onChange({ hairStyle })} />,
      )}
      {look.hairStyle !== 'none'
        ? section(
            'Hair color',
            <View className="flex-row flex-wrap gap-2">
              {(Object.keys(STREET_HAIR_COLORS) as Array<keyof typeof STREET_HAIR_COLORS>).map((key) => (
                <Swatch key={key} color={STREET_HAIR_COLORS[key]} label={`Hair color ${COLOR_NAMES[key]}`} selected={look.hairColor === key} onPress={() => onChange({ hairColor: key })} />
              ))}
            </View>,
          )
        : null}
      {section(
        'Shirt',
        <View className="flex-row flex-wrap gap-2">
          {(Object.keys(STREET_SHIRT_COLORS) as Array<keyof typeof STREET_SHIRT_COLORS>).map((key) => (
            <Swatch key={key} color={STREET_SHIRT_COLORS[key]} label={`Shirt ${COLOR_NAMES[key]}`} selected={look.shirt === key} onPress={() => onChange({ shirt: key })} />
          ))}
        </View>,
      )}
    </View>
  );
}

/** The community board in the middle of the circle: the latest posts, and the way to the full Board. */
function BoardSheet({ coopId, commonsName, posts }: { coopId: string; commonsName: string; posts: CommonsPost[] | null }) {
  const recent = (posts ?? []).slice(0, 3);
  const thisWeek = (posts ?? []).filter(pinnedThisWeek).length;
  const openPost = (post: CommonsPost) => {
    if (post.tag === 'Event' && post.event?.id) {
      router.push({ pathname: '/[coopId]/events/[eventId]', params: { coopId, eventId: post.event.id } } as any);
    } else {
      router.push({ pathname: '/[coopId]/posts/[postId]', params: { coopId, postId: post.id } } as any);
    }
  };
  return (
    <>
      <Heading
        title="Community Board"
        sub={posts === null ? `What's pinned up in ${commonsName}` : `${thisWeek} ${thisWeek === 1 ? 'note' : 'notes'} pinned up this week`}
      />
      <Text className="text-[15px] text-gray-600">Neighbors pin up asks, offers, updates and events here.</Text>
      {posts === null ? (
        <ActivityIndicator color={THEME.primary} />
      ) : recent.length === 0 ? (
        <Text className="text-sm text-gray-500">Nothing&apos;s pinned up yet. Be the first to post something.</Text>
      ) : (
        <View>
          {recent.map((post) => (
            <ListRow
              key={post.id}
              title={post.title || 'Untitled note'}
              sub={post.tag ? `${post.tag}` : undefined}
              a11y={`Open ${post.title || 'note'}`}
              onPress={() => openPost(post)}
            />
          ))}
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        <Button label="See the whole board" onPress={() => openBuilding('board', coopId)} />
      </View>
    </>
  );
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
  onPaint,
  onSetLook,
  boardPosts,
  onKnock,
  walkerName,
  sessionToken,
}: {
  coopId: string;
  commonsName: string;
  street: StreetData;
  selected: StreetPlace | null;
  yourLot: StreetLotData | null;
  lots: Map<number, StreetLotData>;
  onlineIds: Set<string>;
  busy: boolean;
  onPaint: (look: { houseStyle?: string; wallColor?: string; roofColor?: string }) => void;
  onSetLook: (look: Partial<StreetLookData>) => void;
  boardPosts: CommonsPost[] | null;
  onKnock: (lot: StreetLotData) => void;
  /** The name of the person whose card is open, while they're still out. */
  walkerName: string | null;
  sessionToken: string | null;
}) {
  if (!selected) return null;

  if (selected.kind === 'person') {
    if (selected.id === SAGE_WALKER_ID) return <SageSheet commonsName={commonsName} sessionToken={sessionToken} />;
    const person = street.online.find((p) => p.userId === selected.id);
    const lot = street.lots.find((l) => l.user.id === selected.id) ?? null;
    const name = person?.name ?? lot?.user.name ?? walkerName ?? 'Neighbor';
    const handle = person?.handle ?? lot?.user.handle ?? null;
    return (
      <>
        <Heading title={name} sub={person ? 'Out on the street now' : 'Headed home for now'} />
        <View className="flex-row flex-wrap gap-2">
          {lot ? <Button label="Knock" a11y={`Knock on ${name}'s door`} disabled={busy} onPress={() => onKnock(lot)} /> : null}
          <Button
            label="Send a message"
            quiet={!!lot}
            onPress={() => router.push({ pathname: '/(tabs)/messages', params: { userId: selected.id, name } } as any)}
          />
          {handle ? (
            <Button
              label="View profile"
              quiet
              onPress={() => router.push({ pathname: '/people/[handle]', params: { handle, name } } as any)}
            />
          ) : null}
        </View>
      </>
    );
  }

  if (selected.kind === 'building') {
    if (selected.id === 'circle-hall') return <CircleHallSheet coopId={coopId} commonsName={commonsName} />;
    if (selected.id === 'board') return <BoardSheet coopId={coopId} commonsName={commonsName} posts={boardPosts} />;
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
        <YourLook look={lot.user.look} onChange={onSetLook} />
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

/** Sage strolling the street: a friendly hello and the way into a chat. */
function SageSheet({ commonsName, sessionToken }: { commonsName: string; sessionToken: string | null }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openChat = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      // Sage's chat is a private conversation in Messages, opened by Sage's account.
      const { members } = await api.listDirectMembers(sessionToken);
      const sage = members.find((m) => m.isSage);
      router.push({ pathname: '/(tabs)/messages', params: sage ? { userId: sage.id, name: sage.name } : {} } as any);
    } catch (err) {
      setError(friendlyError(err, "We couldn't open your chat with Sage. Try again."));
    } finally {
      setOpening(false);
    }
  };
  return (
    <>
      <Heading title="Sage" sub="Out on the street now" />
      <Text className="text-[15px] text-gray-600">{`Sage helps folks in ${commonsName} find what they need and pitch in. Ask anything.`}</Text>
      {error ? <Text className="text-sm font-semibold text-red-600">{error}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        <Button label="Chat with Sage" disabled={opening} onPress={openChat} />
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
  circleUnread,
  peopleOut,
  onVisit,
}: {
  yourLot: StreetLotData | null;
  neighborsOut: StreetLotData[];
  neighbors: StreetLotData[];
  circleCount: number;
  circleUnread: number;
  peopleOut: Array<{ id: string; name: string }>;
  onVisit: (place: StreetPlace) => void;
}) {
  const places: StreetBuildingId[] = ['board', 'circle-hall', 'corner-store', 'group-buys', 'town-hall'];
  return (
    <>
      <Heading title="Every place on the street" />
      <View>
        <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Places</Text>
        {places.map((id) => (
          <ListRow
            key={id}
            title={BUILDING_NAMES[id]}
            sub={id === 'circle-hall' ? `${circleCount} circles${circleUnread > 0 ? ` · ${circleUnread} new` : ''}` : undefined}
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
        <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Say hi</Text>
        {peopleOut.map((person) => (
          <ListRow key={person.id} title={person.name} sub="Strolling the street" a11y={`Say hi to ${person.name}`} onPress={() => onVisit({ kind: 'person', id: person.id })} />
        ))}
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
