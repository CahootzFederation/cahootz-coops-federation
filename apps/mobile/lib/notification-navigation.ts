import type { Href } from "expo-router";

import type { AccountNotification } from "@repo/validators/notification";

export function notificationDestination(
  notification: AccountNotification,
): Href | null {
  const data = notification.data;
  const id = (key: string) =>
    typeof data?.[key] === "string" && data[key] ? (data[key] as string) : null;
  if (notification.type === "RESOURCE_INVITATION")
    return "/(authenticated)/resource-invitations";
  if (notification.type === "CIRCLE_INVITATION")
    return {
      pathname: "/(authenticated)/spaces",
      params: { coopId: id("coopId") || notification.coopId },
    };
  if (notification.type === "DIRECT_MESSAGE")
    return {
      pathname: "/(tabs)/messages",
      params: id("groupId") ? { groupId: id("groupId")! } : {},
    };
  if (notification.type === "PROPOSAL_DRAFT_READY")
    return "/(authenticated)/commons-proposal-drafts";
  if (notification.type.startsWith("PERSONAL_PAGE_"))
    return "/(authenticated)/personal-page";
  if (notification.type.startsWith("SAGE_SUGGESTION_") && id("actionId"))
    return {
      pathname: "/(authenticated)/sage/[id]",
      params: { id: id("actionId")! },
    };
  if (id("eventId"))
    return {
      pathname: "/[coopId]/events/[eventId]",
      params: {
        coopId: id("coopId") || notification.coopId,
        eventId: id("eventId")!,
      },
    };
  if (id("postId"))
    return {
      pathname: "/[coopId]/posts/[postId]",
      params: {
        coopId: id("coopId") || notification.coopId,
        postId: id("postId")!,
      },
    };
  // A circle's feed (e.g. the new-member drip pointing at a welcome lounge
  // or a public circle to join). Checked after postId so alerts about a
  // post inside a circle still open the post.
  if (id("circleId"))
    return {
      pathname: "/[coopId]/posts",
      params: {
        coopId: id("coopId") || notification.coopId,
        circleId: id("circleId")!,
      },
    };
  if (id("orderId"))
    return {
      pathname: "/(authenticated)/order-detail",
      params: { id: id("orderId")! },
    };
  if (id("storeId"))
    return {
      pathname: "/(authenticated)/store-detail",
      params: { id: id("storeId")! },
    };
  if (id("proposalId"))
    return {
      pathname: "/(authenticated)/proposal-detail",
      params: { id: id("proposalId")! },
    };
  if (id("transactionId") || id("transferId") || id("paymentId"))
    return "/(authenticated)/history";
  return null;
}
