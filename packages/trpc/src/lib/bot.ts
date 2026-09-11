import type { Context } from "../context.js";
import { ensureCommonsMembership } from "./commons.js";

export const SAGE_HANDLE = "sage";
export const SAGE_EMAIL = "sage@bot.cahootz.internal";

type BotDb = Pick<Context["db"], "user" | "userCoopMembership">;

/**
 * Lazily creates (once) the single global Sage bot User row, and gives it an
 * active membership in the default Commons so it surfaces in member/mention
 * pickers there. Handle is the identity mention-resolution keys off; email is
 * used as the upsert anchor since `handle` is nullable and Prisma upsert
 * needs a non-null unique field.
 */
export async function ensureSageBotUser(db: BotDb) {
  const existing = await db.user.findUnique({ where: { handle: SAGE_HANDLE } });
  const sage =
    existing ??
    (await db.user.upsert({
      where: { email: SAGE_EMAIL },
      create: {
        email: SAGE_EMAIL,
        handle: SAGE_HANDLE,
        name: "Sage",
        isBot: true,
        status: "ACTIVE",
        profileCompleted: true,
      },
      update: { isBot: true, handle: SAGE_HANDLE },
    }));

  await ensureCommonsMembership(db, sage.id);

  return sage;
}
