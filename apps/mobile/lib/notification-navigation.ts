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
  if (notification.type === "PROPOSAL_DRAFT_READY")
    return "/(authenticated)/commons-proposal-drafts";
  if (notification.type.startsWith("PERSONAL_PAGE_"))
    return "/(authenticated)/personal-page";
  if (notification.type.startsWith("SAGE_SUGGESTION_") && id("actionId"))
    return {
      pathname: "/(authenticated)/sage/[id]",
      params: { id: id("actionId")! },
    };
  if (id("postId"))
    return {
      pathname: "/[coopId]/posts/[postId]",
      params: {
        coopId: id("coopId") || notification.coopId,
        postId: id("postId")!,
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
