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
  if (notification.type === "COMMONS_INVITATION" && id("invitationId"))
    return {
      pathname: "/invitations/[invitationId]",
      params: { invitationId: id("invitationId")! },
    };
  if (
    notification.type === "COMMONS_ACCESS_REQUEST" ||
    notification.type === "COMMONS_RECOMMENDATION"
  )
    return {
      pathname: "/(authenticated)/commons-invites",
      params: { coopId: id("coopId") || notification.coopId },
    };
  if (
    notification.type === "COMMONS_ACCESS_DECLINED" ||
    notification.type === "FAMILY_SETUP_UPDATED"
  )
    return {
      pathname: "/commons/[coopId]",
      params: { coopId: id("coopId") || notification.coopId },
    };
  if (notification.type === "DIRECT_MESSAGE")
    return {
      pathname: "/(tabs)/messages",
      params: id("groupId") ? { groupId: id("groupId")! } : {},
    };
  if (notification.type === "PROPOSAL_DRAFT_READY")
    return {
      pathname: "/(authenticated)/commons-proposal-drafts",
      params: { coopId: id("coopId") || notification.coopId },
    };
  // Someone joined a commons you steward: their profile, to say hello.
  if (notification.type === "COMMONS_MEMBER_JOINED" && id("memberHandle"))
    return { pathname: "/people/[handle]", params: { handle: id("memberHandle")! } };
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
  // A routed Sage alert opens its own page with the evidence and "Not for me".
  if (notification.type === "SAGE_ALERT" && id("alertId"))
    return { pathname: "/(authenticated)/sage/alert/[id]", params: { id: id("alertId")! } };
  if (id("postId"))
    return {
      pathname: "/[coopId]/posts/[postId]",
      params: {
        coopId: id("coopId") || notification.coopId,
        postId: id("postId")!,
        // Intro and comment-like alerts point at one comment, which the
        // post screen scrolls to and highlights.
        ...(notification.type.startsWith("WELCOME_INTRO_") && id("commentId")
          ? { commentId: id("commentId")!, focus: "intro" }
          : (notification.type === "COMMONS_COMMENT_LIKE" || notification.type === "SAGE_COMMENT") && id("commentId")
            ? { commentId: id("commentId")! }
            : {}),
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
      params: { id: id("proposalId")!, coopId: id("coopId") || notification.coopId },
    };
  if (id("transactionId") || id("transferId") || id("paymentId"))
    return "/(authenticated)/history";
  // Joined a commons (approved request, accepted invitation) with no
  // welcome post to open: its feed.
  if (
    (notification.type === "COMMONS_ACCESS_APPROVED" ||
      notification.type === "COMMONS_INVITATION_ACCEPTED" ||
      notification.type === "COMMONS_MEMBER_JOINED") &&
    id("coopId")
  )
    return { pathname: "/[coopId]/posts", params: { coopId: id("coopId")! } };
  return null;
}
