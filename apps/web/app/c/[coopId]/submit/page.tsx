"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  FileText,
  Image,
  Link as LinkIcon,
  Loader2,
  Mail,
  MapPin,
  Newspaper,
  Send,
  User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type SubmissionType = "article" | "event";

const initialForm = {
  contributorName: "",
  contributorEmail: "",
  title: "",
  summary: "",
  contentMarkdown: "",
  sourceUrl: "",
  date: "",
  location: "",
  byline: "",
  ctaUrl: "",
  imageUrl: "",
};

export default function PublicContributorSubmitPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const [type, setType] = useState<SubmissionType>("article");
  const [form, setForm] = useState(initialForm);
  const [submittedTitle, setSubmittedTitle] = useState("");

  const publicInfoQuery = api.publicCoopInfo.getByCoopIdWithUnpublished.useQuery(
    { coopId },
    { enabled: !!coopId }
  );
  const submitPublicNewsletterSubmission = api.publicCoopInfo.submitPublicNewsletterSubmission.useMutation({
    onSuccess: (result) => {
      setSubmittedTitle(result.submission.title);
      setForm(initialForm);
      setType("article");
    },
  });
  const linkPreviewQuery = api.publicCoopInfo.getLinkPreview.useQuery(
    { url: form.sourceUrl.trim() || "https://example.com" },
    { enabled: false, retry: false }
  );

  const publicInfo = publicInfoQuery.data;
  const coopName = publicInfo?.name || coopId;
  const primaryColor = publicInfo?.primaryColor || "#10b981";
  const accentColor = publicInfo?.accentColor || "#f59e0b";
  const canSubmit =
    form.contributorName.trim().length >= 2 &&
    form.contributorEmail.trim().includes("@") &&
    form.title.trim().length >= 3 &&
    (form.summary.trim().length >= 10 ||
      form.contentMarkdown.trim().length >= 10 ||
      form.sourceUrl.trim().length > 0);
  const selectedTone = useMemo(
    () =>
      type === "event"
        ? "border-sky-400/50 bg-sky-400/10 text-sky-100"
        : "border-emerald-400/50 bg-emerald-400/10 text-emerald-100",
    [type]
  );

  const updateField = (field: keyof typeof initialForm, value: string) => {
    setSubmittedTitle("");
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitPublicNewsletterSubmission.isPending) return;

    const summary =
      form.summary.trim() ||
      form.contentMarkdown
        .trim()
        .replace(/[#*_>`\[\]()]/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 700) ||
      `Source link: ${form.sourceUrl.trim()}`;

    await submitPublicNewsletterSubmission.mutateAsync({
      coopId,
      type,
      contributorName: form.contributorName.trim(),
      contributorEmail: form.contributorEmail.trim(),
      title: form.title.trim(),
      summary,
      contentMarkdown: form.contentMarkdown.trim() || undefined,
      date: form.date.trim() || undefined,
      location: type === "event" ? form.location.trim() || undefined : undefined,
      byline: form.byline.trim() || form.contributorName.trim(),
      ctaLabel: form.ctaUrl.trim() ? (type === "event" ? "Event details" : "Read more") : undefined,
      ctaUrl: form.ctaUrl.trim() || undefined,
      sourceUrl: form.sourceUrl.trim() || undefined,
      imageUrl: form.imageUrl.trim() || undefined,
    });
  };

  const fetchPreview = async () => {
    if (!form.sourceUrl.trim()) return;
    setSubmittedTitle("");
    const result = await linkPreviewQuery.refetch();
    const preview = result.data;
    if (!preview) return;
    setForm((current) => ({
      ...current,
      sourceUrl: preview.url,
      title: current.title.trim() ? current.title : preview.title,
      summary: current.summary.trim() ? current.summary : preview.description,
      contentMarkdown: current.contentMarkdown.trim() ? current.contentMarkdown : preview.description,
      imageUrl: current.imageUrl.trim() ? current.imageUrl : preview.imageUrl || "",
      ctaUrl: current.ctaUrl.trim() ? current.ctaUrl : preview.url,
    }));
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div
        className="border-b border-zinc-800"
        style={{
          background: `linear-gradient(135deg, ${primaryColor}22, #09090b 45%, ${accentColor}18)`,
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <Link
            href={`/c/${coopId}`}
            className="inline-flex w-fit items-center text-sm text-zinc-300 transition-colors hover:text-white"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to newsletter
          </Link>

          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-white/15 bg-white/10 text-white">Temporary public portal</Badge>
                <Badge variant="outline" className="border-white/20 text-zinc-200">
                  {coopName}
                </Badge>
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-normal text-white sm:text-5xl">
                Submit stories and events
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-300">
                Freelancers and community contributors can send articles, interviews, recaps, announcements,
                and event listings for this co-op newsletter.
              </p>
            </div>

            <Card className="border-zinc-800 bg-zinc-950/75 shadow-none">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Editor review</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Submissions stay private until the co-op publishes them.
                    </p>
                  </div>
                  <div className="rounded-md border border-zinc-700 bg-zinc-900 p-2 text-zinc-300">
                    <Newspaper className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {submittedTitle && (
          <div className="mb-5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" />
              <p>
                "{submittedTitle}" was sent to the {coopName} editor queue.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
          <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-zinc-100">Contributor</CardTitle>
              <CardDescription className="text-zinc-500">
                So the co-op can credit or follow up with you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sourceUrl" className="text-zinc-300">
                  Source link
                </Label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="sourceUrl"
                      value={form.sourceUrl}
                      onChange={(event) => updateField("sourceUrl", event.target.value)}
                      placeholder="Paste an article or event URL"
                      maxLength={500}
                      className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={fetchPreview}
                    disabled={!form.sourceUrl.trim() || linkPreviewQuery.isFetching}
                    className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
                  >
                    {linkPreviewQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pull Preview"}
                  </Button>
                </div>
                {linkPreviewQuery.isError && (
                  <p className="text-xs text-red-300">Could not pull that link. You can still submit manually.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="contributorName" className="text-zinc-300">
                  Name
                </Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    id="contributorName"
                    value={form.contributorName}
                    onChange={(event) => updateField("contributorName", event.target.value)}
                    placeholder="Contributor name"
                    maxLength={120}
                    className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contributorEmail" className="text-zinc-300">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    id="contributorEmail"
                    type="email"
                    value={form.contributorEmail}
                    onChange={(event) => updateField("contributorEmail", event.target.value)}
                    placeholder="you@example.com"
                    maxLength={200}
                    className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <Label className="text-zinc-300">Submission type</Label>
                {(["article", "event"] as SubmissionType[]).map((option) => {
                  const Icon = option === "event" ? CalendarDays : FileText;
                  const active = type === option;

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setSubmittedTitle("");
                        setType(option);
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
                        active
                          ? selectedTone
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                      )}
                    >
                      <div className="rounded-md border border-current/20 bg-zinc-950/60 p-2">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium capitalize">{option}</p>
                        <p className="mt-1 text-xs leading-5 text-current/70">
                          {option === "event" ? "Listings, meetups, launches" : "Stories, interviews, reports"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-zinc-100">
                {type === "event" ? "Event Details" : "Article Details"}
              </CardTitle>
              <CardDescription className="text-zinc-500">
                Send the strongest version you have. The co-op can edit before publishing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-zinc-300">
                  Headline
                </Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder={type === "event" ? "Community business mixer" : "A member business worth watching"}
                  maxLength={120}
                  className="border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="date" className="text-zinc-300">
                    Date or issue note
                  </Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="date"
                      value={form.date}
                      onChange={(event) => updateField("date", event.target.value)}
                      placeholder={type === "event" ? "July 19, 2026" : "For this week"}
                      maxLength={80}
                      className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="byline" className="text-zinc-300">
                    Public byline
                  </Label>
                  <Input
                    id="byline"
                    value={form.byline}
                    onChange={(event) => updateField("byline", event.target.value)}
                    placeholder="Leave blank to use your name"
                    maxLength={120}
                    className="border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600"
                  />
                </div>
              </div>

              {type === "event" && (
                <div className="space-y-2">
                  <Label htmlFor="location" className="text-zinc-300">
                    Location
                  </Label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="location"
                      value={form.location}
                      onChange={(event) => updateField("location", event.target.value)}
                      placeholder="Online, venue name, or city"
                      maxLength={160}
                      className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="summary" className="text-zinc-300">
                  Excerpt or short description
                </Label>
                <Textarea
                  id="summary"
                  value={form.summary}
                  onChange={(event) => updateField("summary", event.target.value)}
                  placeholder={
                    type === "event"
                      ? "What is happening, who it is for, when to show up, and why it matters..."
                      : "Tell the story, name the people/businesses, and include what the community should know..."
                  }
                  maxLength={2000}
                  className="min-h-[120px] border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600"
                />
                <p className="text-xs text-zinc-500">
                  {form.summary.trim().length > 0 ? `${form.summary.length}/2,000` : "Used as the newsletter excerpt."}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contentMarkdown" className="text-zinc-300">
                  Full article body
                </Label>
                <Textarea
                  id="contentMarkdown"
                  value={form.contentMarkdown}
                  onChange={(event) => updateField("contentMarkdown", event.target.value)}
                  placeholder="Write or paste the full article here. Markdown is fine: # headings, **bold**, links, and lists."
                  maxLength={20000}
                  className="min-h-[280px] border-zinc-800 bg-zinc-900 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
                />
                <p className="text-xs text-zinc-500">
                  {form.contentMarkdown.trim().length < 10
                    ? "Optional for link-only posts, required for a full article."
                    : `${form.contentMarkdown.length}/20,000`}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ctaUrl" className="text-zinc-300">
                    Button link
                  </Label>
                  <div className="relative">
                    <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="ctaUrl"
                      value={form.ctaUrl}
                      onChange={(event) => updateField("ctaUrl", event.target.value)}
                      placeholder="https://..."
                      maxLength={500}
                      className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="imageUrl" className="text-zinc-300">
                    Image URL
                  </Label>
                  <div className="relative">
                    <Image className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      id="imageUrl"
                      value={form.imageUrl}
                      onChange={(event) => updateField("imageUrl", event.target.value)}
                      placeholder="https://..."
                      maxLength={500}
                      className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
              </div>

              {submitPublicNewsletterSubmission.isError && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {submitPublicNewsletterSubmission.error?.message || "Failed to submit to the newsletter"}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={!canSubmit || submitPublicNewsletterSubmission.isPending}
                  className="text-zinc-950 hover:opacity-90"
                  style={{ backgroundColor: primaryColor }}
                  size="lg"
                >
                  {submitPublicNewsletterSubmission.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Sending
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-5 w-5" />
                      Submit to {coopName}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </main>
  );
}
