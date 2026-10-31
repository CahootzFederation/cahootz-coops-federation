import { createHash, randomUUID } from "node:crypto";
import { Agent, run, tool, webSearchTool } from "@openai/agents";
import { z } from "zod";

import { db, Prisma } from "@repo/db";

import { recordAgentResultCost } from "./ai-cost.js";

const PRODUCT_DISCOVERY_AGENT_KEY = "shared-price-product-discovery";
const DEFAULT_MODEL = "gpt-5-nano";
const MAX_SOURCE_TEXT_LENGTH = 2_000;
const MAX_CHARTER_LENGTH = 4_000;
export const MAX_HINT_LENGTH = 1_000;
const MAX_GOALS = 12;
// Strong deals that miss the charter or goals are kept for an admin to look at, a few per run.
const MAX_OFF_GOAL_PER_RUN = 2;
// A run's step-by-step log is for watching it, so a long run keeps its first entries.
const MAX_PROGRESS_ENTRIES = 80;

/** One thing a run did, shown live to admins: a step, a web search, a page it opened, or a find. */
export interface DiscoveryProgressEntry {
  at: string;
  kind: "step" | "search" | "page" | "find";
  text: string;
  url?: string;
}
type ReportProgress = (entry: Omit<DiscoveryProgressEntry, "at">) => void;
const VALID_TONES = new Set(["pear", "sky", "mint", "coral", "lavender"]);

const ProductCandidateSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().min(1).max(MAX_SOURCE_TEXT_LENGTH),
  category: z.string().min(1).max(80),
  brand: z.string().min(1).max(120),
  supplierName: z.string().min(1).max(160),
  imageUrl: z.string().max(2_000).optional().default(""),
  imageAlt: z.string().max(300).optional().default(""),
  sourceUrl: z.string().min(1).max(2_000),
  comparisonUrl: z.string().max(2_000).optional().default(""),
  memberShare: z.string().min(1).max(120),
  peopleNeeded: z.number().int().min(2).max(10_000),
  regularPriceCents: z.number().int().positive().max(100_000_000),
  bulkShareCents: z.number().int().positive().max(100_000_000),
  purpose: z.string().min(1).max(1_000),
  fitScore: z.number().int().min(0).max(100),
  fitReason: z.string().min(1).max(1_000),
  tone: z.enum(["pear", "sky", "mint", "coral", "lavender"]),
  verifiedFacts: z.array(z.string().min(1).max(500)).max(12),
  risksOrUnverifiedClaims: z.array(z.string().min(1).max(500)).max(12),
  goalFit: z.enum(["fits", "does_not_fit"]).optional(),
  goalFitReason: z.string().max(1_000).optional(),
});

// What the model is asked to return. Nothing per item is enforced here (lengths,
// or even which fields are present): the library rejects the whole answer when
// one item fails, which threw away every good find. candidateForStorage checks
// each item on its own, trims text to the stored limits and drops what's left
// incomplete.
const ProductDiscoveryOutputSchema = z.object({
  candidates: z.array(
    ProductCandidateSchema.extend({
      name: z.string(),
      description: z.string(),
      category: z.string(),
      brand: z.string(),
      supplierName: z.string(),
      imageAlt: z.string().optional().default(""),
      memberShare: z.string(),
      purpose: z.string(),
      fitReason: z.string(),
      goalFitReason: z.string().optional(),
      verifiedFacts: z.array(z.string()),
      risksOrUnverifiedClaims: z.array(z.string()),
    }).partial(),
  ),
});

export type ProductDiscoveryCandidate = z.infer<typeof ProductCandidateSchema>;

export interface HomepageProduct {
  id: string;
  name: string;
  category: string;
  brand: string;
  imageUrl: string;
  imageAlt: string;
  productUrl: string;
  comparisonUrl?: string;
  memberShare: string;
  peopleNeeded: number;
  regularPriceCents: number;
  bulkShareCents: number;
  purpose: string;
  tone: "pear" | "sky" | "mint" | "coral" | "lavender";
}

export interface HomepageProductCatalog {
  id: string;
  name: string;
  description: string;
  participantLabel: string;
  products: HomepageProduct[];
}

