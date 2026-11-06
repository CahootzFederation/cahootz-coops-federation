import { db } from "@repo/db";

type Db = typeof db;

function cleanText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** Key of the product profile made for a Commons that didn't have one. */
export function commonsProfileKey(coopId: string): string {
  return `commons-${coopId}`;
}

const DEFAULT_EXCLUDED_TERMS = ["age-restricted", "hazardous", "single-use novelty"];

/**
 * Give every real Commons and family (not demo ones) a product profile, so the
 * product bot searches for each of them. A new profile starts from the
 * Commons' name and description; its charter and goals are read at search
 * time, and an admin can edit the brief later. New profiles stay off the
 * public homepage, since family Commons are private. Returns how many it made.
 */
export async function ensureCommonsProductProfiles(database: Db = db): Promise<number> {
  const [configs, linked] = await Promise.all([
    database.coopConfig.findMany({
      where: { isActive: true, isDemo: false },
      orderBy: { version: "desc" },
      select: { coopId: true, name: true, description: true, displayMission: true, joinPolicy: true },
    }),
    database.commonsProductProfile.findMany({ where: { coopId: { not: null } }, select: { coopId: true } }),
  ]);
  const covered = new Set(linked.map((profile) => profile.coopId));
  const missing = new Map<string, (typeof configs)[number]>();
  for (const config of configs) {
    if (!covered.has(config.coopId) && !missing.has(config.coopId)) missing.set(config.coopId, config);
  }
  if (missing.size === 0) return 0;
  const created = await database.commonsProductProfile.createMany({
    data: [...missing.values()].map((config) => {
      const name = cleanText(config.name ?? "", 120) || config.coopId;
      const family = config.joinPolicy === "INVITE_ONLY";
      return {
        key: commonsProfileKey(config.coopId),
        coopId: config.coopId,
        name,
        description:
          cleanText(config.description || config.displayMission || "", 500)
          || `Things ${name} ${family ? "family members" : "members"} buy again and again.`,
        participantLabel: family ? "family members" : "members",
        searchPrompt: `Find practical, repeat-purchase products that ${name} ${family ? "family members" : "members"} could buy together in bulk, with clear public bulk pricing.`,
        excludedTerms: DEFAULT_EXCLUDED_TERMS,
        displayOrder: 100,
      };
    }),
    // Two callers at once both try the same keys; the second just skips them.
    skipDuplicates: true,
  });
  return created.count;
}
