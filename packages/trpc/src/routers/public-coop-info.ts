import { createHash, randomUUID } from "crypto";
import { Agent, run, webSearchTool } from "@openai/agents";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { AuthenticatedContext } from "../context.js";
import type { ArticleSample } from "../services/newsletter-article-agent";
import {
  authenticatedProcedure,
  privateProcedure,
  publicProcedure,
} from "../procedures";
import {
  buildArticleWriterBrief,
  extractArticleSamples,
  generateArticleDraftWithAgentOrchestration,
  hasSubjectOverlap,
} from "../services/newsletter-article-agent";
import { router } from "../trpc";

type NewsletterSubmissionType = "article" | "event";
type NewsletterSubmissionStatus = "pending" | "published" | "dismissed";
type NewsletterAgentId = "article-writer" | "event-writer";

interface PreviewOverrides {
  newsletterSubmissions?: unknown;
  newsletterResearchSources?: unknown;
  newsletterAgentSchedules?: unknown;
  [key: string]: unknown;
}

export interface NewsletterSubmission {
  id: string;
  type: NewsletterSubmissionType;
  title: string;
  summary: string;
  contentMarkdown?: string;
  date?: string;
  location?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  sourceUrl?: string;
  imageUrl?: string;
  submittedByUserId: string;
  submittedByName?: string;
  submittedByEmail?: string;
  submittedByWallet: string;
  submittedAt: string;
  status: NewsletterSubmissionStatus;
  source?: "member" | "public-contributor" | "agent";
  agentId?: NewsletterAgentId;
  agentName?: string;
  recommendedBecause?: string;
  agentPrompt?: string;
  approvalRequired?: boolean;
}

export interface NewsletterResearchSource {
  url: string;
  label?: string;
}

export interface NewsletterResearchResult {
  id: string;
  type: "event" | "article_source" | "organization" | "news";
  title: string;
  sourceUrl: string;
  sourceName: string;
  dateFound: string;
  eventDate?: string;
  location?: string;
  summary: string;
  relevanceScore: number;
  alignedGoals: string[];
  reasonForFit: string;
  risksOrUnverifiedClaims: string[];
  recommendedNextAction:
    | "draft_article"
    | "draft_event"
    | "human_review"
    | "ignore";
}

export interface NewsletterResearchCache {
  generatedAt: string;
  coopId: string;
  contextHash: string;
  sources: NewsletterResearchSource[];
  results: NewsletterResearchResult[];
  expiresAt: string;
}

const agentLabels: Record<NewsletterAgentId, string> = {
  "article-writer": "Article Writer Agent",
  "event-writer": "Event Writer Agent",
};
const NEWSLETTER_RESEARCH_CACHE_KEY = "newsletter-research";

interface NewsletterAgentSchedule {
  agentId: NewsletterAgentId;
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string;
  lastRunStatus?: "success" | "empty" | "error";
  lastRunMessage?: string;
  lastCreatedCount?: number;
  updatedAt?: string;
}

const defaultAgentSchedules: Record<
  NewsletterAgentId,
  NewsletterAgentSchedule
> = {
  "article-writer": {
    agentId: "article-writer",
    enabled: true,
    intervalHours: 168,
  },
  "event-writer": {
    agentId: "event-writer",
    enabled: true,
    intervalHours: 168,
  },
};

function normalizePreviewOverrides(value: unknown): PreviewOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PreviewOverrides)
    : {};
}

function normalizeNewsletterSubmissions(
  value: unknown,
): NewsletterSubmission[] {
  if (!Array.isArray(value)) return [];

  return value.filter((submission): submission is NewsletterSubmission => {
    return (
      typeof submission === "object" &&
      submission !== null &&
      "id" in submission &&
      "type" in submission &&
      "title" in submission &&
      "summary" in submission &&
      typeof submission.id === "string" &&
      (submission.type === "article" || submission.type === "event") &&
      typeof submission.title === "string" &&
      typeof submission.summary === "string"
    );
  });
}

function normalizeAgentSchedule(
  agentId: NewsletterAgentId,
  value: unknown,
): NewsletterAgentSchedule {
  const fallback = defaultAgentSchedules[agentId];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...fallback };
  }

  const record = value as Record<string, unknown>;
  const intervalHours =
    typeof record.intervalHours === "number" &&
    Number.isFinite(record.intervalHours)
      ? Math.min(Math.max(Math.round(record.intervalHours), 1), 24 * 60)
      : fallback.intervalHours;
  const lastRunStatus = ["success", "empty", "error"].includes(
    String(record.lastRunStatus),
  )
    ? (record.lastRunStatus as NewsletterAgentSchedule["lastRunStatus"])
    : undefined;

  return {
    agentId,
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    intervalHours,
    lastRunAt:
      typeof record.lastRunAt === "string" ? record.lastRunAt : undefined,
    lastRunStatus,
    lastRunMessage:
      typeof record.lastRunMessage === "string"
        ? record.lastRunMessage
        : undefined,
    lastCreatedCount:
      typeof record.lastCreatedCount === "number" &&
      Number.isFinite(record.lastCreatedCount)
        ? Math.max(Math.round(record.lastCreatedCount), 0)
        : undefined,
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function normalizeAgentSchedules(
  value: unknown,
): Record<NewsletterAgentId, NewsletterAgentSchedule> {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    "article-writer": normalizeAgentSchedule(
      "article-writer",
      record["article-writer"],
    ),
    "event-writer": normalizeAgentSchedule(
      "event-writer",
      record["event-writer"],
    ),
  };
}

function withAgentRunStatus(params: {
  overrides: PreviewOverrides;
  agentId: NewsletterAgentId;
  createdCount: number;
  message: string;
}) {
  const schedules = normalizeAgentSchedules(
    params.overrides.newsletterAgentSchedules,
  );
  const previous = schedules[params.agentId];
  const now = new Date().toISOString();

  return {
    ...params.overrides,
    newsletterAgentSchedules: {
      ...schedules,
      [params.agentId]: {
        ...previous,
        lastRunAt: now,
        lastRunStatus: params.createdCount > 0 ? "success" : "empty",
        lastRunMessage: params.message,
        lastCreatedCount: params.createdCount,
        updatedAt: now,
      },
    },
  };
}

function normalizeResearchSources(value: unknown): NewsletterResearchSource[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((source) => {
      if (typeof source === "string") {
        return { url: source.trim() };
      }

      if (typeof source === "object" && source !== null) {
        const record = source as Record<string, unknown>;
        return {
          url: typeof record.url === "string" ? record.url.trim() : "",
          label:
            typeof record.label === "string" ? record.label.trim() : undefined,
        };
      }

      return { url: "" };
    })
    .filter((source) => {
      try {
        const url = new URL(source.url);
        return ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .slice(0, 12);
}

function normalizeResearchCache(
  value: unknown,
): NewsletterResearchCache | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;

  if (
    typeof record.generatedAt !== "string" ||
    typeof record.coopId !== "string" ||
    typeof record.contextHash !== "string" ||
    typeof record.expiresAt !== "string" ||
    !Array.isArray(record.sources) ||
    !Array.isArray(record.results)
  ) {
    return null;
  }

  return {
    generatedAt: record.generatedAt,
    coopId: record.coopId,
    contextHash: record.contextHash,
    sources: normalizeResearchSources(record.sources),
    results: record.results.filter(
      (result): result is NewsletterResearchResult => {
        return (
          typeof result === "object" &&
          result !== null &&
          "id" in result &&
          "type" in result &&
          "title" in result &&
          "sourceUrl" in result &&
          "summary" in result &&
          typeof result.id === "string" &&
          ["event", "article_source", "organization", "news"].includes(
            String(result.type),
          ) &&
          typeof result.title === "string" &&
          typeof result.sourceUrl === "string" &&
          typeof result.summary === "string"
        );
      },
    ),
    expiresAt: record.expiresAt,
  };
}

function textFromJsonList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        const record = item as Record<string, unknown>;
        if (typeof record.label === "string") return record.label;
        if (typeof record.title === "string") return record.title;
        if (typeof record.description === "string") return record.description;
      }
      return "";
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstSentence(value: string | null | undefined) {
  if (!value) return "";
  return (
    value
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)[0]
      ?.trim() || ""
  );
}

function researchContextHash(params: {
  coopId: string;
  coopName: string;
  coopDescription: string;
  charterText: string;
  missionGoals: string[];
  sectorExclusions: string[];
  sources: NewsletterResearchSource[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        coopId: params.coopId,
        coopName: params.coopName,
        coopDescription: params.coopDescription,
        charterText: params.charterText,
        missionGoals: params.missionGoals,
        sectorExclusions: params.sectorExclusions,
        sources: params.sources.map((source) => source.url).sort(),
      }),
    )
    .digest("hex");
}

function stripHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
}

function goalMatches(text: string, goals: string[]) {
  const textTokens = tokenSet(text);

  return goals.filter((goal) => {
    const goalTokens = [...tokenSet(goal)];
    if (goalTokens.length === 0) return false;
    const hits = goalTokens.filter((token) => textTokens.has(token)).length;
    return (
      hits / goalTokens.length >= 0.25 ||
      goalTokens.some((token) => text.toLowerCase().includes(token))
    );
  });
}

