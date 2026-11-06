import { Agent, run } from "@openai/agents";
import { z } from "zod";

import { recordAgentResultCost } from "../ai-cost.js";
import { checkOutreachText } from "./outreach-check.js";

/**
 * Sage's one personal line for an outreach email: why this business seems like
 * a good fit, from what it publishes about itself. Optional; if it's missing or
 * fails the check, the email goes out without it.
 */
export const VENDOR_DRAFT_FEATURE = "vendor-outreach-draft";
export const VENDOR_DRAFT_MODEL = process.env.VENDOR_DRAFT_MODEL || "gpt-5.6-luna";

export type DraftRunner = (input: { coopId: string; businessName: string; about: string; categoryLabel: string }) => Promise<string | null>;

const INSTRUCTIONS = [
  "Write one or two short, warm, plain sentences to a local business owner about why their business caught our eye.",
  "Use only the facts given about the business. Talk to them as 'you'. Sound like a friendly neighbor, not a salesperson.",
  "No prices, numbers, percentages, links, promises, or claims that anyone approved anything.",
  "Don't mention any church, community name, or person. Don't mention how this note was written.",
].join("\n");

export const runVendorDraft: DraftRunner = async (input) => {
  const agent = new Agent({
    name: "Vendor outreach line",
    instructions: INSTRUCTIONS,
    model: VENDOR_DRAFT_MODEL,
    outputType: z.object({ line: z.string() }),
  });
  const result = await run(agent, `Business: ${input.businessName}\nWhat they sell: ${input.categoryLabel}\nAbout them: ${input.about}`);
  await recordAgentResultCost({ coopId: input.coopId, feature: VENDOR_DRAFT_FEATURE, model: VENDOR_DRAFT_MODEL, result: result as any }).catch(() => {});
  const line = (result.finalOutput as { line?: string } | undefined)?.line;
  return typeof line === "string" ? line.trim() : null;
};

/** A checked personal line, or null. Never throws: a failed draft just means no personal line. */
export async function personalLineFor(
  input: { coopId: string; businessName: string; about: string | null; categoryLabel: string; forbiddenNames: string[] },
  draft: DraftRunner = runVendorDraft,
): Promise<string | null> {
  if (!input.about?.trim()) return null;
  try {
    const line = await draft({ coopId: input.coopId, businessName: input.businessName, about: input.about.slice(0, 500), categoryLabel: input.categoryLabel });
    if (!line) return null;
    return checkOutreachText(line, { forbiddenNames: input.forbiddenNames }).ok ? line : null;
  } catch (error) {
    console.error("[Vendor outreach] Personal line failed:", error);
    return null;
  }
}
