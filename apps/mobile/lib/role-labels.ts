// Platform-level roles (User.roles / UserCoopMembership.roles) and circle-level roles
// (GroupMember.role) that are worth calling out with a tag. "member"/"MEMBER" is the
// default everyone has, so it's intentionally not labeled - showing it would just be noise.
const PLATFORM_ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  governor: 'Governor',
  business: 'Business',
  sage: 'Sage',
};

const CIRCLE_ROLE_LABELS: Record<string, string> = {
  GUIDE: 'Guide',
  NEWCOMER: 'Newcomer',
};

export function platformRoleLabels(roles?: string[] | null): string[] {
  if (!roles?.length) return [];
  const labels = roles.map((role) => PLATFORM_ROLE_LABELS[role]).filter((label): label is string => !!label);
  return [...new Set(labels)];
}

export function circleRoleLabel(role?: string | null): string | null {
  if (!role) return null;
  return CIRCLE_ROLE_LABELS[role] ?? null;
}
