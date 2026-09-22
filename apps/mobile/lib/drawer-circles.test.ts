import type { PrivateGroupSummary } from "./api";
import {
  buildDrawerCirclePreview,
  hiddenDrawerCircleCount,
  shouldShowCreateCircle,
} from "./drawer-circles";

function circle(id: string): PrivateGroupSummary {
  return {
    id,
    name: `Circle ${id}`,
    purpose: null,
    privacy: "invite-only",
    memberCount: 2,
    isLeader: false,
    isMember: true,
    createdAt: "2026-09-18T00:00:00.000Z",
    kind: "STANDARD",
    colorKey: "gold",
    chattingCount: 0,
    welcomeTableNumber: null,
    welcomeTableStatus: null,
    capacity: null,
    newcomerCount: null,
  };
}

describe("buildDrawerCirclePreview", () => {
  it("always presents the commons feed as its General circle", () => {
    expect(buildDrawerCirclePreview("artists", [])).toEqual([
      { id: "general:artists", kind: "main", label: "General" },
    ]);
  });

  it("shows at most three circles including General", () => {
    const preview = buildDrawerCirclePreview("artists", [
      circle("1"),
      circle("2"),
      circle("3"),
    ]);

    expect(preview.map((item) => item.id)).toEqual(["general:artists", "1", "2"]);
    expect(
      hiddenDrawerCircleCount([circle("1"), circle("2"), circle("3")]),
    ).toBe(1);
  });

  it("offers circle creation only while the three-row preview has room", () => {
    expect(shouldShowCreateCircle([])).toBe(true);
    expect(shouldShowCreateCircle([circle("1")])).toBe(true);
    expect(shouldShowCreateCircle([circle("1"), circle("2")])).toBe(false);
  });

  it("shows public circles but hides private circles the viewer has not joined", () => {
    const unjoinedPrivate = { ...circle("private"), isMember: false };
    const publicCircle = { ...circle("public"), privacy: "public" as const, isMember: false };
    expect(buildDrawerCirclePreview("artists", [unjoinedPrivate, publicCircle])).toEqual([
      { id: "general:artists", kind: "main", label: "General" },
      expect.objectContaining({ id: "public", kind: "public" }),
    ]);
  });
});
