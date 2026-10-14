/**
 * Isolated fixture for the default-Commons Playwright journey.
 * Creates a throwaway member in Cahootz and the seeded E2E Market Commons,
 * then removes that account and its login/session records after the test.
 */
// apps/api's local dotenv loader intentionally overrides DATABASE_URL. The
// Playwright journey may point at an isolated database, so restore that
// explicit URL before Prisma is imported and initialized.
if (process.env.E2E_DATABASE_URL_OVERRIDE) {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL_OVERRIDE;
}
const { db } = await import('../../../packages/db/index.js');

const THROWAWAY_EMAIL = /^e2e-default-commons-[a-z0-9-]+@test\.cahootz\.local$/;
const COMMONS_IDS = ['cahootz', 'e2e-market'] as const;

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run the default-Commons fixture in production');
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname;
    } catch {
      return '';
    }
  })();
  if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== '1') {
    throw new Error(`Refusing to run the default-Commons fixture against non-local database host "${host}"`);
  }
}

function assertThrowaway(email: string) {
  if (!THROWAWAY_EMAIL.test(email)) throw new Error(`Unsafe fixture email: ${email}`);
}

async function create(email: string) {
  assertThrowaway(email);
  const missingCommons = [];
  for (const coopId of COMMONS_IDS) {
    const exists = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, select: { coopId: true } });
    if (!exists) missingCommons.push(coopId);
  }
  if (missingCommons.length) throw new Error(`Missing seeded Commons: ${missingCommons.join(', ')}`);

  const now = new Date();
  const handle = email.split('@')[0]!.replace(/[^a-z0-9]/g, '');
  const user = await db.user.create({
    data: { email, name: 'E2E Default Commons Member', handle, status: 'ACTIVE', roles: ['member'] },
    select: { id: true },
  });
  await db.userCoopMembership.createMany({
    data: COMMONS_IDS.map((coopId) => ({
      userId: user.id,
      coopId,
      status: 'ACTIVE' as const,
      roles: ['member'],
      joinedAt: now,
      lastActiveAt: now,
    })),
  });
  return { userId: user.id, handle };
}

async function cleanup(email: string) {
  assertThrowaway(email);
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { deleted: 0 };
  await db.$transaction([
    db.wallet.deleteMany({ where: { userId: user.id } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    db.loginCode.deleteMany({ where: { email } }),
    db.notification.deleteMany({ where: { userId: user.id } }),
    db.userCoopMembership.deleteMany({ where: { userId: user.id } }),
    db.user.deleteMany({ where: { id: user.id } }),
  ]);
  return { deleted: 1 };
}

async function main() {
  assertSafeEnvironment();
  const [command, email] = process.argv.slice(2);
  if (!email) throw new Error('Usage: e2e-default-commons.ts create|cleanup <email>');
  const result = command === 'create'
    ? await create(email)
    : command === 'cleanup'
      ? await cleanup(email)
      : (() => { throw new Error('Usage: e2e-default-commons.ts create|cleanup <email>'); })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
