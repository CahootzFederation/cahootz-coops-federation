/**
 * E2E fixture for the held-reply journey (apps/mobile/e2e/sage-held-reply.spec.ts). Not part of the
 * product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-held-reply.ts seed <runId> <coopId> <authorEmail> <adminEmail>
 *     Makes <adminEmail> a Commons admin (SUPER_ADMIN) of <coopId> for the run, creates a General-feed
 *     question by <authorEmail>, and runs it through the real Commons action agent with a fixed model
 *     answer: a reply Sage isn't confident enough to post on its own. Sage holds it, and code sends it
 *     to a Commons admin to approve. The post is created here rather than through the app so the live
 *     analysis the app starts doesn't race the fixed answer.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-held-reply.ts cleanup <postId> <coopId> <adminEmail> <grantedRole>
 *     Deletes the post with Sage's suggestion, reviews, alerts and decision trails, and removes the
 *     admin role again when this run granted it (<grantedRole> is "1").
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but seeded test accounts and
 * refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { processCommonsActionContent } from "../../../packages/trpc/src/services/commons-action-agent.js";

const TEST_EMAIL = /^[a-z0-9_-]+@test\.cahootz\.local$/;
const onTopic = async () => ({ relevant: true, reason: "E2E fixture: the reply is on topic." });

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the held-reply fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the held-reply fixture against non-local database host "${host}"`);
  }
}

async function testUser(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!TEST_EMAIL.test(normalized)) throw new Error(`Only seeded test accounts can be used: ${email}`);
  const user = await db.user.findFirst({ where: { email: normalized }, select: { id: true, email: true } });
  if (!user) throw new Error(`No test user ${normalized}`);
  return user;
}

async function seed(runId: string, coopId: string, authorEmail: string, adminEmail: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  const [author, admin] = [await testUser(authorEmail), await testUser(adminEmail)];
  const existing = await db.adminRole.findUnique({ where: { userId_coopId_role: { userId: admin.id, coopId, role: "SUPER_ADMIN" } } });
  const grantedRole = !existing || !!existing.revokedAt;
  if (grantedRole) {
    await db.adminRole.upsert({
      where: { userId_coopId_role: { userId: admin.id, coopId, role: "SUPER_ADMIN" } },
      create: { userId: admin.id, coopId, role: "SUPER_ADMIN", grantedBy: "e2e-fixture" },
      update: { revokedAt: null, revokedBy: null },
    });
  }

  const question = `E2E ${runId}: Does anyone know where we can borrow folding tables for the block party?`;
  const post = await db.commonsPost.create({ data: {
    coopId, circleId: `general:${coopId}`, authorId: author.id, title: `E2E ${runId} folding tables`, content: question, tag: "Ask",
  } });
  const reply = `E2E ${runId}: Good question. Who here has folding tables we could borrow for an afternoon?`;
  await processCommonsActionContent("commons_post", post.id, {
    relevanceJudge: onTopic,
    decide: async (items) => ({ items: items.map((item) => ({ id: item.id, actions: [{
      type: "ANSWER_QUESTION", summary: `Ask who can lend folding tables (E2E ${runId})`,
      evidence: "borrow folding tables for the block party", evidenceSource: "thread",
      confidence: 0.4, draftText: reply, resourceKind: "", resourceTitle: "", targetHandle: "",
      templateKey: "", templateLead: "", templateSteps: [], templateOffer: "",
      followUpDays: 0, followUpExpect: "", escalationCategory: "", escalationAboutMember: false,
    }] })) }),
  });

  const action = await db.commonsAction.findFirst({ where: { sourceType: "commons_post", sourceId: post.id, type: "SUGGEST_ACTION" }, select: { id: true } });
  const review = action ? await db.commonsActionReview.findFirst({ where: { actionId: action.id, reviewType: "APPROVE_SUGGESTION" }, select: { userId: true } }) : null;
  return { postId: post.id, actionId: action?.id ?? null, reviewerIsAdmin: review?.userId === admin.id, grantedRole, reply };
}

async function cleanup(postId: string, coopId: string, adminEmail: string, grantedRole: string) {
  if (postId !== "-") {
    const actions = await db.commonsAction.findMany({ where: { sourcePostId: postId }, select: { id: true } });
    const actionIds = actions.map((action) => action.id);
    if (actionIds.length) {
      await db.sageTask.deleteMany({ where: { sourceActionId: { in: actionIds } } });
      await db.commonsActionReview.deleteMany({ where: { actionId: { in: actionIds } } });
      await db.commonsActionAudit.deleteMany({ where: { actionId: { in: actionIds } } });
      await db.commonsActionParticipant.deleteMany({ where: { actionId: { in: actionIds } } });
      await db.commonsAction.deleteMany({ where: { id: { in: actionIds } } });
      for (const actionId of actionIds) {
        await db.notification.deleteMany({ where: { type: { startsWith: "SAGE_" }, data: { path: ["actionId"], equals: actionId } } });
      }
    }
    await db.notification.deleteMany({ where: { type: "SAGE_COMMENT", data: { path: ["postId"], equals: postId } } });
    await db.sageDecisionTrail.deleteMany({ where: { relatedPostIds: { has: postId } } });
    await db.commonsContentScan.deleteMany({ where: { sourceId: postId } });
    await db.commonsPost.deleteMany({ where: { id: postId } });
  }
  if (grantedRole === "1") {
    const admin = await testUser(adminEmail);
    // Only this run's grant: the coopId and role are the ones seed used, and the caller passes "1" only when seed granted it.
    await db.adminRole.updateMany({ where: { userId: admin.id, coopId, role: "SUPER_ADMIN", revokedAt: null }, data: { revokedAt: new Date(), revokedBy: "e2e-fixture" } });
  }
  return { cleaned: true };
}

async function main() {
  assertSafeEnvironment();
  const [command, ...args] = process.argv.slice(2);
  const result = command === "seed" ? await seed(args[0]!, args[1]!, args[2]!, args[3]!)
    : command === "cleanup" ? await cleanup(args[0]!, args[1]!, args[2]!, args[3]!)
    : (() => { throw new Error(`Unknown command ${command}`); })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
