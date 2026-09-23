import type { Context } from "../context.js";
import { COMMONS_COOP_ID, ensureCommonsMembership } from "./commons.js";

/** The role marker stamped on every Sage bot account, on both `User.roles`
 * and its per-coop `UserCoopMembership.roles`. Use this (with `isBot`) to
 * recognize a Sage account instead of matching on handle, since each coop
 * now gets its own distinct Sage `User` row and handle. */
export const SAGE_ROLE = "sage";

// Kept for the original Commons ("cahootz") so its existing Sage account,
// mentions, and DM history keep resolving under the same identity.
export const SAGE_HANDLE = "sage";
export const SAGE_EMAIL = "sage@bot.cahootz.internal";

type BotDb = Pick<Context["db"], "user" | "userCoopMembership">;

export function sageHandleForCoop(coopId: string): string {
  return coopId === COMMONS_COOP_ID ? SAGE_HANDLE : `sage-${coopId}`;
}

export function sageEmailForCoop(coopId: string): string {
  return coopId === COMMONS_COOP_ID
    ? SAGE_EMAIL
    : `sage-${coopId}@bot.cahootz.internal`;
}

export function isSageUser(user: { isBot: boolean; roles: string[] }): boolean {
  return user.isBot && user.roles.includes(SAGE_ROLE);
}

/**
 * Lazily creates (once per coop) that coop's own Sage bot User row, and
 * gives it an active membership in that Commons so it surfaces in
 * member/mention pickers there. Handle/email are per-coop and globally
 * unique (`sage` / `sage-<coopId>`); email is used as the upsert anchor
 * since `handle` is nullable and Prisma upsert needs a non-null unique
 * field. `roles` carries the `"sage"` marker on both the User and its
 * coop membership so other code can recognize Sage by role instead of
 * by handle.
 */
export async function ensureSageBotUser(db: BotDb, coopId: string) {
  const handle = sageHandleForCoop(coopId);
  const email = sageEmailForCoop(coopId);

  const existing = await db.user.findUnique({ where: { handle } });
  const sage =
    existing ??
    (await db.user.upsert({
      where: { email },
      create: {
        email,
        handle,
        name: "Sage",
        isBot: true,
        status: "ACTIVE",
        profileCompleted: true,
        roles: ["member", SAGE_ROLE],
      },
      update: { isBot: true, handle },
    }));

  await ensureCommonsMembership(db, sage.id, coopId, ["member", SAGE_ROLE]);

  return sage;
}
