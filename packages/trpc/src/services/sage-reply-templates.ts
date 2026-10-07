/**
 * Reply templates Sage may use when one fits. They are suggestions, not a required format: when no
 * template fits a post, Sage writes a short, direct reply in the shared voice instead.
 *
 * To add a template, add an entry to SAGE_REPLY_TEMPLATES. Keep "useWhen" specific enough that Sage
 * can tell when the template doesn't apply, and only promise things Sage can actually do (see
 * SAGE_CAN_OFFER), because the output check and members will hold Sage to them.
 */
/** The parts a model fills in when it picks a template. Code renders them, so the format is exact. */
export interface TemplateParts {
  lead: string;
  steps: string[];
  offer: string;
}

export interface SageReplyTemplate {
  key: string;
  name: string;
  /** What each part means for this template, for the model. */
  parts: { lead: string; steps: string; offer: string };
  render: (parts: TemplateParts) => string;
  /** When the template fits. Sage skips it otherwise. */
  useWhen: string;
  /** The parts of the reply, in order. */
  shape: string[];
  example: string;
}

/** The only follow-up actions Sage may offer in a reply, because they're the only ones it can do. */
export const SAGE_CAN_OFFER = [
  "draft a proposal for you to edit and submit", "ask a clarifying question", "suggest members to connect with",
  // A reply that summarizes the thread, and a SageTask follow-up (followUpDays), both exist today.
  "summarize where we've landed", "check back with you on a date you pick",
];

/** Templates whose bullets are things the member is asked to do, so a reply using one is a follow-up.
 * In the others the bullets are options, agreements or questions, not tasks. */
export const TEMPLATES_THAT_ASK = new Set(["action-plan"]);

/** What Sage waits for after a reply, or "" when the reply asks for nothing and needs no follow-up. */
export function followUpExpectation(reply: { templateKey?: string; templateSteps?: string[]; followUpDays?: number; followUpExpect?: string }): string {
  const steps = (reply.templateSteps ?? []).map((step) => step.trim()).filter(Boolean);
  const asks = TEMPLATES_THAT_ASK.has(reply.templateKey ?? "") && steps.length > 0;
  if (!(reply.followUpDays ?? 0) && !asks) return "";
  return reply.followUpExpect?.trim() || (asks ? steps.join("; ") : "");
}

/** A position, 1-4 bullets, a blank line, then the closing line (optionally after a fixed prefix). */
function bulletReply(lead: string, steps: string[], close: string, closePrefix = ""): string {
  const closing = close.trim();
  const prefixed = closePrefix && !closing.toLowerCase().startsWith(closePrefix.toLowerCase()) ? `${closePrefix}${closing}` : closing;
  return [lead.trim(), ...steps.map((step) => `• ${step.trim().replace(/^[•\-*]\s*/, "")}`), "", prefixed].join("\n");
}

