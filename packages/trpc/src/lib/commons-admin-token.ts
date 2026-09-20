import { createHmac, timingSafeEqual } from "node:crypto";
import { isPlatformAdminEmail, isPlatformAdminWallet } from "./admin-config.js";

const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const TOKEN_SCOPE = "commons-action-admin";

interface AdminTokenPayload {
  scope: typeof TOKEN_SCOPE;
  sub: string;
  userId?: string;
  email?: string;
  address?: string;
  exp: number;
}

function signingSecret(): string {
  const secret = process.env.SESSION_SECRET
    || (process.env.NODE_ENV === "production" ? "" : "complex_password_at_least_32_characters_long_for_development");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be shared by the web and API servers");
  return secret;
}

function allowed(identity: { email?: string | null; address?: string | null }): boolean {
  return isPlatformAdminEmail(identity.email) || isPlatformAdminWallet(identity.address);
}

export function issueCommonsAdminToken(identity: { userId?: string | null; email?: string | null; address?: string | null }): string {
  if (!allowed(identity)) throw new Error("Platform admin access required");
  const payload: AdminTokenPayload = {
    scope: TOKEN_SCOPE,
    sub: identity.userId || identity.email || identity.address || "",
    ...(identity.userId ? { userId: identity.userId } : {}),
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.address ? { address: identity.address } : {}),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyCommonsAdminToken(token: string): AdminTokenPayload | null {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", signingSecret()).update(encoded).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<AdminTokenPayload>;
    if (payload.scope !== TOKEN_SCOPE || typeof payload.sub !== "string" || !payload.sub
      || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)
      || (payload.userId !== undefined && (typeof payload.userId !== "string" || payload.userId !== payload.sub))
      || !allowed(payload)) return null;
    return payload as AdminTokenPayload;
  } catch { return null; }
}
