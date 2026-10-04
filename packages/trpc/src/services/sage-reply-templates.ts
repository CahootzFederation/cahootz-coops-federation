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
export const SAGE_CAN_OFFER = ["draft a proposal for you to edit and submit", "ask a clarifying question", "suggest members to connect with"];

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
];

/** Voice rules for every Sage reply, with or without a template. */
export const SAGE_VOICE_RULES = [
  "Write as a trusted organizer in this Commons: say \"we\" and \"us\", speak to the member as \"you\", warm but brief. No greetings or sign-offs.",
  "Lead with your position. Turn advice into something specific a person can do; ask the member you're replying to, not \"anyone\".",
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
  "The thread may include Sage's own earlier comments. If Sage offered to do something once a member provided information, and this item provides it, follow through now (for example, include MAKE_PROPOSAL with a draft built from the details they gave). Don't ask again for information they already gave. Don't say a draft was created; the member is notified when it's ready.";

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
