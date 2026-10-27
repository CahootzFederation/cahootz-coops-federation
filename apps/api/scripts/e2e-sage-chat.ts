// Fixture setup for e2e/sage-chat.spec.ts. Local test databases and test accounts only.
if (process.env.E2E_DATABASE_URL) {
  const host = new URL(process.env.E2E_DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || process.env.NODE_ENV === 'production') throw new Error('Local test databases only');
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
}
const { db } = await import('../../../packages/db/index.js');
const { SAGE_FREE_MESSAGES_PER_MONTH, listSagePacks, monthStart } = await import('../../../packages/trpc/src/services/sage-message-allowance.js');

const COOP_ID = 'cahootz';

async function main() {
  const [command, runId, email] = process.argv.slice(2);
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Local databases only');
  if (!runId || !/^E2E-sage-chat-[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Unique E2E Sage chat ID required');
  if (!email?.endsWith('@test.cahootz.local')) throw new Error('A local test account is required');
  const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const scope = { userId: user.id, coopId: COOP_ID };

  // A fresh month's allowance and an empty chat for this test account.
  if (command === 'reset') {
    await db.sageMessageUse.deleteMany({ where: { ...scope, createdAt: { gte: monthStart(new Date()) } } });
    await db.sageChatMessage.deleteMany({ where: scope });
    return { cleaned: true };
  }
  // Uses up every free message this month, as if the member had already chatted 20 times.
  if (command === 'use-all') {
    const used = await db.sageMessageUse.count({ where: { ...scope, paid: false, createdAt: { gte: monthStart(new Date()) } } });
    await db.sageMessageUse.createMany({
      data: Array.from({ length: Math.max(0, SAGE_FREE_MESSAGES_PER_MONTH - used) }, (_, i) => ({
        ...scope, source: 'DM', sourceId: `${runId}-${i}`, paid: false,
      })),
    });
    const credits = await db.sageMessageCredit.count({ where: { ...scope, revokedAt: null } });
    if (credits) throw new Error('This test account has bought Sage messages; remove them before running the journey');
    const config = await db.coopConfig.findFirst({ where: { coopId: COOP_ID, isActive: true }, orderBy: { version: 'desc' }, select: { name: true } });
    return listSagePacks(db, COOP_ID, config?.name ?? COOP_ID);
  }
  throw new Error('Unknown command');
}
main().then(result => console.log(`E2E_RESULT ${JSON.stringify(result)}`)).finally(() => db.$disconnect());
