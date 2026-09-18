import type { PrivateGroupSummary } from "./api";

export const DRAWER_CIRCLE_PREVIEW_LIMIT = 3;

export type DrawerCirclePreview =
  | {
      id: string;
      kind: "main";
      label: "General";
    }
  | {
      id: string;
      kind: "private";
      label: string;
      memberCount: number;
      isLeader: boolean;
    };

/**
 * Every commons has one durable public circle: its existing commons feed.
 * Focused private circles follow it, keeping the drawer preview intentionally
 * short while preserving the existing feed and post data model.
 */
export function buildDrawerCirclePreview(
  coopId: string,
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
): DrawerCirclePreview[] {
  if (limit <= 0) return [];

  return [
    { id: `main:${coopId}`, kind: "main", label: "General" as const },
    ...circles.slice(0, Math.max(0, limit - 1)).map((circle) => ({
      id: circle.id,
      kind: "private" as const,
      label: circle.name,
      memberCount: circle.memberCount,
      isLeader: circle.isLeader,
    })),
  ];
}

export function shouldShowCreateCircle(
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
) {
  const privateCircleSlots = Math.max(0, limit - 1);
  return circles.length < privateCircleSlots;
}

export function hiddenDrawerCircleCount(
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
) {
  const visiblePrivateCircleCount = Math.max(0, limit - 1);
  return Math.max(0, circles.length - visiblePrivateCircleCount);
}
