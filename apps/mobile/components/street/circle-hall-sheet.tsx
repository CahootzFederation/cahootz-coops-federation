import { useCallback, useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { LoadError } from '@/components/load-error';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { track } from '@/lib/analytics';
import { api, type PrivateGroupSummary } from '@/lib/api';
import { circleColorFromKey } from '@/lib/circle-color';
import { friendlyError } from '@/lib/friendly-error';

const THEME = { ...DESIGN, primary: DESIGN.actionText };

function openCircle(coopId: string, circleId?: string) {
  router.replace({ pathname: '/[coopId]/posts', params: { coopId, circleId } } as any);
}

function CircleRow({
  name,
  sub,
  dot,
  action,
  actionLabel,
  quiet,
  disabled,
  onPress,
}: {
  name: string;
  sub: string;
  dot: string;
  action: string;
  actionLabel: string;
  quiet: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 border-t py-3" style={{ borderColor: THEME.border }}>
      <View className="h-3 w-3 rounded-full" style={{ backgroundColor: dot }} />
      <View className="min-w-0 flex-1">
        <Text className="text-[16px] font-bold text-gray-950">{name}</Text>
        <Text className="text-sm text-gray-500">{sub}</Text>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
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
          {action}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const circleSub = (circle: PrivateGroupSummary) => {
  const parts = [`${circle.memberCount} ${circle.memberCount === 1 ? 'member' : 'members'}`];
  if (circle.chattingCount > 0) parts.push(`${circle.chattingCount} chatting now`);
  if (circle.isMember && (circle.unreadCount ?? 0) > 0) parts.push(`${circle.unreadCount} new`);
  return parts.join(' · ');
};

const dotFor = (circle: PrivateGroupSummary) => circle.iconColor || circleColorFromKey(circle.colorKey).foreground;

/**
 * The Circle Hall on the street: every circle in the Commons, right in the
 * street's panel. Yours first (General, your circles, your welcome lounge),
 * then public ones you can join. The full circles screen is one tap away.
 */
export function CircleHallSheet({ coopId, commonsName }: { coopId: string; commonsName: string }) {
  const { sessionToken } = useAuth();
  const [circles, setCircles] = useState<PrivateGroupSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) return;
      let active = true;
      setLoadError(null);
      api
        .listVisibleCircles(sessionToken, coopId)
        .then((result) => active && setCircles(result.groups))
        .catch((err) => {
          console.error('Failed to load circles for the Circle Hall:', err);
          if (active) setLoadError(friendlyError(err, "We couldn't load your circles. Please try again."));
        });
      return () => {
        active = false;
      };
    }, [coopId, reloadKey, sessionToken]),
  );

  const join = async (circle: PrivateGroupSummary) => {
    if (!sessionToken || busyId) return;
    setBusyId(circle.id);
    setActionError(null);
    try {
      await api.joinPublicCircle(circle.id, sessionToken);
      openCircle(coopId, circle.id);
    } catch (err) {
      setActionError(friendlyError(err, "We couldn't add you to that circle."));
    } finally {
      setBusyId(null);
    }
  };

  const joinWelcomeLounge = async () => {
    if (!sessionToken || busyId) return;
    setBusyId('welcome');
    setActionError(null);
    try {
      const result = await api.assignWelcomeTable(sessionToken, coopId);
      track('welcome_lounge_joined', { source: 'circle_hall' });
      openCircle(coopId, result.groupId);
    } catch (err) {
      setActionError(friendlyError(err, "We couldn't add you to a welcome lounge."));
    } finally {
      setBusyId(null);
    }
  };

  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const all = circles ?? [];
  const mine = all.filter((c) => c.isMember);
  const welcome = mine.find((c) => c.kind === 'WELCOME_TABLE');
  const yours = mine.filter((c) => c.kind !== 'WELCOME_TABLE' && matches(c.name));
  const open = all.filter((c) => !c.isMember && c.privacy === 'public' && matches(c.name));
  const showGeneral = matches('General');
  const showWelcome = welcome ? matches(welcome.name) : matches('Welcome lounge');
  const total = all.length + 1; // plus General
  const nothingMatches = !!search.trim() && !showGeneral && !showWelcome && yours.length === 0 && open.length === 0;

  return (
    <>
      <View className="pr-12">
        <Text accessibilityRole="header" className="text-xl font-bold text-gray-950">
          Circle Hall
        </Text>
        <Text className="mt-0.5 text-sm text-gray-500">
          {circles ? `${total} ${total === 1 ? 'circle meets' : 'circles meet'} here · You're in ${mine.length + 1}` : `Every circle in ${commonsName} meets here`}
        </Text>
      </View>
      <Input
        accessibilityLabel="Find a circle"
        placeholder="Find a circle"
        value={search}
        onChangeText={setSearch}
        style={{ minHeight: DESIGN.controlHeight, backgroundColor: DESIGN.paper }}
      />
      {actionError ? <Text className="text-sm font-semibold text-red-600">{actionError}</Text> : null}
      {loadError && !circles ? (
        <LoadError message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !circles ? (
        <View className="items-center py-6">
          <ActivityIndicator color={THEME.primary} />
        </View>
      ) : (
        <>
          <View>
            <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Your circles</Text>
            {showGeneral ? (
              <CircleRow
                name="General"
                sub={`Everyone in ${commonsName}`}
                dot={circleColorFromKey('blue').foreground}
                action="Open"
                actionLabel="Open General"
                quiet
                onPress={() => openCircle(coopId)}
              />
            ) : null}
            {yours.map((circle) => (
              <CircleRow
                key={circle.id}
                name={circle.name}
                sub={circleSub(circle)}
                dot={dotFor(circle)}
                action="Open"
                actionLabel={`Open ${circle.name}`}
                quiet
                onPress={() => openCircle(coopId, circle.id)}
              />
            ))}
            {welcome && showWelcome ? (
              <CircleRow
                name={welcome.name}
                sub={circleSub(welcome)}
                dot={dotFor(welcome)}
                action="Open"
                actionLabel={`Open ${welcome.name}`}
                quiet
                onPress={() => openCircle(coopId, welcome.id)}
              />
            ) : null}
          </View>
          {(!welcome && showWelcome) || open.length > 0 ? (
            <View>
              <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Open to join</Text>
              {!welcome && showWelcome ? (
                <CircleRow
                  name="Welcome lounge"
                  sub="Meet other new members, with Sage to say hi"
                  dot={THEME.primary}
                  action={busyId === 'welcome' ? 'Joining…' : 'Join'}
                  actionLabel="Join a welcome lounge"
                  quiet={false}
                  disabled={busyId !== null}
                  onPress={joinWelcomeLounge}
                />
              ) : null}
              {open.map((circle) => (
                <CircleRow
                  key={circle.id}
                  name={circle.name}
                  sub={circleSub(circle)}
                  dot={dotFor(circle)}
                  action={busyId === circle.id ? 'Joining…' : 'Join'}
                  actionLabel={`Join ${circle.name}`}
                  quiet={false}
                  disabled={busyId !== null}
                  onPress={() => join(circle)}
                />
              ))}
            </View>
          ) : null}
          {nothingMatches ? <Text className="text-sm text-gray-500">No circles match your search.</Text> : null}
        </>
      )}
      <View className="flex-row flex-wrap gap-2 pt-1">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go inside Circle Hall"
          onPress={() => router.replace({ pathname: '/[coopId]/circles', params: { coopId } } as any)}
          className="min-h-11 justify-center"
        >
          <Text className="text-sm font-bold" style={{ color: THEME.primary }}>
            Go inside to see every circle and manage yours
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
