import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildFeedbackSlackMessage,
  escapeSlackText,
  isFeedbackScreenshotUrl,
  sendFeedbackToSlack,
} from "../services/app-feedback.js";

const report = {
  feedbackId: "fb_1",
  category: "BUG" as const,
  message: "The post button spins forever <!channel>",
  screenshotUrls: ["https://abc.public.blob.vercel-storage.com/feedback/u1/1-shot.png"],
  reporter: { name: "Ada", handle: "ada", email: "ada@example.com" },
  screen: "/(tabs)",
  coopId: "soulaan",
  platform: "ios",
  appVersion: "1.1.6",
};

describe("isFeedbackScreenshotUrl", () => {
  it("accepts only app uploads under feedback/ in our blob store", () => {
    expect(isFeedbackScreenshotUrl(report.screenshotUrls[0]!)).toBe(true);
    expect(isFeedbackScreenshotUrl("https://abc.public.blob.vercel-storage.com/posts/x.png")).toBe(false);
    expect(isFeedbackScreenshotUrl("https://evil.example.com/feedback/x.png")).toBe(false);
    expect(isFeedbackScreenshotUrl("http://abc.public.blob.vercel-storage.com/feedback/x.png")).toBe(false);
    expect(isFeedbackScreenshotUrl("not a url")).toBe(false);
  });
});

describe("buildFeedbackSlackMessage", () => {
  it("shows the reporter, the escaped message, each screenshot and the context", () => {
    const message = buildFeedbackSlackMessage(report);
    const json = JSON.stringify(message);

    expect(message.text).toBe("🐞 Something is broken from Ada");
    expect(json).toContain("&lt;!channel&gt;");
    expect(json).not.toContain("<!channel>");
    expect(message.blocks).toContainEqual({
      type: "image",
      image_url: report.screenshotUrls[0],
      alt_text: "Screenshot 1",
    });
    expect(json).toContain("ios 1.1.6 · Screen: /(tabs) · Commons: soulaan · Ref: fb_1");
  });

  it("escapes Slack control characters", () => {
    expect(escapeSlackText("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("sendFeedbackToSlack", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("prefers the feedback webhook and reports success", async () => {
    vi.stubEnv("SLACK_FEEDBACK_WEBHOOK_URL", "https://hooks.slack.test/feedback");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/general");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendFeedbackToSlack(report)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://hooks.slack.test/feedback", expect.any(Object));
  });

  it("skips quietly without a webhook and never throws on Slack errors", async () => {
    vi.stubEnv("SLACK_FEEDBACK_WEBHOOK_URL", "");
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    await expect(sendFeedbackToSlack(report)).resolves.toBe(false);

    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/general");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(sendFeedbackToSlack(report)).resolves.toBe(false);
  });
});
