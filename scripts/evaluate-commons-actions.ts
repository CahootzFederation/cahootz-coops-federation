import "dotenv/config";
import { Agent, run } from "@openai/agents";
import type { CoopConfig } from "@repo/db";
import { COMMONS_ACTION_MODEL, commonsActionPrompt, createCommonsActionAgent, hasExactGrounding, type SourceItem } from "../packages/trpc/src/services/commons-action-agent.js";
import { estimateAICost, usageFromAgentResult } from "../packages/trpc/src/services/ai-cost.js";

const config = {
  id: "evaluation-charter", version: 1, coopId: "evaluation-commons", name: "Harbor Commons",
  charterText: "Members share tools and maintain a community workshop. Members make major spending decisions through proposals and a member vote.",
  missionGoals: [{ label: "Share equipment", description: "Make useful tools available to members" }, { label: "Member decisions", description: "Let members decide how shared funds are used" }],
} as unknown as CoopConfig;
const now = new Date();
const examples: Array<{ item: SourceItem; expected: string[] }> = [
  { item: { sourceType: "commons_post", sourceId: "offer", sourcePostId: "offer", sourceAuthorId: "member-a", createdAt: now,
    title: "Tools", content: "I can lend my drill to neighbors this weekend.", context: "", coopId: config.coopId }, expected: ["VERIFY_RESOURCE"] },
  { item: { sourceType: "commons_comment", sourceId: "correction", sourcePostId: "thread", sourceAuthorId: "member-b", createdAt: now,
    title: "Workshop budget", content: "The treasurer can spend the workshop fund without asking members.", context: "How should we buy a new table saw?", coopId: config.coopId }, expected: ["RESPOND_CHARTER_CORRECTION"] },
  { item: { sourceType: "commons_post", sourceId: "proposal", sourcePostId: "proposal", sourceAuthorId: "member-c", createdAt: now,
    title: "Tool library", content: "Could we vote to use shared funds for a tool library with a checkout system?", context: "", coopId: config.coopId }, expected: ["MAKE_PROPOSAL"] },
  { item: { sourceType: "commons_post", sourceId: "social", sourcePostId: "social", sourceAuthorId: "member-d", createdAt: now,
    title: "Hello", content: "Hope everyone has a good weekend!", context: "", coopId: config.coopId }, expected: ["NO_ACTION"] },
];

async function main() {
  const agent: Agent = createCommonsActionAgent();
  const result = await run(agent, commonsActionPrompt(config, examples.map((entry) => entry.item)));
  const output = result.finalOutput as { items: Array<{ id: string; actions: Array<{ type: string; evidence: string; draftText: string; resourceKind: string }> }> };
  const byId = new Map(output.items.map((entry) => [entry.id, entry.actions]));
  let matched = 0;
  for (const example of examples) {
    const actual = byId.get(example.item.sourceId) ?? [];
    const types = actual.map((action) => action.type);
    const hit = example.expected.some((expected) => types.includes(expected))
      && actual.every((action) => action.type === "NO_ACTION" || hasExactGrounding(action.evidence, config));
    if (hit) matched++;
    process.stdout.write(`${example.item.sourceId}: expected ${example.expected.join("/")}; got ${types.join(", ") || "none"}; ${hit ? "match" : "review"}\n`);
    for (const action of actual) {
      if (action.type === "NO_ACTION") continue;
      process.stdout.write(`  ${action.type}${action.resourceKind ? ` (${action.resourceKind})` : ""}\n  evidence: ${action.evidence}\n  draft: ${action.draftText}\n`);
    }
  }
  const usage = usageFromAgentResult(result);
  process.stdout.write(`Matched ${matched}/${examples.length} with ${COMMONS_ACTION_MODEL}. Estimated token cost: $${estimateAICost(COMMONS_ACTION_MODEL, usage)?.toFixed(6) ?? "unknown"}.\n`);
  if (matched < examples.length) process.exitCode = 1;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
