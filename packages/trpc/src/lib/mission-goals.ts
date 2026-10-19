/** Mission goal helpers shared by config edits and amendments members vote through. */
export type MissionGoalConfig = {
  key: string;
  label: string;
  priorityWeight: number;
  description?: string;
  domain?: string;
  expertRequired?: boolean;
  scoringRubric?: string;
};

export function missionGoalKeyFromLabel(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return key || "goal";
}

export function withGeneratedMissionGoalKeys(goals: MissionGoalConfig[]): MissionGoalConfig[] {
  const seen = new Map<string, number>();

  return goals.map((goal) => {
    const label = goal.label.trim() || goal.key || "Goal";
    const baseKey = missionGoalKeyFromLabel(label);
    const count = seen.get(baseKey) ?? 0;
    seen.set(baseKey, count + 1);

    return {
      ...goal,
      label,
      key: count === 0 ? baseKey : `${baseKey}_${count + 1}`,
    };
  });
}

/** The next applied-change sequence number for a config's audit trail. */
export async function nextSequence(db: any, coopConfigId: string): Promise<number> {
  const last = await db.coopConfigAudit.findFirst({
    where: { coopConfigId, status: "APPLIED" },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? 0) + 1;
}
