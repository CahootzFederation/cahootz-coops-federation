import type { ReactNode } from "react";

export type CommunityPostType = "article" | "event" | "business" | "announcement";

export interface CommunityPost {
  type: CommunityPostType;
  title: string;
  summary: string;
  contentMarkdown?: string;
  date?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  sourceUrl?: string;
  imageUrl?: string;
}

export interface PreviewOverrides {
  newspaperTitle?: string;
  newspaperIntro?: string;
  communityPosts?: unknown;
  [key: string]: unknown;
}

export const communityTypeLabels: Record<CommunityPostType, string> = {
  article: "Story",
  event: "Event",
  business: "Business",
  announcement: "Notice",
};

export function normalizePreviewOverrides(value: unknown): PreviewOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PreviewOverrides)
    : {};
}

export function normalizeCommunityPosts(value: unknown): CommunityPost[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((post): post is CommunityPost => {
      return (
        typeof post === "object" &&
        post !== null &&
        "title" in post &&
        "summary" in post &&
        typeof post.title === "string" &&
        typeof post.summary === "string" &&
        post.title.trim().length > 0 &&
        post.summary.trim().length > 0
      );
    })
    .map((post) => {
      const type = ["article", "event", "business", "announcement"].includes(post.type)
        ? post.type
        : "article";

      return {
        type,
        title: post.title.trim(),
        summary: post.summary.trim(),
        contentMarkdown: post.contentMarkdown?.trim() || undefined,
        date: post.date?.trim() || undefined,
        byline: post.byline?.trim() || undefined,
        ctaLabel: post.ctaLabel?.trim() || undefined,
        ctaUrl: post.ctaUrl?.trim() || undefined,
        sourceUrl: post.sourceUrl?.trim() || undefined,
        imageUrl: post.imageUrl?.trim() || undefined,
      };
    });
}

