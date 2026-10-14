import type { PrivateGroupSummary } from "./api";

export const DRAWER_CIRCLE_PREVIEW_LIMIT = 3;

export type DrawerCirclePreview = {
  id: string;
  kind: "public" | "private";
  label: string;
  memberCount: number;
  isLeader: boolean;
};

/**
 * The drawer previews a few of the commons' circles. General (the commons
 * feed) is not listed here: the drawer's Home row opens Circle View, where
 * General is always the first card.
 */
export function buildDrawerCirclePreview(
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
): DrawerCirclePreview[] {
  if (limit <= 0) return [];

  return eligibleDrawerCircles(circles).slice(0, limit).map((circle) => ({
    id: circle.id,
    kind: circle.privacy === "public" ? "public" as const : "private" as const,
    label: circle.name,
    memberCount: circle.memberCount,
    isLeader: circle.isLeader,
  }));
}

export function eligibleDrawerCircles(circles: PrivateGroupSummary[]) {
  return circles.filter((circle) => circle.privacy === "public" || circle.isMember === true);
}

export function shouldShowCreateCircle(
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
) {
  return eligibleDrawerCircles(circles).length < Math.max(0, limit);
}

export function hiddenDrawerCircleCount(
  circles: PrivateGroupSummary[],
  limit = DRAWER_CIRCLE_PREVIEW_LIMIT,
) {
  return Math.max(0, eligibleDrawerCircles(circles).length - Math.max(0, limit));
}
