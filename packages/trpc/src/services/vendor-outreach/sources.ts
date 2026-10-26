import { TRPCError } from "@trpc/server";

import { db as defaultDb } from "@repo/db";

import { auditLogEntry } from "../../lib/audit.js";

type Db = typeof defaultDb;

/**
 * Where Sage may look for businesses. Shops on Cahootz, member recommendations
 * and web search are built in. Sage can suggest more (a chamber of commerce
 * directory, a farmers market vendor list); a suggestion does nothing until a
 * platform admin enables it.
 */
export async function enabledSourceTypes(db: Db = defaultDb) {
  const sources = await db.prospectSource.findMany({ where: { status: "ENABLED" }, select: { type: true } });
  return new Set(sources.map((source) => source.type));
}

/** Enabled directory sites, used as search hints ("site:example.org"). */
export async function enabledDirectoryHints(db: Db = defaultDb) {
  const sources = await db.prospectSource.findMany({ where: { status: "ENABLED", type: "DIRECTORY_SITE" }, select: { name: true, config: true } });
  return sources.flatMap((source) => {
    const domain = (source.config as { domain?: unknown })?.domain;
    return typeof domain === "string" && domain ? [{ name: source.name, domain }] : [];
  });
}

/** Sage suggests a place to look. Duplicate names are ignored. */
export async function suggestSource(db: Db, input: { name: string; domain: string; reason: string }) {
  const domain = input.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().slice(0, 120);
  if (!domain.includes(".")) return null;
  try {
    return await db.prospectSource.create({
      data: { type: "DIRECTORY_SITE", name: input.name.slice(0, 120), config: { domain }, suggestedBy: "sage", reason: input.reason.slice(0, 300), status: "SUGGESTED" },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return null;
    throw error;
  }
}

export async function listSourcesForAdmin(db: Db = defaultDb) {
  return db.prospectSource.findMany({ orderBy: [{ status: "asc" }, { createdAt: "asc" }] });
}

export async function setSourceStatus(db: Db, actorId: string, sourceId: string, status: "ENABLED" | "DISABLED") {
  const source = await db.prospectSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that source." });
  await db.prospectSource.update({ where: { id: sourceId }, data: { status } });
  await db.auditLog.create({
    data: auditLogEntry({ actorId, action: status === "ENABLED" ? "PROSPECT_SOURCE_ENABLED" : "PROSPECT_SOURCE_DISABLED", resource: "ProspectSource", resourceId: sourceId }),
  });
}