const soulaanSampleCommunityPosts: CommunityPost[] = [
  {
    type: "article",
    title: "Soulaan is building a member-owned wealth engine",
    summary:
      "A front-page look at how Soulaan can turn membership, local spending, and shared decision-making into a practical engine for generational wealth.",
    contentMarkdown: [
      "## Ownership is the headline",
      "Soulaan is not just asking people to join another group chat, marketplace, or event list. The point is ownership. The co-op gives members a place to organize demand, back businesses, and decide what kind of economic power the community wants to build.",
      "When members apply, they are stepping into a structure that can make everyday participation mean more. Buying from a member business, showing up to an event, voting on a priority, or sharing a skill can all point toward the same goal: keeping more value moving through the people who created it.",
      "## What the co-op is trying to prove",
      "- Black communities can pool demand without waiting for outside permission.",
      "- Local businesses can be promoted, funded, and protected by the people they serve.",
      "- Members can build a shared economic memory instead of starting from zero every generation.",
      "The work is still early, but the invitation is clear. Soulaan is calling in people who want more than inspiration. It is for members ready to build, buy, vote, and be accountable to something bigger than one transaction.",
    ].join("\n\n"),
    date: "Front Page",
    byline: "Soulaan Editorial Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "article",
    title: "How a block fund turns small commitments into neighborhood power",
    summary:
      "A simple model for pooling member participation into funds that can support businesses, tools, emergency needs, and community projects.",
    contentMarkdown: [
      "## Small money needs a place to gather",
      "A block fund is the kind of idea that sounds simple because it is. Members make manageable commitments, the co-op tracks priorities, and the community decides where support should go first.",
      "The goal is not to pretend every member can write a large check. The goal is to build a trusted container where smaller commitments can add up, stay visible, and move with intention.",
      "## What it could fund",
      "- Launch support for a member business.",
      "- Shared tools, pop-up equipment, or event infrastructure.",
      "- Emergency relief for members in good standing.",
      "- Youth programs, business education, or financial workshops.",
      "The bigger win is the habit. Once members can see their participation become something real, the co-op starts feeling less abstract and more like a community balance sheet.",
    ].join("\n\n"),
    date: "Wealth Desk",
    byline: "Community Finance Team",
    imageUrl:
      "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "article",
    title: "Inside the first Soulaan vendor circle",
    summary:
      "Vendors, service providers, and members map what they need from the co-op marketplace before the next public push.",
    contentMarkdown: [
      "## The marketplace starts with listening",
      "Before a co-op marketplace can feel alive, the businesses inside it need to be heard. The first vendor circle is designed to collect practical needs from people selling food, services, art, care work, home goods, and professional support.",
      "The questions are direct: What brings you customers? What blocks you from taking more orders? What would make the co-op useful this month, not someday?",
      "## What vendors are asking for",
      "- Clear listings that make it easy to book or buy.",
      "- Better promotion before events and seasonal moments.",
      "- Shared back-office help for payments, photos, and descriptions.",
      "- A member audience that understands why buying local matters.",
      "The vendor circle gives Soulaan a way to build the marketplace with business owners instead of around them.",
    ].join("\n\n"),
    date: "Marketplace",
    byline: "Business Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "article",
    title: "A practical guide to buying Black and buying together",
    summary:
      "The co-op can make support more coordinated by helping members know what to buy, who to book, and when to show up.",
    contentMarkdown: [
      "## Support gets stronger when it is organized",
      '"Buy Black" can become more than a slogan when members have a shared directory, a calendar, and a reason to move together. Soulaan\'s newsletter can make that visible every week.',
      "Members should be able to open the public page and quickly see what businesses need attention, what events are coming up, and what offers are circulating through the community.",
      "## A weekly rhythm",
      "- One featured business to support.",
      "- One event to attend or share.",
      "- One classified listing that solves a real need.",
      "- One article explaining the bigger economic strategy.",
      "That rhythm helps people participate without needing to understand everything at once.",
    ].join("\n\n"),
    date: "Member Guide",
    byline: "Editorial Team",
    imageUrl:
      "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "event",
    title: "Member orientation and business mixer",
    summary:
      "Applicants, members, and business owners meet to learn how membership, proposals, classifieds, and the marketplace connect.",
    contentMarkdown: [
      "## Orientation plus connection",
      "This session is for people who want to understand the co-op before they apply and for business owners who want to know how the marketplace can work for them.",
      "The night includes a quick walkthrough of membership, a business intro round, and time for people to name what they want Soulaan to build next.",
    ].join("\n\n"),
    date: "Thursday, 6:30 PM",
    byline: "Events Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "article",
    title: "Youth money circle launches this month",
    summary:
      "A new member-led circle introduces young people to saving, ownership, business basics, and community accountability.",
    contentMarkdown: [
      "## Wealth education has to start early",
      "The youth money circle is built around a simple belief: young people should hear about ownership before they only hear about debt.",
      "Members will help create sessions on saving, cooperative economics, business planning, and the difference between looking rich and building real stability.",
      "The circle also gives younger members a way to see the co-op as something they can inherit, improve, and eventually lead.",
    ].join("\n\n"),
    date: "Youth Desk",
    byline: "Education Circle",
    imageUrl:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "business",
    title: "Business spotlight: member services that keep value local",
    summary:
      "From bookkeeping to meal prep to design help, the co-op can make it easier for members to find trusted local services.",
    contentMarkdown: [
      "## The service economy is already here",
      "Some of the most useful businesses in a co-op are not always storefronts. They are bookkeepers, barbers, designers, cleaners, tutors, drivers, cooks, consultants, and caregivers.",
      "The business spotlight is a recurring space for Soulaan to show members who they can hire before defaulting to a platform that extracts value from the community.",
    ].join("\n\n"),
    date: "Business Notes",
    byline: "Marketplace Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1556761175-4b46a572b786?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "event",
    title: "Pop-up market planning night",
    summary:
      "Members are invited to help shape the next pop-up market, from vendor mix to music, food, youth activities, and promotion.",
    contentMarkdown: [
      "## A market is also a message",
      "The next pop-up should feel like more than tables in a room. It should show what the Soulaan economy looks like when people come ready to buy, meet, organize, and celebrate.",
      "Planning night will cover vendor needs, promotion, volunteers, setup, and how to turn visitors into applicants.",
    ].join("\n\n"),
    date: "Planning Night",
    byline: "Events Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1533900298318-6b8da08a523e?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "announcement",
    title: "Classifieds call: services, rooms, equipment, and gigs",
    summary:
      "Soulaan is collecting listings for the classifieds section so members can find what they need inside the network first.",
    contentMarkdown: [
      "## The classifieds are open",
      "Members and trusted community contributors can submit services, rooms, equipment, gigs, tools, and offers for the next issue.",
      "The goal is to make the newsletter useful every week. Someone should be able to open it and find a person to hire, an event to attend, an item to borrow, or a business to support.",
    ].join("\n\n"),
    date: "Public Notice",
    byline: "Editorial Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1600&q=80",
  },
  {
    type: "article",
    title: "Kitchen table governance: how members choose priorities",
    summary:
      "A plain-language look at how Soulaan can make decisions without turning every choice into a confusing meeting.",
    contentMarkdown: [
      "## Governance should feel usable",
      "A co-op needs member voice, but it also needs a process people can actually use. Kitchen table governance means decisions are explained in plain language, priorities are visible, and members know when their input matters.",
      "The newsletter can help by publishing proposal windows, summaries, voting reminders, and post-decision updates. That turns governance into a rhythm instead of a mystery.",
      "## What members should expect",
      "- Clear proposals.",
      "- Real deadlines.",
      "- Transparent results.",
      "- Follow-up on what happened after the vote.",
    ].join("\n\n"),
    date: "Governance",
    byline: "Member Voice Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1600&q=80",
  },
];

