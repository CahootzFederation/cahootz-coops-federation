// Run with: pnpm -F @cahootz/api exec tsx --import ./dotenv.config.js scripts/publish-community-pulse-local.ts cahootz
// Normal publication is scheduled by Sage's wake cycle; this is a local-only first-run/diagnostic entry point.
const host = new URL(process.env.DATABASE_URL ?? '').hostname;
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Local development database required');
const coopId = process.argv[2];
if (!coopId) throw new Error('Provide a Commons ID');
const { db } = await import('../../../packages/db/index.js');
const { publishCommunityPulse } = await import('../../../packages/trpc/src/services/sage-community-pulse.js');
try {
  const result = await publishCommunityPulse(coopId);
  console.log(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
