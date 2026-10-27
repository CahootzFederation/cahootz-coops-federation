import { db } from "@repo/db";

import { auditLogEntry } from "../lib/audit.js";
import { DecisionTrail } from "./sage-decision-trail.js";
import {
  SAGE_INPUT_REFUSAL_REPLIES, checkSageInput, checkSageOutput, cleanseUntrustedText, describeInputFlags, describeOutputProblems,
  describeSageInputRefusal, isSteeringAttempt, isUnsafeReply, mergeFlags,
} from "./untrusted-input.js";

/** Sent instead of a model reply when the message tries to instruct Sage. No model call is made. */
export const SAGE_STEERING_REPLY = SAGE_INPUT_REFUSAL_REPLIES.STEERING;
/** Sent instead of a model reply that failed the safety check in a way cleanup can't fix. */
export const SAGE_UNSAFE_REPLY = "I can't give a good answer to that here. A Commons admin can help.";

/**
 * Decision trails for Sage's @mention and direct-message replies. The reply flow is unchanged:
 * traceSageReply wraps it, records what Sage read, what it was grounded on, the reply it drafted and
 * where it posted, and rethrows any failure after recording it so the caller's handling still applies.
 *
 * Mentions in the general Commons feed are visible to that Commons' members; a mention in a circle only
 * to that circle's members; a direct message's trail only to the two people in it (circle visibility on
 * the DM's private group). An Ask Sage chat is private to the member, so its trail is admin-only, the same
 * people who can already read every DM trail.
 */
export type SageReplySource =
  | { kind: "post"; coopId: string; postId: string; circleId?: string | null }
  | { kind: "comment"; coopId: string; postId: string; commentId: string; circleId?: string | null }
  | { kind: "dm"; coopId: string; groupId: string; messageId: string }
  | { kind: "chat"; coopId: string; messageId: string };

export interface SageReplyGrounding {
  charterChars: number;
  missionGoalCount: number;
  model: string;
  usedFallback: boolean;
}

function trailFor(source: SageReplySource, message: string, threadContext: string | undefined) {
  if (source.kind === "chat") {
    return new DecisionTrail({
      agent: "sage-reply", coopId: source.coopId, circleId: null,
      sourceType: "sage_chat", sourceId: source.messageId, trigger: "SAGE_CHAT", visibility: "ADMINS",
      observed: { content: message, context: threadContext }, relatedPostIds: [],
    }).step("OBSERVED", "Read a message in the Ask Sage chat");
  }
  const isDm = source.kind === "dm";
  const circleId = isDm ? source.groupId : source.circleId ?? null;
  return new DecisionTrail({
    agent: "sage-reply", coopId: source.coopId,
    circleId,
    sourceType: isDm ? "sage_dm" : "sage_mention",
    sourceId: source.kind === "post" ? source.postId : source.kind === "comment" ? source.commentId : source.messageId,
    trigger: isDm ? "SAGE_DM" : "SAGE_MENTION",
    visibility: circleId ? "CIRCLE" : "COMMONS_MEMBERS",
    observed: { content: message, context: threadContext },
    relatedPostIds: isDm ? [] : [source.postId],
  }).step("OBSERVED", source.kind === "post" ? "Read a post that @mentioned Sage"
    : source.kind === "comment" ? "Read a comment that @mentioned Sage" : "Read a direct message to Sage");
}

