import { afterEach, describe, expect, it, vi } from "vitest";

const { trigger, processContent } = vi.hoisted(() => ({
  trigger: vi.fn().mockResolvedValue({ id: "run-1" }),
  processContent: vi.fn().mockResolvedValue({ processed: 1 }),
}));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger } }));
vi.mock("../services/commons-action-agent.js", () => ({ processCommonsActionContent: processContent }));

import { enqueueCommonsActionContent } from "../services/commons-action-dispatch.js";

afterEach(() => {
  trigger.mockClear();
  processContent.mockClear();
  vi.unstubAllEnvs();
});

describe("Commons action event dispatch", () => {
  it("enqueues a new comment with a stable idempotency key", async () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_test");
    await expect(enqueueCommonsActionContent("commons_comment", "comment-1")).resolves.toBeUndefined();
    expect(trigger).toHaveBeenCalledWith("commons-action-content", {
      sourceType: "commons_comment", sourceId: "comment-1",
    }, { idempotencyKey: "commons-action-content:commons_comment:comment-1", idempotencyKeyTTL: "24h" });
    expect(processContent).not.toHaveBeenCalled();
  });

  it("runs the scan on the API backend when Trigger is not configured", async () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "");
    await expect(enqueueCommonsActionContent("commons_post", "post-1")).resolves.toBeUndefined();
    expect(processContent).toHaveBeenCalledWith("commons_post", "post-1");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("does not send local scans to Trigger production with a production key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_prod_test");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(enqueueCommonsActionContent("commons_post", "post-2")).resolves.toBeUndefined();
      expect(processContent).toHaveBeenCalledWith("commons_post", "post-2");
      expect(trigger).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
