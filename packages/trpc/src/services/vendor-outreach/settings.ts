import type { Context } from "../../context.js";

type Db = Pick<Context["db"], "platformConfig">;

export const POSTAL_ADDRESS_KEY = "outreach.postalAddress";

/** The outreach sender and reply inbox are set. Loads no email client, so the web app can call it. */
export function outreachSenderConfigured() {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_OUTREACH_FROM_EMAIL && !!process.env.OUTREACH_REPLY_TO_EMAIL;
}

/**
 * Real email goes out only when the outreach sender, reply inbox and mailing
 * address are all set. Until then every email is saved as DRY_RUN, so the
 * whole pipeline can be checked without anything leaving.
 */
export async function outreachSettings(db: Db, senderReady: () => boolean = outreachSenderConfigured) {
  const postal = await db.platformConfig.findUnique({ where: { key: POSTAL_ADDRESS_KEY } }).catch(() => null);
  const postalAddress = postal?.value?.trim() || null;
  return { live: senderReady() && !!postalAddress, postalAddress: postalAddress ?? "[Mailing address not set yet]" };
}
