import { describe, expect, it } from "vitest";

import {
  familyCharter,
  familyConfigFromSetup,
  familyDefaultPriorityPercents,
  familyMissionGoals,
  familyMonthlyPace,
  familySetupFromConfig,
  familySetupSchema,
} from "../services/family-setup.js";

const GOALS = [
  { label: "Keep the house in the family", detail: "Back taxes first", targetAmountUSD: 6000, targetMonths: 12 },
  { label: "Launch Hollis Catering", targetAmountUSD: 4000, targetMonths: 6 },
  { label: "Buy a rental" },
];

describe("family setup", () => {
  it("weights goals by their order, first goal heaviest", () => {
    const goals = familyMissionGoals(GOALS);
    expect(goals.map((goal) => goal.key)).toEqual([
      "keep_the_house_in_the_family",
      "launch_hollis_catering",
      "buy_a_rental",
    ]);
    expect(goals[0].priorityWeight).toBeGreaterThan(goals[1].priorityWeight);
    expect(goals[1].priorityWeight).toBeGreaterThan(goals[2].priorityWeight);
    expect(goals.map((goal) => goal.priorityWeight)).toEqual([0.5, 0.33, 0.17]);
    expect(goals[0]).toMatchObject({ description: "Target: $6,000 within 1 year. Back taxes first" });
    expect(goals[2]).not.toHaveProperty("description");
  });

  it("splits the default priority into whole percentages that add up to 100", () => {
    expect(familyDefaultPriorityPercents(1)).toEqual([100]);
    expect(familyDefaultPriorityPercents(2)).toEqual([67, 33]);
    expect(familyDefaultPriorityPercents(3)).toEqual([50, 33, 17]);
    for (let count = 1; count <= 6; count += 1) {
      const percents = familyDefaultPriorityPercents(count);
      expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
      expect([...percents].sort((a, b) => b - a)).toEqual(percents);
    }
  });

  it("uses the family's own priority percentages", () => {
    const goals = familyMissionGoals([
      { label: "Buy land", priorityPercent: 25 },
      { label: "Start a business", priorityPercent: 75 },
    ]);
    expect(goals.map((goal) => goal.priorityWeight)).toEqual([0.25, 0.75]);
  });

  it("requires priority percentages on every goal that add up to 100", () => {
    const parse = (percents: (number | undefined)[]) =>
      familySetupSchema.safeParse({
        goals: percents.map((priorityPercent, i) => ({ label: `Goal ${i}`, priorityPercent })),
      });
    expect(parse([60, 40]).success).toBe(true);
    expect(parse([undefined, undefined]).success).toBe(true);
    const short = parse([60, 30]);
    expect(short.success).toBe(false);
    expect(short.error?.issues[0].message).toBe("Goal priorities have to add up to 100%.");
    expect(parse([60, undefined]).success).toBe(false);
    expect(parse([100, 0]).success).toBe(false);
  });

  it("keeps duplicate goal keys unique", () => {
    const keys = familyMissionGoals([{ label: "Buy land" }, { label: "Buy  land!" }]).map((goal) => goal.key);
    expect(keys).toEqual(["buy_land", "buy_land_2"]);
  });

  it("leaves the goals blank when the family skips the goals step", () => {
    expect(familyMissionGoals([])).toEqual([]);
  });

  it("adds up the monthly pace only for goals with an amount and a timeframe", () => {
    expect(familyMonthlyPace(GOALS)).toBe(500 + 667);
  });

  it("writes an agreement with goals, money, decisions, an interim steward and house rules", () => {
    const charter = familyCharter({
      name: "The Hollis Table",
      creatorName: "Tasha",
      setup: {
        mission: "Keep Mom's house and build a business we all own.",
        goals: GOALS,
        votingWindowDays: 3,
        approval: "TWO_THIRDS",
        houseRules: ["No politics at Sunday dinner."],
      },
    });
    expect(charter.split("\n")[0]).toBe("# The Hollis Table family agreement");
    expect(charter).toContain("Keep Mom's house and build a business we all own.");
    expect(charter).toContain("1. Keep the house in the family (50%): $6,000 within 1 year. Back taxes first");
    expect(charter).toContain("3. Buy a rental (17%)\n");
    expect(charter).toContain("Personal bills and loans stay between people");
    expect(charter).toContain("A family decision stays open for 3 days.");
    expect(charter).toContain("it passes with two-thirds of the votes");
    expect(charter).toContain("Tasha started The Hollis Table and is its interim steward until the family elects its stewards.");
    expect(charter).toContain("3. No politics at Sunday dinner.\n4. Anyone can leave at any time.");
  });

  it("still writes a complete agreement with no guided answers, leaving the mission and goals blank", () => {
    const charter = familyCharter({ name: "Robinsons", creatorName: "Deon" });
    expect(charter).not.toContain("Why we're here");
    expect(charter).not.toContain("What we're building together");
    expect(charter).toContain("only while everyone in the family is a steward");
    expect(charter).toContain("A family decision stays open for 7 days.");
    expect(charter).toContain("more than half of the votes");
  });

  it("turns decision choices into the voting settings proposals use", () => {
    expect(
      familyConfigFromSetup({
        name: "Robinsons",
        creatorName: "Deon",
        setup: { votingWindowDays: 14, approval: "TWO_THIRDS" },
      }),
    ).toMatchObject({ votingWindowDays: 14, approvalThresholdPercent: 67, quorumPercent: 50, displayMission: null });
  });

  it("keeps a skipped setup blank except for the default voting rules", () => {
    expect(familyConfigFromSetup({ name: "Robinsons", creatorName: "Deon" })).toMatchObject({
      displayMission: null,
      missionGoals: [],
      votingWindowDays: 7,
      approvalThresholdPercent: 51,
      familySetup: { goals: [], houseRules: [], votingWindowDays: 7, approval: "MAJORITY" },
    });
  });

  it("reads back the saved answers for stewards to edit", () => {
    const setup = { mission: "Build it together.", goals: GOALS, votingWindowDays: 3, approval: "TWO_THIRDS", houseRules: ["Be on time."] };
    const config = familyConfigFromSetup({ name: "Robinsons", creatorName: "Deon", setup: setup as never });
    expect(familySetupFromConfig({ ...config, familySetup: config.familySetup })).toEqual(setup);
  });

  it("reads an older family without its placeholder goals", () => {
    expect(
      familySetupFromConfig({
        familySetup: null,
        displayMission: null,
        missionGoals: [
          { key: "stay_connected", label: "Stay connected", priorityWeight: 0.5 },
          { key: "support_each_other", label: "Support each other", priorityWeight: 0.5 },
        ],
        votingWindowDays: 7,
        approvalThresholdPercent: 51,
      }),
    ).toEqual({ goals: [], votingWindowDays: 7, approval: "MAJORITY", houseRules: [] });
    expect(
      familySetupFromConfig({
        familySetup: null,
        displayMission: "Our why.",
        missionGoals: [{ key: "buy_land", label: "Buy land", priorityWeight: 1 }],
        votingWindowDays: 10,
        approvalThresholdPercent: 67,
      }),
    ).toMatchObject({
      mission: "Our why.",
      goals: [{ label: "Buy land", priorityPercent: 100 }],
      votingWindowDays: 7,
      approval: "TWO_THIRDS",
    });
  });

  it("rejects voting windows and lists outside the guided choices", () => {
    expect(familySetupSchema.safeParse({ votingWindowDays: 5 }).success).toBe(false);
    expect(
      familySetupSchema.safeParse({ goals: Array.from({ length: 7 }, (_, i) => ({ label: `Goal ${i}` })) }).success,
    ).toBe(false);
    expect(familySetupSchema.safeParse({ houseRules: Array(6).fill("Be on time.") }).success).toBe(false);
  });
});
