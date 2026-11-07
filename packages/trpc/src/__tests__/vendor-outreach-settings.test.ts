import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../env.js";
import { outreachEmailReady, outreachSender } from "../lib/email.js";
import { outreachSenderConfigured, outreachSettings, POSTAL_ADDRESS_KEY, updateOutreachPostalAddress } from "../services/vendor-outreach/settings.js";

function fakeDb(saved: string | null) {
  const rows = new Map<string, string>(saved ? [[POSTAL_ADDRESS_KEY, saved]] : []);
  const audits: any[] = [];
  return {
    audits,
    rows,
    platformConfig: {
      findUnique: vi.fn(async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null)),
      upsert: vi.fn(async ({ where, create }: any) => rows.set(where.key, create.value)),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => audits.push(data)) },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("outreach sending settings", () => {
  it("sends from the usual address with replies going there, unless a separate outreach sender is set", () => {
    vi.stubEnv("RESEND_OUTREACH_FROM_EMAIL", "");
    vi.stubEnv("OUTREACH_REPLY_TO_EMAIL", "");
    expect(outreachSender()).toEqual({ from: `Cahootz Commons <${env.RESEND_FROM_EMAIL}>`, replyTo: env.RESEND_FROM_EMAIL });

    vi.stubEnv("RESEND_OUTREACH_FROM_EMAIL", "partners@deals.cahootzcoops.com");
    vi.stubEnv("OUTREACH_REPLY_TO_EMAIL", "partners@cahootzcoops.com");
    expect(outreachSender()).toEqual({ from: "Cahootz Commons <partners@deals.cahootzcoops.com>", replyTo: "partners@cahootzcoops.com" });

    // A sender that already has a display name keeps it, and replies go to its address.
    vi.stubEnv("RESEND_OUTREACH_FROM_EMAIL", "Cahootz Deals <deals@cahootzcoops.com>");
    vi.stubEnv("OUTREACH_REPLY_TO_EMAIL", "");
    expect(outreachSender()).toEqual({ from: "Cahootz Deals <deals@cahootzcoops.com>", replyTo: "deals@cahootzcoops.com" });
  });

  it("only sends from the live site, with the email service set up", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NODE_ENV", "development");
    expect(outreachSenderConfigured()).toBe(false);
    expect(outreachEmailReady()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(outreachSenderConfigured()).toBe(true);
    vi.stubEnv("RESEND_API_KEY", "");
    expect(outreachSenderConfigured()).toBe(false);
  });

  it("goes live only once the sender is ready and the mailing address is set", async () => {
    await expect(outreachSettings(fakeDb(null) as any, () => true)).resolves.toMatchObject({ live: false, savedPostalAddress: null, postalAddress: "[Mailing address not set yet]" });
    await expect(outreachSettings(fakeDb("1 Main St, Town, CA 94000") as any, () => false)).resolves.toMatchObject({ live: false, senderReady: false });
    await expect(outreachSettings(fakeDb("1 Main St, Town, CA 94000") as any, () => true)).resolves.toMatchObject({ live: true, postalAddress: "1 Main St, Town, CA 94000" });
  });

  it("saves the mailing address as one line, keeps the before and after, and turns down one that's too short", async () => {
    const db = fakeDb("Old address, Somewhere, CA 90000");
    await expect(updateOutreachPostalAddress(db as any, "admin-1", { postalAddress: "  2261 Market Street STE 16357\n\nSan Francisco,   CA 94114 " }))
      .resolves.toEqual({ postalAddress: "2261 Market Street STE 16357, San Francisco, CA 94114" });
    expect(db.rows.get(POSTAL_ADDRESS_KEY)).toBe("2261 Market Street STE 16357, San Francisco, CA 94114");
    expect(db.audits).toEqual([expect.objectContaining({
      actorId: "admin-1", action: "OUTREACH_POSTAL_ADDRESS_UPDATED",
      metadata: { before: "Old address, Somewhere, CA 90000", after: "2261 Market Street STE 16357, San Francisco, CA 94114" },
    })]);

    await expect(updateOutreachPostalAddress(db as any, "admin-1", { postalAddress: "Main St" })).rejects.toThrow("Add the full mailing address");
    expect(db.platformConfig.upsert).toHaveBeenCalledTimes(1);
  });
});
