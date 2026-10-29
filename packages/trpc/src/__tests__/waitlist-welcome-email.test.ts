import { describe, expect, it } from "vitest";

import { renderWaitlistWelcomeEmail } from "../lib/email.js";

describe("waitlist welcome email", () => {
  it("names the picked commons and sends people to the app, not an application", async () => {
    const html = await renderWaitlistWelcomeEmail("Soulaan Coop");

    expect(html).toContain("You&#x27;re on the list");
    expect(html).toContain("when Soulaan Coop opens up");
    expect(html).toContain("Get the app");
    expect(html).toContain('href="https://apps.apple.com/us/app/cahootz-commons/id6772781102"');
    expect(html).not.toMatch(/application/i);
  });

  it("still reads naturally when no commons was picked", async () => {
    const html = await renderWaitlistWelcomeEmail(null);

    expect(html).toContain("when a commons near you opens up");
  });
});
