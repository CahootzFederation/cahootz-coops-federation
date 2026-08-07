"use client";

import { useParams } from "next/navigation";
import { useWeb3Auth } from "@/hooks/use-web3-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Eye, Save, Plus, Trash2, Sparkles, Mail, Newspaper as NewspaperIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "@/lib/trpc/client";
import Link from "next/link";

interface FAQ {
  question: string;
  answer: string;
}

interface ContactLink {
  label: string;
  url: string;
  type?: 'email' | 'phone' | 'social';
}

type CommunityPostType = "article" | "event" | "business" | "announcement";

interface CommunityPost {
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

interface PreviewOverrides {
  newspaperTitle?: string;
  newspaperIntro?: string;
  newsletterEmailEnabled?: boolean;
  newsletterEmailSubject?: string;
  newsletterEmailPreheader?: string;
  communityPosts?: CommunityPost[];
  [key: string]: unknown;
}

type RecruitmentTemplate = "wealth" | "ownership" | "business";

const recruitmentTemplates: Record<RecruitmentTemplate, { label: string; description: string }> = {
  wealth: {
    label: "Generational Wealth",
    description: "High-energy member pitch for commons building shared ownership and legacy.",
  },
  ownership: {
    label: "Local Ownership",
    description: "Community-first pitch focused on pooling demand and funding local priorities.",
  },
  business: {
    label: "Business Builder",
    description: "Recruit people who want to back, buy from, and grow commons businesses.",
  },
};

function normalizePreviewOverrides(value: unknown): PreviewOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PreviewOverrides)
    : {};
}

function normalizeCommunityPosts(value: unknown): CommunityPost[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((post): post is CommunityPost => {
      return (
        typeof post === "object" &&
        post !== null &&
        "title" in post &&
        "summary" in post &&
        typeof post.title === "string" &&
        typeof post.summary === "string"
      );
    })
    .map((post) => ({
      type: ["article", "event", "business", "announcement"].includes(post.type) ? post.type : "article",
      title: post.title,
      summary: post.summary,
      contentMarkdown: post.contentMarkdown || "",
      date: post.date || "",
      byline: post.byline || "",
      ctaLabel: post.ctaLabel || "",
      ctaUrl: post.ctaUrl || "",
      sourceUrl: post.sourceUrl || "",
      imageUrl: post.imageUrl || "",
    }));
}