function inferResearchType(
  text: string,
  url: string,
): NewsletterResearchResult["type"] {
  const haystack = `${text} ${url}`.toLowerCase();
  if (
    /\b(event|calendar|workshop|meetup|summit|webinar|conference|festival|market|orientation)\b/.test(
      haystack,
    )
  ) {
    return "event";
  }
  if (/\b(news|press|story|article|blog|report)\b/.test(haystack))
    return "news";
  if (
    /\b(co-?op|cooperative|association|nonprofit|organization|collective)\b/.test(
      haystack,
    )
  )
    return "organization";
  return "article_source";
}

function inferEventDate(text: string) {
  const monthDate = text.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s+\d{4})?\b/i,
  );
  if (monthDate?.[0]) return monthDate[0];

  const numericDate = text.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/);
  return numericDate?.[0];
}

function inferLocation(text: string) {
  const online = text.match(/\b(online|virtual|webinar|zoom)\b/i);
  if (online?.[0]) return "Online";

  const cityState = text.match(
    /\b[A-Z][a-zA-Z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/,
  );
  return cityState?.[0];
}

function extractCandidateLinks(html: string, baseUrl: string) {
  const candidates: NewsletterResearchSource[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) && candidates.length < 8) {
    const href = match[1];
    const label = stripHtml(match[2] || "").slice(0, 140);
    const haystack = `${href} ${label}`.toLowerCase();
    if (
      !/\b(event|calendar|workshop|meetup|summit|webinar|conference|festival|market|article|story|news|blog|press|report)\b/.test(
        haystack,
      )
    ) {
      continue;
    }

    try {
      const url = new URL(href, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const normalizedUrl = url.toString();
      if (seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);
      candidates.push({
        url: normalizedUrl,
        label: label || url.hostname,
      });
    } catch {
      // Ignore malformed hrefs from source pages.
    }
  }

  return candidates;
}

function scoreResearchResult(params: {
  text: string;
  url: string;
  type: NewsletterResearchResult["type"];
  alignedGoals: string[];
  missionGoals: string[];
}) {
  const missionFit = params.missionGoals.length
    ? Math.min(
        1,
        params.alignedGoals.length / Math.min(params.missionGoals.length, 3),
      )
    : 0.5;
  const sourceTrust = params.url.startsWith("https://") ? 0.9 : 0.65;
  const dateRelevance =
    params.type === "event" && inferEventDate(params.text)
      ? 0.9
      : params.type === "event"
        ? 0.45
        : 0.7;
  const communityUsefulness =
    /\b(member|community|business|local|cooperative|workshop|market|ownership|education|funding|mutual|economic)\b/i.test(
      params.text,
    )
      ? 0.85
      : 0.55;

  return Number(
    (
      missionFit * 0.4 +
      sourceTrust * 0.2 +
      dateRelevance * 0.15 +
      communityUsefulness * 0.25
    ).toFixed(2),
  );
}

async function fetchResearchResult(params: {
  source: NewsletterResearchSource;
  coopName: string;
  missionGoals: string[];
}): Promise<
  NewsletterResearchResult & { discoveredSources?: NewsletterResearchSource[] }
> {
  const response = await fetch(params.source.url, {
    headers: {
      "user-agent": "CahootzResearchBrain/1.0 (+https://cahootz.coop)",
      accept: "text/html,application/xhtml+xml,text/plain",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Could not fetch source (${response.status})`);
  }

  const raw = (await response.text()).slice(0, 300_000);
  const finalUrl = response.url || params.source.url;
  const discoveredSources = extractCandidateLinks(raw, finalUrl);
  const title =
    getMetaContent(raw, ["og:title", "twitter:title"]) ||
    getTitleTag(raw) ||
    params.source.label ||
    new URL(finalUrl).hostname;
  const description =
    getMetaContent(raw, [
      "og:description",
      "twitter:description",
      "description",
    ]) || stripHtml(raw).slice(0, 900);
  const text = `${title} ${description} ${stripHtml(raw).slice(0, 20_000)}`;
  const type = inferResearchType(text, finalUrl);
  const alignedGoals = goalMatches(text, params.missionGoals);
  const relevanceScore = scoreResearchResult({
    text,
    url: finalUrl,
    type,
    alignedGoals,
    missionGoals: params.missionGoals,
  });
  const risksOrUnverifiedClaims = [
    type === "event" && !inferEventDate(text)
      ? "Event date was not found in the source preview."
      : "",
    type === "event" && !inferLocation(text)
      ? "Event location was not found in the source preview."
      : "",
  ].filter(Boolean);

  return {
    id: randomUUID(),
    type,
    title: title.slice(0, 160),
    sourceUrl: finalUrl,
    sourceName: params.source.label || new URL(finalUrl).hostname,
    dateFound: new Date().toISOString(),
    eventDate: type === "event" ? inferEventDate(text) : undefined,
    location: type === "event" ? inferLocation(text) : undefined,
    summary: description.slice(0, 1200),
    relevanceScore,
    alignedGoals,
    reasonForFit:
      alignedGoals.length > 0
        ? `Matches ${params.coopName} goals: ${alignedGoals.slice(0, 3).join(", ")}.`
        : `Needs admin review for fit with ${params.coopName}.`,
    risksOrUnverifiedClaims,
    recommendedNextAction:
      type === "event"
        ? "draft_event"
        : relevanceScore >= 0.6
          ? "draft_article"
          : "human_review",
    discoveredSources,
  } satisfies NewsletterResearchResult & {
    discoveredSources: NewsletterResearchSource[];
  };
}

async function buildResearchCache(params: {
  coopId: string;
  coopName: string;
  coopDescription: string;
  charterText: string;
  missionGoals: string[];
  sectorExclusions: string[];
  sources: NewsletterResearchSource[];
}) {
  const now = new Date();
  const contextHash = researchContextHash(params);
  const results: NewsletterResearchResult[] = [];
  const queuedSources = [...params.sources];
  const seenSources = new Set(params.sources.map((source) => source.url));

  for (
    let index = 0;
    index < queuedSources.length && results.length < 24;
    index++
  ) {
    const source = queuedSources[index];
    try {
      const result = await fetchResearchResult({
        source,
        coopName: params.coopName,
        missionGoals: params.missionGoals,
      });
      const { discoveredSources, ...researchResult } = result;
      results.push(researchResult);

      for (const discoveredSource of discoveredSources ?? []) {
        if (seenSources.has(discoveredSource.url) || queuedSources.length >= 24)
          continue;
        seenSources.add(discoveredSource.url);
        queuedSources.push(discoveredSource);
      }
    } catch (error) {
      results.push({
        id: randomUUID(),
        type: "article_source",
        title: source.label || source.url,
        sourceUrl: source.url,
        sourceName: source.label || source.url,
        dateFound: now.toISOString(),
        summary:
          "This source could not be fetched. Admins should verify the URL or try again later.",
        relevanceScore: 0,
        alignedGoals: [],
        reasonForFit: "Fetch failed before relevance could be scored.",
        risksOrUnverifiedClaims: [
          error instanceof Error ? error.message : "Unknown fetch error",
        ],
        recommendedNextAction: "human_review",
      });
    }
  }

  return {
    generatedAt: now.toISOString(),
    coopId: params.coopId,
    contextHash,
    sources: queuedSources,
    results: results.sort((a, b) => b.relevanceScore - a.relevanceScore),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  } satisfies NewsletterResearchCache;
}

function isUsableResearchCache(
  cache: NewsletterResearchCache | null,
  contextHash: string,
) {
  if (!cache) return false;
  return (
    cache.contextHash === contextHash &&
    new Date(cache.expiresAt).getTime() > Date.now()
  );
}

function makeAgentSubmission(params: {
  coopId: string;
  agentId: NewsletterAgentId;
  type: NewsletterSubmissionType;
  title: string;
  summary: string;
  contentMarkdown?: string;
  date?: string;
  location?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  sourceUrl?: string;
  imageUrl?: string;
  recommendedBecause: string;
  agentPrompt?: string;
}): NewsletterSubmission {
  return {
    id: randomUUID(),
    type: params.type,
    title: params.title,
    summary: params.summary,
    contentMarkdown: params.contentMarkdown,
    date: params.date,
    location: params.location,
    byline:
      params.byline ||
      (params.type === "event" ? "Events Desk" : "Editorial Desk"),
    ctaLabel: params.ctaLabel,
    ctaUrl: params.ctaUrl,
    sourceUrl: params.sourceUrl,
    imageUrl: params.imageUrl,
    submittedByUserId: "agent",
    submittedByName: agentLabels[params.agentId],
    submittedByWallet: "agent",
    submittedAt: new Date().toISOString(),
    status: "pending",
    source: "agent",
    agentId: params.agentId,
    agentName: agentLabels[params.agentId],
    recommendedBecause: params.recommendedBecause,
    agentPrompt: params.agentPrompt,
    approvalRequired: true,
  };
}

interface EventCandidate {
  sourceTitle: string;
  sourceUrl: string;
  sourceName: string;
  possibleEventTitle: string;
  possibleDate: string;
  whyItMayFitGoals: string;
}

interface VerifiedEventDraft {
  title: string;
  summary: string;
  contentMarkdown: string;
  date: string;
  location: string;
  sourceUrl: string;
  ctaUrl: string;
  sourceTitle: string;
  sourceName: string;
  goalFit: string;
}

const EventCandidateSchema = z.object({
  sourceTitle: z.string(),
  sourceUrl: z.string(),
  sourceName: z.string(),
  possibleEventTitle: z.string(),
  possibleDate: z.string(),
  whyItMayFitGoals: z.string(),
});

const EventDiscoverySchema = z.object({
  candidates: z.array(EventCandidateSchema),
});

const EventVerificationSchema = z.object({
  approved: z.boolean(),
  eventTitle: z.string(),
  sourceTitle: z.string(),
  sourceUrl: z.string(),
  sourceName: z.string(),
  eventDate: z.string(),
  eventTime: z.string(),
  organizer: z.string(),
  locationOrOnline: z.string(),
  registrationUrl: z.string(),
  summary: z.string(),
  goalFit: z.string(),
  verifiedFacts: z.array(z.string()),
  rejectionReason: z.string(),
});

function sanitizeAgentText(value: string) {
  return value
    .replace(/cite[^]*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sourceHost(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function logNewsletterAgent(
  level: "info" | "warn" | "error",
  event: string,
  props: Record<string, unknown> = {},
) {
  const logProps = {
    area: "newsletter-agent",
    event,
    ...props,
  };

  console[level](`[newsletter-agent] ${event}`, logProps);
}

async function runNewsletterAgentStep<T>(params: {
  pipeline: "event";
  step: string;
  agent: Parameters<typeof run>[0];
  input: string;
  props?: Record<string, unknown>;
}): Promise<T | undefined> {
  const startedAt = Date.now();
  logNewsletterAgent("info", "openai_step_started", {
    pipeline: params.pipeline,
    step: params.step,
    ...params.props,
  });

  try {
    const result = (await run(params.agent, params.input)) as unknown as {
      finalOutput?: T;
      output?: T;
    };
    const output = result.finalOutput ?? result.output;
    logNewsletterAgent("info", "openai_step_completed", {
      pipeline: params.pipeline,
      step: params.step,
      durationMs: Date.now() - startedAt,
      hasOutput: Boolean(output),
      ...params.props,
    });
    return output;
  } catch (error) {
    logNewsletterAgent("error", "openai_step_failed", {
      pipeline: params.pipeline,
      step: params.step,
      durationMs: Date.now() - startedAt,
      error: safeErrorMessage(error),
      ...params.props,
    });
    throw error;
  }
}

function normalizeHttpUrl(value: string) {
  try {
    const parsedUrl = new URL(value.trim());
    if (!["http:", "https:"].includes(parsedUrl.protocol)) return null;
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function hasConcreteValue(value: string) {
  const normalized = sanitizeAgentText(value).toLowerCase();
  if (!normalized) return false;
  return ![
    "unknown",
    "tbd",
    "n/a",
    "na",
    "none",
    "not listed",
    "not available",
    "needs source",
    "needs confirmation",
    "needs confirmed date",
    "needs confirmed location",
    "to be announced",
    "coming soon",
  ].some(
    (placeholder) =>
      normalized === placeholder || normalized.includes(placeholder),
  );
}

async function discoverEventCandidatesWithAgent(params: {
  coopName: string;
  coopDescription: string;
  missionGoals: string[];
  cachedEvents: NewsletterResearchResult[];
}): Promise<EventCandidate[]> {
  if (!process.env.OPENAI_API_KEY) {
    logNewsletterAgent("warn", "skipped_missing_openai_api_key", {
      pipeline: "event",
      step: "event_discovery",
      coopName: params.coopName,
      cachedEventCount: params.cachedEvents.length,
    });
    return [];
  }

  const cachedLines = params.cachedEvents
    .slice(0, 6)
    .map((result) =>
      [
        `Title: ${result.title}`,
        `URL: ${result.sourceUrl}`,
        `Source: ${result.sourceName}`,
        `Date hint: ${result.eventDate || "none"}`,
        `Location hint: ${result.location || "none"}`,
        `Summary: ${result.summary}`,
        `Goal fit hint: ${result.reasonForFit}`,
      ].join("\n"),
    )
    .join("\n\n");

  const model =
    process.env.NEWSLETTER_EVENT_MODEL ||
    process.env.NEWSLETTER_ARTICLE_MODEL ||
    "gpt-5.2";
  const discoveryAgent = new Agent({
    name: "Newsletter Event Discovery Agent",
    instructions: [
      "Find a small set of real, current event candidates for a co-op newsletter.",
      "Use web_search when cached candidates are missing, stale, too thin, or not clearly event pages.",
      "Prefer primary event pages, organizer pages, official calendar listings, ticket/registration pages, or credible community calendars.",
      "Do not return evergreen resources, generic workshops without dates, recurring pages without a specific upcoming occurrence, articles about past events, or vague networking listings.",
      "Specific co-op usefulness must come from the provided goals. Do not invent usefulness outside those goals.",
      "Return at most 4 candidates. Fewer is better when quality is thin.",
    ].join("\n"),
    model,
    outputType: EventDiscoverySchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: "auto" },
  });

  const discoveryInput = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Co-op: ${params.coopName}`,
    `Co-op context: ${firstSentence(params.coopDescription) || params.coopName}`,
    `Goals that define usefulness: ${params.missionGoals.join(", ") || "member ownership, local economic power, community participation"}`,
    "",
    "Cached event candidates, if any:",
    cachedLines || "None.",
  ].join("\n");

  const output = await runNewsletterAgentStep<
    z.infer<typeof EventDiscoverySchema>
  >({
    pipeline: "event",
    step: "event_discovery",
    agent: discoveryAgent,
    input: discoveryInput,
    props: {
      model,
      coopName: params.coopName,
      cachedEventCount: params.cachedEvents.length,
    },
  });

  const candidates =
    output?.candidates
      ?.map((candidate) => ({
        sourceTitle: sanitizeAgentText(candidate.sourceTitle),
        sourceUrl: sanitizeAgentText(candidate.sourceUrl),
        sourceName: sanitizeAgentText(candidate.sourceName),
        possibleEventTitle: sanitizeAgentText(candidate.possibleEventTitle),
        possibleDate: sanitizeAgentText(candidate.possibleDate),
        whyItMayFitGoals: sanitizeAgentText(candidate.whyItMayFitGoals),
      }))
      .filter(
        (candidate) =>
          candidate.sourceTitle && normalizeHttpUrl(candidate.sourceUrl),
      )
      .slice(0, 4) ?? [];

  logNewsletterAgent("info", "event_candidates_discovered", {
    pipeline: "event",
    step: "event_discovery",
    coopName: params.coopName,
    rawCandidateCount: output?.candidates?.length ?? 0,
    usableCandidateCount: candidates.length,
  });

  return candidates;
}

async function verifyEventCandidateWithAgent(params: {
  coopName: string;
  coopDescription: string;
  missionGoals: string[];
  candidate: EventCandidate;
}): Promise<VerifiedEventDraft | null> {
  if (!process.env.OPENAI_API_KEY) {
    logNewsletterAgent("warn", "skipped_missing_openai_api_key", {
      pipeline: "event",
      step: "event_verifier",
      coopName: params.coopName,
      sourceTitle: params.candidate.sourceTitle,
      sourceHost: sourceHost(params.candidate.sourceUrl),
    });
    return null;
  }

  const sourceUrl = normalizeHttpUrl(params.candidate.sourceUrl);
  if (!sourceUrl) {
    logNewsletterAgent("warn", "rejected", {
      pipeline: "event",
      step: "event_verifier",
      reason: "invalid_candidate_url",
      coopName: params.coopName,
      sourceTitle: params.candidate.sourceTitle,
    });
    return null;
  }

  const model =
    process.env.NEWSLETTER_EVENT_MODEL ||
    process.env.NEWSLETTER_ARTICLE_MODEL ||
    "gpt-5.2";
  const verifierAgent = new Agent({
    name: "Newsletter EventVerifier Agent",
    instructions: [
      "Verify whether one event candidate is good enough for a co-op newsletter queue.",
      "Use web_search and the candidate URL to verify facts from public sources.",
      "Approve only if there is a specific upcoming event occurrence, a real source URL, date, time or all-day indication, organizer, location or online access, registration/details URL, summary, and goal-based fit.",
      "Reject evergreen pages, past events, vague event series without a specific upcoming date, generic networking, motivational content with no practical member utility, thin listings with missing organizer/date/location, or anything where facts conflict.",
      "Specific co-op usefulness must come from the provided goals. Do not add an actionable next step.",
      "Return verifiedFacts as short facts traceable to the source. If any required field is missing, approved must be false and rejectionReason must explain why.",
    ].join("\n"),
    model,
    outputType: EventVerificationSchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: "auto" },
  });

  const verificationInput = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Co-op: ${params.coopName}`,
    `Co-op context: ${firstSentence(params.coopDescription) || params.coopName}`,
    `Goals that define usefulness: ${params.missionGoals.join(", ") || "member ownership, local economic power, community participation"}`,
    "",
    "Candidate to verify:",
    `Source title: ${params.candidate.sourceTitle}`,
    `Source URL: ${sourceUrl}`,
    `Source name: ${params.candidate.sourceName}`,
    `Possible event title: ${params.candidate.possibleEventTitle}`,
    `Possible date: ${params.candidate.possibleDate}`,
    `Why it may fit goals: ${params.candidate.whyItMayFitGoals}`,
  ].join("\n");

  const verification = await runNewsletterAgentStep<
    z.infer<typeof EventVerificationSchema>
  >({
    pipeline: "event",
    step: "event_verifier",
    agent: verifierAgent,
    input: verificationInput,
    props: {
      model,
      coopName: params.coopName,
      sourceTitle: params.candidate.sourceTitle,
      sourceHost: sourceHost(sourceUrl),
    },
  });
  if (!verification?.approved) {
    logNewsletterAgent("warn", "rejected", {
      pipeline: "event",
      step: "event_verifier",
      reason: verification?.rejectionReason || "not_approved",
      coopName: params.coopName,
      sourceTitle: params.candidate.sourceTitle,
      sourceHost: sourceHost(sourceUrl),
    });
    return null;
  }

  const verifiedSourceUrl =
    normalizeHttpUrl(verification.sourceUrl) || sourceUrl;
  const registrationUrl =
    normalizeHttpUrl(verification.registrationUrl) || verifiedSourceUrl;
  const title = sanitizeAgentText(verification.eventTitle);
  const summary = sanitizeAgentText(verification.summary);
  const eventDate = sanitizeAgentText(verification.eventDate);
  const eventTime = sanitizeAgentText(verification.eventTime);
  const organizer = sanitizeAgentText(verification.organizer);
  const locationOrOnline = sanitizeAgentText(verification.locationOrOnline);
  const goalFit = sanitizeAgentText(verification.goalFit);
  const verifiedFacts = verification.verifiedFacts
    .map(sanitizeAgentText)
    .filter(Boolean)
    .slice(0, 6);

  if (
    !hasConcreteValue(title) ||
    !hasConcreteValue(summary) ||
    !hasConcreteValue(eventDate) ||
    !hasConcreteValue(eventTime) ||
    !hasConcreteValue(organizer) ||
    !hasConcreteValue(locationOrOnline) ||
    !hasConcreteValue(goalFit) ||
    verifiedFacts.length < 3
  ) {
    logNewsletterAgent("warn", "rejected", {
      pipeline: "event",
      step: "event_verifier",
      reason: "verified_event_failed_local_validation",
      coopName: params.coopName,
      sourceTitle: params.candidate.sourceTitle,
      sourceHost: sourceHost(sourceUrl),
      hasTitle: hasConcreteValue(title),
      hasDate: hasConcreteValue(eventDate),
      hasTime: hasConcreteValue(eventTime),
      hasOrganizer: hasConcreteValue(organizer),
      hasLocation: hasConcreteValue(locationOrOnline),
      factCount: verifiedFacts.length,
    });
    return null;
  }

  const sourceTitle = sanitizeAgentText(
    verification.sourceTitle || params.candidate.sourceTitle,
  );
  const sourceName = sanitizeAgentText(
    verification.sourceName || params.candidate.sourceName,
  );

  logNewsletterAgent("info", "event_candidate_approved", {
    pipeline: "event",
    step: "event_verifier",
    coopName: params.coopName,
    title,
    sourceTitle: sourceTitle || params.candidate.sourceTitle,
    sourceHost: sourceHost(verifiedSourceUrl),
  });

  return {
    title: title.slice(0, 120),
    summary: summary.slice(0, 1200),
    contentMarkdown: [
      "## Verified event facts",
      `- Date: ${eventDate}`,
      `- Time: ${eventTime}`,
      `- Organizer: ${organizer}`,
      `- Location/online: ${locationOrOnline}`,
      `- Source: ${sourceTitle || sourceName || verifiedSourceUrl}`,
      "",
      "## Why it fits this co-op",
      goalFit,
      "",
      "## Source-backed notes",
      verifiedFacts.map((fact) => `- ${fact}`).join("\n"),
    ].join("\n"),
    date: `${eventDate}${eventTime ? `, ${eventTime}` : ""}`.slice(0, 180),
    location: locationOrOnline.slice(0, 180),
    sourceUrl: verifiedSourceUrl,
    ctaUrl: registrationUrl,
    sourceTitle: (sourceTitle || title).slice(0, 180),
    sourceName: (sourceName || new URL(verifiedSourceUrl).hostname).slice(
      0,
      120,
    ),
    goalFit: goalFit.slice(0, 1000),
  };
}

async function generateVerifiedEventSubmissions(params: {
  agentId: NewsletterAgentId;
  coopId: string;
  coopName: string;
  coopDescription: string;
  missionGoals: string[];
  existingTitles: string[];
  researchResults: NewsletterResearchResult[];
}) {
  const cachedEvents = params.researchResults
    .filter(
      (result) =>
        result.type === "event" ||
        result.recommendedNextAction === "draft_event",
    )
    .filter(
      (result) =>
        !params.existingTitles.some(
          (title) => title.toLowerCase() === result.title.toLowerCase(),
        ),
    )
    .slice(0, 6);

  const cacheCandidates: EventCandidate[] = cachedEvents.map((result) => ({
    sourceTitle: result.title,
    sourceUrl: result.sourceUrl,
    sourceName: result.sourceName,
    possibleEventTitle: result.title,
    possibleDate: result.eventDate || "",
    whyItMayFitGoals: result.reasonForFit,
  }));

  logNewsletterAgent("info", "event_pipeline_started", {
    pipeline: "event",
    coopId: params.coopId,
    coopName: params.coopName,
    researchResultCount: params.researchResults.length,
    cachedEventCount: cachedEvents.length,
    existingTitleCount: params.existingTitles.length,
  });

  const discoveredCandidates = await discoverEventCandidatesWithAgent({
    coopName: params.coopName,
    coopDescription: params.coopDescription,
    missionGoals: params.missionGoals,
    cachedEvents,
  });

  const seenUrls = new Set<string>();
  const candidates = [...cacheCandidates, ...discoveredCandidates]
    .filter((candidate) => {
      const normalizedUrl = normalizeHttpUrl(candidate.sourceUrl);
      if (!normalizedUrl || seenUrls.has(normalizedUrl)) return false;
      seenUrls.add(normalizedUrl);
      candidate.sourceUrl = normalizedUrl;
      return true;
    })
    .slice(0, 6);

  logNewsletterAgent("info", "event_candidates_ready", {
    pipeline: "event",
    coopId: params.coopId,
    coopName: params.coopName,
    cacheCandidateCount: cacheCandidates.length,
    discoveredCandidateCount: discoveredCandidates.length,
    candidateCount: candidates.length,
  });

  const verifiedEvents: NewsletterSubmission[] = [];
  for (const candidate of candidates) {
    if (verifiedEvents.length >= 2) break;

    const verifiedEvent = await verifyEventCandidateWithAgent({
      coopName: params.coopName,
      coopDescription: params.coopDescription,
      missionGoals: params.missionGoals,
      candidate,
    });

    if (!verifiedEvent) continue;
    if (
      params.existingTitles.some(
        (title) => title.toLowerCase() === verifiedEvent.title.toLowerCase(),
      )
    )
      continue;
    if (
      verifiedEvents.some(
        (event) =>
          event.title.toLowerCase() === verifiedEvent.title.toLowerCase(),
      )
    )
      continue;

    verifiedEvents.push(
      makeAgentSubmission({
        coopId: params.coopId,
        agentId: params.agentId,
        type: "event",
        title: verifiedEvent.title,
        summary: verifiedEvent.summary,
        contentMarkdown: verifiedEvent.contentMarkdown,
        date: verifiedEvent.date,
        location: verifiedEvent.location,
        sourceUrl: verifiedEvent.sourceUrl,
        ctaLabel: "Event details",
        ctaUrl: verifiedEvent.ctaUrl,
        recommendedBecause: `Verified by the EventVerifier Agent from "${verifiedEvent.sourceTitle}" (${verifiedEvent.sourceName}). ${verifiedEvent.goalFit}`,
      }),
    );
  }

  logNewsletterAgent("info", "event_pipeline_completed", {
    pipeline: "event",
    coopId: params.coopId,
    coopName: params.coopName,
    candidateCount: candidates.length,
    createdCount: verifiedEvents.length,
  });

  return verifiedEvents;
}

async function buildAgentSubmissions(params: {
  agentId: NewsletterAgentId;
  coopId: string;
  coopName: string;
  coopDescription: string;
  missionGoals: string[];
  existingTitles: string[];
  articleSamples?: ArticleSample[];
  researchResults?: NewsletterResearchResult[];
}) {
  const titleExists = new Set(
    params.existingTitles.map((title) => title.toLowerCase()),
  );
  const unique = (items: NewsletterSubmission[]) =>
    items
      .filter((item) => !titleExists.has(item.title.toLowerCase()))
      .filter(
        (item) =>
          item.type !== "article" ||
          !hasSubjectOverlap(item.title, params.existingTitles),
      )
      .slice(0, 3);
  const usefulResearch = (params.researchResults ?? [])
    .filter(
      (result) =>
        result.relevanceScore >= 0.45 &&
        result.recommendedNextAction !== "ignore",
    )
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  logNewsletterAgent("info", "build_agent_submissions_started", {
    pipeline: params.agentId === "article-writer" ? "article" : "event",
    coopId: params.coopId,
    coopName: params.coopName,
    agentId: params.agentId,
    researchResultCount: params.researchResults?.length ?? 0,
    usefulResearchCount: usefulResearch.length,
    existingTitleCount: params.existingTitles.length,
  });

  const articleBrief = buildArticleWriterBrief({
    coopName: params.coopName,
    coopDescription: params.coopDescription,
    missionGoals: params.missionGoals,
    articleSamples: params.articleSamples ?? [],
    researchResults: usefulResearch,
  });

  if (params.agentId === "article-writer") {
    const articleSources = usefulResearch
      .filter(
        (result) =>
          result.recommendedNextAction === "draft_article" ||
          result.type === "news" ||
          result.type === "article_source",
      )
      .filter(
        (result) => !hasSubjectOverlap(result.title, params.existingTitles),
      )
      .slice(0, 3);

    logNewsletterAgent("info", "article_sources_ready", {
      pipeline: "article",
      coopId: params.coopId,
      coopName: params.coopName,
      sourceCount: articleSources.length,
      willColdSearch: articleSources.length === 0,
    });

    const generatedDrafts: NewsletterSubmission[] = [];
    const sourcesToTry: Array<NewsletterResearchResult | undefined> =
      articleSources.length > 0 ? articleSources : [undefined];

    for (const result of sourcesToTry) {
      const llmDraft = await generateArticleDraftWithAgentOrchestration({
        briefPrompt: articleBrief.prompt,
        source: result,
        existingTitles: [
          ...params.existingTitles,
          ...generatedDrafts.map((draft) => draft.title),
        ],
        coopName: params.coopName,
        coopDescription: params.coopDescription,
        missionGoals: params.missionGoals,
      });

      if (llmDraft) {
        generatedDrafts.push(
          makeAgentSubmission({
            coopId: params.coopId,
            agentId: params.agentId,
            type: "article",
            title: llmDraft.title,
            summary: llmDraft.summary,
            contentMarkdown: llmDraft.contentMarkdown,
            date: "Story",
            sourceUrl: llmDraft.sourceUrl,
            ctaLabel: llmDraft.ctaLabel || "Read source",
            ctaUrl: llmDraft.sourceUrl,
            recommendedBecause: `Written by the Article Writer Agent after the Research Curator Agent selected "${llmDraft.sourceTitle}" from ${llmDraft.sourceName}. ${llmDraft.reasonForFit}`,
            agentPrompt: articleBrief.prompt,
          }),
        );
      }
    }

    const uniqueDrafts = unique(generatedDrafts);
    logNewsletterAgent("info", "article_pipeline_completed", {
      pipeline: "article",
      coopId: params.coopId,
      coopName: params.coopName,
      attemptedSourceCount: sourcesToTry.length,
      generatedCount: generatedDrafts.length,
      createdCount: uniqueDrafts.length,
    });

    return uniqueDrafts;
  }

  const verifiedEvents = await generateVerifiedEventSubmissions({
    agentId: params.agentId,
    coopId: params.coopId,
    coopName: params.coopName,
    coopDescription: params.coopDescription,
    missionGoals: params.missionGoals,
    existingTitles: params.existingTitles,
    researchResults: usefulResearch,
  });

  const uniqueEvents = unique(verifiedEvents).slice(0, 2);
  logNewsletterAgent("info", "event_unique_filter_completed", {
    pipeline: "event",
    coopId: params.coopId,
    coopName: params.coopName,
    verifiedCount: verifiedEvents.length,
    createdCount: uniqueEvents.length,
  });

  return uniqueEvents;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveUrl(
  value: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function getMetaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1]);
    }
  }
  return undefined;
}

function getTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1]) : undefined;
}

async function fetchLinkPreview(url: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid URL" });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only http and https links are supported",
    });
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      "user-agent": "CahootzNewsletterBot/1.0 (+https://cahootz.coop)",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Could not load that link",
    });
  }

  const html = (await response.text()).slice(0, 250_000);
  const finalUrl = response.url || parsedUrl.toString();
  const title =
    getMetaContent(html, ["og:title", "twitter:title"]) ||
    getTitleTag(html) ||
    parsedUrl.hostname;
  const description =
    getMetaContent(html, [
      "og:description",
      "twitter:description",
      "description",
    ]) || "";
  const imageUrl = resolveUrl(
    getMetaContent(html, ["og:image", "twitter:image"]),
    finalUrl,
  );

  return {
    url: finalUrl,
    title: title.slice(0, 160),
    description: description.slice(0, 1200),
    imageUrl,
  };
}

export async function runNewsletterAgentForCoop(params: {
  db: AuthenticatedContext["db"];
  coopId: string;
  agentId: NewsletterAgentId;
  updatedBy?: string;
}) {
  const [publicInfo, coopConfig, researchCacheRecord] = await Promise.all([
    params.db.publicCoopInfo.findUnique({
      where: { coopId: params.coopId },
      select: {
        name: true,
        previewOverrides: true,
      },
    }),
    params.db.coopConfig.findFirst({
      where: { coopId: params.coopId, isActive: true },
      orderBy: { version: "desc" },
      select: {
        name: true,
        description: true,
        displayMission: true,
        missionGoals: true,
      },
    }),
    params.db.coopResearchCache.findUnique({
      where: {
        coopId_cacheKey: {
          coopId: params.coopId,
          cacheKey: NEWSLETTER_RESEARCH_CACHE_KEY,
        },
      },
    }),
  ]);

  if (!publicInfo) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Public newsletter is not set up yet",
    });
  }

  const updatedBy = params.updatedBy || "trigger.dev";
  const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
  const existingSubmissions = normalizeNewsletterSubmissions(
    overrides.newsletterSubmissions,
  ).filter((submission) => submission.status === "pending");
  const existingPosts = Array.isArray(overrides.communityPosts)
    ? overrides.communityPosts
    : [];
  const existingTitles = [
    ...existingSubmissions.map((submission) => submission.title),
    ...existingPosts
      .map((post) => {
        if (typeof post === "object" && post !== null && "title" in post) {
          return typeof post.title === "string" ? post.title : "";
        }
        return "";
      })
      .filter(Boolean),
  ];

  const coopName = publicInfo.name || coopConfig?.name || params.coopId;
  const missionGoals = textFromJsonList(coopConfig?.missionGoals, [
    "member ownership",
    "local economic power",
    "community participation",
  ]);
  const coopDescription =
    coopConfig?.displayMission || coopConfig?.description || "";
  const researchCache = normalizeResearchCache(researchCacheRecord?.data);
  const researchResults =
    researchCache && new Date(researchCache.expiresAt).getTime() > Date.now()
      ? researchCache.results
      : [];

  logNewsletterAgent("info", "run_started", {
    coopId: params.coopId,
    coopName,
    agentId: params.agentId,
    hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
    hasResearchCache: Boolean(researchCache),
    researchCacheExpired: researchCache
      ? new Date(researchCache.expiresAt).getTime() <= Date.now()
      : undefined,
    researchResultCount: researchResults.length,
    existingPendingSubmissionCount: existingSubmissions.length,
    existingPostCount: existingPosts.length,
    existingTitleCount: existingTitles.length,
    updatedBy,
  });

  const generatedSubmissions = await buildAgentSubmissions({
    agentId: params.agentId,
    coopId: params.coopId,
    coopName,
    coopDescription,
    missionGoals,
    existingTitles,
    articleSamples: extractArticleSamples(existingPosts),
    researchResults,
  });

  const runMessage =
    generatedSubmissions.length === 0
      ? `${agentLabels[params.agentId]} did not add any verified newsletter drafts.`
      : `${agentLabels[params.agentId]} added ${generatedSubmissions.length} draft(s) to the newsletter queue.`;

  logNewsletterAgent("info", "run_completed", {
    coopId: params.coopId,
    coopName,
    agentId: params.agentId,
    createdCount: generatedSubmissions.length,
    status: generatedSubmissions.length > 0 ? "success" : "empty",
    message: runMessage,
  });

  const overridesWithRunStatus = withAgentRunStatus({
    overrides,
    agentId: params.agentId,
    createdCount: generatedSubmissions.length,
    message: runMessage,
  });

  if (generatedSubmissions.length === 0) {
    await params.db.publicCoopInfo.update({
      where: { coopId: params.coopId },
      data: {
        previewOverrides: overridesWithRunStatus as any,
        updatedBy,
      },
    });

    return {
      success: true,
      createdCount: 0,
      submissions: [],
      message: runMessage,
    };
  }

  await params.db.publicCoopInfo.update({
    where: { coopId: params.coopId },
    data: {
      previewOverrides: {
        ...overridesWithRunStatus,
        newsletterSubmissions: [
          ...generatedSubmissions,
          ...existingSubmissions,
        ].slice(0, 100),
      } as any,
      updatedBy,
    },
  });

  const adminMemberships = await params.db.userCoopMembership.findMany({
    where: {
      coopId: params.coopId,
      status: "ACTIVE",
      roles: { hasSome: ["admin", "governor"] },
    },
    select: { userId: true },
  });

  if (adminMemberships.length > 0) {
    await params.db.notification.createMany({
      data: adminMemberships.map((membership) => ({
        userId: membership.userId,
        coopId: params.coopId,
        type: "NEWSLETTER_AGENT_SUBMISSION",
        title: `${agentLabels[params.agentId]} added draft(s)`,
        body: `${generatedSubmissions.length} pending newsletter draft(s) are ready for admin review.`,
        data: {
          agentId: params.agentId,
          submissionIds: generatedSubmissions.map(
            (submission) => submission.id,
          ),
          source: "agent",
        },
      })),
    });
  }

  return {
    success: true,
    createdCount: generatedSubmissions.length,
    submissions: generatedSubmissions,
    message: runMessage,
  };
}

export const publicCoopInfoRouter = router({
  /**
   * Get published public coop info by coopId (public access)
   */
  getByCoopId: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .query(async ({ input, ctx }) => {
      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      if (!publicInfo || !publicInfo.isPublished || publicInfo.isDemo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public coop page not found or not published",
        });
      }

      return publicInfo;
    }),

  /**
   * Get public coop info including unpublished (for coming soon page)
   */
  getByCoopIdWithUnpublished: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .query(async ({ input, ctx }) => {
      console.log("check coopId with unpublished", input.coopId);
      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      return publicInfo;
    }),

  /**
   * Get preview data for public page (stores and proposals)
   */
  getPreviewData: publicProcedure
    .input(
      z.object({
        coopId: z.string(),
        previewMode: z.enum(["live", "curated", "hybrid"]),
        storeLimit: z.number().min(1).max(50).optional().default(12),
        proposalLimit: z.number().min(1).max(20).optional().default(3),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.previewMode === "curated") {
        return null;
      }

      const storeWhere = {
        coopId: input.coopId,
        status: "APPROVED" as const,
        // Only surface stores whose Stripe Connect account is fully ready
        // to accept charges; otherwise customers would hit an error at
        // checkout. SC verification is purely a badge, not a filter.
        business: {
          stripeAccount: {
            chargesEnabled: true,
          },
        },
      };

      const productWhere = {
        isActive: true,
        store: storeWhere,
      };

      const [stores, proposals, memberCount, storeCount, productCount] =
        await Promise.all([
          ctx.db.store.findMany({
            where: storeWhere,
            take: input.storeLimit,
            orderBy: [
              { isFeatured: "desc" },
              { isScVerified: "desc" },
              { createdAt: "desc" },
            ],
            select: {
              id: true,
              name: true,
              description: true,
              category: true,
              imageUrl: true,
              isScVerified: true,
              isFeatured: true,
              _count: {
                select: {
                  products: {
                    where: {
                      isActive: true,
                    },
                  },
                },
              },
            },
          }),
          ctx.db.proposal.findMany({
            where: {
              coopId: input.coopId,
              status: { in: ["VOTABLE", "APPROVED", "FUNDED"] },
            },
            take: input.proposalLimit,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              title: true,
              summary: true,
              status: true,
              budgetAmount: true,
              budgetCurrency: true,
            },
          }),
          ctx.db.userCoopMembership.count({
            where: {
              coopId: input.coopId,
              status: "ACTIVE",
            },
          }),
          ctx.db.store.count({
            where: storeWhere,
          }),
          ctx.db.product.count({
            where: productWhere,
          }),
        ]);

      return {
        stores: stores.map(({ _count, ...store }) => ({
          ...store,
          productCount: _count.products,
        })),
        proposals,
        stats: {
          memberCount,
          storeCount,
          productCount,
        },
      };
    }),

  getLinkPreview: publicProcedure
    .input(z.object({ url: z.string().trim().url().max(500) }))
    .query(async ({ input }) => fetchLinkPreview(input.url)),

  /**
   * Let active co-op members submit stories and events for the public newsletter.
   * Submissions are kept pending in previewOverrides until an admin publishes them.
   */
  submitNewsletterSubmission: authenticatedProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        type: z.enum(["article", "event"]),
        title: z.string().trim().min(3).max(120),
        summary: z.string().trim().min(10).max(2000),
        contentMarkdown: z.string().trim().max(20000).optional(),
        date: z.string().trim().max(80).optional(),
        location: z.string().trim().max(160).optional(),
        byline: z.string().trim().max(120).optional(),
        ctaLabel: z.string().trim().max(60).optional(),
        ctaUrl: z.string().trim().max(500).optional(),
        sourceUrl: z.string().trim().max(500).optional(),
        imageUrl: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;
      if (!walletAddress) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "No wallet address provided",
        });
      }

      const user = await ctx.db.user.findFirst({
        where: {
          OR: [
            { walletAddress },
            { wallets: { some: { address: walletAddress } } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          memberships: {
            where: {
              coopId: input.coopId,
              status: "ACTIVE",
            },
            select: { id: true },
          },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found for wallet",
        });
      }

      if (user.memberships.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only active co-op members can submit to the newsletter",
        });
      }

      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
        select: { previewOverrides: true },
      });

      if (!publicInfo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public newsletter is not set up yet",
        });
      }

      const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
      const existingSubmissions = normalizeNewsletterSubmissions(
        overrides.newsletterSubmissions,
      ).filter((submission) => submission.status === "pending");

      const submission: NewsletterSubmission = {
        id: randomUUID(),
        type: input.type,
        title: input.title.trim(),
        summary: input.summary.trim(),
        contentMarkdown: input.contentMarkdown?.trim() || undefined,
        date: input.date?.trim() || undefined,
        location: input.location?.trim() || undefined,
        byline: input.byline?.trim() || undefined,
        ctaLabel: input.ctaLabel?.trim() || undefined,
        ctaUrl: input.ctaUrl?.trim() || undefined,
        sourceUrl: input.sourceUrl?.trim() || undefined,
        imageUrl: input.imageUrl?.trim() || undefined,
        submittedByUserId: user.id,
        submittedByName: user.name || user.email || undefined,
        submittedByWallet: walletAddress,
        submittedAt: new Date().toISOString(),
        status: "pending",
      };

      await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: {
          previewOverrides: {
            ...overrides,
            newsletterSubmissions: [submission, ...existingSubmissions].slice(
              0,
              100,
            ),
          } as any,
          updatedBy: walletAddress,
        },
      });

      const adminMemberships = await ctx.db.userCoopMembership.findMany({
        where: {
          coopId: input.coopId,
          status: "ACTIVE",
          roles: { hasSome: ["admin", "governor"] },
        },
        select: { userId: true },
      });

      if (adminMemberships.length > 0) {
        await ctx.db.notification.createMany({
          data: adminMemberships.map((membership) => ({
            userId: membership.userId,
            coopId: input.coopId,
            type: "NEWSLETTER_SUBMISSION",
            title:
              input.type === "event"
                ? "New event submitted"
                : "New story submitted",
            body: `${submission.submittedByName || "A member"} submitted "${submission.title}" for the newsletter.`,
            data: {
              submissionId: submission.id,
              submissionType: submission.type,
            },
          })),
        });
      }

      return { success: true, submission };
    }),

  /**
   * Temporary public contributor intake for hired writers and event scouts.
   * This bypasses portal membership while still keeping submissions unpublished
   * until a co-op admin reviews them.
   */
  submitPublicNewsletterSubmission: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        type: z.enum(["article", "event"]),
        title: z.string().trim().min(3).max(120),
        summary: z.string().trim().min(10).max(2000),
        contentMarkdown: z.string().trim().max(20000).optional(),
        contributorName: z.string().trim().min(2).max(120),
        contributorEmail: z.string().trim().email().max(200),
        date: z.string().trim().max(80).optional(),
        location: z.string().trim().max(160).optional(),
        byline: z.string().trim().max(120).optional(),
        ctaLabel: z.string().trim().max(60).optional(),
        ctaUrl: z.string().trim().max(500).optional(),
        sourceUrl: z.string().trim().max(500).optional(),
        imageUrl: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
        select: { previewOverrides: true },
      });

      if (!publicInfo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public newsletter is not set up yet",
        });
      }

      const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
      const existingSubmissions = normalizeNewsletterSubmissions(
        overrides.newsletterSubmissions,
      ).filter((submission) => submission.status === "pending");

      const submission: NewsletterSubmission = {
        id: randomUUID(),
        type: input.type,
        title: input.title.trim(),
        summary: input.summary.trim(),
        contentMarkdown: input.contentMarkdown?.trim() || undefined,
        date: input.date?.trim() || undefined,
        location: input.location?.trim() || undefined,
        byline: input.byline?.trim() || input.contributorName.trim(),
        ctaLabel: input.ctaLabel?.trim() || undefined,
        ctaUrl: input.ctaUrl?.trim() || undefined,
        sourceUrl: input.sourceUrl?.trim() || undefined,
        imageUrl: input.imageUrl?.trim() || undefined,
        submittedByUserId: "public-contributor",
        submittedByName: input.contributorName.trim(),
        submittedByEmail: input.contributorEmail.trim(),
        submittedByWallet: "public-contributor",
        submittedAt: new Date().toISOString(),
        status: "pending",
      };

      await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: {
          previewOverrides: {
            ...overrides,
            newsletterSubmissions: [submission, ...existingSubmissions].slice(
              0,
              100,
            ),
          } as any,
          updatedBy: input.contributorEmail.trim(),
        },
      });

      const adminMemberships = await ctx.db.userCoopMembership.findMany({
        where: {
          coopId: input.coopId,
          status: "ACTIVE",
          roles: { hasSome: ["admin", "governor"] },
        },
        select: { userId: true },
      });

      if (adminMemberships.length > 0) {
        await ctx.db.notification.createMany({
          data: adminMemberships.map((membership) => ({
            userId: membership.userId,
            coopId: input.coopId,
            type: "NEWSLETTER_SUBMISSION",
            title:
              input.type === "event"
                ? "New public event submission"
                : "New public story submission",
            body: `${submission.submittedByName} submitted "${submission.title}" for the newsletter.`,
            data: {
              submissionId: submission.id,
              submissionType: submission.type,
              contributorEmail: submission.submittedByEmail,
              source: "public-contributor",
            },
          })),
        });
      }

      return { success: true, submission };
    }),

  getNewsletterResearch: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot access research for a different coop",
        });
      }

      const cache = await ctx.db.coopResearchCache.findUnique({
        where: {
          coopId_cacheKey: {
            coopId: input.coopId,
            cacheKey: NEWSLETTER_RESEARCH_CACHE_KEY,
          },
        },
      });

      return {
        cache: cache ? normalizeResearchCache(cache.data) : null,
        updatedAt: cache?.updatedAt ?? null,
        expiresAt: cache?.expiresAt ?? null,
      };
    }),

  getNewsletterAgentBrief: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot access newsletter agent brief for a different coop",
        });
      }

      const [publicInfo, coopConfig, researchCacheRecord] = await Promise.all([
        ctx.db.publicCoopInfo.findUnique({
          where: { coopId: input.coopId },
          select: {
            name: true,
            previewOverrides: true,
          },
        }),
        ctx.db.coopConfig.findFirst({
          where: { coopId: input.coopId, isActive: true },
          orderBy: { version: "desc" },
          select: {
            name: true,
            description: true,
            displayMission: true,
            missionGoals: true,
          },
        }),
        ctx.db.coopResearchCache.findUnique({
          where: {
            coopId_cacheKey: {
              coopId: input.coopId,
              cacheKey: NEWSLETTER_RESEARCH_CACHE_KEY,
            },
          },
        }),
      ]);

      if (!publicInfo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public newsletter is not set up yet",
        });
      }

      const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
      const existingPosts = Array.isArray(overrides.communityPosts)
        ? overrides.communityPosts
        : [];
      const researchCache = normalizeResearchCache(researchCacheRecord?.data);
      const researchResults =
        researchCache &&
        new Date(researchCache.expiresAt).getTime() > Date.now()
          ? researchCache.results
          : [];
      const brief = buildArticleWriterBrief({
        coopName: publicInfo.name || coopConfig?.name || input.coopId,
        coopDescription:
          coopConfig?.displayMission || coopConfig?.description || "",
        missionGoals: textFromJsonList(coopConfig?.missionGoals, [
          "member ownership",
          "local economic power",
          "community participation",
        ]),
        articleSamples: extractArticleSamples(existingPosts),
        researchResults,
      });

      return {
        articleWriterPrompt: brief.prompt,
        styleGuide: brief.styleGuide,
        previousSubjects: brief.previousSubjects,
        researchResultCount: researchResults.length,
      };
    }),

  runNewsletterResearch: privateProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        sources: z
          .array(
            z.object({
              url: z.string().trim().url().max(500),
              label: z.string().trim().max(120).optional(),
            }),
          )
          .max(12)
          .optional(),
        forceRefresh: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot run research for a different coop",
        });
      }

      const [publicInfo, coopConfig, existingCache] = await Promise.all([
        ctx.db.publicCoopInfo.findUnique({
          where: { coopId: input.coopId },
          select: {
            name: true,
            previewOverrides: true,
          },
        }),
        ctx.db.coopConfig.findFirst({
          where: { coopId: input.coopId, isActive: true },
          orderBy: { version: "desc" },
          select: {
            name: true,
            description: true,
            displayMission: true,
            charterText: true,
            missionGoals: true,
            sectorExclusions: true,
          },
        }),
        ctx.db.coopResearchCache.findUnique({
          where: {
            coopId_cacheKey: {
              coopId: input.coopId,
              cacheKey: NEWSLETTER_RESEARCH_CACHE_KEY,
            },
          },
        }),
      ]);

      if (!publicInfo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public newsletter is not set up yet",
        });
      }

      const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
      const cachedData = normalizeResearchCache(existingCache?.data);
      const requestedSources = normalizeResearchSources(
        input.sources ?? overrides.newsletterResearchSources,
      );
      const sources =
        requestedSources.length > 0
          ? requestedSources
          : (cachedData?.sources ?? []);
      if (sources.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Add at least one research source URL before refreshing research.",
        });
      }

      const coopName = publicInfo.name || coopConfig?.name || input.coopId;
      const missionGoals = textFromJsonList(coopConfig?.missionGoals, [
        "member ownership",
        "local economic power",
        "community participation",
      ]);
      const sectorExclusions = textFromJsonList(coopConfig?.sectorExclusions);
      const coopDescription =
        coopConfig?.displayMission || coopConfig?.description || "";
      const charterText = coopConfig?.charterText || "";
      const contextHash = researchContextHash({
        coopId: input.coopId,
        coopName,
        coopDescription,
        charterText,
        missionGoals,
        sectorExclusions,
        sources,
      });
      if (
        !input.forceRefresh &&
        cachedData &&
        isUsableResearchCache(cachedData, contextHash)
      ) {
        return {
          success: true,
          cache: cachedData,
          cached: true,
          message: `Using cached research with ${cachedData.results.length} result(s).`,
        };
      }

      const nextCache = await buildResearchCache({
        coopId: input.coopId,
        coopName,
        coopDescription,
        charterText,
        missionGoals,
        sectorExclusions,
        sources,
      });

      await ctx.db.coopResearchCache.upsert({
        where: {
          coopId_cacheKey: {
            coopId: input.coopId,
            cacheKey: NEWSLETTER_RESEARCH_CACHE_KEY,
          },
        },
        create: {
          coopId: input.coopId,
          cacheKey: NEWSLETTER_RESEARCH_CACHE_KEY,
          contextHash,
          data: nextCache as any,
          expiresAt: new Date(nextCache.expiresAt),
          updatedBy: ctx.walletAddress,
        },
        update: {
          contextHash,
          data: nextCache as any,
          expiresAt: new Date(nextCache.expiresAt),
          updatedBy: ctx.walletAddress,
        },
      });

      return {
        success: true,
        cache: nextCache,
        cached: false,
        message: `Research refreshed with ${nextCache.results.length} result(s).`,
      };
    }),

  /**
   * Admin-only starter runner for newsletter agents. It writes generated
   * suggestions into the existing newsletter submission queue, so admins use
   * the same publish/dismiss review flow already built for articles and events.
   */
  runNewsletterAgent: privateProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        agentId: z.enum(["article-writer", "event-writer"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot run newsletter agents for a different coop",
        });
      }

      return runNewsletterAgentForCoop({
        db: ctx.db,
        coopId: input.coopId,
        agentId: input.agentId,
        updatedBy: ctx.walletAddress,
      });
    }),

  /**
   * Get public coop info by domain (public access)
   */
  getByDomain: publicProcedure
    .input(z.object({ domain: z.string() }))
    .query(async ({ input, ctx }) => {
      // Get all published public info and filter in code
      // (Prisma JSON array_contains has type issues)
      const allPublicInfo = await ctx.db.publicCoopInfo.findMany({
        where: { isPublished: true, isDemo: false },
      });

      const publicInfo = allPublicInfo.find((info) => {
        if (info.primaryDomain === input.domain) return true;
        const additionalDomains = info.additionalDomains as string[] | null;
        if (additionalDomains && additionalDomains.includes(input.domain))
          return true;
        return false;
      });

      if (!publicInfo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No coop found for this domain",
        });
      }

      return publicInfo;
    }),

  /**
   * Bootstrap/backfill public info from CoopConfig (admin only)
   */
  bootstrapFromConfig: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot modify public info for a different coop",
        });
      }

      // Get the active CoopConfig
      const config = await ctx.db.coopConfig.findFirst({
        where: {
          coopId: input.coopId,
          isActive: true,
        },
        orderBy: {
          version: "desc",
        },
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "CoopConfig not found",
        });
      }

      // Check if PublicCoopInfo already exists
      const existing = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "PublicCoopInfo already exists for this coop",
        });
      }

      // Map CoopConfig fields to PublicCoopInfo — no hardcoded copy fallbacks;
      // admins apply a recruitment starter or fill fields manually.
      const publicInfo = await ctx.db.publicCoopInfo.create({
        data: {
          coopId: input.coopId,
          name: config.name || undefined,
          tagline: config.tagline || undefined,
          heroTitle: config.name ? `Apply to ${config.name}` : undefined,
          heroSubtitle: config.description || undefined,
          aboutBody: config.description || undefined,
          missionBody: config.displayMission || undefined,
          eligibilityBody: config.eligibility || undefined,
          primaryCtaLabel: "Apply to Join",
          primaryCtaUrl: `/${input.coopId}/application`,
          previewOverrides: {
            newspaperTitle: `${config.name || input.coopId} Newsletter`,
            newspaperIntro:
              "Stories, events, classifieds, business notes, and public notices from the co-op.",
            newsletterEmailEnabled: false,
            newsletterEmailSubject: `${config.name || input.coopId} Weekly Newsletter`,
            newsletterEmailPreheader:
              "Stories, events, classifieds, business notes, and public notices from the co-op.",
            communityPosts: [
              {
                type: "article",
                title: `Why ${config.name || "this co-op"} is organizing now`,
                summary:
                  "A front-page note on what the co-op is building, who it is for, and why members are being invited to apply.",
                date: "From the co-op desk",
                byline: "Membership committee",
              },
              {
                type: "event",
                title: "Next member orientation",
                summary:
                  "Invite applicants, business owners, and neighbors to learn how membership, proposals, and the marketplace work.",
                date: "Upcoming",
              },
              {
                type: "business",
                title: "Member business spotlight",
                summary:
                  "Use this space to feature a business, creator, service, or project moving the co-op economy forward.",
              },
            ],
          },
          primaryColor: config.bgColor || "#f59e0b",
          accentColor: config.accentColor || "#ea580c",
          isDemo: config.isDemo,
          isPublished: false,
          createdBy: ctx.walletAddress,
        },
      });

      return {
        success: true,
        publicInfo,
      };
    }),

  /**
   * Create a blank public page (admin only)
   */
  createBlank: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot modify public info for a different coop",
        });
      }

      // Check if PublicCoopInfo already exists
      const existing = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "PublicCoopInfo already exists for this coop",
        });
      }

      // Create a minimal blank page — no hardcoded copy; admins apply a
      // recruitment starter or fill fields manually.
      const publicInfo = await ctx.db.publicCoopInfo.create({
        data: {
          coopId: input.coopId,
          name: input.coopId,
          primaryColor: "#f59e0b",
          accentColor: "#ea580c",
          backgroundColor: "#1a1a1a",
          primaryCtaLabel: "Apply to Join",
          primaryCtaUrl: `/${input.coopId}/application`,
          mobileAppUrl: "https://mobile.cahootzcoops.com",
          previewOverrides: {
            newspaperTitle: `${input.coopId} Newsletter`,
            newspaperIntro:
              "Stories, events, classifieds, business notes, and public notices from the co-op.",
            newsletterEmailEnabled: false,
            newsletterEmailSubject: `${input.coopId} Weekly Newsletter`,
            newsletterEmailPreheader:
              "Stories, events, classifieds, business notes, and public notices from the co-op.",
            communityPosts: [
              {
                type: "article",
                title: "Why we are organizing now",
                summary:
                  "A front-page note on what the co-op is building, who it is for, and why members are being invited to apply.",
                date: "From the co-op desk",
                byline: "Membership committee",
              },
              {
                type: "event",
                title: "Next member orientation",
                summary:
                  "Invite applicants, business owners, and neighbors to learn how membership, proposals, and the marketplace work.",
                date: "Upcoming",
              },
              {
                type: "business",
                title: "Member business spotlight",
                summary:
                  "Use this space to feature a business, creator, service, or project moving the co-op economy forward.",
              },
            ],
          },
          previewMode: "hybrid",
          isPublished: false,
          createdBy: ctx.walletAddress,
        },
      });

      return {
        success: true,
        publicInfo,
      };
    }),

  /**
   * Update public coop info (admin only)
   */
  update: privateProcedure
    .input(
      z.object({
        coopId: z.string(),
        data: z.object({
          name: z.string().optional(),
          tagline: z.string().optional(),
          heroTitle: z.string().optional(),
          heroSubtitle: z.string().optional(),
          heroImageUrl: z.string().url().optional().nullable(),
          logoUrl: z.string().url().optional().nullable(),
          primaryColor: z.string().optional(),
          accentColor: z.string().optional(),
          backgroundColor: z.string().optional(),
          coverImageUrl: z.string().url().optional().nullable(),
          aboutTitle: z.string().optional(),
          aboutBody: z.string().optional(),
          missionBody: z.string().optional(),
          eligibilityTitle: z.string().optional(),
          eligibilityBody: z.string().optional(),
          features: z
            .array(
              z.object({
                title: z.string(),
                description: z.string(),
                iconName: z.string().optional(),
              }),
            )
            .optional(),
          faqs: z
            .array(
              z.object({
                question: z.string(),
                answer: z.string(),
              }),
            )
            .optional(),
          contactEmail: z.string().email().optional().nullable(),
          contactLinks: z
            .array(
              z.object({
                label: z.string(),
                url: z.string(),
                type: z.enum(["email", "phone", "social"]).optional(),
              }),
            )
            .optional(),
          newsletterUrl: z.string().url().optional().nullable(),
          primaryCtaLabel: z.string().optional(),
          primaryCtaUrl: z.string().min(1).optional().nullable(),
          mobileAppUrl: z.string().url().optional().nullable(),
          previewMode: z.enum(["live", "curated", "hybrid"]).optional(),
          previewOverrides: z.any().optional(),
          showStatsBar: z.boolean().optional(),
          isPublished: z.boolean().optional(),
          seoTitle: z.string().optional(),
          seoDescription: z.string().optional(),
          primaryDomain: z.string().optional().nullable(),
          additionalDomains: z.array(z.string()).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot modify public info for a different coop",
        });
      }

      const publicInfo = await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: {
          ...input.data,
          updatedBy: ctx.walletAddress,
        },
      });

      return {
        success: true,
        publicInfo,
      };
    }),

  /**
   * Return the available recruitment template options.
   * Template content is defined here so it can be updated server-side
   * without frontend deploys.
   */
  getRecruitmentTemplates: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .query(({ input }) => {
      return [
        {
          key: "wealth",
          label: "Generational Wealth",
          description:
            "High-energy member pitch for co-ops building shared ownership and legacy.",
        },
        {
          key: "ownership",
          label: "Local Ownership",
          description:
            "Community-first pitch focused on pooling demand and funding local priorities.",
        },
        {
          key: "business",
          label: "Business Builder",
          description:
            "Recruit people who want to back, buy from, and grow co-op businesses.",
        },
      ];
    }),

  /**
   * Apply a recruitment template directly to the publicCoopInfo record.
   * All template content is defined and maintained here on the server.
   */
  applyRecruitmentTemplate: privateProcedure
    .input(
      z.object({
        coopId: z.string(),
        template: z.enum(["wealth", "ownership", "business"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot modify public info for a different coop",
        });
      }

      const existing = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public page not found — create it first",
        });
      }

      const coopName = existing.name || input.coopId;
      let patch: Parameters<typeof ctx.db.publicCoopInfo.update>[0]["data"] =
        {};

      if (input.template === "wealth") {
        patch = {
          tagline: "Build generational wealth together",
          heroTitle: `Apply to ${coopName}`,
          heroSubtitle: `This is for people who want more than inspiration. ${coopName} is building a member-owned economy where our spending, businesses, votes, and collective power can become real generational wealth.`,
          aboutTitle: "Why Join",
          aboutBody: `Join ${coopName} if you are ready to help build something our people can own. Members back co-op businesses, help decide what gets funded, and grow a shared economic engine designed for stability, opportunity, and legacy.`,
          missionBody: [
            "Grow a member-owned marketplace where everyday spending strengthens the co-op.",
            "Build a community wealth fund that can support businesses, services, projects, and long-term assets.",
            "Give members a voice in how resources move, who gets backed, and what future the co-op is building.",
          ].join("\n"),
          eligibilityTitle: "Who Should Apply",
          eligibilityBody:
            "Apply if you want ownership, accountability, and a seat at the table while this co-op builds economic power for members and the next generation.",
          faqs: [
            {
              question: "What happens after I apply?",
              answer:
                "Your application goes to the co-op for review. If approved, you can participate as a member and help shape what gets built next.",
            },
            {
              question: "Do I need co-op experience?",
              answer:
                "No. You need alignment, seriousness, and a willingness to participate in a member-owned economy.",
            },
          ],
          primaryCtaLabel: "Apply to Join",
          primaryCtaUrl: `/${input.coopId}/application`,
          seoTitle: `${coopName} membership application`,
          seoDescription: `Apply to ${coopName} and help build a member-owned economy for generational wealth.`,
        };
      } else if (input.template === "ownership") {
        patch = {
          tagline: "Own more of what your community already makes possible",
          heroTitle: `Join ${coopName}`,
          heroSubtitle: `${coopName} brings members together to pool demand, support local businesses, fund shared priorities, and make decisions as owners.`,
          aboutTitle: "A Co-op Built for Members",
          aboutBody: `Membership in ${coopName} is a way to turn community participation into shared leverage. Apply to help grow an economy where members can support each other, vote on priorities, and build useful local infrastructure.`,
          missionBody: [
            "Organize member demand so more value stays connected to the community.",
            "Fund projects and services members actually want.",
            "Create a practical governance path for people who want more say in their local economy.",
          ].join("\n"),
          eligibilityTitle: "Who Should Apply",
          eligibilityBody:
            "Apply if you want to participate, vote, support member businesses, and help turn shared priorities into funded action.",
          faqs: [],
          primaryCtaLabel: "Apply to Join",
          primaryCtaUrl: `/${input.coopId}/application`,
        };
      } else {
        patch = {
          tagline: "Help grow the businesses your co-op believes in",
          heroTitle: `Build with ${coopName}`,
          heroSubtitle: `${coopName} is recruiting members who want to buy from, promote, fund, and grow a stronger co-op marketplace.`,
          aboutTitle: "Turn Support into Ownership",
          aboutBody: `Apply to ${coopName} if you want your support for local businesses to become part of a bigger ownership strategy. Members help bring customers, proposals, rewards, and governance into one co-op economy.`,
          missionBody: [
            "Help member businesses find customers and community support.",
            "Use co-op activity to fund tools, services, and new ventures.",
            "Create a marketplace where members can see their participation compound.",
          ].join("\n"),
          eligibilityTitle: "Who Should Apply",
          eligibilityBody:
            "Apply if you are ready to support member businesses, invite serious builders, and help the co-op marketplace grow.",
          faqs: [],
          primaryCtaLabel: "Apply to Join",
          primaryCtaUrl: `/${input.coopId}/application`,
        };
      }

      const publicInfo = await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: { ...patch, updatedBy: ctx.walletAddress },
      });

      return { success: true, publicInfo };
    }),

  /**
   * Get public coop info for editing (admin only)
   */
  getForEdit: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot access public info for a different coop",
        });
      }

      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      return publicInfo;
    }),
});
