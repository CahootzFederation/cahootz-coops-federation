import { describe, expect, it } from "vitest";

import { renderCommonsInvitationEmail } from "../lib/email.js";

describe("commons invitation email", () => {
  it("links only to the app, never an invitation link or token, and shows the expiry date only", async () => {
    const html = await renderCommonsInvitationEmail({
      heading: "Maya invited you to join Robinson Family",
      commonsName: "Robinson Family",
      description: "Where we keep up with each other.",
      steps: "Open the Cahootz app. Your invitation to join Robinson Family is waiting on your home screen.",
      ctaLabel: "Open on iOS",
      appLinkUrl: "https://apps.apple.com/us/app/cahootz-commons/id6772781102",
      expiresAt: new Date("2026-10-15T15:11:00Z"),
    });

    expect(html).toContain("Maya invited you to join Robinson Family");
    expect(html).toContain("Open on iOS");
    expect(html).toContain("Android · Coming soon");
    expect(html).toContain('href="https://apps.apple.com/us/app/cahootz-commons/id6772781102"');
    expect(html).not.toMatch(/commons:\/\/|\/invite\//);
    expect(html).toContain("This invitation expires on October 15, 2026.");
    expect(html).not.toMatch(/expires on [^<]*\d:\d\d/);
  });
});
