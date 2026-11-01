import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listDiscoveryProfilesForAdmin,
  listDiscoveryRunsForAdmin,
  startProductDiscoveryRun,
  updateDiscoveryProfile,
} from "../services/vendor-outreach/product-runs.js";

const NOW = new Date("2026-11-03T15:00:00Z");
const MINUTE = 60_000;

interface Run { profileId: string; status: string; startedAt: Date; trigger?: string; savedMatchCount?: number }

interface Config { coopId: string; name: string; joinPolicy?: string; isDemo?: boolean; isActive?: boolean; description?: string | null }

function fakeDb(profiles: Array<Record<string, unknown>>, runs: Run[], configs: Config[] = []) {
  const audits: unknown[] = [];
  const matchesCoop = (p: Record<string, unknown>, where: any) =>
    !where?.coopId || (where.coopId.not === null ? p.coopId != null : true);
  const inWindow = (run: Run, where: any) =>
    (!where.profileId || run.profileId === where.profileId) &&
    (!where.status || run.status === where.status) &&
    (!where.trigger?.not || (run.trigger ?? "manual") !== where.trigger.not) &&
    (!where.startedAt?.gte || run.startedAt >= where.startedAt.gte);
  return {
    audits,
    commonsProductProfile: {
      findUnique: vi.fn(async ({ where }: any) => profiles.find((p) => p.key === where.key) ?? null),
      createMany: vi.fn(async ({ data }: any) => {
        for (const row of data) profiles.push({ id: `p-${row.key}`, isEnabled: true, monthlyRunLimit: 5, ...row });
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where }: any = {}) =>
        profiles.filter((p) => matchesCoop(p, where)).map((p) => ({
          ...p,
          discoveryRuns: runs
            .filter((r) => r.profileId === p.id)
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
            .slice(0, 1)
            .map((r) => ({ trigger: "manual", finishedAt: null, savedProductCount: 0, savedMatchCount: 0, error: null, ...r })),
        })),
      ),
    },
    productDiscoveryRun: {
      count: vi.fn(async ({ where }: any) => runs.filter((r) => inWindow(r, where)).length),
      findFirst: vi.fn(async ({ where }: any) => runs.find((r) => inWindow(r, where)) ?? null),
      groupBy: vi.fn(async ({ where }: any) => {
        const counts = new Map<string, number>();
        for (const r of runs.filter((r) => inWindow(r, where))) {
          const key = `${r.profileId}|${r.trigger ?? "manual"}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts].map(([key, n]) => {
          const [profileId, trigger] = key.split("|");
          return { profileId, trigger, _count: { _all: n } };
        });
      }),
    },
    coopConfig: {
      findMany: vi.fn(async ({ where }: any) =>
        configs
          .filter((c) => (c.isActive ?? true) === where.isActive)
          .filter((c) => where.isDemo === undefined || (c.isDemo ?? false) === where.isDemo)
          .filter((c) => !where.coopId?.in || where.coopId.in.includes(c.coopId))
          .map((c) => ({ joinPolicy: "APPLICATION_REQUIRED", isDemo: false, description: null, displayMission: null, ...c })),
      ),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => audits.push(data)) },
  };
}

const traveler = { id: "p-traveler", key: "traveler", name: "Traveler", coopId: "travel", isEnabled: true, monthlyRunLimit: 2 };

describe("starting product discovery from the admin page", () => {
  let dispatch: ReturnType<typeof vi.fn<(profileKey: string, requestId: string, hint: string | undefined) => Promise<void>>>;
  beforeEach(() => {
    dispatch = vi.fn(async (_profileKey: string, _requestId: string, _hint: string | undefined) => undefined);
  });

  it("hands the run to the job and records who started it", async () => {
    const db = fakeDb([traveler], []);
    const result = await startProductDiscoveryRun(db as any, "admin-1", { profileKey: "traveler" }, { now: NOW, dispatch });
    expect(result).toEqual({ ok: true, profileName: "Traveler" });
    expect(dispatch).toHaveBeenCalledWith("traveler", expect.stringMatching(/^admin:traveler:/), undefined);
    expect(db.audits).toEqual([expect.objectContaining({ actorId: "admin-1", action: "PRODUCT_DISCOVERY_STARTED", resourceId: "p-traveler" })]);
  });

  it("starts an extra search even when the month's scheduled searches are used up", async () => {
    const full = fakeDb([traveler], [
      { profileId: "p-traveler", status: "SUCCEEDED", startedAt: new Date(NOW.getTime() - 60 * MINUTE) },
      { profileId: "p-traveler", status: "SUCCEEDED", startedAt: new Date(NOW.getTime() - 120 * MINUTE) },
    ]);
    await expect(startProductDiscoveryRun(full as any, "admin-1", { profileKey: "traveler" }, { now: NOW, dispatch })).resolves.toMatchObject({ ok: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("won't start a second search while one is running, but ignores one stuck for over 30 minutes", async () => {
    const running = fakeDb([traveler], [{ profileId: "p-traveler", status: "RUNNING", startedAt: new Date(NOW.getTime() - 5 * MINUTE) }]);
    await expect(startProductDiscoveryRun(running as any, "admin-1", { profileKey: "traveler" }, { now: NOW, dispatch })).rejects.toMatchObject({ code: "CONFLICT" });

    const stuck = fakeDb([traveler], [{ profileId: "p-traveler", status: "RUNNING", startedAt: new Date(NOW.getTime() - 45 * MINUTE) }]);
    await startProductDiscoveryRun(stuck as any, "admin-1", { profileKey: "traveler" }, { now: NOW, dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("refuses unknown and turned-off profiles without dispatching", async () => {
    const db = fakeDb([{ ...traveler, isEnabled: false }], []);
    await expect(startProductDiscoveryRun(db as any, "admin-1", { profileKey: "nope" }, { now: NOW, dispatch })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startProductDiscoveryRun(db as any, "admin-1", { profileKey: "traveler" }, { now: NOW, dispatch })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("turned off"),
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
  });

  it("lists each Commons' scheduled usage, its extra searches and its latest run", async () => {
    const family = { id: "p-family", key: "family", name: "Family", coopId: "fam-1", isEnabled: true, monthlyRunLimit: 5 };
    const db = fakeDb([traveler, family], [
      { profileId: "p-traveler", status: "SUCCEEDED", startedAt: new Date(NOW.getTime() - 90 * MINUTE), savedMatchCount: 3 },
      { profileId: "p-traveler", status: "SUCCEEDED", trigger: "admin", startedAt: new Date(NOW.getTime() - 60 * MINUTE) },
      { profileId: "p-traveler", status: "RUNNING", startedAt: new Date(NOW.getTime() - 2 * MINUTE) },
    ], [
      { coopId: "travel", name: "Traveler Commons" },
      { coopId: "fam-1", name: "The Robinsons", joinPolicy: "INVITE_ONLY" },
    ]);
    const rows = await listDiscoveryProfilesForAdmin(db as any, NOW);
    expect(rows).toEqual([
      expect.objectContaining({ key: "traveler", name: "Traveler Commons", isFamily: false, runsThisMonth: 1, extraRunsThisMonth: 1, running: true, latestRun: expect.objectContaining({ status: "RUNNING" }) }),
      expect.objectContaining({ key: "family", name: "The Robinsons", isFamily: true, runsThisMonth: 0, extraRunsThisMonth: 0, running: false, latestRun: null }),
    ]);
    expect(rows[0]).not.toHaveProperty("id");
  });

  it("lists the real Commons and families: makes a profile for a Commons without one, and leaves out unlinked profiles and demos", async () => {
    const orphan = { id: "p-planet", key: "planet", name: "Planet", coopId: null, isEnabled: true, monthlyRunLimit: 5 };
    const demo = { id: "p-demo", key: "demo", name: "Demo", coopId: "demo-1", isEnabled: true, monthlyRunLimit: 5 };
    const db = fakeDb([traveler, orphan, demo], [], [
      { coopId: "travel", name: "Traveler Commons" },
      { coopId: "demo-1", name: "Demo Commons", isDemo: true },
      { coopId: "fam-2", name: "Granny Squad", joinPolicy: "INVITE_ONLY", description: "Keeping the family stocked." },
      { coopId: "block-club", name: "Block Club" },
    ]);
    const rows = await listDiscoveryProfilesForAdmin(db as any, NOW);
    expect(rows.map((row) => [row.name, row.isFamily])).toEqual([
      ["Block Club", false],
      ["Traveler Commons", false],
      ["Granny Squad", true],
    ]);
    const made = db.commonsProductProfile.createMany.mock.calls[0]![0].data;
    expect(made).toEqual([
      expect.objectContaining({ key: "commons-fam-2", coopId: "fam-2", name: "Granny Squad", description: "Keeping the family stocked.", participantLabel: "family members" }),
      expect.objectContaining({ key: "commons-block-club", coopId: "block-club", name: "Block Club", description: "Things Block Club members buy again and again." }),
    ]);
    // New profiles never go on the public homepage: families are private.
    expect(made.every((row: any) => !("isHomepageVisible" in row))).toBe(true);

    // Once every Commons has a profile, listing again makes no more.
    await listDiscoveryProfilesForAdmin(db as any, NOW);
    expect(db.commonsProductProfile.createMany).toHaveBeenCalledTimes(1);
  });

  it("shows a profile's past searches with their logs, and estimates time from recent finished searches", async () => {
    const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MINUTE);
    const runs = [
      { id: "live", status: "RUNNING", trigger: "admin", startedAt: at(1), finishedAt: null, progress: [{ kind: "search", text: "bulk rice" }] },
      { id: "done", status: "SUCCEEDED", trigger: "scheduled", startedAt: at(30), finishedAt: new Date(at(30).getTime() + 120_000), progress: [] },
      { id: "old", status: "SUCCEEDED", trigger: "scheduled", startedAt: at(90), finishedAt: at(90), progress: null },
    ];
    const finished = [
      { startedAt: at(30), finishedAt: new Date(at(30).getTime() + 120_000) },
      { startedAt: at(60), finishedAt: new Date(at(60).getTime() + 200_000) },
      { startedAt: at(80), finishedAt: new Date(at(80).getTime() + 60_000) },
      // Recorded before finish times were real: no length, so it isn't counted.
      { startedAt: at(90), finishedAt: at(90) },
    ];
    const db = {
      commonsProductProfile: { findUnique: vi.fn(async () => ({ id: "p-traveler" })) },
      productDiscoveryRun: { findMany: vi.fn(async ({ where }: any) => (where.profileId ? runs : finished)) },
    };
    const result = await listDiscoveryRunsForAdmin(db as any, "traveler", NOW);
    expect(result.estimateSeconds).toBe(120);
    expect(result.runs.map((r) => [r.id, r.running, r.seconds, r.progress.length])).toEqual([
      ["live", true, null, 1],
      ["done", false, 120, 0],
      ["old", false, 0, 0],
    ]);
    await expect(listDiscoveryRunsForAdmin({ commonsProductProfile: { findUnique: vi.fn(async () => null) } } as any, "nope", NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("passes a one-time hint to the search and records it, and turns down one that's too long", async () => {
    const db = fakeDb([traveler], []);
    await startProductDiscoveryRun(db as any, "admin-1", { profileKey: "traveler", hint: "  bulk diapers and wipes  " }, { now: NOW, dispatch });
    expect(dispatch).toHaveBeenCalledWith("traveler", expect.any(String), "bulk diapers and wipes");
    expect(db.audits).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ hint: "bulk diapers and wipes" }) })]);

    // A blank hint is the same as none.
    await startProductDiscoveryRun(fakeDb([traveler], []) as any, "admin-1", { profileKey: "traveler", hint: "   " }, { now: NOW, dispatch });
    expect(dispatch).toHaveBeenLastCalledWith("traveler", expect.any(String), undefined);

    await expect(
      startProductDiscoveryRun(fakeDb([traveler], []) as any, "admin-1", { profileKey: "traveler", hint: "x".repeat(1_001) }, { now: NOW, dispatch }),
    ).rejects.toMatchObject({ issues: [expect.objectContaining({ message: "Keep the hint under 1,000 characters." })] });
  });

  it("lets an admin change what a profile looks for, keeps the before and after, and checks the input", async () => {
    const updates: unknown[] = [];
    const audits: any[] = [];
    const db = {
      commonsProductProfile: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.key === "family"
            ? { id: "p-family", name: "Family Commons", searchPrompt: "Find household staples", description: "Families", searchTerms: ["household"], excludedTerms: [] }
            : null,
        ),
        update: vi.fn(async (args: unknown) => updates.push(args)),
      },
      auditLog: { create: vi.fn(async ({ data }: any) => audits.push(data)) },
    };
    const result = await updateDiscoveryProfile(db as any, "admin-1", {
      profileKey: "family",
      searchPrompt: "  Find bulk diapers, wipes and baby food with public case prices.  ",
      description: "Young families",
      searchTerms: ["diapers", " wipes ", "Diapers"],
      excludedTerms: ["formula samples"],
    });
    expect(result).toEqual({ ok: true, profileName: "Family Commons" });
    expect(updates).toEqual([{
      where: { id: "p-family" },
      data: {
        searchPrompt: "Find bulk diapers, wipes and baby food with public case prices.",
        description: "Young families",
        searchTerms: ["Diapers", "wipes"],
        excludedTerms: ["formula samples"],
      },
    }]);
    expect(audits[0]).toMatchObject({
      action: "PRODUCT_DISCOVERY_PROFILE_UPDATED",
      resourceId: "p-family",
      metadata: { before: { searchTerms: ["household"] }, after: { searchTerms: ["Diapers", "wipes"] } },
    });

    await expect(
      updateDiscoveryProfile(db as any, "admin-1", { profileKey: "family", searchPrompt: "short", description: "Young families", searchTerms: [], excludedTerms: [] }),
    ).rejects.toMatchObject({ issues: [expect.objectContaining({ message: "Say what to find in at least a few words." })] });
    await expect(
      updateDiscoveryProfile(db as any, "admin-1", { profileKey: "nope", searchPrompt: "Find household staples", description: "Families", searchTerms: [], excludedTerms: [] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
