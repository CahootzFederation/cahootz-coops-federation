import { createHash, createHmac } from "node:crypto";

/**
 * The outreach email. Code writes every fact and term; the only free text is a
 * checked personal line (Sage's) and an admin-approved extra line. The email
 * comes from Cahootz Commons, never names the Commons or anyone in it, and
 * doesn't talk about how it was written.
 */
export interface OutreachEmailInput {
  step: "FIRST" | "FOLLOW_UP";
  businessName: string;
  categoryLabel: string;
  /** A specific discovered item the campaign is finding a seller for. Used in place of the category. */
  itemName?: string | null;
  area: string;
  interestCount: number;
  offerType: "MEMBER_DEAL" | "GROUP_BUY";
  personalLine?: string | null;
  pitchPoints?: string | null;
  replyUrl: string;
  unsubscribeUrl: string;
  postalAddress: string;
}

export interface OutreachEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildOutreachEmail(input: OutreachEmailInput): OutreachEmail {
  const what = input.itemName || input.categoryLabel;
  // An admin can start a search for an item before any members have answered; then we don't give a number.
  const households = input.interestCount < 1 ? "Households" : input.interestCount === 1 ? "1 household" : `${input.interestCount} households`;
  const deal =
    input.offerType === "GROUP_BUY"
      ? "a group order when enough people sign up, at a price that works for you"
      : "a standing member price";

  const howItWorks = [
    "You set the member price and how much you get for each item. That amount is yours, with no fees taken out of it.",
    "Members pay through Cahootz Commons, and we send your amount to your account.",
    "Nobody pays anything until an order is confirmed with you.",
  ];

  const paragraphs =
    input.step === "FIRST"
      ? [
          `Hi ${input.businessName},`,
          "I'm reaching out from Cahootz Commons, a network of community groups that buy from local businesses together.",
          input.interestCount < 1
            ? `${households} in a community near ${input.area} want to buy ${what} together. We're looking for a business that would offer them ${deal}.`
            : `${households} in a community near ${input.area} told us they'd buy ${what} together. We're looking for a local business that would offer them ${deal}.`,
          ...(input.personalLine ? [input.personalLine] : []),
          ...(input.pitchPoints ? [input.pitchPoints] : []),
        ]
      : [
          `Hi ${input.businessName},`,
          `Following up on my note about ${input.interestCount < 1 ? "households" : households} near ${input.area} who'd like to buy ${what} together.`,
          "If it's a fit, it takes about a minute to tell us. If not, no problem at all.",
        ];

  const subject =
    input.step === "FIRST"
      ? `Local households looking for ${what}`
      : `Following up: local households and ${what}`;

  const replyLine = `If you're open to it, tell us here: ${input.replyUrl}`;
  const text = [
    ...paragraphs,
    ...(input.step === "FIRST" ? ["How it works for you:", ...howItWorks.map((line) => `- ${line}`)] : []),
    replyLine,
    "Thanks,\nThe Cahootz Commons team",
    `${input.postalAddress}\nDon't want to hear from us? Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n\n");

  const p = (content: string) => `<p style="margin:0 0 14px;line-height:1.5">${content}</p>`;
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f1d1a;max-width:560px">',
    ...paragraphs.map((line) => p(escapeHtml(line))),
    ...(input.step === "FIRST"
      ? [p("<strong>How it works for you:</strong>"), `<ul style="margin:0 0 14px;padding-left:20px;line-height:1.5">${howItWorks.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`]
      : []),
    p(`If you're open to it, <a href="${escapeHtml(input.replyUrl)}">tell us here</a>. It takes about a minute.`),
    p("Thanks,<br>The Cahootz Commons team"),
    `<p style="margin:24px 0 0;font-size:12px;color:#77706a;line-height:1.5">${escapeHtml(input.postalAddress)}<br>Don't want to hear from us? <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#77706a">Unsubscribe</a>.</p>`,
    "</div>",
  ].join("");

  return { subject, text, html };
}

/** The reply link token for one business in one campaign. Derived, so follow-ups reuse the same link. */
export function replyToken(campaignProspectId: string, secret = process.env.SESSION_SECRET) {
  if (!secret) throw new Error("SESSION_SECRET is required to make reply links");
  return createHmac("sha256", secret).update(`vendor-reply:${campaignProspectId}`).digest("base64url");
}

export function hashReplyToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function webBaseUrl() {
  return (process.env.WEB_BASE_URL || process.env.NEXT_PUBLIC_WEB_URL || process.env.WEB_URL || "https://cahootzcommons.com").replace(/\/+$/, "");
}

export function replyUrls(token: string) {
  const base = webBaseUrl();
  return {
    replyUrl: `${base}/v/${token}`,
    unsubscribeUrl: `${base}/v/${token}?unsubscribe=1`,
    oneClickUnsubscribeUrl: `${base}/api/vendor-reply/${token}/unsubscribe`,
  };
}
