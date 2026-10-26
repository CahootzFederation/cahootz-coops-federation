import { vi } from "vitest";

/**
 * A small in-memory stand-in for the Prisma calls the vendor outreach services
 * make. Supports equality, in/notIn/not, lt/lte/gt/gte, OR, relation filters by
 * a foreign key, increments, count, groupBy and unique-key violations.
 */
type Row = Record<string, any>;

const RELATIONS: Record<string, { table: string; key: string }> = {
  campaignProspect: { table: "campaignProspect", key: "campaignProspectId" },
  campaign: { table: "vendorCampaign", key: "campaignId" },
  prospect: { table: "vendorProspect", key: "prospectId" },
};

const UNIQUE: Record<string, string[][]> = {
  vendorCampaign: [["demandActionId"]],
  campaignProspect: [["campaignId", "prospectId"], ["replyTokenHash"]],
  outreachMessage: [["campaignProspectId", "step"]],
  outreachSuppression: [["email"], ["domain"]],
  vendorProspect: [["emailNormalized"]],
  prospectSource: [["name"]],
};

/** Column defaults from the Prisma schema that the services rely on. */
const DEFAULTS: Record<string, Row> = {
  vendorCampaign: { status: "PROPOSED", maxEmails: 10, maxSearches: 5, searchesUsed: 0, discoveredAt: null, area: null, pitchPoints: null, offerType: "GROUP_BUY" },
  vendorProspect: { status: "FOUND", lastContactedAt: null, declinedUntil: null, convertedOfferId: null },
  campaignProspect: { status: "QUEUED", personalLine: null, replyTokenHash: null },
  prospectSource: { status: "SUGGESTED", config: {} },
};

export function createFakeOutreachDb() {
  const tables: Record<string, Row[]> = {};
  const rows = (table: string) => (tables[table] ??= []);
  let counter = 0;

  const matches = (row: Row, where: Row | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") return (condition as Row[]).some((w) => matches(row, w));
      if (key === "AND") return (condition as Row[]).every((w) => matches(row, w));
      const relation = RELATIONS[key];
      if (relation && condition && typeof condition === "object" && !(key in row && typeof row[key] !== "object")) {
        const target = rows(relation.table).find((candidate) => candidate.id === row[relation.key]);
        return !!target && matches(target, condition);
      }
      const value = row[key];
      if (condition !== null && typeof condition === "object" && !(condition instanceof Date) && !Array.isArray(condition)) {
        const c = condition as Row;
        if ("in" in c && !c.in.includes(value)) return false;
        if ("notIn" in c && c.notIn.includes(value)) return false;
        if ("not" in c && (c.not === null ? value == null : value === c.not)) return false;
        if ("lt" in c && !(value != null && value < c.lt)) return false;
        if ("lte" in c && !(value != null && value <= c.lte)) return false;
        if ("gt" in c && !(value != null && value > c.gt)) return false;
        if ("gte" in c && !(value != null && value >= c.gte)) return false;
        if ("startsWith" in c && !String(value ?? "").startsWith(c.startsWith)) return false;
        return true;
      }
      return condition === undefined ? true : value === condition;
    });
  };

  const findByWhere = (table: string, where: Row) => {
    const compound = Object.entries(where).find(([key, value]) => key.includes("_") && value && typeof value === "object");
    return rows(table).find((row) => matches(row, compound ? compound[1] : where));
  };

  const withIncludes = (table: string, row: Row, include?: Row) => {
    const out: Row = { ...row };
    if (!include) return out;
    for (const [key, spec] of Object.entries(include)) {
      if (!spec) continue;
      if (key === "prospect") out.prospect = { ...rows("vendorProspect").find((p) => p.id === row.prospectId) };
      else if (key === "campaign") out.campaign = { ...rows("vendorCampaign").find((c) => c.id === row.campaignId) };
      else if (key === "prospects") out.prospects = rows("campaignProspect").filter((cp) => cp.campaignId === row.id).map((cp) => withIncludes("campaignProspect", cp, (spec as Row).select ?? (spec as Row).include));
      else if (key === "responses") out.responses = rows("vendorResponse").filter((r) => (table === "vendorProspect" ? r.prospectId === row.id : r.campaignProspectId === row.id)).sort((a, b) => b.respondedAt - a.respondedAt).slice(0, (spec as Row).take ?? 100);
      else if (key === "referrals") out.referrals = rows("vendorReferral").filter((r) => r.prospectId === row.id).map((r) => ({ ...r, referredBy: { name: r.referrerName ?? null, email: null } }));
    }
    return out;
  };

  const assertUnique = (table: string, row: Row, ignoreId?: string) => {
    for (const keys of UNIQUE[table] ?? []) {
      if (rows(table).some((other) => other.id !== ignoreId && keys.every((k) => row[k] != null && other[k] === row[k]))) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
    }
  };

  const applyData = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value) row[key] = (row[key] ?? 0) + (value as Row).increment;
      else row[key] = value;
    }
    row.updatedAt = new Date();
  };

  const model = (table: string) => ({
    findUnique: vi.fn(async ({ where, include, select }: Row) => {
      const row = findByWhere(table, where);
      return row ? withIncludes(table, row, include ?? select) : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where, include }: Row) => {
      const row = findByWhere(table, where);
      if (!row) throw new Error(`${table} not found`);
      return withIncludes(table, row, include);
    }),
    findFirst: vi.fn(async ({ where, include, select, orderBy }: Row = {}) => {
      void orderBy;
      const row = rows(table).find((r) => matches(r, where));
      return row ? withIncludes(table, row, include ?? select) : null;
    }),
    findMany: vi.fn(async ({ where, include, select, take }: Row = {}) =>
      rows(table).filter((r) => matches(r, where)).slice(0, take ?? 10_000).map((r) => withIncludes(table, r, include ?? select)),
    ),
    count: vi.fn(async ({ where }: Row = {}) => rows(table).filter((r) => matches(r, where)).length),
    create: vi.fn(async ({ data }: Row) => {
      const row: Row = { id: `${table}_${++counter}`, createdAt: new Date(), updatedAt: new Date(), ...DEFAULTS[table], ...data };
      assertUnique(table, row);
      rows(table).push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const row = findByWhere(table, where);
      if (!row) throw new Error(`${table} not found`);
      applyData(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const hit = rows(table).filter((r) => matches(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: Row) => {
      const row = findByWhere(table, where);
      if (row) {
        applyData(row, update);
        return { ...row };
      }
      const created: Row = { id: `${table}_${++counter}`, createdAt: new Date(), ...create };
      rows(table).push(created);
      return created;
    }),
    groupBy: vi.fn(async ({ by, where }: Row) => {
      const groups = new Map<string, number>();
      rows(table).filter((r) => matches(r, where)).forEach((r) => groups.set(r[by[0]], (groups.get(r[by[0]]) ?? 0) + 1));
      return [...groups.entries()].map(([key, n]) => ({ [by[0]]: key, _count: { _all: n } }));
    }),
  });

  const names = [
    "commonsAction", "vendorCampaign", "vendorProspect", "vendorReferral", "prospectSource", "campaignProspect", "outreachMessage",
    "outreachSuppression", "vendorResponse", "auditLog", "store", "coopConfig", "platformConfig", "marketplaceOffer",
  ];
  const db: any = { tables };
  for (const name of names) db[name] = model(name);
  return db;
}
