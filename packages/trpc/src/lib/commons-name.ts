import { TRPCError } from "@trpc/server";

/** Trims a commons name and collapses runs of whitespace to one space. */
export function cleanCommonsName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** The form two names are compared in: "The  Mae Clan" and "the mae clan" collide. */
export function commonsNameKey(name: string): string {
  return cleanCommonsName(name).toLowerCase();
}

/**
 * Every commons (families included) needs a name no other commons uses, so
 * people can tell them apart in lists, invitations and emails.
 *
 * Call this inside the transaction that writes the name: the advisory lock
 * holds until that transaction ends, so two people racing to create the same
 * name can't both pass the check. `exceptCoopId` lets a commons keep its own
 * name when something else about it changes.
 */
export async function assertCommonsNameAvailable(
  tx: any,
  name: string,
  options: { exceptCoopId?: string } = {},
): Promise<void> {
  const cleaned = cleanCommonsName(name);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commons-name:${commonsNameKey(cleaned)}`}))`;

  const taken = await tx.coopConfig.findFirst({
    where: {
      isActive: true,
      name: { equals: cleaned, mode: "insensitive" },
      ...(options.exceptCoopId ? { coopId: { not: options.exceptCoopId } } : {}),
    },
    select: { id: true },
  });

  if (taken) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `The name "${cleaned}" is already taken. Try another one.`,
    });
  }
}
