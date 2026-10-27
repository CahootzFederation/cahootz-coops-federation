import { beforeEach, describe, expect, it, vi } from "vitest";

const runSageCommonsReply = vi.fn();
const traceSageReply = vi.fn();
vi.mock("../agents/registry.js", () => ({ runSageCommonsReply: (...args: unknown[]) => runSageCommonsReply(...args) }));
vi.mock("../services/sage-reply-trails.js", () => ({ traceSageReply: (...args: unknown[]) => traceSageReply(...args) }));
vi.mock("../services/commons-membership.js", () => ({ requireActiveMember: vi.fn().mockResolvedValue({ status: "ACTIVE" }) }));
vi.mock("../services/sage-member-memory.js", () => ({
  loadMemberMemory: vi.fn().mockResolvedValue([]), memberMemoryLines: vi.fn().mockReturnValue([]),
}));

import { buildCommunitySnapshot, sendSageChatMessage } from "../services/sage-community-chat.js";
import {
  SAGE_FREE_MESSAGES_PER_MONTH, answerWithinSageAllowance, claimSageMessage, ensureSageMessagePacks, grantSageMessageCreditsForTransaction,
  outOfMessagesReply, readSageAllowance, releaseSageMessage, revokeSageMessageCreditsForTransaction,
} from "../services/sage-message-allowance.js";

const NOW = new Date("2026-10-27T15:00:00Z");
const USER = "member-1";
const COOP = "soulaan";

type Use = { id: string; userId: string; coopId: string; source: string; sourceId: string; paid: boolean; createdAt: Date };
type Credit = { id: string; userId: string; coopId: string; messages: number; productId: string; commerceTransactionId: string; revokedAt: Date | null };
type ChatRow = { id: string; userId: string; coopId: string; role: string; content: string; createdAt: Date };

/** An in-memory stand-in for the tables the allowance and chat use. */
function fakeDb() {
  const uses: Use[] = [];
  const credits: Credit[] = [];
  const chat: ChatRow[] = [];
  const products: Array<{ id: string; kind: string; sageMessageCount: number | null; store: { coopId: string; kind: string } }> = [];
  const transactions: Array<{ id: string; customerId: string; coopId: string; metadata: unknown }> = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;
  const matchUse = (row: Use, where: any) =>
    (where.userId === undefined || row.userId === where.userId) && (where.coopId === undefined || row.coopId === where.coopId)
    && (where.paid === undefined || row.paid === where.paid) && (!where.createdAt?.gte || row.createdAt >= where.createdAt.gte);
  const db: any = {
    $transaction: vi.fn(async (fn: any) => fn(db)),
    $queryRaw: vi.fn(async () => []),
    sageMessageUse: {
      count: vi.fn(async ({ where }: any) => uses.filter((row) => matchUse(row, where)).length),
      findUnique: vi.fn(async ({ where }: any) => uses.find((row) =>
        row.source === where.source_sourceId.source && row.sourceId === where.source_sourceId.sourceId) ?? null),
      create: vi.fn(async ({ data }: any) => { const row = { id: id("use"), createdAt: NOW, ...data }; uses.push(row); return row; }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = uses.length;
        for (let i = uses.length - 1; i >= 0; i--) if (uses[i]!.source === where.source && uses[i]!.sourceId === where.sourceId) uses.splice(i, 1);
        return { count: before - uses.length };
      }),
    },
    sageMessageCredit: {
      aggregate: vi.fn(async ({ where }: any) => ({
        _sum: { messages: credits.filter((row) => row.userId === where.userId && row.coopId === where.coopId && row.revokedAt === null)
          .reduce((sum, row) => sum + row.messages, 0) || null },
      })),
      upsert: vi.fn(async ({ where, create }: any) => {
        const key = where.commerceTransactionId_productId;
        const found = credits.find((row) => row.commerceTransactionId === key.commerceTransactionId && row.productId === key.productId);
        if (found) return found;
        const row = { id: id("credit"), revokedAt: null, ...create };
        credits.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hits = credits.filter((row) => row.commerceTransactionId === where.commerceTransactionId && row.revokedAt === null);
        for (const row of hits) Object.assign(row, data);
        return { count: hits.length };
      }),
    },
    commerceTransaction: { findUnique: vi.fn(async ({ where }: any) => transactions.find((row) => row.id === where.id) ?? null) },
    product: {
      findMany: vi.fn(async ({ where }: any) => products.filter((row) =>
        where.id.in.includes(row.id) && row.kind === where.kind && row.sageMessageCount !== null
        && row.store.coopId === where.store.coopId && row.store.kind === where.store.kind)),
      upsert: vi.fn(),
    },
    productCategoryConfig: { upsert: vi.fn() },
    store: { findFirst: vi.fn().mockResolvedValue({ id: "store-1", status: "APPROVED" }) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: "Dana Smith" }) },
    sageChatMessage: {
      findMany: vi.fn(async ({ where, take }: any) => chat.filter((row) => row.userId === where.userId && row.coopId === where.coopId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take)),
      create: vi.fn(async ({ data }: any) => { const row = { id: id("chat"), createdAt: new Date(NOW.getTime() + seq), ...data }; chat.push(row); return row; }),
      delete: vi.fn(async ({ where }: any) => { const i = chat.findIndex((row) => row.id === where.id); return chat.splice(i, 1)[0]; }),
    },
    aIObservation: { findMany: vi.fn().mockResolvedValue([]) },
    commonsPost: { findMany: vi.fn().mockResolvedValue([]) },
    event: { findMany: vi.fn().mockResolvedValue([]) },
    proposal: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db, uses, credits, chat, products, transactions };
}