export function limitSharedProductsBetweenCatalogs(
  catalogs: HomepageProductCatalog[],
  maxSharedPerPair = 2,
): HomepageProductCatalog[] {
  const accepted: HomepageProductCatalog[] = [];

  for (const catalog of catalogs) {
    const products: HomepageProduct[] = [];
    for (const product of catalog.products) {
      const canInclude = accepted.every((earlierCatalog) => {
        const earlierIds = new Set(earlierCatalog.products.map(({ id }) => id));
        if (!earlierIds.has(product.id)) return true;
        const sharedCount = products.filter(({ id }) =>
          earlierIds.has(id),
        ).length;
        return sharedCount < maxSharedPerPair;
      });
      if (canInclude) products.push(product);
    }
    accepted.push({ ...catalog, products });
  }

  return accepted;
}

interface DiscoveryProfile {
  id: string;
  key: string;
  coopId: string | null;
  name: string;
  description: string;
  searchPrompt: string;
  searchTerms: string[];
  excludedTerms: string[];
  maxCandidatesPerRun: number;
  monthlyRunLimit: number;
}

/** The linked Commons' charter and goals, which every candidate is checked against. */
export interface CommonsGoals {
  charter: string;
  goals: Array<{ label: string; description: string }>;
}

export interface ProductDiscoveryProvider {
  discover(input: {
    profile: DiscoveryProfile;
    query: string;
    model: string;
    commons: CommonsGoals | null;
    onProgress?: ReportProgress;
  }): Promise<{
    candidates: ProductDiscoveryCandidate[];
    rawInput?: unknown;
    rawOutput?: unknown;
  }>;
}

function cleanText(value: string, maxLength = MAX_SOURCE_TEXT_LENGTH): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizePublicHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sourceKey(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl).digest("hex");
}

function evidenceHash(candidate: ProductDiscoveryCandidate): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceUrl: candidate.sourceUrl,
        comparisonUrl: candidate.comparisonUrl || null,
        memberShare: candidate.memberShare,
        peopleNeeded: candidate.peopleNeeded,
        regularPriceCents: candidate.regularPriceCents,
        bulkShareCents: candidate.bulkShareCents,
        verifiedFacts: candidate.verifiedFacts,
        risksOrUnverifiedClaims: candidate.risksOrUnverifiedClaims,
      }),
    )
    .digest("hex");
}

function candidateForStorage(
  candidate: ProductDiscoveryCandidate,
): ProductDiscoveryCandidate | null {
  const cut = (value: unknown, max: number) =>
    typeof value === "string" ? cleanText(value, max) : value;
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.slice(0, 12).map((item) => cut(item, 500))
      : value;
  const parsed = ProductCandidateSchema.safeParse({
    ...candidate,
    name: cut(candidate.name, 160),
    description: cut(candidate.description, MAX_SOURCE_TEXT_LENGTH),
    category: cut(candidate.category, 80),
    brand: cut(candidate.brand, 120),
    supplierName: cut(candidate.supplierName, 160),
    imageAlt: cut(candidate.imageAlt, 300),
    memberShare: cut(candidate.memberShare, 120),
    purpose: cut(candidate.purpose, 1_000),
    fitReason: cut(candidate.fitReason, 1_000),
    goalFitReason: cut(candidate.goalFitReason, 1_000),
    verifiedFacts: list(candidate.verifiedFacts),
    risksOrUnverifiedClaims: list(candidate.risksOrUnverifiedClaims),
  });
  if (!parsed.success) return null;

  const sourceUrl = normalizePublicHttpUrl(parsed.data.sourceUrl);
  const comparisonUrl = parsed.data.comparisonUrl
    ? normalizePublicHttpUrl(parsed.data.comparisonUrl)
    : null;
  const imageUrl = parsed.data.imageUrl
    ? normalizePublicHttpUrl(parsed.data.imageUrl)
    : null;

  if (!sourceUrl) return null;
  if (parsed.data.bulkShareCents >= parsed.data.regularPriceCents) return null;

  return {
    ...parsed.data,
    name: cleanText(parsed.data.name, 160),
    description: cleanText(parsed.data.description),
    category: cleanText(parsed.data.category, 80),
    brand: cleanText(parsed.data.brand, 120),
    supplierName: cleanText(parsed.data.supplierName, 160),
    sourceUrl,
    comparisonUrl: comparisonUrl ?? "",
    imageUrl: imageUrl ?? "",
    imageAlt: cleanText(parsed.data.imageAlt, 300),
    memberShare: cleanText(parsed.data.memberShare, 120),
    purpose: cleanText(parsed.data.purpose, 1_000),
    fitReason: cleanText(parsed.data.fitReason, 1_000),
    goalFitReason: cleanText(parsed.data.goalFitReason ?? "", 1_000),
    verifiedFacts: parsed.data.verifiedFacts.map((fact) =>
      cleanText(fact, 500),
    ),
    risksOrUnverifiedClaims: parsed.data.risksOrUnverifiedClaims.map((risk) =>
      cleanText(risk, 500),
    ),
  };
}

