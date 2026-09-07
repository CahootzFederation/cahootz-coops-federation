/**
 * Platform-wide admin allowlist. This is distinct from per-coop blockchain
 * admin roles (see services/admin-verification.ts) — a platform admin can
 * see and manage every commons, not just one they hold a role on.
 *
 * Values come from env vars (never committed to git — see .env.example),
 * not hardcoded here, since this file is a regular tracked source file.
 * Set PLATFORM_ADMIN_WALLETS / PLATFORM_ADMIN_EMAILS as comma-separated
 * lists in apps/api/.env and apps/web/.env (both processes import this
 * module, so both need the vars set) to grant access to /portal/admin.
 */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export const PLATFORM_ADMIN_WALLETS: string[] = parseList(process.env.PLATFORM_ADMIN_WALLETS);

export const PLATFORM_ADMIN_EMAILS: string[] = parseList(process.env.PLATFORM_ADMIN_EMAILS);

export function isPlatformAdminWallet(address?: string | null): boolean {
  if (!address) return false;
  return PLATFORM_ADMIN_WALLETS.includes(address.toLowerCase());
}

export function isPlatformAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase());
}

export function isPlatformAdmin(identity: {
  address?: string | null;
  email?: string | null;
}): boolean {
  return isPlatformAdminWallet(identity.address) || isPlatformAdminEmail(identity.email);
}
