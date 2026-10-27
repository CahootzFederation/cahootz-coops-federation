import type { Prisma } from "@repo/db";

import type { Context } from "../context.js";

type Db = Context["db"];
type Tx = Prisma.TransactionClient;

/**
 * How many messages a member can send Sage in one Commons. The Ask Sage chat and member DMs to Sage
 * share one allowance, so a DM is never a free way around it. Free messages reset each UTC month and
 * are used first; messages bought from the Commons' official store never expire.
 *
 * Only messages Sage answers with a model count. Fixed replies (refusals, "forget that", a yes to
 * Sage's own ask, check-in follow-ups Sage started) cost nothing and are free.
 */
export const SAGE_FREE_MESSAGES_PER_MONTH = 20;

/** Platform-fixed packs: every Commons sells the same ones, and stewards can't change them. */
export const SAGE_MESSAGE_PACKS = [
  { messages: 50, priceUSD: 5 },
  { messages: 150, priceUSD: 12 },
] as const;

export const SAGE_MESSAGES_CATEGORY = "SAGE_MESSAGES";

export type SageMessageSource = "CHAT" | "DM";

export interface SageAllowance {
  freeLimit: number;
  freeUsed: number;
  freeLeft: number;
  paidLeft: number;
  left: number;
  /** When the free messages come back (start of next UTC month). */
  resetsAt: Date;
}

export function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export async function readSageAllowance(client: Db | Tx, input: { userId: string; coopId: string; now?: Date }): Promise<SageAllowance> {
  const now = input.now ?? new Date();
  const scope = { userId: input.userId, coopId: input.coopId };
  const [freeUsed, paidUsed, bought] = await Promise.all([
    client.sageMessageUse.count({ where: { ...scope, paid: false, createdAt: { gte: monthStart(now) } } }),
    client.sageMessageUse.count({ where: { ...scope, paid: true } }),
    client.sageMessageCredit.aggregate({ where: { ...scope, revokedAt: null }, _sum: { messages: true } }),
  ]);
  const freeLeft = Math.max(0, SAGE_FREE_MESSAGES_PER_MONTH - freeUsed);
  // A refund after messages were used can leave more used than bought; the member keeps what they used.
  const paidLeft = Math.max(0, (bought._sum.messages ?? 0) - paidUsed);
  return {
    freeLimit: SAGE_FREE_MESSAGES_PER_MONTH, freeUsed: Math.min(freeUsed, SAGE_FREE_MESSAGES_PER_MONTH),
    freeLeft, paidLeft, left: freeLeft + paidLeft, resetsAt: nextMonthStart(now),
  };
}

export type SageClaim =
  | { ok: true; paid: boolean; allowance: SageAllowance }
  | { ok: false; allowance: SageAllowance };

/**
 * Uses one message for a member message Sage is about to answer. Free first, then bought. A per-member
 * lock keeps two messages sent at once from both taking the last one. Idempotent per source message.
 */