function profileTokens(
  profile: Pick<DiscoveryProfile, "searchPrompt" | "searchTerms">,
) {
  return new Set(
    [profile.searchPrompt, ...profile.searchTerms]
      .join(" ")
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g) ?? [],
  );
}

export function scoreExistingProductForProfile(
  profile: Pick<
    DiscoveryProfile,
    "searchPrompt" | "searchTerms" | "excludedTerms"
  >,
  product: Pick<
    ProductDiscoveryCandidate,
    "name" | "description" | "category" | "brand"
  >,
): number {
  const haystack = [
    product.name,
    product.description,
    product.category,
    product.brand,
  ]
    .join(" ")
    .toLowerCase();
  if (
    profile.excludedTerms.some((term) =>
      haystack.includes(term.trim().toLowerCase()),
    )
  ) {
    return 0;
  }

  const tokens = profileTokens(profile);
  if (tokens.size === 0) return 0;
  const matches = [...tokens].filter((token) => haystack.includes(token));
  return Math.min(100, Math.round((matches.length / tokens.size) * 100));
}

export function buildDiscoveryQuery(profile: Pick<DiscoveryProfile, "searchPrompt" | "searchTerms" | "excludedTerms" | "maxCandidatesPerRun">, hint?: string | null): string {
  return [
    profile.searchPrompt,
    hint
      ? `For this search only, an admin asked you to look for: "${hint}". Start there and open any links they gave. Still follow the rest of this brief, the exclusions, and the Commons' charter and goals.`
      : "",
    `Useful product themes: ${profile.searchTerms.join(", ") || "everyday essentials"}.`,
    profile.excludedTerms.length > 0
      ? `Exclude: ${profile.excludedTerms.join(", ")}.`
      : "",
    `Return at most ${profile.maxCandidatesPerRun} candidates.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The active charter and goals of the Commons a profile is linked to, or null when there's nothing to check. */
export async function loadCommonsGoals(
  database: typeof db,
  coopId: string | null,
): Promise<CommonsGoals | null> {
  if (!coopId) return null;
  const config = await database.coopConfig.findFirst({
    where: { coopId, isActive: true },
    orderBy: { version: "desc" },
    select: { charterText: true, missionGoals: true },
  });
  if (!config) return null;
  const goals = (Array.isArray(config.missionGoals) ? config.missionGoals : [])
    .flatMap((goal) => {
      const value = goal as { label?: unknown; description?: unknown };
      return typeof value.label === "string" && value.label.trim()
        ? [{
            label: cleanText(value.label, 200),
            description: typeof value.description === "string" ? cleanText(value.description, 500) : "",
          }]
        : [];
    })
    .slice(0, MAX_GOALS);
  const charter = cleanText(config.charterText ?? "", MAX_CHARTER_LENGTH);
  return charter || goals.length > 0 ? { charter, goals } : null;
}

export function buildDiscoveryInstructions(maxCandidates: number, commons: CommonsGoals | null): string {
  return [
    "Find real bulk or wholesale products that could support a shared-price offer for one Commons.",
    "Use web_search. Prefer primary supplier, manufacturer, wholesale, distributor, or official product pages.",
    "Every candidate needs a public supplier URL, a defensible per-member bulk price, a public comparison price, a minimum participant count, and short source-backed facts.",
    "Do not invent discounts, prices, minimum quantities, images, certifications, product claims, or supplier relationships.",
    "If a price or minimum order is unclear, omit the candidate instead of estimating it.",
    "Use risksOrUnverifiedClaims for shipping, tax, wholesale eligibility, stock, geography, or any claim that still needs human verification.",
    "These are review candidates only. Do not describe them as approved, live, affiliated, or purchasable through Cahootz.",
    "Each time you settle on a candidate, call note_find once with its name, supplier and page URL, before your final answer. It only records progress.",
    ...(commons
      ? [
          "The Commons' charter and goals are in the input. Look for products that help those goals, and check every candidate against them.",
          'Set goalFit to "fits" when the product clearly helps at least one goal and nothing in the charter rules it out. Otherwise set "does_not_fit".',
          "In goalFitReason, name the goal it helps, or say which goal it misses or which part of the charter it conflicts with, in one plain sentence.",
          `Return no more than ${maxCandidates} strong candidates that fit; fewer is better than weak evidence.`,
          `You may also return up to ${MAX_OFF_GOAL_PER_RUN} strong deals you came across that don't fit, marked "does_not_fit", so a person can decide. Don't search for extra ones just to fill this.`,
        ]
      : [
          "Leave goalFit and goalFitReason out.",
          `Return no more than ${maxCandidates} strong candidates; fewer is better than weak evidence.`,
        ]),
  ].join("\n");
}

export function buildDiscoveryInput(params: {
  profile: Pick<DiscoveryProfile, "name" | "description">;
  query: string;
  commons: CommonsGoals | null;
  today: Date;
}): string {
  const { commons } = params;
  return [
    `Today: ${params.today.toISOString().slice(0, 10)}`,
    `Commons: ${params.profile.name}`,
    `Commons description: ${params.profile.description}`,
    ...(commons
      ? [
          "Commons goals:",
          ...(commons.goals.length > 0
            ? commons.goals.map((goal) => `- ${goal.label}${goal.description ? `: ${goal.description}` : ""}`)
            : ["- (none listed)"]),
          "Commons charter:",
          commons.charter || "(none written)",
        ]
      : []),
    "Product research brief:",
    params.query,
  ].join("\n");
}

/** A finished web search or page visit from the model's raw stream, as a progress line; null for anything else. */
export function progressFromModelEvent(raw: unknown): Omit<DiscoveryProgressEntry, "at"> | null {
  const event = raw as { type?: string; item?: { type?: string; action?: { type?: string; query?: unknown; url?: unknown } } } | null;
  if (event?.type !== "response.output_item.done" || event.item?.type !== "web_search_call") return null;
  const action = event.item.action;
  if (action?.type === "search" && typeof action.query === "string" && action.query.trim()) {
    return { kind: "search", text: cleanText(action.query, 300) };
  }
  if (action?.type === "open_page" && typeof action.url === "string") {
    const url = normalizePublicHttpUrl(action.url);
    return url ? { kind: "page", text: new URL(url).hostname.replace(/^www\./, ""), url } : null;
  }
  return null;
}

const openAiProductDiscoveryProvider: ProductDiscoveryProvider = {
  async discover({ profile, query, model, commons, onProgress }) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for product discovery.");
    }

    const agent = new Agent({
      name: "Shared-price Product Research Agent",
      model,
      outputType: ProductDiscoveryOutputSchema,
      tools: [
        webSearchTool(),
        tool({
          name: "note_find",
          description: "Record that you settled on a candidate, so people watching the search can see it. Returns nothing useful.",
          parameters: z.object({ name: z.string(), supplier: z.string(), url: z.string() }),
          execute: async ({ name, supplier, url }) => {
            onProgress?.({
              kind: "find",
              text: cleanText(`${name} from ${supplier}`, 300),
              url: normalizePublicHttpUrl(url) ?? undefined,
            });
            return "Noted.";
          },
        }),
      ],
      modelSettings: { toolChoice: "auto" },
      instructions: buildDiscoveryInstructions(profile.maxCandidatesPerRun, commons),
    });

    const input = buildDiscoveryInput({ profile, query, commons, today: new Date() });
    const result = await run(agent, input, { stream: true });
    // Web searches happen inside one model response, so they're read from the raw stream as they finish.
    for await (const event of result) {
      if (event.type !== "raw_model_stream_event" || event.data.type !== "model") continue;
      const entry = progressFromModelEvent(event.data.event);
      if (entry) onProgress?.(entry);
    }
    await result.completed;
    await recordAgentResultCost({
      coopId: profile.coopId,
      feature: PRODUCT_DISCOVERY_AGENT_KEY,
      model,
      result,
    }).catch(console.error);

    const output =
      (
        result as unknown as {
          finalOutput?: z.infer<typeof ProductDiscoveryOutputSchema>;
          output?: z.infer<typeof ProductDiscoveryOutputSchema>;
        }
      ).finalOutput ??
      (
        result as unknown as {
          output?: z.infer<typeof ProductDiscoveryOutputSchema>;
        }
      ).output;

    return {
      candidates: (output?.candidates ?? []) as ProductDiscoveryCandidate[],
      rawInput: { input, model },
      rawOutput: output ?? null,
    };
  },
};

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function createRun(params: {
  database: typeof db;
  profile: DiscoveryProfile;
  idempotencyKey: string;
  trigger: string;
  model: string;
  query: string;
  hint: string | null;
}) {
  try {
    return {
      created: true,
      run: await params.database.productDiscoveryRun.create({
        data: {
          profileId: params.profile.id,
          idempotencyKey: params.idempotencyKey,
          status: "RUNNING",
          trigger: params.trigger,
          model: params.model,
          query: params.query,
          hint: params.hint,
        },
      }),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await params.database.productDiscoveryRun.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existing?.status === "FAILED") {
        const recovered = await params.database.productDiscoveryRun.updateMany({
          where: {
            id: existing.id,
            status: "FAILED",
          },
          data: {
            status: "RUNNING",
            error: null,
            startedAt: new Date(),
            finishedAt: null,
          },
        });
        if (recovered.count === 1) {
          return {
            created: true,
            run: await params.database.productDiscoveryRun.findUnique({
              where: { id: existing.id },
            }),
          };
        }
      }
      return {
        created: false,
        run: existing,
      };
    }
    throw error;
  }
}

async function addCrossCommonsCandidates(params: {
  database: typeof db;
  profile: DiscoveryProfile;
  runId: string;
}) {
  const existingMatches = await params.database.commonsProductMatch.findMany({
    where: { profileId: params.profile.id },
    select: { productId: true },
  });
  const excludedProductIds = existingMatches.map(({ productId }) => productId);
  const products = await params.database.sourcedProduct.findMany({
    where: {
      status: "VERIFIED",
      id:
        excludedProductIds.length > 0
          ? { notIn: excludedProductIds }
          : undefined,
    },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      brand: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  let saved = 0;
  for (const product of products) {
    const fitScore = scoreExistingProductForProfile(params.profile, product);
    if (fitScore < 20) continue;

    await params.database.commonsProductMatch.create({
      data: {
        profileId: params.profile.id,
        productId: product.id,
        status: "CANDIDATE",
        fitScore,
        fitReason:
          "An existing verified catalog item overlaps this Commons' product brief.",
        purpose: `A cross-Commons candidate for ${params.profile.name}; member review is still required.`,
        discoveredByRunId: params.runId,
      },
    });
    saved += 1;
    if (saved >= params.profile.maxCandidatesPerRun) break;
  }
  return saved;
}

export async function runProductDiscoveryForProfile(params: {
  profileKey: string;
  /**
   * "admin" is a platform admin's extra search from the outreach page. It
   * neither counts toward nor is stopped by the profile's monthly limit, and
   * it leaves the profile's schedule where it was.
   */
  trigger?: "scheduled" | "manual" | "admin";
  idempotencyKey?: string;
  /** What an admin asked this one search to look for (text and/or links). */
  hint?: string | null;
  now?: Date;
  provider?: ProductDiscoveryProvider;
  model?: string;
  database?: typeof db;
}) {
  const database = params.database ?? db;
  const now = params.now ?? new Date();
  const profile = await database.commonsProductProfile.findUnique({
    where: { key: params.profileKey },
    select: {
      id: true,
      key: true,
      coopId: true,
      name: true,
      description: true,
      searchPrompt: true,
      searchTerms: true,
      excludedTerms: true,
      maxCandidatesPerRun: true,
      monthlyRunLimit: true,
      isEnabled: true,
    },
  });
  if (!profile)
    throw new Error(`Unknown product discovery profile: ${params.profileKey}`);
  if (!profile.isEnabled)
    throw new Error(`Product discovery is disabled for ${profile.name}.`);

  const hint = params.hint ? cleanText(params.hint, MAX_HINT_LENGTH) || null : null;
  const query = buildDiscoveryQuery(profile, hint);
  const model =
    params.model ?? process.env.PRODUCT_DISCOVERY_MODEL ?? DEFAULT_MODEL;
  const trigger = params.trigger ?? "manual";
  const idempotencyKey =
    params.idempotencyKey ??
    `${trigger}:${profile.key}:${now.toISOString()}:${randomUUID()}`;
  const acquiredRun = await createRun({
    database,
    profile,
    idempotencyKey,
    trigger,
    model,
    query,
    hint,
  });
  const runRecord = acquiredRun.run;
  if (!runRecord)
    throw new Error("Product discovery run could not be created.");
  if (!acquiredRun.created) {
    return { runId: runRecord.id, status: "duplicate" as const };
  }
  // Tests pass a fixed clock; real runs stamp the actual finish time so durations mean something.
  const finishedAt = () => params.now ?? new Date();

  const progress: DiscoveryProgressEntry[] = [];
  let progressSaved: Promise<unknown> = Promise.resolve();
  const report: ReportProgress = (entry) => {
    if (progress.length >= MAX_PROGRESS_ENTRIES) return;
    progress.push({ ...entry, at: new Date().toISOString() });
    const snapshot = [...progress];
    // Saved in order, one at a time; a failed write only loses a progress line.
    progressSaved = progressSaved
      .then(() =>
        database.productDiscoveryRun.update({
          where: { id: runRecord.id },
          data: { progress: snapshot as unknown as Prisma.InputJsonValue },
        }),
      )
      .catch(() => undefined);
  };

  const overMonthlyLimit =
    trigger !== "admin" &&
    (await database.productDiscoveryRun.count({
      where: {
        profileId: profile.id,
        status: "SUCCEEDED",
        trigger: { not: "admin" },
        startedAt: { gte: startOfUtcMonth(now) },
      },
    })) >= profile.monthlyRunLimit;
  if (overMonthlyLimit) {
    await database.productDiscoveryRun.update({
      where: { id: runRecord.id },
      data: {
        status: "SKIPPED",
        error: `Monthly run limit of ${profile.monthlyRunLimit} reached.`,
        finishedAt: finishedAt(),
      },
    });
    return { runId: runRecord.id, status: "skipped_limit" as const };
  }

  try {
    report({ kind: "step", text: "Checking ideas other Commons already use" });
    const crossCommonsCount = await addCrossCommonsCandidates({
      database,
      profile,
      runId: runRecord.id,
    });
    if (crossCommonsCount > 0) {
      report({ kind: "step", text: `Added ${crossCommonsCount} idea${crossCommonsCount === 1 ? "" : "s"} other Commons use` });
    }
    const commons = await loadCommonsGoals(database, profile.coopId);
    if (hint) report({ kind: "step", text: `Following your hint: ${cleanText(hint, 200)}` });
    report({
      kind: "step",
      text: commons ? "Searching the web with this Commons' charter and goals in mind" : "Searching the web",
    });
    const discovery = await (
      params.provider ?? openAiProductDiscoveryProvider
    ).discover({
      profile,
      query,
      model,
      commons,
      onProgress: report,
    });
    const valid = discovery.candidates
      .map(candidateForStorage)
      .filter((candidate): candidate is ProductDiscoveryCandidate =>
        Boolean(candidate),
      );
    // Without a charter there's nothing to check, so any goal verdict is ignored.
    const offGoal = (candidate: ProductDiscoveryCandidate) =>
      Boolean(commons) && candidate.goalFit === "does_not_fit";
    const candidates = [
      ...valid
        .filter((candidate) => !offGoal(candidate))
        .slice(0, profile.maxCandidatesPerRun),
      ...valid.filter(offGoal).slice(0, MAX_OFF_GOAL_PER_RUN),
    ];
    const dropped = discovery.candidates.length - valid.length;
    const missed = candidates.filter(offGoal).length;
    report({
      kind: "step",
      text: [
        `The bot returned ${discovery.candidates.length} find${discovery.candidates.length === 1 ? "" : "s"}`,
        dropped > 0 ? `${dropped} dropped for missing details (a price, link, score or reason)` : "",
        missed > 0 ? `${missed} kept that didn't fit the goals` : "",
      ].filter(Boolean).join(", ") + ". Saving them now.",
    });

    const goalFitFields = (candidate: ProductDiscoveryCandidate) =>
      commons
        ? {
            goalFit: offGoal(candidate) ? "DOES_NOT_FIT" : "FITS",
            goalFitReason: candidate.goalFitReason || null,
          }
        : { goalFit: null, goalFitReason: null };

    let savedProductCount = 0;
    let savedMatchCount = crossCommonsCount;
    for (const candidate of candidates) {
      const candidateSourceKey = sourceKey(candidate.sourceUrl);
      let product = await database.sourcedProduct.findUnique({
        where: { sourceKey: candidateSourceKey },
        select: { id: true, status: true },
      });
      // A global rejection is stronger than a new Commons-level match. Keep
      // the evidence in its original audit trail, but never revive the item.
      if (product?.status === "REJECTED") continue;
      if (!product) {
        product = await database.sourcedProduct.create({
          data: {
            sourceKey: candidateSourceKey,
            sourceUrl: candidate.sourceUrl,
            name: candidate.name,
            description: candidate.description,
            category: candidate.category,
            brand: candidate.brand,
            supplierName: candidate.supplierName,
            imageUrl: candidate.imageUrl || null,
            imageAlt: candidate.imageAlt || null,
            status: "CANDIDATE",
          },
          select: { id: true, status: true },
        });
        savedProductCount += 1;
      }

      const candidateEvidenceHash = evidenceHash(candidate);
      const existingObservation =
        await database.productPriceObservation.findUnique({
          where: {
            productId_evidenceHash: {
              productId: product.id,
              evidenceHash: candidateEvidenceHash,
            },
          },
          select: { id: true },
        });
      if (!existingObservation) {
        await database.productPriceObservation.create({
          data: {
            productId: product.id,
            discoveryRunId: runRecord.id,
            sourceUrl: candidate.sourceUrl,
            comparisonUrl: candidate.comparisonUrl || null,
            memberShare: candidate.memberShare,
            peopleNeeded: candidate.peopleNeeded,
            regularPriceCents: candidate.regularPriceCents,
            bulkShareCents: candidate.bulkShareCents,
            verifiedFacts: candidate.verifiedFacts,
            risksOrUnverifiedClaims: candidate.risksOrUnverifiedClaims,
            evidenceHash: candidateEvidenceHash,
            observedAt: now,
          },
        });
      }

      const existingMatch = await database.commonsProductMatch.findUnique({
        where: {
          profileId_productId: {
            profileId: profile.id,
            productId: product.id,
          },
        },
        select: { status: true },
      });
      if (!existingMatch) {
        await database.commonsProductMatch.create({
          data: {
            profileId: profile.id,
            productId: product.id,
            status: "CANDIDATE",
            fitScore: candidate.fitScore,
            fitReason: candidate.fitReason,
            purpose: candidate.purpose,
            tone: candidate.tone,
            ...goalFitFields(candidate),
            discoveredByRunId: runRecord.id,
          },
        });
        savedMatchCount += 1;
      } else if (existingMatch.status === "CANDIDATE") {
        await database.commonsProductMatch.update({
          where: {
            profileId_productId: {
              profileId: profile.id,
              productId: product.id,
            },
          },
          data: {
            fitScore: candidate.fitScore,
            fitReason: candidate.fitReason,
            purpose: candidate.purpose,
            tone: candidate.tone,
            ...goalFitFields(candidate),
            discoveredByRunId: runRecord.id,
          },
        });
      }
    }

    report({
      kind: "step",
      text: savedMatchCount === 0 ? "Done. Nothing new this time." : `Done. ${savedMatchCount} new idea${savedMatchCount === 1 ? "" : "s"} to review.`,
    });
    await progressSaved;
    await database.$transaction([
      database.productDiscoveryRun.update({
        where: { id: runRecord.id },
        data: {
          status: "SUCCEEDED",
          candidateCount: discovery.candidates.length,
          savedProductCount,
          savedMatchCount,
          progress: progress as unknown as Prisma.InputJsonValue,
          finishedAt: finishedAt(),
        },
      }),
      ...(trigger === "admin"
        ? []
        : [
            database.commonsProductProfile.update({
              where: { id: profile.id },
              data: { lastDiscoveredAt: now },
            }),
          ]),
      database.aIEvaluation.create({
        data: {
          agentKey: PRODUCT_DISCOVERY_AGENT_KEY,
          agentName: "Shared-price Product Research Agent",
          model,
          entityType: "CommonsProductProfile",
          entityId: profile.id,
          input: (discovery.rawInput ?? { query }) as Prisma.InputJsonValue,
          output: (discovery.rawOutput ?? {
            candidateCount: discovery.candidates.length,
          }) as Prisma.InputJsonValue,
          status: "SUCCESS",
        },
      }),
    ]);

    return {
      runId: runRecord.id,
      status: "succeeded" as const,
      candidateCount: discovery.candidates.length,
      savedProductCount,
      savedMatchCount,
      crossCommonsCount,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Product discovery failed.";
    report({ kind: "step", text: `Stopped: ${cleanText(message, 200)}` });
    await progressSaved;
    await database.productDiscoveryRun.update({
      where: { id: runRecord.id },
      data: {
        status: "FAILED",
        error: cleanText(message, 2_000),
        progress: progress as unknown as Prisma.InputJsonValue,
        finishedAt: finishedAt(),
      },
    });
    await database.aIEvaluation
      .create({
        data: {
          agentKey: PRODUCT_DISCOVERY_AGENT_KEY,
          agentName: "Shared-price Product Research Agent",
          model,
          entityType: "CommonsProductProfile",
          entityId: profile.id,
          input: { query },
          status: "ERROR",
          error: cleanText(message, 2_000),
        },
      })
      .catch(console.error);
    throw error;
  }
}

