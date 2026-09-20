import { afterEach, describe, expect, it, vi } from "vitest";

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn().mockResolvedValue({ id: "run-1" }) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger } }));

import { enqueueCommonsActionContent } from "../services/commons-action-dispatch.js";

afterEach(() => {
  trigger.mockClear();
});

describe("Commons action event dispatch", () => {
  it("enqueues a new comment with a stable idempotency key", async () => {
    await expect(enqueueCommonsActionContent("commons_comment", "comment-1")).resolves.toBeUndefined();
    expect(trigger).toHaveBeenCalledWith("commons-action-content", {
      sourceType: "commons_comment", sourceId: "comment-1",
    }, { idempotencyKey: "commons-action-content:commons_comment:comment-1", idempotencyKeyTTL: "24h" });
  });
});