export async function claimSageMessage(
  client: Db,
  input: { userId: string; coopId: string; source: SageMessageSource; sourceId: string; now?: Date },
): Promise<SageClaim> {
  const now = input.now ?? new Date();
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`sage-messages:${input.userId}:${input.coopId}`}))::text`;
    const existing = await tx.sageMessageUse.findUnique({
      where: { source_sourceId: { source: input.source, sourceId: input.sourceId } },
      select: { paid: true },
    });
    if (existing) return { ok: true as const, paid: existing.paid, allowance: await readSageAllowance(tx, { ...input, now }) };
    const before = await readSageAllowance(tx, { ...input, now });
    if (before.left <= 0) return { ok: false as const, allowance: before };
    const paid = before.freeLeft <= 0;
    await tx.sageMessageUse.create({
      data: { userId: input.userId, coopId: input.coopId, source: input.source, sourceId: input.sourceId, paid, createdAt: now },
    });
    return { ok: true as const, paid, allowance: await readSageAllowance(tx, { ...input, now }) };
  });
}

/**
 * Uses one message, then answers. Out of messages: the fixed out-of-messages reply instead, with no
 * model call. The message is given back if answering fails, or if the model gave no answer and Sage
 * fell back to its stock "I'm not sure" reply.
 */
export async function answerWithinSageAllowance<R extends { reply: string; grounding?: { usedFallback: boolean } }>(
  client: Db,
  input: { userId: string; coopId: string; source: SageMessageSource; sourceId: string; now?: Date },
  answer: () => Promise<R>,
  outOfMessages: (allowance: SageAllowance) => Promise<R>,
): Promise<R> {
  const claim = await claimSageMessage(client, input);
  if (!claim.ok) return outOfMessages(claim.allowance);
  try {
    const answered = await answer();
    if (answered.grounding?.usedFallback) await releaseSageMessage(client, input);
    return answered;
  } catch (error) {
    await releaseSageMessage(client, input).catch(console.error);
    throw error;
  }
}

/** Gives a message back when Sage couldn't answer it. */
export async function releaseSageMessage(client: Db | Tx, input: { source: SageMessageSource; sourceId: string }) {
  await client.sageMessageUse.deleteMany({ where: { source: input.source, sourceId: input.sourceId } });
}

export function sagePackName(messages: number) {
  return `${messages} Sage messages`;
}

/** Idempotently lists the fixed Sage message packs in a Commons' official store. */
export async function ensureSageMessagePacks(client: Db | Tx, input: { storeId: string; coopName: string }) {
  await client.productCategoryConfig.upsert({
    where: { key: SAGE_MESSAGES_CATEGORY },
    update: { label: "Sage messages", isAdminOnly: true, isActive: true },
    create: { key: SAGE_MESSAGES_CATEGORY, label: "Sage messages", isAdminOnly: true, isActive: true, sortOrder: 110 },
  });
  for (const pack of SAGE_MESSAGE_PACKS) {
    const data = {
      name: sagePackName(pack.messages),
      description: `Keep talking with Sage about ${input.coopName}. Adds ${pack.messages} messages to your Ask Sage chat. You use them after your ${SAGE_FREE_MESSAGES_PER_MONTH} free messages each month, and they never expire.`,
      category: SAGE_MESSAGES_CATEGORY,
      kind: "SAGE_MESSAGE_PACK" as const,
      priceUSD: pack.priceUSD,
      ucDiscountPrice: null,
      quantity: 0,
      trackInventory: false,
      allowBackorder: false,
      isActive: true,
      isFeatured: false,
    };
    await client.product.upsert({
      where: { storeId_sageMessageCount: { storeId: input.storeId, sageMessageCount: pack.messages } },
      update: data,
      create: { ...data, storeId: input.storeId, sageMessageCount: pack.messages, images: [] },
    });
  }
}

/**
 * The packs a member can buy in this Commons. storeReady is false until its official store can take payments.
 * Stores made before packs existed get them here the first time anyone looks.
 */
export async function listSagePacks(client: Db, coopId: string, coopName?: string) {
  const store = await client.store.findFirst({
    where: { coopId, kind: "OFFICIAL_COMMONS", deletedAt: null },
    select: { id: true, status: true },
  });
  if (!store) return { storeReady: false, packs: [] as Array<{ productId: string; messages: number; priceUSD: number }> };
  const findPacks = () => client.product.findMany({
    where: { storeId: store.id, kind: "SAGE_MESSAGE_PACK", isActive: true, sageMessageCount: { not: null } },
    orderBy: { sageMessageCount: "asc" },
    select: { id: true, sageMessageCount: true, priceUSD: true },
  });
  let products = await findPacks();
  if (products.length < SAGE_MESSAGE_PACKS.length && coopName) {
    // Two first looks at once can race on the unique pack index; the loser just reads what the winner made.
    await ensureSageMessagePacks(client, { storeId: store.id, coopName }).catch(console.error);
    products = await findPacks();
  }
  return {
    storeReady: store.status === "APPROVED",
    packs: products.map((product) => ({ productId: product.id, messages: product.sageMessageCount!, priceUSD: product.priceUSD })),
  };
}

function metadataItems(metadata: unknown) {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const items = Array.isArray(record.items) ? record.items : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { productId, quantity } = item as Record<string, unknown>;
    if (typeof productId !== "string") return [];
    return [{ productId, quantity: typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0 ? quantity : 1 }];
  });
}

/** Adds bought messages after a paid checkout. Safe to run more than once for the same payment. */
export async function grantSageMessageCreditsForTransaction(client: Db | Tx, transactionId: string) {
  const transaction = await client.commerceTransaction.findUnique({
    where: { id: transactionId },
    select: { id: true, customerId: true, coopId: true, metadata: true },
  });
  if (!transaction) return [];
  const items = metadataItems(transaction.metadata);
  if (!items.length) return [];
  const products = await client.product.findMany({
    where: {
      id: { in: items.map((item) => item.productId) }, kind: "SAGE_MESSAGE_PACK", sageMessageCount: { not: null },
      store: { coopId: transaction.coopId, kind: "OFFICIAL_COMMONS" },
    },
    select: { id: true, sageMessageCount: true },
  });
  const grants = [];
  for (const product of products) {
    const quantity = items.find((item) => item.productId === product.id)!.quantity;
    grants.push(await client.sageMessageCredit.upsert({
      where: { commerceTransactionId_productId: { commerceTransactionId: transaction.id, productId: product.id } },
      update: {},
      create: {
        userId: transaction.customerId, coopId: transaction.coopId, productId: product.id,
        commerceTransactionId: transaction.id, messages: product.sageMessageCount! * quantity,
      },
    }));
  }
  return grants;
}

/** A refunded payment takes its bought messages back. Messages already used stay used. */
export function revokeSageMessageCreditsForTransaction(client: Db | Tx, transactionId: string, now = new Date()) {
  return client.sageMessageCredit.updateMany({
    where: { commerceTransactionId: transactionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** What Sage says when a member is out of messages. Fixed text, no model call. */
export function outOfMessagesReply(allowance: Pick<SageAllowance, "resetsAt">, storeReady: boolean) {
  const resets = allowance.resetsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return storeReady
    ? `You've used all ${SAGE_FREE_MESSAGES_PER_MONTH} of your free Sage messages this month. They come back on ${resets}. If you want to keep going now, you can get more messages in the Commons store.`
    : `You've used all ${SAGE_FREE_MESSAGES_PER_MONTH} of your free Sage messages this month. They come back on ${resets}.`;
}
