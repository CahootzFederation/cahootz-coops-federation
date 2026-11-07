import { describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", () => ({ tool: (opts: { name: string }) => opts }));
vi.mock("@repo/db", () => ({ db: {} }));
vi.mock("../services/sage-member-actions.js", () => ({
  MEMBER_POST_TAGS: ["REQUEST"], memberCommons: vi.fn(), proposeIntroduction: vi.fn(), proposeMemberPost: vi.fn(), rescheduleMemberPostFollowUp: vi.fn(),
}));
vi.mock("../services/sage-proactive.js", () => ({ scheduleMemberCheckIn: vi.fn() }));
vi.mock("../services/knowledge-base.js", () => ({ searchKnowledgeBase: vi.fn() }));
vi.mock("../agents/tools/specialist-tools.js", () => ({ findMembersForNeed: vi.fn() }));

import { buildSageReplyTools } from "../agents/tools/member-action-tools.js";

const names = (tools: Array<{ name: string }>) => tools.map((entry) => entry.name).sort();
const LOOKUPS = ["count_members_offering", "list_commons_resources", "search_commons_documents"];

describe("Sage reply tools", () => {
  it("gives a DM every member action plus the Commons lookups", () => {
    const dm = buildSageReplyTools({ kind: "dm", memberId: "m", conversationGroupId: "g", coopId: "c" });
    expect(names(dm.tools)).toEqual([
      ...LOOKUPS, "follow_up_later", "list_my_commons", "propose_post", "schedule_check_in", "search_opportunities", "suggest_introduction",
    ].sort());
  });

  it("gives a public @mention the same tools minus those that need a private yes or reveal other Commons", () => {
    const thread = buildSageReplyTools({ kind: "thread", memberId: "m", coopId: "c" });
    expect(names(thread.tools)).toEqual([...LOOKUPS, "schedule_check_in", "search_opportunities"].sort());
    expect(thread.instructions).toContain("This reply is public.");
  });
});
