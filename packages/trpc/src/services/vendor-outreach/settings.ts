import { z } from "zod";

import type { Context } from "../../context.js";
import { auditLogEntry } from "../../lib/audit.js";

type Db = Pick<Context["db"], "platformConfig">;

export const POSTAL_ADDRESS_KEY = "outreach.postalAddress";

/** Real outreach email only ever leaves the live site, never a dev machine, test run or CI. */
export function outreachLiveSite() {
  return process.env.NODE_ENV === "production";
}

/**
 * Outreach can send: the live site with the email service set up. It sends
 * from the same address as every other email unless a separate outreach
 * sender is set. Loads no email client, so the web app can call it.
 */
export function outreachSenderConfigured() {
  return outreachLiveSite() && !!process.env.RESEND_API_KEY;
}

/**
 * Real email goes out only when the sender is ready and the mailing address
 * is set. Until then every email is saved as DRY_RUN, so the whole pipeline
 * can be checked without anything leaving.
 */
export async function outreachSettings(db: Db, senderReady: () => boolean = outreachSenderConfigured) {
  const postal = await db.platformConfig.findUnique({ where: { key: POSTAL_ADDRESS_KEY } }).catch(() => null);
  const postalAddress = postal?.value?.trim() || null;
  const ready = senderReady();
  return {
    live: ready && !!postalAddress,
    senderReady: ready,
    liveSite: outreachLiveSite(),
    savedPostalAddress: postalAddress,
    postalAddress: postalAddress ?? "[Mailing address not set yet]",
  };
}

export const postalAddressSchema = z.object({
  postalAddress: z
    .string()
    // Lines typed on separate rows become one line for the email footer.
    .transform((value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(", ").replace(/\s+/g, " "))
    .pipe(
      z.string()
        .min(10, "Add the full mailing address: street, city, state and ZIP.")
        .max(200, "Keep the mailing address under 200 characters."),
    ),
});

/**
 * Set the mailing address printed at the bottom of every outreach email (US
 * law requires one). The before and after go in the audit log.
 */
export async function updateOutreachPostalAddress(
  db: Pick<Context["db"], "platformConfig" | "auditLog">,
  actorId: string,
  raw: z.input<typeof postalAddressSchema>,
) {
  const { postalAddress } = postalAddressSchema.parse(raw);
  const before = await db.platformConfig.findUnique({ where: { key: POSTAL_ADDRESS_KEY } });
  await db.platformConfig.upsert({
    where: { key: POSTAL_ADDRESS_KEY },
    create: { key: POSTAL_ADDRESS_KEY, value: postalAddress, updatedBy: actorId },
    update: { value: postalAddress, updatedBy: actorId },
  });
  await db.auditLog.create({
    data: auditLogEntry({
      actorId, action: "OUTREACH_POSTAL_ADDRESS_UPDATED", resource: "PlatformConfig", resourceId: POSTAL_ADDRESS_KEY,
      metadata: { before: before?.value ?? null, after: postalAddress },
    }),
  });
  return { postalAddress };
}
