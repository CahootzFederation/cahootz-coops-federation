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
      kind: "public" | "private";
      label: string;
      memberCount: number;
      isLeader: boolean;
    };

/**
 * Every commons has one durable public circle: its existing commons feed.
 * Public and joined circles follow it, keeping the drawer preview intentionally
 * short while preserving the existing feed and post data model.
 */
export function buildDrawerCirclePreview(
  coopId: string,
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
): DrawerCirclePreview[] {
  if (limit <= 0) return [];

  return [
    { id: `general:${coopId}`, kind: "main", label: "General" as const },
    ...eligibleDrawerCircles(circles).slice(0, Math.max(0, limit - 1)).map((circle) => ({
      id: circle.id,
      kind: circle.privacy === "public" ? "public" as const : "private" as const,
      label: circle.name,
      memberCount: circle.memberCount,
      isLeader: circle.isLeader,
    })),
  ];
}

export function eligibleDrawerCircles(circles: PrivateGroupSummary[]) {
  return circles.filter((circle) => circle.privacy === "public" || circle.isMember === true);
}

export function shouldShowCreateCircle(
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
) {
  const privateCircleSlots = Math.max(0, limit - 1);
  return eligibleDrawerCircles(circles).length < privateCircleSlots;
}

export function hiddenDrawerCircleCount(
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
) {
  const visiblePrivateCircleCount = Math.max(0, limit - 1);
  return Math.max(0, eligibleDrawerCircles(circles).length - visiblePrivateCircleCount);
}