async function useFree(db: any, count: number, at = NOW) {
  for (let i = 0; i < count; i++) {
    await claimSageMessage(db, { userId: USER, coopId: COOP, source: "DM", sourceId: `seed-${at.getTime()}-${i}`, now: at });
  }
}

describe("Sage message allowance", () => {
  it("uses free messages first, then bought ones, then stops", async () => {
    const { db, credits } = fakeDb();
    credits.push({ id: "c1", userId: USER, coopId: COOP, messages: 2, productId: "p", commerceTransactionId: "t", revokedAt: null });
    await useFree(db, SAGE_FREE_MESSAGES_PER_MONTH);
    const afterFree = await readSageAllowance(db, { userId: USER, coopId: COOP, now: NOW });
    expect(afterFree).toMatchObject({ freeLeft: 0, paidLeft: 2, left: 2 });

    const first = await claimSageMessage(db, { userId: USER, coopId: COOP, source: "CHAT", sourceId: "m1", now: NOW });
    expect(first).toMatchObject({ ok: true, paid: true });
    await claimSageMessage(db, { userId: USER, coopId: COOP, source: "CHAT", sourceId: "m2", now: NOW });
    const out = await claimSageMessage(db, { userId: USER, coopId: COOP, source: "CHAT", sourceId: "m3", now: NOW });
    expect(out.ok).toBe(false);
    expect(out.allowance.left).toBe(0);
  });

  it("counts the same message once, even when claimed twice", async () => {
    const { db, uses } = fakeDb();
    await claimSageMessage(db, { userId: USER, coopId: COOP, source: "DM", sourceId: "same", now: NOW });
    await claimSageMessage(db, { userId: USER, coopId: COOP, source: "DM", sourceId: "same", now: NOW });
    expect(uses).toHaveLength(1);
  });

  it("gives free messages back at the start of each UTC month, but not bought ones used", async () => {
    const { db } = fakeDb();
    await useFree(db, SAGE_FREE_MESSAGES_PER_MONTH, new Date("2026-09-30T23:59:00Z"));
    const allowance = await readSageAllowance(db, { userId: USER, coopId: COOP, now: NOW });
    expect(allowance).toMatchObject({ freeUsed: 0, freeLeft: SAGE_FREE_MESSAGES_PER_MONTH });
    expect(allowance.resetsAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("keeps each Commons' allowance separate", async () => {
    const { db } = fakeDb();
    await useFree(db, SAGE_FREE_MESSAGES_PER_MONTH);
    const other = await readSageAllowance(db, { userId: USER, coopId: "other-commons", now: NOW });
    expect(other.left).toBe(SAGE_FREE_MESSAGES_PER_MONTH);
  });

  it("releases a message Sage couldn't answer", async () => {
    const { db, uses } = fakeDb();
    await claimSageMessage(db, { userId: USER, coopId: COOP, source: "CHAT", sourceId: "failed", now: NOW });
    await releaseSageMessage(db, { source: "CHAT", sourceId: "failed" });
    expect(uses).toHaveLength(0);
  });

  it("grants packs times quantity once per payment, only for this Commons' official store", async () => {
    const { db, credits, products, transactions } = fakeDb();
    products.push(
      { id: "pack-50", kind: "SAGE_MESSAGE_PACK", sageMessageCount: 50, store: { coopId: COOP, kind: "OFFICIAL_COMMONS" } },
      { id: "other-pack", kind: "SAGE_MESSAGE_PACK", sageMessageCount: 50, store: { coopId: "elsewhere", kind: "OFFICIAL_COMMONS" } },
      { id: "mug", kind: "STANDARD", sageMessageCount: null, store: { coopId: COOP, kind: "MEMBER" } },
    );
    transactions.push({ id: "tx-1", customerId: USER, coopId: COOP, metadata: { items: [
      { productId: "pack-50", quantity: 2 }, { productId: "other-pack", quantity: 1 }, { productId: "mug", quantity: 1 },
    ] } });
    await grantSageMessageCreditsForTransaction(db, "tx-1");
    await grantSageMessageCreditsForTransaction(db, "tx-1");
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ userId: USER, coopId: COOP, messages: 100, productId: "pack-50" });
  });

  it("takes bought messages back on refund without going below zero", async () => {
    const { db, credits } = fakeDb();
    credits.push({ id: "c1", userId: USER, coopId: COOP, messages: 1, productId: "p", commerceTransactionId: "tx-r", revokedAt: null });
    await useFree(db, SAGE_FREE_MESSAGES_PER_MONTH);
    await claimSageMessage(db, { userId: USER, coopId: COOP, source: "CHAT", sourceId: "paid", now: NOW });
    await revokeSageMessageCreditsForTransaction(db, "tx-r", NOW);
    expect(await readSageAllowance(db, { userId: USER, coopId: COOP, now: NOW })).toMatchObject({ paidLeft: 0, left: 0 });
  });

  it("lists the fixed packs in the official store", async () => {
    const { db } = fakeDb();
    await ensureSageMessagePacks(db, { storeId: "store-1", coopName: "Soulaan Coop" });
    const calls = db.product.upsert.mock.calls.map(([args]: any) => args.create);
    expect(calls.map((pack: any) => [pack.sageMessageCount, pack.priceUSD, pack.kind])).toEqual([
      [50, 5, "SAGE_MESSAGE_PACK"], [150, 12, "SAGE_MESSAGE_PACK"],
    ]);
    expect(calls[0].description).toContain("never expire");
  });

  it("answers a DM within the allowance, and sends the fixed reply once it's used up", async () => {
    const { db, uses } = fakeDb();
    const answer = vi.fn().mockResolvedValue({ reply: "model answer" });
    const outOfMessages = vi.fn(async () => ({ reply: "fixed reply" }));
    const dm = (id: string) => answerWithinSageAllowance(db, { userId: USER, coopId: COOP, source: "DM", sourceId: id, now: NOW }, answer, outOfMessages);
    expect(await dm("dm-1")).toEqual({ reply: "model answer" });
    expect(uses).toEqual([expect.objectContaining({ source: "DM", sourceId: "dm-1", paid: false })]);
    await useFree(db, SAGE_FREE_MESSAGES_PER_MONTH - 1);
    expect(await dm("dm-2")).toEqual({ reply: "fixed reply" });
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it("gives a message back when the model gave no answer", async () => {
    const { db, uses } = fakeDb();
    const fallback = { reply: "I'm not sure", grounding: { usedFallback: true } };
    await answerWithinSageAllowance(db, { userId: USER, coopId: COOP, source: "DM", sourceId: "dm-f", now: NOW },
      async () => fallback, async () => fallback);
    expect(uses).toHaveLength(0);

    runSageCommonsReply.mockResolvedValue(fallback);
    traceSageReply.mockImplementation(async (_source, input, produce, publish) => publish((await produce(input.message)).reply));
    await sendSageChatMessage(db, { userId: USER, coopId: COOP, content: "Anything?", now: NOW });
    expect(uses).toHaveLength(0);
  });

  it("gives a DM's message back when the model fails", async () => {
    const { db, uses } = fakeDb();
    await expect(answerWithinSageAllowance(db, { userId: USER, coopId: COOP, source: "DM", sourceId: "dm-x", now: NOW },
      () => Promise.reject(new Error("down")), async () => ({ reply: "unused" }))).rejects.toThrow("down");
    expect(uses).toHaveLength(0);
  });

  it("tells the member when free messages come back", () => {
    const reply = outOfMessagesReply({ resetsAt: new Date("2026-11-01T00:00:00Z") }, true);
    expect(reply).toContain("November 1");
    expect(reply).toContain("Commons store");
    expect(outOfMessagesReply({ resetsAt: new Date("2026-11-01T00:00:00Z") }, false)).not.toContain("store");
  });
});

describe("Ask Sage chat", () => {
  beforeEach(() => {
    runSageCommonsReply.mockReset();
    traceSageReply.mockReset();
    // Stand-in for the real trail wrapper: produce, then publish what it returned.
    traceSageReply.mockImplementation(async (_source, input, produce, publish) => {
      const out = await produce(input.message, input.threadContext);
      await publish(out.reply);
    });
  });

  it("saves the question and Sage's answer and uses one message", async () => {
    const { db, uses, chat } = fakeDb();
    runSageCommonsReply.mockResolvedValue({ reply: "The food drive needs two more drivers this Saturday." });
    const result = await sendSageChatMessage(db, { userId: USER, coopId: COOP, content: "What needs help right now?", now: NOW });
    expect(result.status).toBe("SENT");
    expect(result.messages.map((m) => [m.fromSage, m.body])).toEqual([
      [false, "What needs help right now?"], [true, "The food drive needs two more drivers this Saturday."],
    ]);
    expect(chat).toHaveLength(2);
    expect(uses).toEqual([expect.objectContaining({ source: "CHAT", paid: false })]);
    expect(runSageCommonsReply.mock.calls[0]![0]).toMatchObject({ channel: "chat", memberName: "Dana" });
  });

  it("doesn't save or call the model when the member is out of messages", async () => {
    const { db, chat } = fakeDb();
    await useFree(db, SAGE_FREE_MESSAGES_PER_MONTH);
    const result = await sendSageChatMessage(db, { userId: USER, coopId: COOP, content: "One more?", now: NOW });
    expect(result).toEqual({ status: "OUT_OF_MESSAGES", messages: [] });
    expect(chat).toHaveLength(0);
    expect(runSageCommonsReply).not.toHaveBeenCalled();
  });

  it("gives the message back and keeps nothing when Sage fails", async () => {
    const { db, uses, chat } = fakeDb();
    runSageCommonsReply.mockRejectedValue(new Error("model down"));
    await expect(sendSageChatMessage(db, { userId: USER, coopId: COOP, content: "Hello?", now: NOW }))
      .rejects.toThrow("That message didn't count");
    expect(uses).toHaveLength(0);
    expect(chat).toHaveLength(0);
  });

  it("doesn't count a fixed reply that never reached the model", async () => {
    const { db, uses, chat } = fakeDb();
    traceSageReply.mockImplementation(async (_source, _input, _produce, publish) => publish("That looks like code."));
    const result = await sendSageChatMessage(db, { userId: USER, coopId: COOP, content: "const x = 1;", now: NOW });
    expect(result.status).toBe("SENT");
    expect(uses).toHaveLength(0);
    expect(chat.map((row) => row.role)).toEqual(["MEMBER", "SAGE"]);
  });

  it("builds the snapshot from member-visible data only, without names", async () => {
    const { db } = fakeDb();
    db.commonsPost.findMany.mockResolvedValue([{
      title: "Rides to the clinic", content: "Anyone driving Tuesday?", tag: "Need", createdAt: NOW, _count: { comments: 1 },
    }]);
    db.proposal.findMany.mockResolvedValue([{ title: "Buy a shared van", status: "VOTABLE" }]);
    const snapshot = await buildCommunitySnapshot(db, COOP, NOW);
    expect(snapshot).toContain('"Rides to the clinic": Anyone driving Tuesday? (1 reply)');
    expect(snapshot).toContain("Buy a shared van (voting open)");
    const postWhere = db.commonsPost.findMany.mock.calls[0]![0].where;
    expect(postWhere.OR).toEqual([{ circleId: null }, { circleId: `general:${COOP}` }]);
    expect(db.commonsPost.findMany.mock.calls[0]![0].select.author).toBeUndefined();
  });
});