export async function listHomepageProductCatalogs(
  now = new Date(),
  database: typeof db = db,
): Promise<HomepageProductCatalog[]> {
  const profiles = await database.commonsProductProfile.findMany({
    where: { isEnabled: true, isHomepageVisible: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: {
      productMatches: {
        where: {
          status: "APPROVED",
          isHomepageFeatured: true,
          product: { status: "VERIFIED" },
        },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
        include: {
          product: {
            include: {
              priceObservations: {
                where: {
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
                orderBy: { observedAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const catalogs = profiles
    .map((profile) => ({
      id: profile.key,
      name: profile.name,
      description: profile.description,
      participantLabel: profile.participantLabel,
      products: profile.productMatches.flatMap((match) => {
        const observation = match.product.priceObservations[0];
        if (!observation || !match.product.imageUrl) return [];
        const tone = VALID_TONES.has(match.tone)
          ? (match.tone as HomepageProduct["tone"])
          : "mint";
        return [
          {
            id: match.product.sourceKey.slice(0, 16),
            name: match.product.name,
            category: match.product.category,
            brand: match.product.brand,
            imageUrl: match.product.imageUrl,
            imageAlt: match.product.imageAlt || match.product.name,
            productUrl: match.product.sourceUrl,
            comparisonUrl: observation.comparisonUrl || undefined,
            memberShare: observation.memberShare,
            peopleNeeded: observation.peopleNeeded,
            regularPriceCents: observation.regularPriceCents,
            bulkShareCents: observation.bulkShareCents,
            purpose: match.purpose,
            tone,
          },
        ];
      }),
    }))
    .filter((profile) => profile.products.length > 0);

  return limitSharedProductsBetweenCatalogs(catalogs).filter(
    (profile) => profile.products.length > 0,
  );
}