export async function traceSageReply(
  source: SageReplySource,
  input: { message: string; threadContext?: string; threadCount: number; remembered?: string[]; toolLog?: string[] },
  produce: (message: string, threadContext: string | undefined) => Promise<{ reply: string; grounding?: SageReplyGrounding }>,
  publish: (reply: string) => Promise<void>,
): Promise<void> {
  const message = cleanseUntrustedText(input.message, { maxChars: 4000 });
  const thread = input.threadContext ? cleanseUntrustedText(input.threadContext, { maxChars: 8000 }) : undefined;
  const inputCheck = mergeFlags(thread ? [message, thread] : [message]);
  const trail = trailFor(source, message.text, thread?.text);
  trail.step("EVIDENCE", input.threadCount
    ? `${input.threadCount} earlier ${source.kind === "dm" || source.kind === "chat" ? "messages in this conversation" : "items in the thread"}`
    : "No earlier conversation");
  if (input.remembered?.length) {
    trail.step("EVIDENCE", `${input.remembered.length} need${input.remembered.length === 1 ? "" : "s"} remembered from the member's check-ins`, { detail: input.remembered.join("\n") });
  }
  if (source.kind === "dm") trail.policy("The sender is in this direct message with Sage", true);
  else if (source.kind === "chat") trail.policy("The sender is an active member of this Commons", true);
  else {
    trail.policy("The sender is an active member of this Commons", true);
    trail.policy(source.circleId ? "Sage replies to @mentions in this Commons' circles, with no tools" : "Sage replies to @mentions in the general Commons feed", true);
  }
  // Only the new message decides this; earlier turns are context, and Sage's own replies are in them.
  const steering = isSteeringAttempt(message.flags);
  trail.policy("The message has no instructions aimed at Sage", !steering, describeInputFlags(inputCheck));
  // Code, math problems, huge pastes and encoded blobs never reach a model.
  const refusal = checkSageInput(input.message, message.flags);
  if (refusal && refusal !== "STEERING") {
    trail.policy("The message reads as a person writing to Sage", false, describeSageInputRefusal(refusal));
  }
  try {
    if (refusal) {
      await publish(SAGE_INPUT_REFUSAL_REPLIES[refusal]);
      if (refusal !== "STEERING") {
        await db.auditLog.create({
          data: auditLogEntry({
            actorId: "system/sage", action: "SAGE_INPUT_REFUSED",
            resource: source.kind === "dm" ? "GroupComment" : source.kind === "chat" ? "SageChatMessage" : source.kind === "comment" ? "CommonsComment" : "CommonsPost",
            resourceId: source.kind === "post" ? source.postId : source.kind === "comment" ? source.commentId : source.messageId,
            metadata: { reason: refusal, channel: source.kind, length: input.message.length },
          }),
        }).catch(console.error);
      }
      trail.taken("Sent a ready-made reply", "INFO");
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
        : `No charter text is configured; ${grounding.missionGoalCount} mission goals`, { detail: `Model ${grounding.model}.` });
    }
    // The same toolkit serves DMs and @mentions (buildSageReplyTools); record each lookup or action it took.
    for (const entry of input.toolLog ?? []) trail.step("EVIDENCE", `Used a tool: ${entry}`);
    trail.step("CONSIDERED", "Drafted a reply", { outcome: "INFO", detail: reply });
    if (grounding) {
      trail.policy("The model gave an answer", !grounding.usedFallback,
        grounding.usedFallback ? "The model returned nothing, so Sage sent its ready-made \"I'm not sure\" reply." : undefined);
    }
    trail.policy("The reply passes the safety check", outputCheck.ok, [
      describeOutputProblems(outputCheck.problems),
      outputCheck.ok ? "" : isUnsafeReply(outputCheck.problems) ? "Sent a safe standard reply instead." : "Links and @mentions were removed before posting.",
    ].filter(Boolean).join(" ") || undefined);
    await publish(reply);
    trail.taken(source.kind === "dm" ? "Replied in the direct message" : source.kind === "chat" ? "Replied in the Ask Sage chat" : "Replied in the comments as Sage", "PASS");
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

/** Sage doesn't reply to @mentions outside this Commons' own circles; recording that answers "why didn't Sage reply?". */
export async function recordSkippedCircleMention(source: { coopId: string; circleId: string; postId: string; sourceId: string; kind: "post" | "comment" }, message: string) {
  const trail = new DecisionTrail({
    agent: "sage-reply", coopId: source.coopId, circleId: source.circleId,
    sourceType: "sage_mention", sourceId: source.sourceId, trigger: "SAGE_MENTION", visibility: "CIRCLE",
    observed: { content: message }, relatedPostIds: [source.postId],
  }).step("OBSERVED", source.kind === "post" ? "Read a circle post that @mentioned Sage" : "Read a circle comment that @mentioned Sage");
  trail.policy("Sage replies to @mentions in this Commons' feed and circles", false, "This circle isn't one Sage answers in.");
  await trail.taken("Didn't reply", "INFO").result("No reply", "INFO", "None.").setOutcome("Didn't reply: Sage doesn't answer here").save();
}
