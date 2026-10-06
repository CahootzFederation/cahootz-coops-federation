import { z } from "zod";

/**
 * The guided part of starting a family: what the family will build together
 * (its mission goals), why, and how it decides (its agreement, stored as the
 * commons charter). Pure functions, so the app can preview the agreement
 * before anything is saved.
 *
 * A family's goals are things it owns or runs together. The agreement says
 * shared money never covers one person's bills or loans, and that the
 * creator is only an interim steward until the family elects its own.
 *
 * Skipped answers stay blank: no goals and no mission until the family sets
 * them. Voting keeps a working default (7 days, more than half) so a family
 * can always decide something. Stewards can change every answer later, but
 * only while everyone in the family is a steward.
 */

export const FAMILY_VOTING_WINDOWS = [3, 7, 14] as const;
export const FAMILY_MAX_GOALS = 6;
export const FAMILY_MAX_HOUSE_RULES = 5;
/** At least half the family has to vote for a family decision to count. */
export const FAMILY_QUORUM_PERCENT = 50;

const APPROVAL_PERCENT = { MAJORITY: 51, TWO_THIRDS: 67 } as const;

export const familyGoalSchema = z.object({
  label: z.string().trim().min(2).max(80),
  detail: z.string().trim().max(160).optional(),
  targetAmountUSD: z.number().int().positive().max(10_000_000).optional(),
  targetMonths: z.number().int().min(1).max(120).optional(),
});

export const familySetupSchema = z.object({
  mission: z.string().trim().max(280).optional(),
  goals: z.array(familyGoalSchema).max(FAMILY_MAX_GOALS).default([]),
  votingWindowDays: z
    .number()
    .int()
    .refine((days) => (FAMILY_VOTING_WINDOWS as readonly number[]).includes(days), {
      message: "Pick 3, 7 or 14 days.",
    })
    .default(7),
  approval: z.enum(["MAJORITY", "TWO_THIRDS"]).default("MAJORITY"),
  houseRules: z.array(z.string().trim().min(3).max(200)).max(FAMILY_MAX_HOUSE_RULES).default([]),
});

export type FamilyGoalInput = z.infer<typeof familyGoalSchema>;
export type FamilySetupInput = z.input<typeof familySetupSchema>;
type FamilySetup = z.output<typeof familySetupSchema>;

/**
 * The two placeholder goals every family got before guided setup. They were
 * never the family's own choice, so they read back as no goals.
 */
const LEGACY_PLACEHOLDER_GOAL_KEYS = new Set(["stay_connected", "support_each_other"]);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatFamilyTimeframe(months: number) {
  if (months % 12 === 0) return months === 12 ? "1 year" : `${months / 12} years`;
  return months === 1 ? "1 month" : `${months} months`;
}

/** "$6,000 within 1 year", "$6,000" or "" when the goal has no target. */
export function familyGoalTarget(goal: FamilyGoalInput) {
  const amount = goal.targetAmountUSD ? usd.format(goal.targetAmountUSD) : "";
  const time = goal.targetMonths ? `within ${formatFamilyTimeframe(goal.targetMonths)}` : "";
  return [amount, time].filter(Boolean).join(" ");
}

/** About how much a month the family needs to set aside for every goal with a target and timeframe. */
export function familyMonthlyPace(goals: FamilyGoalInput[]) {
  return Math.round(
    goals.reduce(
      (sum, goal) =>
        goal.targetAmountUSD && goal.targetMonths ? sum + goal.targetAmountUSD / goal.targetMonths : sum,
      0,
    ),
  );
}

function goalKey(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "goal"
  );
}

/**
 * The family's goals in the shape the proposal engine scores against. The
 * order is the priority: the first goal weighs the most. No goals means
 * none: the family hasn't set any yet.
 */
export function familyMissionGoals(goals: FamilyGoalInput[]) {
  if (!goals.length) return [];
  const total = (goals.length * (goals.length + 1)) / 2;
  const seen = new Map<string, number>();
  return goals.map((goal, index) => {
    const base = goalKey(goal.label);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const target = familyGoalTarget(goal);
    return {
      key: count === 1 ? base : `${base}_${count}`,
      label: goal.label,
      priorityWeight: Math.round(((goals.length - index) / total) * 1000) / 1000,
      ...(goal.detail || target
        ? { description: [target && `Target: ${target}.`, goal.detail].filter(Boolean).join(" ") }
        : {}),
      scoringRubric: `Helps if it moves the family closer to "${goal.label}" with money spent on something the family owns or runs together. Paying one person's bills or lending to one member does not count.`,
    };
  });
}