export function withDevSampleCommunityPosts(coopId: string, posts: CommunityPost[]) {
  if (process.env.NODE_ENV === "production" || coopId !== "soulaan") {
    return posts;
  }

  const existingTitles = new Set(posts.map((post) => post.title.toLowerCase()));
  const missingSamples = soulaanSampleCommunityPosts.filter(
    (post) => !existingTitles.has(post.title.toLowerCase())
  );

  return [...posts, ...missingSamples];
}

export function getCommunityPostSlug(post: Pick<CommunityPost, "title">, index: number) {
  const slug = post.title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${index + 1}-${slug || "story"}`;
}

function renderInlineMarkdown(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

export function MarkdownishArticle({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div className="mt-5 space-y-3 text-[color:var(--newsletter-muted)]">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1" />;
        if (trimmed.startsWith("### ")) {
          return <h4 key={index} className="pt-2 text-xl font-black text-[color:var(--newsletter-ink)]">{trimmed.slice(4)}</h4>;
        }
        if (trimmed.startsWith("## ")) {
          return <h3 key={index} className="pt-3 text-2xl font-black text-[color:var(--newsletter-ink)]">{trimmed.slice(3)}</h3>;
        }
        if (trimmed.startsWith("# ")) {
          return <h2 key={index} className="pt-4 text-3xl font-black text-[color:var(--newsletter-ink)]">{trimmed.slice(2)}</h2>;
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return <li key={index} className="ml-6 text-base leading-7">{renderInlineMarkdown(trimmed.slice(2))}</li>;
        }
        if (trimmed.startsWith("> ")) {
          return (
            <blockquote key={index} className="border-l-4 border-[color:var(--coop-accent)] pl-4 text-base italic leading-7">
              {renderInlineMarkdown(trimmed.slice(2))}
            </blockquote>
          );
        }
        return <p key={index} className="text-base leading-7 md:text-lg">{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
}
