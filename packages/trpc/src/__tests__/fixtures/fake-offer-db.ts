import { vi } from "vitest";

/**
 * A small in-memory stand-in for the Prisma calls the marketplace offer
 * service makes. Supports the where-clause shapes that service uses
 * (equality, in/notIn/not, lte/gt/gte, the `offer` relation filter).
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined, tables: Tables): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((w) => matches(row, w, tables));
    if (key === "offer") return matches(tables.marketplaceOffer.find((o) => o.id === row.offerId) ?? {}, condition, tables);
    if (key === "store") return matches(tables.store.find((s) => s.id === row.storeId) ?? {}, condition, tables);
    if (key === "user") return matches({ isBot: false, ...(tables.user.find((u) => u.id === row.userId) ?? {}) }, condition, tables);
    if (key === "commitments") {
      const some = (condition as Row).some;
      return tables.offerCommitment.some((c) => c.offerId === row.id && matches(c, some, tables));
    }
    const value = row[key];
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as Row;
      if ("in" in c && !c.in.includes(value)) return false;
      if ("notIn" in c && c.notIn.includes(value)) return false;
      if ("not" in c && (c.not === null ? value == null : value === c.not)) return false;
      if ("lte" in c && !(value != null && value <= c.lte)) return false;
      if ("gt" in c && !(value != null && value > c.gt)) return false;
      if ("gte" in c && !(value != null && value >= c.gte)) return false;
      if ("equals" in c && value !== c.equals) return false;
      return true;
    }
    return value === condition;
  });
}

type Tables = {
  marketplaceOffer: Row[];
  offerCommitment: Row[];
  offerNotificationSend: Row[];
  offerDigestSend: Row[];
  platformConfig: Row[];
  notification: Row[];
  auditLog: Row[];
  user: Row[];
  userCoopMembership: Row[];
  store: Row[];
  commerceTransaction: Row[];
  treasuryLedgerEntry: Row[];
};

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++idCounter}`;

function withRelations(tables: Tables, table: keyof Tables, row: Row, include?: Row) {
  if (!include) return { ...row };
  const out: Row = { ...row };
  if (include.store) out.store = tables.store.find((s) => s.id === row.storeId);
  if (include.product) out.product = { id: row.productId, name: "Product", imageUrl: null, kind: "STANDARD" };
  if (include.offer) {
    const offer = tables.marketplaceOffer.find((o) => o.id === row.offerId);
    out.offer = offer ? withRelations(tables, "marketplaceOffer", offer, typeof include.offer === "object" ? include.offer.include ?? include.offer.select : undefined) : null;
  }
  if (include.offerCommitment) out.offerCommitment = tables.offerCommitment.find((c) => c.commerceTransactionId === row.id) ?? null;
  if (include.commitments) {
    const where = typeof include.commitments === "object" ? include.commitments.where : undefined;
    out.commitments = tables.offerCommitment.filter((c) => c.offerId === row.id && matches(c, where, tables));
  }
  void table;
  return out;
}

function model(tables: Tables, table: keyof Tables, prefix: string, uniqueKeys: Array<string[]> = []) {
  const rows = () => tables[table];
  const findByWhere = (where: Row) => {
    const compound = Object.entries(where).find(([, v]) => v && typeof v === "object" && !(v instanceof Date) && !("in" in v) && !("not" in v));
    if (compound && compound[0].includes("_")) return rows().find((r) => matches(r, compound[1], tables));
    return rows().find((r) => matches(r, where, tables));
  };
  const assertUnique = (row: Row, ignoreId?: string) => {
    for (const keys of uniqueKeys) {
      if (rows().some((r) => r.id !== ignoreId && keys.every((k) => r[k] === row[k] && row[k] != null))) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
    }
  };
  return {
    findUnique: vi.fn(async ({ where, include, select }: Row) => {
      const row = findByWhere(where);
      return row ? withRelations(tables, table, row, include ?? select) : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where, include }: Row) => {
      const row = findByWhere(where);
      if (!row) throw new Error("Not found");
      return withRelations(tables, table, row, include);
    }),
    findFirst: vi.fn(async ({ where, include }: Row = {}) => {
      const row = rows().find((r) => matches(r, where, tables));
      return row ? withRelations(tables, table, row, include) : null;
    }),
    findMany: vi.fn(async ({ where, include, select }: Row = {}) =>
      rows().filter((r) => matches(r, where, tables)).map((r) => withRelations(tables, table, r, include ?? select)),
    ),
    create: vi.fn(async ({ data }: Row) => {
      const row = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), ...data };
      assertUnique(row);
      rows().push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const row = findByWhere(where);
      if (!row) throw new Error("Not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const hit = rows().filter((r) => matches(r, where, tables));
      hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
      return { count: hit.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: Row) => {
      const row = findByWhere(where);
      if (row) {
        Object.assign(row, update, { updatedAt: new Date() });
        return { ...row };
      }
      const created = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), ...create };
      assertUnique(created);
      rows().push(created);
      return { ...created };
    }),
    aggregate: vi.fn(async ({ where }: Row) => ({
      _sum: { quantity: rows().filter((r) => matches(r, where, tables)).reduce((s, r) => s + (r.quantity ?? 0), 0) },
    })),
    groupBy: vi.fn(async ({ by, where }: Row) => {
      const groups = new Map<string, Row[]>();
      rows().filter((r) => matches(r, where, tables)).forEach((r) => {
        const key = r[by[0]];
        groups.set(key, [...(groups.get(key) ?? []), r]);
      });
      return [...groups.entries()].map(([key, members]) => ({
        [by[0]]: key,
        _count: { _all: members.length },
        _sum: { savingsCents: members.reduce((s, r) => s + (r.savingsCents ?? 0), 0) },
      }));
    }),
  };
}

export function createFakeOfferDb() {
  const tables: Tables = {
    marketplaceOffer: [],
    offerCommitment: [],
    offerNotificationSend: [],
    offerDigestSend: [],
    platformConfig: [],
    notification: [],
    auditLog: [],
    user: [],
    userCoopMembership: [],
    store: [],
    commerceTransaction: [],
    treasuryLedgerEntry: [],
  };
  const db: any = {
    tables,
    marketplaceOffer: model(tables, "marketplaceOffer", "offer"),
    offerCommitment: model(tables, "offerCommitment", "commit", [["offerId", "userId"], ["commerceTransactionId"]]),
    offerNotificationSend: model(tables, "offerNotificationSend", "send", [["offerId", "userId", "kind"]]),
    offerDigestSend: model(tables, "offerDigestSend", "digest", [["coopId", "userId", "weekKey"]]),
    platformConfig: model(tables, "platformConfig", "config", [["key"]]),
    notification: model(tables, "notification", "note"),
    auditLog: model(tables, "auditLog", "audit"),
    user: model(tables, "user", "user"),
    store: model(tables, "store", "store"),
    commerceTransaction: model(tables, "commerceTransaction", "tx"),
    treasuryLedgerEntry: model(tables, "treasuryLedgerEntry", "led"),
    userCoopMembership: {
      ...model(tables, "userCoopMembership", "mem"),
      findUnique: vi.fn(async ({ where }: Row) => {
        const key = where.userId_coopId;
        return tables.userCoopMembership.find((m) => m.userId === key.userId && m.coopId === key.coopId) ?? null;
      }),
    },
    notificationPreference: { findUnique: vi.fn(async () => null) },
    pushDevice: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    pushTicket: { createMany: vi.fn() },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(db)),
  };
  return db;
}

export function seedOfferWorld(db: any, overrides: Row = {}) {
  const now = Date.now();
  db.tables.store.push({ id: "store_1", name: "Corner Market", ownerId: "vendor_1", status: "APPROVED", deletedAt: null });
  for (const userId of ["member_1", "member_2", "member_3", "steward_1"]) {
    db.tables.user.push({ id: userId, name: userId.replace("_", " "), phone: "555-0100" });
    db.tables.userCoopMembership.push({
      userId,
      coopId: "church",
      status: "ACTIVE",
      roles: userId === "steward_1" ? ["member", "steward"] : ["member"],
    });
  }
  const offer = {
    id: "offer_1",
    offerType: "GROUP_BUY",
    coopId: "church",
    storeId: "store_1",
    productId: "product_1",
    businessId: "biz_1",
    title: "Family rice, 20 lb",
    description: null,
    regularPriceCents: 2400,
    regularPriceSource: "Posted shelf price",
    memberPriceCents: 1800,
    vendorPayoutCents: 1500,
    commonsSplitBps: 5000,
    minimumCommitments: 3,
    minimumPaidOrders: 2,
    maximumQuantity: 5,
    quantityPerMember: 2,
    committedQuantity: 0,
    commitmentDeadline: new Date(now + 24 * 3600 * 1000),
    paymentWindowHours: 72,
    paymentDeadline: null,
    expiresAt: null,
    fulfillmentMethod: "PICKUP",
    pickupLocation: "Church hall",
    status: "LIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  db.tables.marketplaceOffer.push(offer);
  return offer;
}
