/**
 * E2E fixture for the platform admin journey (apps/mobile/e2e/admin-commons-ai.spec.ts). Not part of
 * the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-admin.ts login-code <email>
 *     Issues a one-time admin login code for a seeded test admin (an @test.cahootz.local address on
 *     the PLATFORM_ADMIN_EMAILS allowlist), standing in for the email a real admin would receive.
 *     The admin still signs in through the real login page.
 *   tsx --import ./dotenv.config.js scripts/e2e-admin.ts reset-limits <coopId>
 *     Puts the Commons' Sage autonomy limits back to the defaults.
 *   tsx --import ./dotenv.config.js scripts/e2e-admin.ts outreach-cleanup <memberEmail>
 *     Deletes the Sage check-ins an admin sent this test member by hand, and their message alerts.
 *   tsx --import ./dotenv.config.js scripts/e2e-admin.ts dev-issue-seed <tag>
 *     Saves two Sage issue-idea drafts (one clean, one blocked by the privacy check) and prints the
 *     current cadence setting so cleanup can put it back.
 *   tsx --import ./dotenv.config.js scripts/e2e-admin.ts dev-issue-cleanup <tag> <WEEKLY|MONTHLY|none>
 *     Deletes the tagged drafts and restores the cadence setting ("none" removes it).
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { randomInt } from "node:crypto";
import { db } from "../../../packages/db/index.js";
import { isPlatformAdminEmail } from "../../../packages/trpc/src/lib/admin-config.js";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the admin fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the admin fixture against non-local database host "${host}"`);
  }
}

async function loginCode(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[a-z0-9_-]+@test\.cahootz\.local$/.test(normalized)) throw new Error("Only seeded test accounts can get a fixture login code");
  if (!isPlatformAdminEmail(normalized)) throw new Error(`${normalized} is not on PLATFORM_ADMIN_EMAILS; add it for local and CI E2E runs`);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.loginCode.create({ data: { email: normalized, code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  return { code };
}

async function resetLimits(coopId: string) {
  await db.commonsAgentSetting.updateMany({
    where: { coopId }, data: { autonomyMonthlyUsdLimit: 5, autonomyMonthlyCallLimit: 2000 },
  });
  return { reset: true };
}

async function outreachCleanup(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith("@test.cahootz.local")) throw new Error("Only seeded test accounts are allowed");
  const user = await db.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!user) return { deleted: 0 };
  const comments = await db.groupComment.findMany({
    where: { systemKey: { startsWith: `sage-weekly:${user.id}:manual-` } }, select: { id: true, groupId: true, createdAt: true },
  });
  for (const comment of comments) {
    await db.notification.deleteMany({
      where: { userId: user.id, type: "DIRECT_MESSAGE", createdAt: { gte: comment.createdAt }, data: { path: ["groupId"], equals: comment.groupId } },
    });
  }
  await db.groupComment.deleteMany({ where: { id: { in: comments.map((comment) => comment.id) } } });
  return { deleted: comments.length };
}

const DEV_ISSUE_CADENCE_KEY = "sage.devIssueCadence";

async function devIssueSeed(tag: string) {
  if (!/^[a-z0-9-]+$/i.test(tag)) throw new Error("Use a plain tag");
  const cadence = await db.platformConfig.findUnique({ where: { key: DEV_ISSUE_CADENCE_KEY } });
  const window = { windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), windowEnd: new Date() };
  const body = "## What members are running into\nE2E: the ride board looks empty.\n\n## What we're seeing\n- 2 in-app reports from 2 members (2 bug reports)";
  await db.sageDevIssueDraft.create({
    data: { periodKey: `E2E-${tag}-flagged`, cadence: "WEEKLY", title: `E2E ${tag} flagged idea`, body, evidence: {}, privacyFlags: ["Names a member or a Commons"], ...window },
  });
  await db.sageDevIssueDraft.create({
    data: { periodKey: `E2E-${tag}-clean`, cadence: "WEEKLY", title: `E2E ${tag} ride board looks empty`, body, evidence: {}, ...window },
  });
  return { cadence: cadence?.value ?? "none" };
}

async function devIssueCleanup(tag: string, cadence: string) {
  const { count } = await db.sageDevIssueDraft.deleteMany({ where: { periodKey: { startsWith: `E2E-${tag}-` } } });
  if (cadence === "WEEKLY" || cadence === "MONTHLY") {
    await db.platformConfig.update({ where: { key: DEV_ISSUE_CADENCE_KEY }, data: { value: cadence } });
  } else {
    await db.platformConfig.deleteMany({ where: { key: DEV_ISSUE_CADENCE_KEY } });
  }
  return { deleted: count };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second] = process.argv.slice(2);
  const result =
    command === "login-code" && first ? await loginCode(first)
      : command === "reset-limits" && first ? await resetLimits(first)
        : command === "outreach-cleanup" && first ? await outreachCleanup(first)
          : command === "dev-issue-seed" && first ? await devIssueSeed(first)
            : command === "dev-issue-cleanup" && first && second ? await devIssueCleanup(first, second)
              : (() => { throw new Error("Usage: e2e-admin.ts login-code <email> | reset-limits <coopId> | outreach-cleanup <memberEmail> | dev-issue-seed <tag> | dev-issue-cleanup <tag> <cadence>"); })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
