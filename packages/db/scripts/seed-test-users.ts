/**
 * Bulk-create throwaway test users for a Commons, so multiple simulators/
 * phones can each be signed in as a different person (e.g. to exercise the
 * @mention system with several real, independent sessions).
 *
 * Seeded users authenticate with the frictionless test-login bypass in
 * packages/trpc/src/routers/auth.ts (isTestLogin): email matching
 * *@test.cahootz.local + code "000000", no email/SMS required, non-production only.
 *
 * Usage:
 *   pnpm --filter @repo/db seed:test-users -- --coopId=cahootz --count=6
 *   pnpm --filter @repo/db seed:test-users -- --coopId=soulaan --count=4 --prefix=mention
 */
import * as PrismaClientModule from "@prisma/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PrismaClient =
  (PrismaClientModule as any).PrismaClient ?? (PrismaClientModule as any).default.PrismaClient;

const prisma = new PrismaClient();

const COMMONS_COOP_ID = "cahootz";
const TEST_EMAIL_DOMAIN = "test.cahootz.local";
const TEST_LOGIN_CODE = "000000";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const coopId = args.coopId;
  if (!coopId) {
    console.error("Missing required --coopId=<id> argument.");
    process.exit(1);
  }

  const count = Number.parseInt(args.count ?? "10", 10);
  if (!Number.isInteger(count) || count < 1) {
    console.error(`Invalid --count value: ${args.count}`);
    process.exit(1);
  }

  const prefix = args.prefix ?? "tester";

  const isDefaultCommons = coopId === COMMONS_COOP_ID;

  if (!isDefaultCommons) {
    const coopConfig = await prisma.coopConfig.findFirst({
      where: { coopId, isActive: true },
    });

    if (!coopConfig) {
      const existing = await prisma.coopConfig.findMany({
        distinct: ["coopId"],
        select: { coopId: true },
      });
      console.error(`No active CoopConfig found for coopId "${coopId}".`);
      console.error(
        `Existing coopIds: ${existing.map((c: { coopId: string }) => c.coopId).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }
  }

  const now = new Date();
  const summary: { email: string; handle: string }[] = [];

  for (let i = 1; i <= count; i++) {
    const email = `${prefix}${i}@${TEST_EMAIL_DOMAIN}`;
    const handle = `${prefix}${i}`;

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: `Test User ${i}`,
        handle,
        status: "ACTIVE",
        roles: ["member"],
      },
      update: {
        status: "ACTIVE",
      },
    });

    if (isDefaultCommons) {
      await prisma.userCoopMembership.upsert({
        where: { userId_coopId: { userId: user.id, coopId } },
        create: {
          userId: user.id,
          coopId,
          status: "ACTIVE",
          roles: ["member"],
          joinedAt: now,
          lastActiveAt: now,
        },
        update: { status: "ACTIVE", lastActiveAt: now },
      });
    } else {
      const existingWallet = await prisma.wallet.findFirst({ where: { userId: user.id, isPrimary: true } });

      if (!existingWallet) {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);

        // Test-only fixture wallet: only its address is used (login only checks
        // that a wallet exists, it never signs anything), so the private key is
        // discarded rather than stored — same convention as seed-demo-data.ts.
        await prisma.wallet.create({
          data: {
            userId: user.id,
            address: account.address,
            chain: "base-sepolia",
            walletType: "EXTERNAL",
            isPrimary: true,
            verifiedAt: now,
          },
        });
      }

      await prisma.userCoopMembership.upsert({
        where: { userId_coopId: { userId: user.id, coopId } },
        create: {
          userId: user.id,
          coopId,
          status: "ACTIVE",
          roles: ["member"],
          joinedAt: now,
          lastActiveAt: now,
        },
        update: { status: "ACTIVE", lastActiveAt: now },
      });
    }

    summary.push({ email, handle });
  }

  console.log(`\nSeeded ${summary.length} test user(s) into Commons "${coopId}":\n`);
  console.table(summary);
  console.log(`Log in on any device with the email above and code "${TEST_LOGIN_CODE}".\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