export const SAGE_REPLY_TEMPLATES: SageReplyTemplate[] = [
  {
    key: "action-plan",
    name: "Action plan",
    useWhen: "A member raises a shared need, cost or idea the Commons could act on together, and there are clear first steps the member can take.",
    parts: {
      lead: "One sentence: your position and why it matters to us. No \"Here's what we can do\" - that's added for you.",
      steps: "2-3 concrete actions for the member you're replying to, each starting with a verb, with a deadline when it fits. No bullet characters.",
      offer: "What Sage will do after, starting with \"I can\" and using only what Sage can offer.",
    },
    render: ({ lead, steps, offer }) => [
      `${lead.trim()} Here's what we can do:`,
      ...steps.map((step) => `• ${step.trim().replace(/^[•\-*]\s*/, "")}`),
      "",
      `Once you've done that, ${offer.trim().replace(/^Once you've done that,?\s*/i, "")}`,
    ].join("\n"),
    shape: [
      "One sentence: your position and why it matters to us.",
      "\"Here's what we can do:\" then 2-3 bullets starting with \"•\". Each bullet is one concrete action for the member you're replying to (\"you\"), with a deadline when it fits.",
      "\"Once you've done that, I can ...\" with one thing from the list of things Sage can offer.",
    ],
    example: [
      "Pooling drivers is exactly the kind of cost we should be sharing. Here's what we can do:",
      "• Post in the Commons asking who else runs deliveries, so we know who's in.",
      "• Reply here with your delivery days, rough weekly stops, and what you pay now.",
      "",
      "Once you've done that, I can draft a small proposal so members can vote on funding it or on someone to organize the drivers.",
    ].join("\n"),
  },
  {
    key: "where-we-are",
    name: "Where we are",
    useWhen: "A thread has several replies and is going in circles, or people are talking past each other. Not for a single post with no replies.",
    parts: {
      lead: "One sentence naming the decision the thread is really about.",
      steps: "2-3 bullets: what people already agree on (start with \"Agreed:\") and what is still open (start with \"Still open:\"). Use only what members said; no names.",
      offer: "One question to the group that would settle the open point, or an offer starting with \"I can\".",
    },
    render: ({ lead, steps, offer }) => bulletReply(lead, steps, offer),
    shape: [
      "One sentence naming the decision.",
      "2-3 bullets starting with \"•\": \"Agreed: ...\" and \"Still open: ...\", from what members said.",
      "One question that would settle it, or \"I can ...\".",
    ],
    example: [
      "This is really about whether we meet weekly or monthly.",
      "• Agreed: we want the potluck to keep going, and Saturdays work best.",
      "• Still open: weekly is a lot of hosting for the same few homes.",
      "",
      "Who would host at least once if we went weekly? If fewer than four, I can summarize where we've landed as monthly.",
    ].join("\n"),
  },
  {
    key: "trade-off",
    name: "Trade-off",
    useWhen: "Members are weighing two or three concrete options for the same decision. Lay the options out evenly; don't pick a side between members.",
    parts: {
      lead: "One sentence naming the choice in front of us.",
      steps: "One bullet per option (2-3): the option, then what it costs or risks us, from the thread or a checked source.",
      offer: "The one fact that would decide it, and who could supply it (a role, not a name), as a question.",
    },
    render: ({ lead, steps, offer }) => bulletReply(lead, steps, offer),
    shape: [
      "One sentence naming the choice.",
      "One \"•\" bullet per option with what it costs or risks.",
      "The fact that would decide it, as a question.",
    ],
    example: [
      "We're choosing between the library room and rotating homes.",
      "• Library: free and easy to reach by bus, but it closes at 7.",
      "• Homes: we can stay late, but the same two members end up hosting.",
      "",
      "How many of us need to leave before 7? If most do, the library wins.",
    ].join("\n"),
  },
  {
    key: "missing-piece",
    name: "Missing piece",
    useWhen: "The group is about to decide, or is stuck, because a specific fact is missing (a cost, a date, a count, a rule).",
    parts: {
      lead: "One sentence: what we can't decide yet, and why.",
      steps: "1-3 bullets, each one specific fact we need and who can likely supply it (a role or \"you\", not a name).",
      offer: "What Sage will do once the facts are in, starting with \"I can\" and using only what Sage can offer.",
    },
    render: ({ lead, steps, offer }) => bulletReply(lead, steps, offer, "Once we have that, "),
    shape: [
      "One sentence: what we can't decide yet and why.",
      "1-3 \"•\" bullets, each a specific missing fact and who can supply it.",
      "\"Once we have that, I can ...\" with one thing Sage can offer.",
    ],
    example: [
      "We can't compare the two vans until we know what each costs us a month.",
      "• You: the monthly payment and insurance quote for each.",
      "• Drivers: how many school runs a week each of you would take.",
      "",
      "Once we have that, I can summarize where we've landed so everyone can weigh in.",
    ].join("\n"),
  },
  {
    key: "before-we-decide",
    name: "Before we decide",
    useWhen: "A few people are settling something that affects others who haven't spoken in the thread (other members, a circle, people who'd pay or do the work).",
    parts: {
      lead: "One sentence: who this decision affects that we haven't heard from yet (a group, never a named person).",
      steps: "1-3 bullets, each a question for the people affected.",
      offer: "When Sage will check back or what it will do next, starting with \"I can\".",
    },
    render: ({ lead, steps, offer }) => bulletReply(lead, steps, offer),
    shape: [
      "One sentence on who's affected and not yet heard.",
      "1-3 \"•\" bullets with questions for them.",
      "\"I can ...\" with when Sage checks back or what it does next.",
    ],
    example: [
      "Moving pickup to 3:30 changes things for every member on the route, and only two have weighed in.",
      "• Does 3:30 work with your work schedule?",
      "• If not, what's the latest time that does?",
      "",
      "I can check back with you on a date you pick and summarize the answers.",
    ].join("\n"),
  },
];

