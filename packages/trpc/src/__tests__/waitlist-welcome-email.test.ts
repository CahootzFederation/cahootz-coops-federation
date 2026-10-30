import { describe, expect, it } from "vitest";

import { renderWaitlistWelcomeEmail } from "../lib/email.js";

describe("waitlist welcome email", () => {
  it("names the picked commons and links to neither the app nor an application", async () => {
    const html = await renderWaitlistWelcomeEmail("Soulaan Coop");

    expect(html).toContain("You&#x27;re on the list");
    expect(html).toContain("when Soulaan Coop opens up");
    expect(html).not.toContain("Get the app");
    expect(html).not.toContain("apps.apple.com");
    expect(html).not.toMatch(/application/i);
  });

  it("still reads naturally when no commons was picked", async () => {
    const html = await renderWaitlistWelcomeEmail(null);

    expect(html).toContain("when a commons near you opens up");
  });
});
