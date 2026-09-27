/**
 * Member activity tracking for the new-member drip.
 *
 * `User.lastActiveAt` is written from `accountAuthenticatedProcedure`, i.e.
 * only after a session token has been verified. It is deliberately NOT
 * written from the wallet-header `authenticatedProcedure`: that header is an
 * unverified claim, so honoring it would let anyone mark someone else as
 * "active" and silence their drip.
 */

/** Write `lastActiveAt` at most once per this interval per user. */
export const ACTIVITY_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export function shouldTouchActivity(
  lastActiveAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastActiveAt) return true;
  return now.getTime() - lastActiveAt.getTime() >= ACTIVITY_TOUCH_INTERVAL_MS;
}

type ActivityDb = {
  user: {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: { lastActiveAt: Date };
    }) => Promise<unknown>;
  };
};

/**
 * Records that the member used the app, unless it was already recorded in
 * the last 15 minutes. The caller passes the `lastActiveAt` it already
 * loaded, so a fresh value costs no extra query. The write re-checks the
 * threshold in SQL so concurrent requests collapse into one update. Never
 * throws: activity tracking must not fail the request it rides on.
 */
export async function touchMemberActivity(
  db: ActivityDb,
  user: { id: string; lastActiveAt?: Date | null },
  now: Date = new Date(),
): Promise<void> {
  if (!shouldTouchActivity(user.lastActiveAt, now)) return;
  const staleBefore = new Date(now.getTime() - ACTIVITY_TOUCH_INTERVAL_MS);
  try {
    await db.user.updateMany({
      where: {
        id: user.id,
        OR: [{ lastActiveAt: null }, { lastActiveAt: { lte: staleBefore } }],
      },
      data: { lastActiveAt: now },
    });
  } catch (error) {
    console.warn("[activity] Could not record member activity", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