/** Voice rules for every Sage reply, with or without a template. */
export const SAGE_VOICE_RULES = [
  "Write as a trusted organizer in this Commons: say \"we\" and \"us\", speak to the member as \"you\", warm but brief. No greetings or sign-offs.",
  "Lead with your position on facts and next steps. Turn advice into something specific a person can do; ask the member you're replying to, not \"anyone\".",
  "When members disagree with each other, don't pick a side: lay out the options, what each costs or risks, and the fact that would decide it.",
  "Comment only when you add something the thread lacks: a fact, structure (options, what's agreed, what's open), or a voice that hasn't been heard. Stay quiet when members are already answering each other well; a question or choice nobody has answered yet is not that, so help with it.",
  "Use plain words. No consultant terms such as leverage, optimize, stakeholders, synergy, pilot design, coverage or best practices.",
  `Only offer what Sage can do: ${SAGE_CAN_OFFER.join("; ")}. Never offer to organize, pay, schedule, recruit, contact people outside the app, or take any real-world action.`,
  "Keep it under about 80 words. No links and no @mentions.",
];

/**
 * Instructions for any agent that writes Sage replies or comments. Structured agents pick a template by
 * key and fill its parts (templateKey, templateLead, templateSteps, templateOffer), and code renders the
 * reply; plain-text agents follow the shape directly.
 */
export function sageReplyStyleInstructions(options: { structured?: boolean; templates?: SageReplyTemplate[] } = {}): string {
  const templates = options.templates ?? SAGE_REPLY_TEMPLATES;
  return [
    ...SAGE_VOICE_RULES,
    templates.length
      ? options.structured
        ? "Reply templates are suggestions. When a post matches a template's \"use when\", set templateKey to that template's key and fill templateLead, templateSteps and templateOffer as described; the reply is built from them, so still write draftText as a plain fallback. When no template matches, set templateKey to \"\" and leave the template fields empty. Never force a post that doesn't match into a template."
        : "Reply templates: when a post matches a template's \"use when\", follow that template's shape, including its line breaks and bullets. They are suggestions: if no template matches, write a short direct reply in the same voice. Never force a post that doesn't match into a template."
      : "",
    ...templates.map((template) => [
      `Template "${template.name}" (key "${template.key}") - use when: ${template.useWhen}`,
      ...(options.structured ? [`templateLead: ${template.parts.lead}`, `templateSteps: ${template.parts.steps}`, `templateOffer: ${template.parts.offer}`] : []),
      `Shape: ${template.shape.map((part, index) => `(${index + 1}) ${part}`).join(" ")}`,
      `Example:\n${template.example}`,
    ].join("\n")),
  ].filter(Boolean).join("\n");
}

/** How Sage follows through on something it offered earlier in the same thread. */
export const SAGE_FOLLOW_THROUGH_RULE =
  "The thread may include Sage's own earlier comments. If Sage offered to do something once a member provided information, and this item provides it, follow through now (for example, include MAKE_PROPOSAL with a draft built from the details they gave; its evidence is still the charter or goal passage the proposal serves, not the member's words). Don't ask again for information they already gave, and don't start a second round of questions: if they gave most of what Sage asked for, follow through now and put anything still missing in the draft as an open question for the group. Don't say a draft was created; the member is notified when it's ready.";

/**
 * The reply text: the chosen template rendered from its parts when the model picked a known template
 * and filled it in, otherwise the model's plain draft.
 */
export function renderTemplatedReply(output: { draftText: string; templateKey?: string; templateLead?: string; templateSteps?: string[]; templateOffer?: string }): { text: string; templateKey: string | null } {
  const template = SAGE_REPLY_TEMPLATES.find((candidate) => candidate.key === output.templateKey);
  const steps = (output.templateSteps ?? []).map((step) => step.trim()).filter(Boolean);
  if (!template || !output.templateLead?.trim() || !output.templateOffer?.trim() || steps.length === 0) {
    return { text: output.draftText, templateKey: null };
  }
  return { text: template.render({ lead: output.templateLead, steps: steps.slice(0, 4), offer: output.templateOffer }), templateKey: template.key };
}
