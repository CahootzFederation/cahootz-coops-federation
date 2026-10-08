/**
 * E2E fixture for Sage's "Should we invite them?" (apps/mobile/e2e/sage-person-invite.spec.ts).
 * Not part of the product; only the Playwright spec calls it.
 *
 *   mentions <familyName> <memberEmail> <personName> <runId>
 *     Records that the member mentioned <personName> in three of the family's posts, the way the
 *     Commons action agent does after reading them (minus the model call, which is live-model work
 *     and is unit-tested), then runs Sage's real decision of whether and whom to ask. Prints the
 *     suggestion id and who was asked.
 *
 * Cleanup is `e2e-family-commons.ts cleanup <familyName>`, which removes the family with its
 * suggestions, mentions and invitations. Prints one JSON line prefixed with "E2E_RESULT ".
 * Refuses production, non-local databases, non-test accounts and non-"E2E Family" commons.
 */
import { db } from "../../../packages/db/index.js";
import { maybeSuggestPersonInvite, recordPersonMentions } from "../../../packages/trpc/src/services/sage-person-mentions.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the person-invite fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the person-invite fixture against non-local database host "${host}"`);
  }
}

async function mentions(familyName: string, memberEmail: string, personName: string, runId: string) {
  if (!familyName.startsWith("E2E Family")) throw new Error("Only E2E Family commons can be used");
  if (!memberEmail.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can be used");
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  const config = await db.coopConfig.findFirst({ where: { name: familyName, joinPolicy: "INVITE_ONLY", isActive: true }, select: { coopId: true } });
  if (!config) throw new Error(`${familyName} not found`);
  const member = await db.user.findUnique({ where: { email: memberEmail }, select: { id: true } });
  if (!member) throw new Error(`${memberEmail} not found`);

  let nameKey = "";
  for (const index of [1, 2, 3]) {
    const [key] = await recordPersonMentions({
      coopId: config.coopId, mentionedById: member.id, sourceType: "commons_post", sourceId: `e2e-mention-${runId}-${index}`,
      people: [{ name: personName, relation: "aunt" }],
    });
    nameKey = key ?? nameKey;
  }
  if (!nameKey) throw new Error(`"${personName}" isn't a name Sage would track`);
  const result = await maybeSuggestPersonInvite(config.coopId, nameKey);
  if (!result.actionId) throw new Error(`Sage didn't ask: ${result.reason}`);
  return { coopId: config.coopId, nameKey, ...result };
}

async function main() {
  assertSafeEnvironment();
  const [command, ...args] = process.argv.slice(2);
  if (command !== "mentions" || args.length !== 4) {
    throw new Error("Usage: e2e-sage-person-invite.ts mentions <familyName> <memberEmail> <personName> <runId>");
  }
  const result = await mentions(args[0]!, args[1]!, args[2]!, args[3]!);
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
