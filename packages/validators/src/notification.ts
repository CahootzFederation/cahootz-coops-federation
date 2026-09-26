import { z } from "zod";

export const notificationCategories = [
  "community",
  "governance",
  "payments",
  "orders",
  "other",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export const notificationCategoryLabels: Record<NotificationCategory, string> =
  {
    community: "Community",
    governance: "Governance",
    payments: "Payments & rewards",
    orders: "Orders & stores",
    other: "Other account updates",
  };
export const notificationCategoryTypes: Record<
  Exclude<NotificationCategory, "other">,
  string[]
> = {
  community: [
    "COMMONS_COMMENT",
    "COMMONS_SUPPORT",
    "PERSONAL_PAGE_COMMENT",
    "PERSONAL_PAGE_SUPPORT",
    "MENTION",
    "CIRCLE_POST",
    "CIRCLE_COMMENT",
    "NEW_FOLLOWER",
    "EVENT_REMINDER",
    "CIRCLE_INVITATION",
  ],
  governance: [
    "PROPOSAL_CREATED",
    "PROPOSAL_PASSED",
    "PROPOSAL_REJECTED",
    "VOTE_REMINDER",
  ],
  payments: [
    "PAYMENT_RECEIVED",
    "PAYMENT_SENT",
    "TRANSFER_RECEIVED",
    "TRANSFER_SENT",
    "PAYMENT_CLAIMED",
    "PAYMENT_REFUNDED",
    "PAYMENT_REFUND_FAILED",
    "PAYMENT_EXPIRED",
    "WALLET_FUNDED",
    "WITHDRAWAL_INITIATED",
    "WITHDRAWAL_COMPLETE",
    "SC_EARNED",
    "SC_REWARD_EARNED",
    "DELAYED_MINT",
    "MINT_SUCCESS_PAYMENT_FAILED",
    "PAYMENT_SUCCESS_MINT_FAILED",
    "STORE_PAYMENT_RECEIVED",
  ],
  orders: [
    "ORDER_PLACED",
    "ORDER_RECEIVED",
    "ORDER_SHIPPED",
    "ORDER_DELIVERED",
    "ORDER_STATUS_UPDATE",
    "STORE_APPROVED",
  ],
};
export function notificationCategory(type: string): NotificationCategory {
  return (
    (
      Object.keys(notificationCategoryTypes) as Exclude<
        NotificationCategory,
        "other"
      >[]
    ).find((category) => notificationCategoryTypes[category].includes(type)) ||
    "other"
  );
}
export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  community: z.boolean(),
  governance: z.boolean(),
  payments: z.boolean(),
  orders: z.boolean(),
  other: z.boolean(),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: true,
  community: true,
  governance: true,
  payments: true,
  orders: true,
  other: true,
};
export const circleNotificationLevels = ["ALL", "MENTIONS", "NONE"] as const;
export const circleNotificationLevelSchema = z.enum(circleNotificationLevels);
export type CircleNotificationLevel = z.infer<
  typeof circleNotificationLevelSchema
>;
export const defaultCircleNotificationLevel: CircleNotificationLevel =
  "MENTIONS";
export function parseCircleNotificationLevel(
  value: string | null | undefined,
): CircleNotificationLevel {
  const parsed = circleNotificationLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultCircleNotificationLevel;
}
export const notificationCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1),
});
export type NotificationCursor = z.infer<typeof notificationCursorSchema>;
export interface AccountNotification {
  id: string;
  coopId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}
export interface NotificationPage {
  notifications: AccountNotification[];
  nextCursor: NotificationCursor | null;
  totalCount: number;
  unreadCount: number;
}
