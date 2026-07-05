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
  MapPin,
  Newspaper,
  Send,
  Sparkles,
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

export default function NewsletterSubmitPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const [type, setType] = useState<SubmissionType>("article");
  const [form, setForm] = useState(initialForm);
  const [submittedTitle, setSubmittedTitle] = useState("");

  const { data: config } = api.coopConfig.getActive.useQuery({ coopId });
  const submitNewsletterSubmission = api.publicCoopInfo.submitNewsletterSubmission.useMutation({
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

  const coopName = config?.name || coopId;
  const canSubmit =
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
    if (!canSubmit || submitNewsletterSubmission.isPending) return;

    const summary =
      form.summary.trim() ||
      form.contentMarkdown
        .trim()
        .replace(/[#*_>`[\]()]/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 700) ||
      `Source link: ${form.sourceUrl.trim()}`;

    await submitNewsletterSubmission.mutateAsync({
      coopId,
      type,
      title: form.title.trim(),
      summary,
      contentMarkdown: form.contentMarkdown.trim() || undefined,
      date: form.date.trim() || undefined,
      location: type === "event" ? form.location.trim() || undefined : undefined,
      byline: form.byline.trim() || undefined,
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
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href={`/portal/${coopId}`}
        className="inline-flex items-center text-sm text-zinc-400 transition-colors hover:text-zinc-100"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to dashboard
      </Link>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-5 shadow-none">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-100">
              Contributor desk
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              {coopName}
            </Badge>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-zinc-50">
            Submit to the newsletter
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Send articles, interviews, recaps, announcements, and events for this co-op's community paper.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">Submission status</p>
              <p className="mt-1 text-xs text-zinc-500">
                {submittedTitle ? "Sent to the editor queue" : "Ready for a draft"}
              </p>
            </div>
            <div
              className={cn(
                "rounded-md border p-2",
                submittedTitle
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
              )}
            >
              {submittedTitle ? <CheckCircle2 className="h-4 w-4" /> : <Newspaper className="h-4 w-4" />}
            </div>
          </div>
          {submittedTitle && (
            <p className="mt-5 rounded-md border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">
              "{submittedTitle}" is in the newsletter queue.
            </p>
          )}
        </div>
      </section>

      <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <Sparkles className="h-5 w-5 text-amber-300" />
              Format
            </CardTitle>
            <CardDescription className="text-zinc-500">
              Choose what kind of piece this is.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
                      {option === "event" ? "Calendar items, meetups, launches" : "Stories, interviews, updates"}
                    </p>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardHeader>
            <CardTitle className="text-zinc-100">
              {type === "event" ? "Event Submission" : "Article Submission"}
            </CardTitle>
            <CardDescription className="text-zinc-500">
              This goes to the co-op newsletter editor queue.
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
              <Label htmlFor="title" className="text-zinc-300">
                Headline
              </Label>
              <Input
                id="title"
                value={form.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder={type === "event" ? "Community wealth night" : "How members are building together"}
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
                    placeholder={type === "event" ? "July 19, 2026" : "Weekly issue"}
                    maxLength={80}
                    className="border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="byline" className="text-zinc-300">
                  Byline
                </Label>
                <Input
                  id="byline"
                  value={form.byline}
                  onChange={(event) => updateField("byline", event.target.value)}
                  placeholder="Your name or publication credit"
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
                    placeholder="Online, Atlanta, GA, or the venue name"
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
                    ? "What is happening, who should show up, and why it matters to the co-op..."
                    : "Tell the story with the key people, business names, outcomes, and next step..."
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

            {submitNewsletterSubmission.isError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {submitNewsletterSubmission.error?.message || "Failed to submit to the newsletter"}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={!canSubmit || submitNewsletterSubmission.isPending}
                className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                size="lg"
              >
                {submitNewsletterSubmission.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Sending
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-5 w-5" />
                    Submit to Newsletter
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
