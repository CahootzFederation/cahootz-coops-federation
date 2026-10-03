import { createHash, randomBytes } from "node:crypto";

import { isValidE164, toE164 } from "./phone.js";

/**
 * Commons invitation tokens are 256-bit random values, so a plain SHA-256 is
 * enough to make the stored hash useless to anyone who reads the table (no
 * salt or slow hash needed; there's nothing to brute-force). Only the hash is
 * stored; the raw token exists in the invitation link and nowhere else.
 */
export function createInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function normalizeInvitationEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeInvitationPhone(phone: string | null | undefined) {
  const normalized = toE164(phone);
  return normalized && isValidE164(normalized) ? normalized : null;
}

/** "maya@example.com" -> "m***@example.com", "+15105551234" -> "•••• 1234". */
export function maskInvitationContact(invitation: {
  recipientEmailNormalized: string | null;
  recipientPhoneNormalized: string | null;
}) {
  if (invitation.recipientEmailNormalized) {
    const [local, domain] = invitation.recipientEmailNormalized.split("@");
    return `${local?.[0] ?? ""}***@${domain ?? ""}`;
  }
  if (invitation.recipientPhoneNormalized) {
    return `•••• ${invitation.recipientPhoneNormalized.slice(-4)}`;
  }
  return null;
}
