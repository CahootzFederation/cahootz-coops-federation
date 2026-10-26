import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";

import { recordAgentResultCost } from "../ai-cost.js";

/**
 * A short-lived research worker that searches the web for local businesses for
 * one approved campaign. It only reports what businesses publish about
 * themselves; it never contacts anyone. Code checks and dedupes everything it
 * returns before a business is queued.
 */
export const VENDOR_RESEARCH_FEATURE = "vendor-outreach-research";
export const VENDOR_RESEARCH_MODEL = process.env.VENDOR_RESEARCH_MODEL || "gpt-5.2";
const MAX_BUSINESSES = 10;

export const ResearchResultSchema = z.object({
  businesses: z
    .array(
      z.object({
        name: z.string(),
        website: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
        address: z.string().nullable(),
        city: z.string().nullable(),
        contactSourceUrl: z.string().describe("The page where the email or phone was published"),
        whyFit: z.string().describe("One short sentence on why this business fits, in plain words"),
      }),
    )
    .max(MAX_BUSINESSES),
  suggestedSources: z
    .array(z.object({ name: z.string(), domain: z.string(), reason: z.string() }))
    .max(2)
    .describe("Directories worth searching next time, like a chamber of commerce member list"),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

export interface ResearchRequest {
  coopId: string;
  categoryLabel: string;
  searchTerms: string[];
  area: string;
  directoryHints: Array<{ name: string; domain: string }>;
}

export type ResearchRunner = (request: ResearchRequest) => Promise<ResearchResult | null>;

const INSTRUCTIONS = [
  "You find real local businesses that might offer a community a better price.",
  "Use web search. Prefer independent, locally owned businesses near the area given.",
  "Only report contact details the business publishes itself, on its own website or its business listing.",
  "Never guess or invent an email, phone, website or business. Use null when you can't find one.",
  "Don't include large national chains, marketplaces, or businesses that are closed.",
  "whyFit is one short, plain sentence about the business, with no prices and no promises.",
  "If you notice a directory of local businesses that would be good to search next time, suggest it.",
].join("\n");

export const runVendorResearch: ResearchRunner = async (request) => {
  const agent = new Agent({
    name: "Vendor research worker",
    instructions: INSTRUCTIONS,
    model: VENDOR_RESEARCH_MODEL,
    outputType: ResearchResultSchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: "auto" },
  });
  const input = [
    `Find up to ${MAX_BUSINESSES} local businesses selling ${request.categoryLabel} near ${request.area}.`,
    `Helpful search terms: ${request.searchTerms.join(", ")}.`,
    request.directoryHints.length
      ? `Also look in these directories: ${request.directoryHints.map((hint) => `${hint.name} (site:${hint.domain})`).join("; ")}.`
      : "",
  ].filter(Boolean).join("\n");
  const result = await run(agent, input);
  await recordAgentResultCost({ coopId: request.coopId, feature: VENDOR_RESEARCH_FEATURE, model: VENDOR_RESEARCH_MODEL, result: result as any }).catch(() => {});
  const parsed = ResearchResultSchema.safeParse(result.finalOutput);
  return parsed.success ? parsed.data : null;
};
