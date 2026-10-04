import { DecisionTrail } from "./sage-decision-trail.js";
import {
  checkSageOutput, cleanseUntrustedText, describeInputFlags, describeOutputProblems, isSteeringAttempt, isUnsafeReply, mergeFlags,
} from "./untrusted-input.js";

/** Sent instead of a model reply when the message tries to instruct Sage. No model call is made. */
export const SAGE_STEERING_REPLY = "I can only help with questions about this Commons, its charter and its goals.";
/** Sent instead of a model reply that failed the safety check in a way cleanup can't fix. */
export const SAGE_UNSAFE_REPLY = "I can't give a good answer to that here. A Commons admin can help.";

/**
 * Decision trails for Sage's @mention and direct-message replies. The reply flow is unchanged:
 * traceSageReply wraps it, records what Sage read, what it was grounded on, the reply it drafted and
 * where it posted, and rethrows any failure after recording it so the caller's handling still applies.
 *
 * Mentions in the general Commons feed are visible to that Commons' members; a direct message's trail
 * is visible only to the two people in it (circle visibility on the DM's private group).
 */
export type SageReplySource =
  | { kind: "post"; coopId: string; postId: string }
  | { kind: "comment"; coopId: string; postId: string; commentId: string }
  | { kind: "dm"; coopId: string; groupId: string; messageId: string };

export interface SageReplyGrounding {
  charterChars: number;
  missionGoalCount: number;
  model: string;
  usedFallback: boolean;
}

function trailFor(source: SageReplySource, message: string, threadContext: string | undefined) {
  const isDm = source.kind === "dm";
  return new DecisionTrail({
    agent: "sage-reply", coopId: source.coopId,
    circleId: isDm ? source.groupId : null,
    sourceType: isDm ? "sage_dm" : "sage_mention",
    sourceId: source.kind === "post" ? source.postId : source.kind === "comment" ? source.commentId : source.messageId,
    trigger: isDm ? "SAGE_DM" : "SAGE_MENTION",
    visibility: isDm ? "CIRCLE" : "COMMONS_MEMBERS",
    observed: { content: message, context: threadContext },
    relatedPostIds: isDm ? [] : [source.postId],
  }).step("OBSERVED", source.kind === "post" ? "Read a post that @mentioned Sage"
    : source.kind === "comment" ? "Read a comment that @mentioned Sage" : "Read a direct message to Sage");
}

export async function traceSageReply(
  source: SageReplySource,
  input: { message: string; threadContext?: string; threadCount: number },
  produce: (message: string, threadContext: string | undefined) => Promise<{ reply: string; grounding?: SageReplyGrounding }>,
  publish: (reply: string) => Promise<void>,
): Promise<void> {
  const message = cleanseUntrustedText(input.message, { maxChars: 4000 });
  const thread = input.threadContext ? cleanseUntrustedText(input.threadContext, { maxChars: 8000 }) : undefined;
  const inputCheck = mergeFlags(thread ? [message, thread] : [message]);
  const trail = trailFor(source, message.text, thread?.text);
  trail.step("EVIDENCE", input.threadCount
    ? `${input.threadCount} earlier ${source.kind === "dm" ? "messages in this conversation" : "items in the thread"}`
    : "No earlier conversation");
  if (source.kind === "dm") trail.policy("The sender is in this direct message with Sage", true);
  else {
    trail.policy("The sender is an active member of this Commons", true);
    trail.policy("Sage replies to @mentions in the general Commons feed", true);
  }
  // Only the new message decides this; earlier turns are context, and Sage's own replies are in them.
  const steering = isSteeringAttempt(message.flags);
  trail.policy("The message has no instructions aimed at Sage", !steering, describeInputFlags(inputCheck));
  try {
    if (steering) {
      await publish(SAGE_STEERING_REPLY);
      trail.taken("Sent the standard reply without asking the model", "INFO");
      trail.result("Reply posted", "PASS", "None.");
      await trail.save();
      return;
    }
    const produced = await produce(message.text, thread?.text);
    const { grounding } = produced;
    const outputCheck = checkSageOutput(produced.reply);
    const reply = outputCheck.ok ? produced.reply : isUnsafeReply(outputCheck.problems) ? SAGE_UNSAFE_REPLY : outputCheck.cleaned;
    if (grounding) {
      trail.step("EVIDENCE", grounding.charterChars
        ? `The charter (${grounding.charterChars.toLocaleString("en-US")} characters) and ${grounding.missionGoalCount} mission goals`
        : `No charter text is configured; ${grounding.missionGoalCount} mission goals`, { detail: `Model ${grounding.model}. Sage replies have no other tools or memory.` });
    }
    trail.step("CONSIDERED", "Drafted a reply", { outcome: "INFO", detail: reply });
    if (grounding) {
      trail.policy("The model gave an answer", !grounding.usedFallback,
        grounding.usedFallback ? "The model returned nothing, so Sage used its standard \"no grounded answer\" reply." : undefined);
    }
    trail.policy("The reply passes the safety check", outputCheck.ok, [
      describeOutputProblems(outputCheck.problems),
      outputCheck.ok ? "" : isUnsafeReply(outputCheck.problems) ? "Sent a safe standard reply instead." : "Links and @mentions were removed before posting.",
    ].filter(Boolean).join(" ") || undefined);
    await publish(reply);
    trail.taken(source.kind === "dm" ? "Replied in the direct message" : "Replied in the comments as Sage", "PASS");
    trail.result("Reply posted", "PASS", "None.");
    await trail.save();
  } catch (error) {
    trail.taken("Couldn't reply", "FAIL")
      .taken("Error", "FAIL", error instanceof Error ? error.message : String(error), true)
      .result("No reply posted", "FAIL", "None.")
      .setOutcome("Reply failed");
    await trail.save();
    throw error;
  }
}

/** Sage doesn't reply to @mentions in circles; recording that answers "why didn't Sage reply?". */
export async function recordSkippedCircleMention(source: { coopId: string; circleId: string; postId: string; sourceId: string; kind: "post" | "comment" }, message: string) {
  const trail = new DecisionTrail({
    agent: "sage-reply", coopId: source.coopId, circleId: source.circleId,
    sourceType: "sage_mention", sourceId: source.sourceId, trigger: "SAGE_MENTION", visibility: "CIRCLE",
    observed: { content: message }, relatedPostIds: [source.postId],
  }).step("OBSERVED", source.kind === "post" ? "Read a circle post that @mentioned Sage" : "Read a circle comment that @mentioned Sage");
  trail.policy("Sage replies to @mentions in the general Commons feed", false, "This was in a circle. Circle activity is read in batches by circle analysis instead.");
  await trail.taken("Didn't reply", "INFO").result("No reply", "INFO", "None.").setOutcome("Didn't reply: @mentions in circles aren't answered").save();
}
