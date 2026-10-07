import { tool } from "@openai/agents";
import { z } from "zod";

import type { KnowledgeVisibility } from "@repo/db";
import { searchKnowledgeBase } from "../../services/knowledge-base.js";
import type { AgentToolContext } from "./context.js";

/**
 * Read-only tools for the agents that write Sage's comments (the Commons feed agent and the circle
 * trend agent). Each is bound to one Commons, and to one circle when given. Unlike the steward's
 * Bridge tools they never return member names or ids, because what they find can end up in a public
 * comment: introductions stay consent-first.
 *
 * Every result's text is added to `checked`, so a reply that quotes it can be verified in code.
 */
export type CommentToolLog = (summary: string, detail?: string) => void;

const MIN_MEMBERS_SHOWN = 2;
const STOPWORDS = new Set(["a", "an", "the", "for", "to", "of", "and", "with", "help", "need", "someone", "who", "can", "my", "our"]);

function words(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word)))];
}

export function buildCommentTools(ctx: AgentToolContext & { circleId?: string | null }, checked: string[], log?: CommentToolLog) {
  const searchDocuments = tool({
    name: "search_commons_documents",
    description: "Search this Commons' uploaded documents (notes, guides, local programs, FAQs) for facts about the topic. Returns titles and excerpts; quote an excerpt exactly if you rely on it.",
    parameters: z.object({ query: z.string().min(3).max(200), limit: z.number().int().min(1).max(5).default(3) }),
    errorFunction: null,
    execute: async ({ query, limit }) => {
      // Results can end up in a comment everyone in the Commons (or circle) reads, so only documents
      // already shared that widely: never PRIVATE ones.
      const scopes = [
        { scopeType: "commons", scopeId: ctx.coopId, visibilities: ["COMMONS", "PUBLIC"] as KnowledgeVisibility[] },
        ...(ctx.circleId ? [{ scopeType: "circle", scopeId: ctx.circleId, visibilities: ["CIRCLE", "COMMONS", "PUBLIC"] as KnowledgeVisibility[] }] : []),
      ];
      const results = (await Promise.all(scopes.map((scope) => searchKnowledgeBase({ coopId: ctx.coopId, ...scope, query, limit }).catch(() => [])))).flat().slice(0, limit);
      const found = results.map((row) => ({ title: String((row as { title?: unknown }).title ?? ""), excerpt: String((row as { excerpt?: unknown }).excerpt ?? "").slice(0, 800) }));
      for (const row of found) checked.push(row.title, row.excerpt);
      log?.(`Searched documents for "${query.slice(0, 60)}": ${found.length} found`, found.map((row) => `• ${row.title}`).join("\n") || undefined);
      return found;
    },
  });

  const listResources = tool({
    name: "list_commons_resources",
    description: "Verified resources members have shared in this Commons: skills, equipment, spaces, services, information.",
    parameters: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
    errorFunction: null,
    execute: async ({ limit }) => {
      const resources = await ctx.db.commonsResource.findMany({
        where: { coopId: ctx.coopId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: limit,
        select: { kind: true, title: true, description: true },
      });
      for (const resource of resources) checked.push(resource.title, resource.description ?? "");
      log?.(`${resources.length} published resources`, resources.map((resource) => `• ${resource.title}`).join("\n") || undefined);
      return resources.map((resource) => ({ kind: resource.kind, title: resource.title, description: (resource.description ?? "").slice(0, 400) }));
    },
  });

  const countMembersOffering = tool({
    name: "count_members_offering",
    description: "How many active members of this Commons list a skill, resource or interest matching something the group needs. Counts only, never names; under 2 is reported as \"fewer than 2\".",
    parameters: z.object({ need: z.string().min(3).max(200) }),
    errorFunction: null,
    execute: async ({ need }) => {
      const wanted = words(need);
      if (!wanted.length) return { summary: "No matching members found." };
      const members = await ctx.db.userCoopMembership.findMany({
        where: { coopId: ctx.coopId, status: "ACTIVE", user: { isBot: false, deletedAt: null } },
        select: { user: { select: { skills: true, resourcesOffered: true, interests: true } } }, take: 1000,
      });
      // A term is shown only when at least two members list it, so it can't point at one person.
      const termCounts = new Map<string, number>();
      let count = 0;
      for (const member of members) {
        const matched = [...member.user.skills, ...member.user.resourcesOffered, ...member.user.interests]
          .filter((entry) => words(entry).some((word) => wanted.some((want) => word.startsWith(want.slice(0, 5)) || want.startsWith(word.slice(0, 5)))));
        if (matched.length) {
          count += 1;
          for (const term of new Set(matched.map((entry) => entry.toLowerCase()))) termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
        }
      }
      const shared = [...termCounts].filter(([, members]) => members >= MIN_MEMBERS_SHOWN).map(([term]) => term).slice(0, 6);
      const summary = count >= MIN_MEMBERS_SHOWN
        ? `${count} members list something matching "${need}"${shared.length ? `: ${shared.join(", ")}` : ""}.`
        : `Fewer than 2 members list something matching "${need}".`;
      checked.push(summary);
      log?.(summary);
      return { summary };
    },
  });

  return [searchDocuments, listResources, countMembersOffering];
}
