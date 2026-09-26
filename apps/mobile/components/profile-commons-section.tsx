import { TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Award, Lock } from 'lucide-react-native';

import { IconAvatar } from '@/components/icon-avatar';
import { Text } from '@/components/ui/text';
import type { PersonalPageCommons } from '@/lib/api';

const ROLE_LABELS: Record<string, string> = {
  member: 'Member',
  admin: 'Admin',
  governor: 'Governor',
  business: 'Business',
};

function roleLabel(role: string) {
  return ROLE_LABELS[role] || role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Leads with elevated roles; plain "Member" only shows when it's the sole role,
 * since everyone listed here is a member.
 */
function displayRoles(roles: string[]) {
  const elevated = roles.filter((role) => role !== 'member');
  return elevated.length > 0 ? elevated : ['member'];
}

export function ProfileCommonsSection({
  commons,
  isOwnPage,
}: {
  commons: PersonalPageCommons[];
  isOwnPage: boolean;
}) {
  const badgeCount = commons.reduce((total, item) => total + item.badges.length, 0);

  return (
    <View className="rounded-2xl border border-gray-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-black text-gray-950">Commons</Text>
        <Text className="text-xs font-bold text-gray-500">
          {commons.length} commons{badgeCount > 0 ? ` · ${badgeCount} ${badgeCount === 1 ? 'badge' : 'badges'}` : ''}
        </Text>
      </View>

      {commons.length === 0 ? (
        <Text className="mt-2 text-sm leading-5 text-gray-500">
          {isOwnPage ? "You haven't joined a commons yet." : 'No shared or public commons to show.'}
        </Text>
      ) : null}

      <View className="mt-2">
        {commons.map((item, index) => (
          <TouchableOpacity
            key={item.coopId}
            onPress={() => router.push({ pathname: '/commons/[coopId]', params: { coopId: item.coopId } } as any)}
            className={`flex-row items-start gap-3 py-3 ${index > 0 ? 'border-t border-gray-100' : ''}`}
            activeOpacity={0.75}
            accessibilityLabel={`Open ${item.name}`}
          >
            <IconAvatar
              emoji={item.iconEmoji}
              color={item.iconColor}
              fallbackText={item.name}
              colorKey={item.coopId}
              size={36}
              radius={10}
            />
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text className="min-w-0 shrink text-sm font-black text-gray-950" numberOfLines={1}>
                  {item.name}
                </Text>
                {item.isPrivate ? <Lock size={11} color="#64748B" accessibilityLabel="Private commons" /> : null}
              </View>
              <View className="mt-1.5 flex-row flex-wrap gap-1.5">
                {displayRoles(item.roles).map((role) => (
                  <View key={role} className="rounded-full bg-gray-100 px-2 py-0.5">
                    <Text className="text-[10px] font-black text-gray-700">{roleLabel(role)}</Text>
                  </View>
                ))}
                {item.badges.map((badge) => (
                  <View
                    key={badge.tier}
                    className="flex-row items-center rounded-full px-2 py-0.5"
                    style={{ backgroundColor: `${badge.color}18` }}
                  >
                    <Award size={10} color={badge.color} />
                    <Text className="ml-1 text-[10px] font-black" style={{ color: badge.color }}>
                      {badge.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