/** The family's agreement, shown to everyone they invite before they join. */
export function familyCharter(params: {
  name: string;
  creatorName: string;
  setup?: FamilySetupInput;
}) {
  const setup: FamilySetup = familySetupSchema.parse(params.setup ?? {});
  const { name } = params;
  const lines = [`# ${name} family agreement`, ""];

  if (setup.mission) {
    lines.push("Why we're here");
    lines.push(setup.mission);
    lines.push("");
  }

  if (setup.goals.length) {
    lines.push("What we're building together, most important first");
    setup.goals.forEach((goal, index) => {
      const target = familyGoalTarget(goal);
      const detail = [target, goal.detail].filter(Boolean).join(". ");
      lines.push(`${index + 1}. ${goal.label}${detail ? `: ${detail}` : ""}`);
    });
    lines.push("");
  }

  lines.push("Our money");
  lines.push(
    "Money we pool goes only to things the family owns or runs together. Personal bills and loans stay between people, outside the family's shared money.",
  );
  lines.push("");

  const passes = setup.approval === "TWO_THIRDS" ? "two-thirds of the votes" : "more than half of the votes";
  lines.push("How we decide");
  lines.push(`- A family decision stays open for ${setup.votingWindowDays} days.`);
  lines.push(`- At least half the family has to vote, and it passes with ${passes}.`);
  lines.push(
    "- Stewards can change our goals and this agreement only while everyone in the family is a steward. After that, changing them is a family decision.",
  );
  lines.push("");

  lines.push("Stewards");
  lines.push(
    `- ${params.creatorName} started ${name} and is its interim steward until the family elects its stewards.`,
  );
  lines.push("- Stewards invite family members, approve requests and can remove anyone who breaks these rules.");
  lines.push("");

  lines.push("House rules");
  const rules = [
    `${name} is private. Don't share posts, photos or names from here without asking the person first.`,
    "Be kind. Disagree about ideas, not about people.",
    ...setup.houseRules,
    "Anyone can leave at any time.",
  ];
  rules.forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));

  return lines.join("\n");
}

/** Every CoopConfig field the guided setup decides. */
export function familyConfigFromSetup(params: {
  name: string;
  creatorName: string;
  setup?: FamilySetupInput;
}) {
  const setup: FamilySetup = familySetupSchema.parse(params.setup ?? {});
  return {
    familySetup: setup,
    displayMission: setup.mission || null,
    charterText: familyCharter(params),
    missionGoals: familyMissionGoals(setup.goals),
    votingWindowDays: setup.votingWindowDays,
    approvalThresholdPercent: APPROVAL_PERCENT[setup.approval],
    quorumPercent: FAMILY_QUORUM_PERCENT,
  };
}

/**
 * A family's current answers, for its stewards to edit. Families set up
 * before the answers were saved are read back from their config, without
 * the old placeholder goals.
 */
export function familySetupFromConfig(config: {
  familySetup: unknown;
  displayMission: string | null;
  missionGoals: unknown;
  votingWindowDays: number;
  approvalThresholdPercent: number;
}): FamilySetup {
  const saved = familySetupSchema.safeParse(config.familySetup);
  if (config.familySetup && saved.success) return saved.data;

  const goals = (Array.isArray(config.missionGoals) ? config.missionGoals : [])
    .filter(
      (goal): goal is { key?: string; label: string } =>
        !!goal && typeof goal === "object" && typeof (goal as { label?: unknown }).label === "string",
    )
    .filter((goal) => !LEGACY_PLACEHOLDER_GOAL_KEYS.has(goal.key ?? ""))
    .slice(0, FAMILY_MAX_GOALS)
    .map((goal) => ({ label: goal.label.slice(0, 80) }))
    .filter((goal) => goal.label.trim().length >= 2);

  return familySetupSchema.parse({
    mission: config.displayMission?.slice(0, 280) || undefined,
    goals,
    votingWindowDays: (FAMILY_VOTING_WINDOWS as readonly number[]).includes(config.votingWindowDays)
      ? config.votingWindowDays
      : 7,
    approval: config.approvalThresholdPercent >= APPROVAL_PERCENT.TWO_THIRDS ? "TWO_THIRDS" : "MAJORITY",
    houseRules: [],
  });
}
