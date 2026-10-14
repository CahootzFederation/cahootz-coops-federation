/**
 * Deterministic fixture for apps/mobile/e2e/sage-community-question.spec.ts. It stands in for the daily
 * community memory sweep: it saves one ACTIVE community hypothesis and runs the real
 * askCommonsAboutHypothesis, so Sage posts its open question in the Commons feed. Members answering it
 * runs through the real app. (How hypotheses qualify is covered by sage-community-memory.test.ts.)
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-community-question.ts seed <runId>
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-community-question.ts responders <postId>
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-community-question.ts cleanup <runId>
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";
import { COMMONS_COOP_ID } from "../../../packages/trpc/src/lib/commons.js";
import { COMMUNITY_MEMORY_AGENT_KEY } from "../../../packages/trpc/src/services/sage-community-memory.js";
import { askCommonsAboutHypothesis, countQuestionResponders } from "../../../packages/trpc/src/services/sage-community-question.js";

const KEY_PREFIX = "e2e-community-question:";
const THEME = "shared_resources";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Community question fixture refuses production");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing non-local database host "${host}"`);
  }
}

/** Removes E2E questions and hypotheses: one run's, or every leftover E2E one so the Commons cooldown starts clear. */
async function removeE2E(systemKey: { startsWith: string } | string) {
  const observations = await db.aIObservation.findMany({ where: { systemKey }, select: { id: true } });
  const ids = observations.map((row) => row.id);
  if (!ids.length) return 0;
  const actions = await db.commonsAction.findMany({ where: { originObservationId: { in: ids } }, select: { id: true, sourcePostId: true } });
  await db.commonsPost.deleteMany({ where: { id: { in: actions.map((action) => action.sourcePostId) }, author: { isBot: true } } });
  await db.commonsAction.deleteMany({ where: { id: { in: actions.map((action) => action.id) } } });
  await db.aIObservation.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function seed(runId: string) {
  await removeE2E({ startsWith: KEY_PREFIX });
  const observation = await db.aIObservation.create({
    data: {
      type: "community_wellbeing_signal", scopeType: "commons", scopeId: COMMONS_COOP_ID, confidence: 0.8,
      summary: `E2E ${runId}: members reported a need related to resources during this evidence window.`,
      details: { themeKey: THEME, e2e: true }, visibility: "SAGE_INTERNAL", status: "ACTIVE",
      expiresAt: new Date(Date.now() + 86_400_000), generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY, systemKey: `${KEY_PREFIX}${runId}`,
    },
    select: { id: true },
  });
  const result = await askCommonsAboutHypothesis(COMMONS_COOP_ID, [{ id: observation.id, themeKey: THEME, confidence: 0.8, goalLabels: [] }]);
  if (!result.asked) throw new Error(`Sage didn't ask: ${result.reason}`);
  return { coopId: COMMONS_COOP_ID, postId: result.postId, actionId: result.actionId };
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!arg) throw new Error("Usage: e2e-sage-community-question.ts seed|responders|cleanup <runId|postId>");
  assertSafeEnvironment();
  const result = command === "seed" ? await seed(arg)
    : command === "responders" ? { responders: await countQuestionResponders(arg) }
    : command === "cleanup" ? { removed: await removeE2E(`${KEY_PREFIX}${arg}`) } : null;
  if (!result) throw new Error("Usage: e2e-sage-community-question.ts seed|responders|cleanup <runId|postId>");
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
