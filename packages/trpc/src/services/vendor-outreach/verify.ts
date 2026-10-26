import { promises as dns } from "node:dns";

import type { Context } from "../../context.js";

type Db = Context["db"];

/** Don't contact the same business again within this many days, from any campaign. */
export const RECONTACT_AFTER_DAYS = 90;
const DAY_MS = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type MxResolver = (domain: string) => Promise<boolean>;

/** True when the domain has a mail server. A lookup that fails or hangs counts as no. */
export const resolveMailServer: MxResolver = async (domain) => {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return records.length > 0;
  } catch {
    return false;
  }
};

export type SkipReason =
  | "NO_EMAIL"
  | "BAD_EMAIL"
  | "NO_MAIL_SERVER"
  | "UNSUBSCRIBED"
  | "SUPPRESSED"
  | "CONTACTED_RECENTLY"
  | "DECLINED_RECENTLY"
  | "ALREADY_TALKING";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  NO_EMAIL: "No email found (phone only)",
  BAD_EMAIL: "Email doesn't look right",
  NO_MAIL_SERVER: "Email domain can't receive mail",
  UNSUBSCRIBED: "Unsubscribed",
  SUPPRESSED: "On the do-not-email list",
  CONTACTED_RECENTLY: "Contacted in the last 90 days",
  DECLINED_RECENTLY: "Said not right now",
  ALREADY_TALKING: "Already talking with us",
};

/**
 * Can this business be emailed? Checked in code before anything is queued and
 * again right before sending, so a business that unsubscribed in between is
 * never emailed.
 */
export async function verifyProspect(
  db: Db,
  prospect: {
    email: string | null;
    domain: string | null;
    status: string;
    lastContactedAt: Date | null;
    declinedUntil: Date | null;
  },
  options: { now?: Date; resolveMx?: MxResolver; checkMx?: boolean } = {},
): Promise<{ ok: true } | { ok: false; reason: SkipReason }> {
  const now = options.now ?? new Date();
  if (prospect.status === "UNSUBSCRIBED") return { ok: false, reason: "UNSUBSCRIBED" };
  if (["INTERESTED", "IN_TALKS", "CONVERTED"].includes(prospect.status)) return { ok: false, reason: "ALREADY_TALKING" };
  if (!prospect.email) return { ok: false, reason: "NO_EMAIL" };
  const email = prospect.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, reason: "BAD_EMAIL" };
  const emailDomain = email.split("@")[1]!;

  const suppressed = await db.outreachSuppression.findFirst({
    where: { OR: [{ email }, { domain: emailDomain }, ...(prospect.domain ? [{ domain: prospect.domain }] : [])] },
    select: { reason: true },
  });
  if (suppressed) return { ok: false, reason: suppressed.reason === "UNSUBSCRIBED" ? "UNSUBSCRIBED" : "SUPPRESSED" };
  if (prospect.declinedUntil && prospect.declinedUntil > now) return { ok: false, reason: "DECLINED_RECENTLY" };
  if (prospect.lastContactedAt && prospect.lastContactedAt.getTime() > now.getTime() - RECONTACT_AFTER_DAYS * DAY_MS) {
    return { ok: false, reason: "CONTACTED_RECENTLY" };
  }
  if (options.checkMx !== false && !(await (options.resolveMx ?? resolveMailServer)(emailDomain))) {
    return { ok: false, reason: "NO_MAIL_SERVER" };
  }
  return { ok: true };
}