export default function PublicPageSettingsPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const { isAdmin } = useWeb3Auth();

  const [saved, setSaved] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#f59e0b");
  const [accentColor, setAccentColor] = useState("#ea580c");
  const [backgroundColor, setBackgroundColor] = useState("#1a1a1a");
  const [aboutTitle, setAboutTitle] = useState("Why Join");
  const [aboutBody, setAboutBody] = useState("");
  const [eligibilityTitle, setEligibilityTitle] = useState("Who Should Apply");
  const [eligibilityBody, setEligibilityBody] = useState("");
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [contactEmail, setContactEmail] = useState("");
  const [contactLinks, setContactLinks] = useState<ContactLink[]>([]);
  const [newsletterUrl, setNewsletterUrl] = useState("");
  const [primaryCtaLabel, setPrimaryCtaLabel] = useState("Apply to Join");
  const [primaryCtaUrl, setPrimaryCtaUrl] = useState("");
  const [mobileAppUrl, setMobileAppUrl] = useState("https://mobile.cahootzcoops.com");
  const [previewMode, setPreviewMode] = useState<'live' | 'curated' | 'hybrid'>('hybrid');
  const [isPublished, setIsPublished] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [previewOverrides, setPreviewOverrides] = useState<PreviewOverrides>({});
  const [newspaperTitle, setNewspaperTitle] = useState("");
  const [newspaperIntro, setNewspaperIntro] = useState("");
  const [newsletterEmailEnabled, setNewsletterEmailEnabled] = useState(false);
  const [newsletterEmailSubject, setNewsletterEmailSubject] = useState("");
  const [newsletterEmailPreheader, setNewsletterEmailPreheader] = useState("");
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);

  // Load existing public info
  const { data: publicInfo, isLoading, refetch } = api.publicCoopInfo.getForEdit.useQuery(
    { coopId },
    { enabled: isAdmin }
  );

  // Bootstrap mutation
  const bootstrap = api.publicCoopInfo.bootstrapFromConfig.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  // Create blank mutation
  const createBlank = api.publicCoopInfo.createBlank.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  // Update mutation
  const updatePublicInfo = api.publicCoopInfo.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      refetch();
    },
  });

  // Load data into form when available
  useEffect(() => {
    if (publicInfo) {
      const editablePublicInfo = publicInfo as any;
      setName(publicInfo.name || "");
      setTagline(publicInfo.tagline || "");
      setHeroTitle(publicInfo.heroTitle || "");
      setHeroSubtitle(publicInfo.heroSubtitle || "");
      setHeroImageUrl(publicInfo.heroImageUrl || "");
      setLogoUrl(publicInfo.logoUrl || "");
      setCoverImageUrl(publicInfo.coverImageUrl || "");
      setPrimaryColor(publicInfo.primaryColor);
      setAccentColor(publicInfo.accentColor);
      setBackgroundColor(publicInfo.backgroundColor);
      setAboutTitle(publicInfo.aboutTitle || "Why Join");
      setAboutBody(publicInfo.aboutBody || "");
      setEligibilityTitle(publicInfo.eligibilityTitle || "Who Should Apply");
      setEligibilityBody(publicInfo.eligibilityBody || "");
      setFaqs(editablePublicInfo.faqs || []);
      setContactEmail(publicInfo.contactEmail || "");
      setContactLinks(editablePublicInfo.contactLinks || []);
      setNewsletterUrl(publicInfo.newsletterUrl || "");
      setPrimaryCtaLabel(publicInfo.primaryCtaLabel || "Apply to Join");
      setPrimaryCtaUrl(publicInfo.primaryCtaUrl || "");
      setMobileAppUrl(publicInfo.mobileAppUrl || "https://mobile.cahootzcoops.com");
      setPreviewMode(publicInfo.previewMode as 'live' | 'curated' | 'hybrid');
      setIsPublished(publicInfo.isPublished);
      setSeoTitle(publicInfo.seoTitle || "");
      setSeoDescription(publicInfo.seoDescription || "");
      const overrides = normalizePreviewOverrides(editablePublicInfo.previewOverrides);
      setPreviewOverrides(overrides);
      setNewspaperTitle(overrides.newspaperTitle || "");
      setNewspaperIntro(overrides.newspaperIntro || "");
      setNewsletterEmailEnabled(overrides.newsletterEmailEnabled === true);
      setNewsletterEmailSubject(
        typeof overrides.newsletterEmailSubject === "string" ? overrides.newsletterEmailSubject : ""
      );
      setNewsletterEmailPreheader(
        typeof overrides.newsletterEmailPreheader === "string" ? overrides.newsletterEmailPreheader : ""
      );
      setCommunityPosts(normalizeCommunityPosts(overrides.communityPosts));
    }
  }, [publicInfo]);

  const handleSave = () => {
    const nextPreviewOverrides: PreviewOverrides = { ...previewOverrides };
    const cleanedCommunityPosts = communityPosts
      .map((post) => ({
        type: post.type,
        title: post.title.trim(),
        summary: post.summary.trim(),
        contentMarkdown: post.contentMarkdown?.trim() || "",
        date: post.date?.trim() || "",
        byline: post.byline?.trim() || "",
        ctaLabel: post.ctaLabel?.trim() || "",
        ctaUrl: post.ctaUrl?.trim() || "",
        sourceUrl: post.sourceUrl?.trim() || "",
        imageUrl: post.imageUrl?.trim() || "",
      }))
      .filter((post) => post.title.length > 0 && post.summary.length > 0);

    if (newspaperTitle.trim()) {
      nextPreviewOverrides.newspaperTitle = newspaperTitle.trim();
    } else {
      delete nextPreviewOverrides.newspaperTitle;
    }

    if (newspaperIntro.trim()) {
      nextPreviewOverrides.newspaperIntro = newspaperIntro.trim();
    } else {
      delete nextPreviewOverrides.newspaperIntro;
    }

    nextPreviewOverrides.communityPosts = cleanedCommunityPosts;
    nextPreviewOverrides.newsletterEmailEnabled = newsletterEmailEnabled;

    if (newsletterEmailSubject.trim()) {
      nextPreviewOverrides.newsletterEmailSubject = newsletterEmailSubject.trim();
    } else {
      delete nextPreviewOverrides.newsletterEmailSubject;
    }

    if (newsletterEmailPreheader.trim()) {
      nextPreviewOverrides.newsletterEmailPreheader = newsletterEmailPreheader.trim();
    } else {
      delete nextPreviewOverrides.newsletterEmailPreheader;
    }

    updatePublicInfo.mutate({
      coopId,
      data: {
        name,
        tagline,
        heroTitle,
        heroSubtitle,
        heroImageUrl: heroImageUrl || null,
        logoUrl: logoUrl || null,
        coverImageUrl: coverImageUrl || null,
        primaryColor,
        accentColor,
        backgroundColor,
        aboutTitle,
        aboutBody: aboutBody || undefined,
        eligibilityTitle,
        eligibilityBody: eligibilityBody || undefined,
        faqs: faqs.length > 0 ? faqs : undefined,
        contactEmail: contactEmail || null,
        contactLinks: contactLinks.length > 0 ? contactLinks : undefined,
        newsletterUrl: newsletterUrl || null,
        primaryCtaLabel,
        primaryCtaUrl: primaryCtaUrl || null,
        mobileAppUrl: mobileAppUrl || null,
        previewMode,
        isPublished,
        seoTitle: seoTitle || undefined,
        seoDescription: seoDescription || undefined,
        previewOverrides: nextPreviewOverrides,
      },
    });
  };

  const addFaq = () => {
    setFaqs([...faqs, { question: "", answer: "" }]);
  };

  const removeFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  const updateFaq = (index: number, field: keyof FAQ, value: string) => {
    const updated = [...faqs];
    const faq = updated[index];
    if (!faq) return;
    updated[index] = { ...faq, [field]: value };
    setFaqs(updated);
  };

  const addContactLink = () => {
    setContactLinks([...contactLinks, { label: "", url: "" }]);
  };

  const removeContactLink = (index: number) => {
    setContactLinks(contactLinks.filter((_, i) => i !== index));
  };

  const updateContactLink = (index: number, field: keyof ContactLink, value: string) => {
    const updated = [...contactLinks];
    const link = updated[index];
    if (!link) return;
    updated[index] = { ...link, [field]: value };
    setContactLinks(updated);
  };

  const addCommunityPost = (type: CommunityPostType = "article") => {
    setCommunityPosts([
      ...communityPosts,
      {
        type,
        title: "",
        summary: "",
        contentMarkdown: "",
        date: "",
        byline: "",
        ctaLabel: "",
        ctaUrl: "",
        sourceUrl: "",
        imageUrl: "",
      },
    ]);
  };

  const removeCommunityPost = (index: number) => {
    setCommunityPosts(communityPosts.filter((_, i) => i !== index));
  };

  const updateCommunityPost = (index: number, field: keyof CommunityPost, value: string) => {
    const updated = [...communityPosts];
    const post = updated[index];
    if (!post) return;
    updated[index] = {
      ...post,
      [field]: field === "type" ? (value as CommunityPostType) : value,
    };
    setCommunityPosts(updated);
  };

  const applyRecruitmentTemplate = (template: RecruitmentTemplate) => {
    const coopName = name || "your commons";

    setPrimaryCtaLabel("Apply to Join");
    setPrimaryCtaUrl(`/${coopId}/application`);
    setNewspaperTitle(`${coopName} Newsletter`);
    setNewsletterEmailSubject(`${coopName} Weekly Newsletter`);

    if (template === "wealth") {
      setTagline("Build generational wealth together");
      setHeroTitle(`Apply to ${coopName}`);
      setHeroSubtitle(
        `This is for people who want more than inspiration. ${coopName} is building a member-owned economy where our spending, businesses, votes, and collective power can become real generational wealth.`
      );
      setAboutTitle("Why Join");
      setAboutBody(
        `Join ${coopName} if you are ready to help build something our people can own. Members back commons businesses, help decide what gets funded, and grow a shared economic engine designed for stability, opportunity, and legacy.`
      );
      setMissionBody(
        [
          "Grow a member-owned marketplace where everyday spending strengthens the commons.",
          "Build a community wealth fund that can support businesses, services, projects, and long-term assets.",
          "Give members a voice in how resources move, who gets backed, and what future the commons is building.",
        ].join("\n")
      );
      setEligibilityTitle("Who Should Apply");
      setEligibilityBody(
        "Apply if you want ownership, accountability, and a seat at the table while this commons builds economic power for members and the next generation."
      );
      setFaqs([
        {
          question: "What happens after I apply?",
          answer:
            "Your application goes to the commons for review. If approved, you can participate as a member and help shape what gets built next.",
        },
        {
          question: "Do I need commons experience?",
          answer:
            "No. You need alignment, seriousness, and a willingness to participate in a member-owned economy.",
        },
      ]);
      setNewspaperIntro(
        "Stories, events, classifieds, business notes, and public notices from the commons."
      );
      setNewsletterEmailPreheader(
        `This week's stories, events, and business notes from ${coopName}.`
      );
      setCommunityPosts([
        {
          type: "article",
          title: `Why ${coopName} is organizing now`,
          summary:
            "A front-page note on what the commons is building, who it is for, and why members are being invited to apply.",
          date: "From the commons desk",
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
            "Use this space to feature a business, creator, service, or project moving the commons economy forward.",
        },
      ]);
      setSeoTitle(`${coopName} membership application`);
      setSeoDescription(`Apply to ${coopName} and help build a member-owned economy for generational wealth.`);
      return;
    }

    if (template === "ownership") {
      setTagline("Own more of what your community already makes possible");
      setHeroTitle(`Join ${coopName}`);
      setHeroSubtitle(
        `${coopName} brings members together to pool demand, support local businesses, fund shared priorities, and make decisions as owners.`
      );
      setAboutTitle("A Commons Built for Members");
      setAboutBody(
        `Membership in ${coopName} is a way to turn community participation into shared leverage. Apply to help grow an economy where members can support each other, vote on priorities, and build useful local infrastructure.`
      );
      setMissionBody(
        [
          "Organize member demand so more value stays connected to the community.",
          "Fund projects and services members actually want.",
          "Create a practical governance path for people who want more say in their local economy.",
        ].join("\n")
      );
      setEligibilityTitle("Who Should Apply");
      setEligibilityBody(
        "Apply if you want to participate, vote, support member businesses, and help turn shared priorities into funded action."
      );
      setFaqs([]);
      setNewspaperIntro("Stories, events, classifieds, and business notes from members building local ownership.");
      setNewsletterEmailPreheader(
        `A weekly update on what ${coopName} members are building, funding, and sharing.`
      );
      setCommunityPosts([
        {
          type: "article",
          title: `What ${coopName} is building this month`,
          summary:
            "A public update on member priorities, funded ideas, and the work happening inside the commons.",
          date: "Latest issue",
        },
        {
          type: "announcement",
          title: "Proposal window open",
          summary:
            "Members and applicants can follow what the commons is considering next.",
        },
      ]);
      return;
    }

    setTagline("Help grow the businesses your commons believes in");
    setHeroTitle(`Build with ${coopName}`);
    setHeroSubtitle(
      `${coopName} is recruiting members who want to buy from, promote, fund, and grow a stronger commons marketplace.`
    );
    setAboutTitle("Turn Support into Ownership");
    setAboutBody(
      `Apply to ${coopName} if you want your support for local businesses to become part of a bigger ownership strategy. Members help bring customers, proposals, rewards, and governance into one commons economy.`
    );
    setMissionBody(
      [
        "Help member businesses find customers and community support.",
        "Use commons activity to fund tools, services, and new ventures.",
        "Create a marketplace where members can see their participation compound.",
      ].join("\n")
    );
    setEligibilityTitle("Who Should Apply");
    setEligibilityBody(
      "Apply if you are ready to support member businesses, invite serious builders, and help the commons marketplace grow."
    );
    setFaqs([]);
    setNewspaperIntro("Stories, classifieds, and business updates from the commons marketplace.");
    setNewsletterEmailPreheader(
      `Business updates, classifieds, and marketplace stories from ${coopName}.`
    );
    setCommunityPosts([
      {
        type: "business",
        title: "Business directory is open",
        summary:
          "Feature the businesses, creators, and services that members can support right now.",
      },
      {
        type: "article",
        title: "How member spending grows the marketplace",
        summary:
          "Explain how buying from commons businesses helps create more leverage for members and operators.",
      },
      {
        type: "event",
        title: "Vendor and member mixer",
        summary:
          "Invite business owners, applicants, and members to connect around what the commons needs next.",
        date: "Upcoming",
      },
    ]);
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You must be an admin to manage newsletter settings.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!publicInfo) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Public Page Not Set Up</h1>
          <p className="text-gray-500 mt-1">
            Create your commons&apos; public page newsletter to get started
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Bootstrap from Commons Configuration</CardTitle>
              <CardDescription>
                Copy existing settings from your commons configuration to pre-fill the newsletter with your commons&apos; name, tagline, mission, and branding.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => bootstrap.mutate({ coopId })}
                disabled={bootstrap.isPending || createBlank.isPending}
                className="w-full"
              >
                {bootstrap.isPending ? "Bootstrapping..." : "Bootstrap from Commons Configuration"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create Blank Newsletter</CardTitle>
              <CardDescription>
                Start with a blank newsletter template with default branding. You can customize everything in the editor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => createBlank.mutate({ coopId })}
                disabled={bootstrap.isPending || createBlank.isPending}
                variant="outline"
                className="w-full"
              >
                {createBlank.isPending ? "Creating..." : "Create Blank Newsletter"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <p className="text-sm text-blue-900">
              <strong>Note:</strong> Your public page will start unpublished. You can edit and preview it before making it live.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Public Page Settings</h1>
          <p className="text-gray-500 mt-1">
            Manage your commons&apos; public newsletter and application pitch
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/c/${coopId}`}
            target="_blank"
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Eye size={18} />
            Preview
          </Link>
          <Link
            href={`/c/${coopId}/newsletter-email`}
            target="_blank"
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Mail size={18} />
            Email Preview
          </Link>
          <Button
            onClick={handleSave}
            disabled={updatePublicInfo.isPending}
            className="inline-flex items-center gap-2"
          >
            <Save size={18} />
            {saved ? "Saved!" : updatePublicInfo.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Publishing Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe size={20} />
            Publishing Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="w-5 h-5"
              />
              <span className="font-semibold">Published</span>
            </label>
            {isPublished ? (
              <span className="text-green-600 text-sm">✓ Public page is live</span>
            ) : (
              <span className="text-yellow-600 text-sm">⚠ Public page is hidden</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recruitment Starters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={20} />
            Recruitment Starters
          </CardTitle>
          <CardDescription>
            Fill the page with pitch copy, newsletter posts, benefits, FAQs, and CTA text.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.keys(recruitmentTemplates) as RecruitmentTemplate[]).map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => applyRecruitmentTemplate(template)}
                className="rounded-lg border p-4 text-left transition hover:border-orange-300 hover:bg-orange-50"
              >
                <span className="font-semibold">{recruitmentTemplates[template].label}</span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  {recruitmentTemplates[template].description}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Starters replace the editable pitch and newsletter fields. Review, tweak, then save changes.
          </p>
        </CardContent>
      </Card>

      {/* Newsletter */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail size={20} />
            Newsletter
          </CardTitle>
          <CardDescription>
            Publish commons stories, event notices, announcements, classifieds, and business notes on the newsletter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Newsletter Title</Label>
            <Input
              value={newspaperTitle}
              onChange={(e) => setNewspaperTitle(e.target.value)}
              placeholder={`${name || coopId} Newsletter`}
            />
          </div>
          <div>
            <Label>Newsletter Intro</Label>
            <Textarea
              value={newspaperIntro}
              onChange={(e) => setNewspaperIntro(e.target.value)}
              placeholder="Stories, events, business updates, classifieds, and notices from the commons."
              rows={3}
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Weekly Email</Label>
                <p className="text-sm text-muted-foreground">
                  Turn on when this newsletter is ready to use as a weekly email issue.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={newsletterEmailEnabled}
                  onChange={(e) => setNewsletterEmailEnabled(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-gray-200 peer-checked:bg-orange-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white rtl:peer-checked:after:-translate-x-full"></div>
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <Label>Email Subject</Label>
                <Input
                  value={newsletterEmailSubject}
                  onChange={(e) => setNewsletterEmailSubject(e.target.value)}
                  placeholder={`${name || coopId} Weekly Newsletter`}
                />
              </div>
              <div>
                <Label>Email Preview Text</Label>
                <Input
                  value={newsletterEmailPreheader}
                  onChange={(e) => setNewsletterEmailPreheader(e.target.value)}
                  placeholder="Stories, events, classifieds, and business updates inside."
                />
              </div>
            </div>

            <div className="mt-4">
              <Button type="button" variant="outline" asChild>
                <Link href={`/c/${coopId}/newsletter-email`} target="_blank">
                  <Eye size={16} className="mr-2" />
                  Preview Email Format
                </Link>
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <Label>Editorial Queue</Label>
                <p className="text-sm text-muted-foreground">
                  Admins can review submitted articles and events from here before publishing them.
                </p>
              </div>
              <Button type="button" variant="outline" asChild>
                <Link href={`/portal/${coopId}/newsletter/submissions`}>
                  <NewspaperIcon className="mr-2 h-4 w-4" />
                  Open Editorial Queue
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Button type="button" variant="outline" onClick={() => addCommunityPost("article")}>
              <Plus size={16} />
              Story
            </Button>
            <Button type="button" variant="outline" onClick={() => addCommunityPost("event")}>
              <Plus size={16} />
              Event
            </Button>
            <Button type="button" variant="outline" onClick={() => addCommunityPost("business")}>
              <Plus size={16} />
              Business
            </Button>
            <Button type="button" variant="outline" onClick={() => addCommunityPost("announcement")}>
              <Plus size={16} />
              Notice
            </Button>
          </div>

          {communityPosts.map((post, index) => (
            <div key={index} className="rounded-lg border p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-500">Post {index + 1}</p>
                  <p className="text-xs text-muted-foreground">
                    The first post becomes the front-page lead story.
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeCommunityPost(index)}>
                  <Trash2 size={16} />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-[0.45fr_1fr]">
                <div>
                  <Label>Type</Label>
                  <select
                    value={post.type}
                    onChange={(e) => updateCommunityPost(index, "type", e.target.value)}
                    className="w-full rounded-lg border p-2"
                  >
                    <option value="article">Story</option>
                    <option value="event">Event</option>
                    <option value="business">Business Note</option>
                    <option value="announcement">Notice</option>
                  </select>
                </div>
                <div>
                  <Label>Title</Label>
                  <Input
                    value={post.title}
                    onChange={(e) => updateCommunityPost(index, "title", e.target.value)}
                    placeholder="Commons launches youth business night"
                  />
                </div>
              </div>

              <div className="mt-3">
                <Label>Summary</Label>
                <Textarea
                  value={post.summary}
                  onChange={(e) => updateCommunityPost(index, "summary", e.target.value)}
                  placeholder="Write the short public blurb people should read on the front page."
                  rows={3}
                />
              </div>

              <div className="mt-3">
                <Label>Full Article Markdown</Label>
                <Textarea
                  value={post.contentMarkdown || ""}
                  onChange={(e) => updateCommunityPost(index, "contentMarkdown", e.target.value)}
                  placeholder="Write the full story here. Use markdown headings, bullets, and quotes for the article page."
                  rows={8}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Used on the larger article page. If empty, the article page uses the summary.
                </p>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Date / Issue Text</Label>
                  <Input
                    value={post.date || ""}
                    onChange={(e) => updateCommunityPost(index, "date", e.target.value)}
                    placeholder="May 18, 2026 or This Saturday"
                  />
                </div>
                <div>
                  <Label>Byline / Source</Label>
                  <Input
                    value={post.byline || ""}
                    onChange={(e) => updateCommunityPost(index, "byline", e.target.value)}
                    placeholder="By the membership committee"
                  />
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <div>
                  <Label>Link Label</Label>
                  <Input
                    value={post.ctaLabel || ""}
                    onChange={(e) => updateCommunityPost(index, "ctaLabel", e.target.value)}
                    placeholder="Read more"
                  />
                </div>
                <div>
                  <Label>Link URL</Label>
                  <Input
                    value={post.ctaUrl || ""}
                    onChange={(e) => updateCommunityPost(index, "ctaUrl", e.target.value)}
                    placeholder="https://example.com/story"
                  />
                </div>
                <div>
                  <Label>Source URL</Label>
                  <Input
                    value={post.sourceUrl || ""}
                    onChange={(e) => updateCommunityPost(index, "sourceUrl", e.target.value)}
                    placeholder="https://source-site.com/article"
                  />
                </div>
                <div>
                  <Label>Image URL</Label>
                  <Input
                    value={post.imageUrl || ""}
                    onChange={(e) => updateCommunityPost(index, "imageUrl", e.target.value)}
                    placeholder="https://example.com/photo.jpg"
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Hero Section */}
      <Card>
        <CardHeader>
          <CardTitle>Hero Section</CardTitle>
          <CardDescription>Main application pitch and call-to-action</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Commons Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cahootz Commons"
            />
          </div>
          <div>
            <Label>Tagline</Label>
            <Input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Build generational wealth together"
            />
          </div>
          <div>
            <Label>Hero Title (optional override)</Label>
            <Input
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="Leave empty to use name"
            />
          </div>
          <div>
            <Label>Hero Subtitle</Label>
            <Textarea
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="Pitch people on why they should apply"
              rows={3}
            />
          </div>
          <div>
            <Label>Logo URL</Label>
            <Input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </div>
          <div>
            <Label>Hero Image URL</Label>
            <Input
              value={heroImageUrl}
              onChange={(e) => setHeroImageUrl(e.target.value)}
              placeholder="https://example.com/hero.jpg"
            />
          </div>
          <div>
            <Label>Cover Image URL (background)</Label>
            <Input
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://example.com/cover.jpg"
            />
          </div>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle>Branding & Colors</CardTitle>
          <CardDescription>Customize your page colors</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Primary Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#f59e0b"
                />
              </div>
            </div>
            <div>
              <Label>Accent Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  placeholder="#ea580c"
                />
              </div>
            </div>
            <div>
              <Label>Background Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  placeholder="#1a1a1a"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* About Section */}
      <Card>
        <CardHeader>
          <CardTitle>Recruitment Pitch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Section Title</Label>
            <Input
              value={aboutTitle}
              onChange={(e) => setAboutTitle(e.target.value)}
              placeholder="Why Join"
            />
          </div>
          <div>
            <Label>About Body</Label>
            <Textarea
              value={aboutBody}
              onChange={(e) => setAboutBody(e.target.value)}
              placeholder="Tell future members why this commons matters..."
              rows={6}
            />
          </div>
        </CardContent>
      </Card>

      {/* Eligibility Section */}
      <Card>
        <CardHeader>
          <CardTitle>Eligibility Section</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Section Title</Label>
            <Input
              value={eligibilityTitle}
              onChange={(e) => setEligibilityTitle(e.target.value)}
              placeholder="Who Should Apply"
            />
          </div>
          <div>
            <Label>Eligibility Requirements</Label>
            <Textarea
              value={eligibilityBody}
              onChange={(e) => setEligibilityBody(e.target.value)}
              placeholder="Describe the people this commons wants to recruit..."
              rows={6}
            />
          </div>
        </CardContent>
      </Card>

      {/* Member Benefits */}
      <Card>
        <CardHeader>
          <CardTitle>Member Benefits</CardTitle>
          <CardDescription>
            These are controlled by the commons config so every application and newsletter uses the same benefits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" asChild>
            <Link href={`/portal/${coopId}/proposals/config`}>
              Edit Member Benefits in Commons Config
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* FAQs */}
      <Card>
        <CardHeader>
          <CardTitle>FAQs</CardTitle>
          <CardDescription>Answer common questions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="p-4 border rounded-lg space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-sm font-semibold text-gray-500">FAQ {index + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFaq(index)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              <Input
                value={faq.question}
                onChange={(e) => updateFaq(index, 'question', e.target.value)}
                placeholder="Question"
              />
              <Textarea
                value={faq.answer}
                onChange={(e) => updateFaq(index, 'answer', e.target.value)}
                placeholder="Answer"
                rows={3}
              />
            </div>
          ))}
          <Button onClick={addFaq} variant="outline" className="w-full">
            <Plus size={16} className="mr-2" />
            Add FAQ
          </Button>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Contact Email</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="hello@example.com"
            />
          </div>
          <div>
            <Label>Newsletter URL</Label>
            <Input
              value={newsletterUrl}
              onChange={(e) => setNewsletterUrl(e.target.value)}
              placeholder="https://example.com/newsletter"
            />
          </div>
          <div>
            <Label>Contact Links</Label>
            {contactLinks.map((link, index) => (
              <div key={index} className="flex gap-2 mt-2">
                <Input
                  value={link.label}
                  onChange={(e) => updateContactLink(index, 'label', e.target.value)}
                  placeholder="Label"
                  className="flex-1"
                />
                <Input
                  value={link.url}
                  onChange={(e) => updateContactLink(index, 'url', e.target.value)}
                  placeholder="URL"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeContactLink(index)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            <Button onClick={addContactLink} variant="outline" className="w-full mt-2">
              <Plus size={16} className="mr-2" />
              Add Link
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Call-to-Action */}
      <Card>
        <CardHeader>
          <CardTitle>Application Call-to-Action</CardTitle>
          <CardDescription>Configure your primary application button</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>CTA Button Label</Label>
            <Input
              value={primaryCtaLabel}
              onChange={(e) => setPrimaryCtaLabel(e.target.value)}
              placeholder="Apply to Join"
            />
          </div>
          <div>
            <Label>Mobile App URL</Label>
            <Input
              value={mobileAppUrl}
              onChange={(e) => setMobileAppUrl(e.target.value)}
              placeholder="https://mobile.cahootzcoops.com"
            />
          </div>
          <div>
            <Label>Custom Application URL (optional)</Label>
            <Input
              value={primaryCtaUrl}
              onChange={(e) => setPrimaryCtaUrl(e.target.value)}
              placeholder={`Leave empty to use /${coopId}/application`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Preview Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Preview Section</CardTitle>
          <CardDescription>Show stores, proposals, and activity</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Preview Mode</Label>
            <select
              value={previewMode}
              onChange={(e) => setPreviewMode(e.target.value as 'live' | 'curated' | 'hybrid')}
              className="w-full p-2 border rounded-lg"
            >
              <option value="live">Live - Show real data only</option>
              <option value="curated">Curated - Show custom content only</option>
              <option value="hybrid">Hybrid - Live data with curated overrides</option>
            </select>
          </div>
          <p className="text-sm text-gray-500">
            Live mode shows recent stores and proposals automatically. Curated mode requires manual content. Hybrid uses live data but allows you to override specific items.
          </p>
        </CardContent>
      </Card>

      {/* SEO */}
      <Card>
        <CardHeader>
          <CardTitle>SEO Settings</CardTitle>
          <CardDescription>Optimize for search engines</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>SEO Title</Label>
            <Input
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder="Leave empty to use commons name"
            />
          </div>
          <div>
            <Label>SEO Description</Label>
            <Textarea
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              placeholder="Leave empty to use tagline"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button at Bottom */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updatePublicInfo.isPending}
          size="lg"
          className="inline-flex items-center gap-2"
        >
          <Save size={18} />
          {saved ? "Saved!" : updatePublicInfo.isPending ? "Saving..." : "Save All Changes"}
        </Button>
      </div>
    </div>
  );
}
