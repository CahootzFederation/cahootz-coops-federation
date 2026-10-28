import { createHash, randomUUID } from "node:crypto";
import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";

import { db, Prisma } from "@repo/db";

import { recordAgentResultCost } from "./ai-cost.js";

const PRODUCT_DISCOVERY_AGENT_KEY = "shared-price-product-discovery";
const DEFAULT_MODEL = "gpt-5-nano";
const MAX_SOURCE_TEXT_LENGTH = 2_000;
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
});

const ProductDiscoveryOutputSchema = z.object({
  candidates: z.array(ProductCandidateSchema).max(8),
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

export interface ProductDiscoveryProvider {
  discover(input: {
    profile: DiscoveryProfile;
    query: string;
    model: string;
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
  const parsed = ProductCandidateSchema.safeParse(candidate);
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

function buildDiscoveryQuery(profile: DiscoveryProfile): string {
  return [
    profile.searchPrompt,
    `Useful product themes: ${profile.searchTerms.join(", ") || "everyday essentials"}.`,
    profile.excludedTerms.length > 0
      ? `Exclude: ${profile.excludedTerms.join(", ")}.`
      : "",
    `Return at most ${profile.maxCandidatesPerRun} candidates.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const openAiProductDiscoveryProvider: ProductDiscoveryProvider = {
  async discover({ profile, query, model }) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for product discovery.");
    }

    const agent = new Agent({
      name: "Shared-price Product Research Agent",
      model,
      outputType: ProductDiscoveryOutputSchema,
      tools: [webSearchTool()],
      modelSettings: { toolChoice: "auto" },
      instructions: [
        "Find real bulk or wholesale products that could support a shared-price offer for one Commons.",
        "Use web_search. Prefer primary supplier, manufacturer, wholesale, distributor, or official product pages.",
        "Every candidate needs a public supplier URL, a defensible per-member bulk price, a public comparison price, a minimum participant count, and short source-backed facts.",
        "Do not invent discounts, prices, minimum quantities, images, certifications, product claims, or supplier relationships.",
        "If a price or minimum order is unclear, omit the candidate instead of estimating it.",
        "Use risksOrUnverifiedClaims for shipping, tax, wholesale eligibility, stock, geography, or any claim that still needs human verification.",
        "These are review candidates only. Do not describe them as approved, live, affiliated, or purchasable through Cahootz.",
        `Return no more than ${profile.maxCandidatesPerRun} strong candidates; fewer is better than weak evidence.`,
      ].join("\n"),
    });

    const input = [
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      `Commons: ${profile.name}`,
      `Commons description: ${profile.description}`,
      "Product research brief:",
      query,
    ].join("\n");
    const result = await run(agent, input);
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
      candidates: output?.candidates ?? [],
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
  trigger?: "scheduled" | "manual";
  idempotencyKey?: string;
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

  const query = buildDiscoveryQuery(profile);
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
  });
  const runRecord = acquiredRun.run;
  if (!runRecord)
    throw new Error("Product discovery run could not be created.");
  if (!acquiredRun.created) {
    return { runId: runRecord.id, status: "duplicate" as const };
  }

  const completedThisMonth = await database.productDiscoveryRun.count({
    where: {
      profileId: profile.id,
      status: "SUCCEEDED",
      startedAt: { gte: startOfUtcMonth(now) },
    },
  });
  if (completedThisMonth >= profile.monthlyRunLimit) {
    await database.productDiscoveryRun.update({
      where: { id: runRecord.id },
      data: {
        status: "SKIPPED",
        error: `Monthly run limit of ${profile.monthlyRunLimit} reached.`,
        finishedAt: now,
      },
    });
    return { runId: runRecord.id, status: "skipped_limit" as const };
  }

  try {
    const crossCommonsCount = await addCrossCommonsCandidates({
      database,
      profile,
      runId: runRecord.id,
    });
    const discovery = await (
      params.provider ?? openAiProductDiscoveryProvider
    ).discover({
      profile,
      query,
      model,
    });
    const candidates = discovery.candidates
      .map(candidateForStorage)
      .filter((candidate): candidate is ProductDiscoveryCandidate =>
        Boolean(candidate),
      )
      .slice(0, profile.maxCandidatesPerRun);

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
            discoveredByRunId: runRecord.id,
          },
        });
      }
    }

    await database.$transaction([
      database.productDiscoveryRun.update({
        where: { id: runRecord.id },
        data: {
          status: "SUCCEEDED",
          candidateCount: discovery.candidates.length,
          savedProductCount,
          savedMatchCount,
          finishedAt: now,
        },
      }),
      database.commonsProductProfile.update({
        where: { id: profile.id },
        data: { lastDiscoveredAt: now },
      }),
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
    await database.productDiscoveryRun.update({
      where: { id: runRecord.id },
      data: {
        status: "FAILED",
        error: cleanText(message, 2_000),
        finishedAt: now,
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
