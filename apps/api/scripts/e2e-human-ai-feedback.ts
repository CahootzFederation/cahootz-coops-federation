// Optional isolated local database; validate before loading Prisma.
if (process.env.E2E_DATABASE_URL) {
  const host = new URL(process.env.E2E_DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || process.env.NODE_ENV === 'production') throw new Error('Local test databases only');
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
}
const { db } = await import('../../../packages/db/index.js');

async function main() {
  const [command, runId, emailA, emailB] = process.argv.slice(2);
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Local databases only');
  if (!runId || !/^E2E-pulse-[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Unique E2E Pulse ID required');
  if (![emailA, emailB].every(e => e?.endsWith('@test.cahootz.local')) || emailA === emailB) throw new Error('Two local test accounts required');
  const users = await Promise.all([emailA, emailB].map(email => db.user.findUniqueOrThrow({ where: { email }, select: { id: true } })));
  const id = runId;
  if (command === 'publish') {
    await db.coopConfig.create({ data: {
      coopId: runId, version: 1, name: runId, isPrivate: true, charterText: 'E2E Pulse publication fixture',
      missionGoals: [], structuralWeights: {}, scoreMix: {}, proposalCategories: [], sectorExclusions: [], createdBy: 'e2e',
    } });
    await db.userCoopMembership.createMany({ data: users.map(user => ({ coopId: runId, userId: user.id, status: 'ACTIVE' as const })) });
    const { publishCommunityPulse } = await import('../../../packages/trpc/src/services/sage-community-pulse.js');
    const results = await Promise.all([publishCommunityPulse(runId), publishCommunityPulse(runId)]);
    const rows = await db.aIObservation.findMany({ where: { scopeId: runId, type: 'community_pulse' }, select: { id: true } });
    if (rows.length !== 1 || results.some(r => r.observationId !== rows[0]!.id)) throw new Error('Concurrent publisher runs must create one observation');
    return { id: rows[0]!.id, coopId: runId };
  }
  if (command === 'cleanup-published') {
    await db.aIObservation.deleteMany({ where: { scopeType: 'commons', scopeId: runId } });
    await db.userCoopMembership.deleteMany({ where: { coopId: runId } });
    await db.sageWakeCycle.deleteMany({ where: { coopId: runId } });
    await db.coopConfig.deleteMany({ where: { coopId: runId } });
    return { cleaned: true };
  }
  if (command === 'seed') {
    for (const user of users) {
      const member = await db.userCoopMembership.findFirst({ where: { userId: user.id, coopId: 'cahootz', status: 'ACTIVE' } });
      if (!member) throw new Error('Seed the test members first');
    }
    await db.aIObservation.create({ data: {
      id, type: 'community_pulse', scopeType: 'commons', scopeId: 'cahootz', visibility: 'COMMONS_MEMBERS', confidence: 0.6,
      summary: `${runId}: a smaller first gathering could help people join in.`,
      details: { title: `${runId} Community connections`, basis: 'E2E fixture: shared invitations without a time or place.', uncertainty: 'We do not yet know which times work.' },
      generatedByAgentKey: 'e2e-pulse', expiresAt: new Date(Date.now() + 3600000),
    } });
    await db.aIObservation.create({ data: { id: `${id}-private`, type: 'community_pulse', scopeType: 'commons', scopeId: 'cahootz', visibility: 'SAGE_INTERNAL', confidence: 0.6, summary: `${runId} PRIVATE MUST NOT APPEAR`, generatedByAgentKey: 'e2e-pulse' } });
    return { id };
  }
  if (command === 'verify') {
    const rows = await db.humanAIFeedback.findMany({ where: { observationId: id }, orderBy: { createdAt: 'asc' } });
    if (rows.length !== 2 || new Set(rows.map(r => r.userId)).size !== 2) throw new Error('Expected exactly one response from each member');
    let immutable = false;
    try { await db.aIObservation.update({ where: { id }, data: { summary: 'Changed wording' } }); } catch { immutable = true; }
    if (!immutable) throw new Error('Published wording was mutable');
    return { count: rows.length, a: rows.find(r => r.userId === users[0]!.id)?.response, b: rows.find(r => r.userId === users[1]!.id)?.response, immutable };
  }
  if (command === 'cleanup') {
    await db.aIObservation.deleteMany({ where: { id: { in: [id, `${id}-private`] }, generatedByAgentKey: 'e2e-pulse' } });
    return { cleaned: true };
  }
  throw new Error('Unknown command');
}
main().then(result => console.log(`E2E_RESULT ${JSON.stringify(result)}`)).finally(() => db.$disconnect());
