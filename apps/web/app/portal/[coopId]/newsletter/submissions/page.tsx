"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Newspaper,
  Send,
  Trash2,
  User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useWeb3Auth } from "@/hooks/use-web3-auth";

type CommunityPostType = "article" | "event" | "business" | "announcement";
type NewsletterSubmissionType = "article" | "event";

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

interface NewsletterSubmission {
  id: string;
  type: NewsletterSubmissionType;
  title: string;
  summary: string;
  contentMarkdown?: string;
  date?: string;
  location?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  sourceUrl?: string;
  imageUrl?: string;
  submittedByName?: string;
  submittedByEmail?: string;
  submittedByWallet?: string;
  submittedAt?: string;
  status?: "pending" | "published" | "dismissed";
}

interface PreviewOverrides {
  communityPosts?: unknown;
  newsletterSubmissions?: unknown;
  [key: string]: unknown;
}

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
}

function normalizeNewsletterSubmissions(value: unknown): NewsletterSubmission[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((submission): submission is NewsletterSubmission => {
      return (
        typeof submission === "object" &&
        submission !== null &&
        "id" in submission &&
        "type" in submission &&
        "title" in submission &&
        "summary" in submission &&
        typeof submission.id === "string" &&
        (submission.type === "article" || submission.type === "event") &&
        typeof submission.title === "string" &&
        typeof submission.summary === "string"
      );
    })
    .filter((submission) => !submission.status || submission.status === "pending")
    .map((submission) => ({
      ...submission,
      title: submission.title.trim(),
      summary: submission.summary.trim(),
      contentMarkdown: submission.contentMarkdown?.trim() || "",
      date: submission.date?.trim() || "",
      location: submission.location?.trim() || "",
      byline: submission.byline?.trim() || "",
      ctaLabel: submission.ctaLabel?.trim() || "",
      ctaUrl: submission.ctaUrl?.trim() || "",
      sourceUrl: submission.sourceUrl?.trim() || "",
      imageUrl: submission.imageUrl?.trim() || "",
      status: "pending",
    }));
}

function submissionToPost(submission: NewsletterSubmission): CommunityPost {
  const summaryParts = [
    submission.summary,
    submission.type === "event" && submission.location ? `Location: ${submission.location}` : "",
  ].filter(Boolean);

  return {
    type: submission.type === "event" ? "event" : "article",
    title: submission.title,
    summary: summaryParts.join("\n"),
    contentMarkdown: submission.contentMarkdown || "",
    date: submission.date || "",
    byline: submission.byline || submission.submittedByName || "",
    ctaLabel: submission.ctaLabel || (submission.sourceUrl ? "Read source" : ""),
    ctaUrl: submission.ctaUrl || submission.sourceUrl || "",
    sourceUrl: submission.sourceUrl || "",
    imageUrl: submission.imageUrl || "",
  };
}

export default function NewsletterSubmissionsPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const { isAdmin } = useWeb3Auth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savedMessage, setSavedMessage] = useState("");

  const { data: publicInfo, isLoading, refetch } = api.publicCoopInfo.getForEdit.useQuery(
    { coopId },
    { enabled: isAdmin }
  );
  const updatePublicInfo = api.publicCoopInfo.update.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const editablePublicInfo = publicInfo as any;
  const previewOverrides = normalizePreviewOverrides(editablePublicInfo?.previewOverrides);
  const submissions = useMemo(
    () => normalizeNewsletterSubmissions(previewOverrides.newsletterSubmissions),
    [previewOverrides.newsletterSubmissions]
  );
  const communityPosts = useMemo(
    () => normalizeCommunityPosts(previewOverrides.communityPosts),
    [previewOverrides.communityPosts]
  );
  const selectedSubmissions = submissions.filter((submission) => selectedIds.has(submission.id));
  const allSelected = submissions.length > 0 && selectedIds.size === submissions.length;

  useEffect(() => {
    setSelectedIds((current) => {
      const validIds = new Set(submissions.map((submission) => submission.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [submissions]);

  const toggleSubmission = (submissionId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(submissionId)) {
        next.delete(submissionId);
      } else {
        next.add(submissionId);
      }
      return next;
    });
    setSavedMessage("");
  };

  const toggleAll = () => {
    setSavedMessage("");
    setSelectedIds(allSelected ? new Set() : new Set(submissions.map((submission) => submission.id)));
  };

  const saveQueue = async (nextSubmissions: NewsletterSubmission[], nextPosts: CommunityPost[], message: string) => {
    const nextPreviewOverrides: PreviewOverrides = {
      ...previewOverrides,
      communityPosts: nextPosts,
    };

    if (nextSubmissions.length > 0) {
      nextPreviewOverrides.newsletterSubmissions = nextSubmissions;
    } else {
      delete nextPreviewOverrides.newsletterSubmissions;
    }

    await updatePublicInfo.mutateAsync({
      coopId,
      data: {
        previewOverrides: nextPreviewOverrides,
      },
    });
    setSelectedIds(new Set());
    setSavedMessage(message);
  };

  const publishSelected = async () => {
    if (selectedSubmissions.length === 0) return;
    const selected = new Set(selectedSubmissions.map((submission) => submission.id));
    const nextSubmissions = submissions.filter((submission) => !selected.has(submission.id));
    const nextPosts = [...communityPosts, ...selectedSubmissions.map(submissionToPost)];
    await saveQueue(nextSubmissions, nextPosts, `${selectedSubmissions.length} submission(s) published.`);
  };

  const dismissSelected = async () => {
    if (selectedSubmissions.length === 0) return;
    const selected = new Set(selectedSubmissions.map((submission) => submission.id));
    const nextSubmissions = submissions.filter((submission) => !selected.has(submission.id));
    await saveQueue(nextSubmissions, communityPosts, `${selectedSubmissions.length} submission(s) dismissed.`);
  };

  const publishOne = async (submission: NewsletterSubmission) => {
    setSelectedIds(new Set([submission.id]));
    const nextSubmissions = submissions.filter((item) => item.id !== submission.id);
    const nextPosts = [...communityPosts, submissionToPost(submission)];
    await saveQueue(nextSubmissions, nextPosts, `"${submission.title}" published.`);
  };

  const dismissOne = async (submission: NewsletterSubmission) => {
    setSelectedIds(new Set([submission.id]));
    const nextSubmissions = submissions.filter((item) => item.id !== submission.id);
    await saveQueue(nextSubmissions, communityPosts, `"${submission.title}" dismissed.`);
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardContent className="p-6 text-sm text-zinc-400">
            Only co-op admins can review newsletter submissions.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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
            <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-100">
              Editorial queue
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              {publicInfo?.name || coopId}
            </Badge>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-zinc-50">
            Pick submissions to publish
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Review articles and events from members or public contributors, then choose what goes into the newsletter.
          </p>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <Newspaper className="h-5 w-5 text-emerald-300" />
              Queue status
            </CardTitle>
            <CardDescription className="text-zinc-500">
              {isLoading ? "Loading submissions" : `${submissions.length} pending submission(s)`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {savedMessage ? (
              <div className="flex items-start gap-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                <span>{savedMessage}</span>
              </div>
            ) : (
              <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-400">
                Published picks are added to the bottom of the newsletter post list.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <button
              type="button"
              onClick={toggleAll}
              disabled={submissions.length === 0 || updatePublicInfo.isPending}
              className="flex items-center gap-3 text-left text-sm text-zinc-300 disabled:opacity-50"
            >
              <Checkbox checked={allSelected} className="border-zinc-600" />
              <span>{allSelected ? "Deselect all" : "Select all submissions"}</span>
            </button>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={publishSelected}
                disabled={selectedIds.size === 0 || updatePublicInfo.isPending}
                className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              >
                {updatePublicInfo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish Selected
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={dismissSelected}
                disabled={selectedIds.size === 0 || updatePublicInfo.isPending}
                className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
              >
                <Trash2 className="h-4 w-4" />
                Dismiss Selected
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      ) : submissions.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardContent className="flex min-h-48 items-center justify-center p-6 text-sm text-zinc-500">
            No pending newsletter submissions.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {submissions.map((submission) => {
            const selected = selectedIds.has(submission.id);

            return (
              <Card
                key={submission.id}
                className={cn(
                  "border-zinc-800 bg-zinc-950/70 shadow-none transition-colors",
                  selected && "border-emerald-400/50 bg-emerald-400/5"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <button
                      type="button"
                      onClick={() => toggleSubmission(submission.id)}
                      className="flex shrink-0 items-center gap-3 text-left md:pt-1"
                      aria-label={`${selected ? "Deselect" : "Select"} ${submission.title}`}
                    >
                      <Checkbox checked={selected} className="border-zinc-600" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className={cn(
                            "border",
                            submission.type === "event"
                              ? "border-sky-400/30 bg-sky-400/10 text-sky-100"
                              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                          )}
                        >
                          {submission.type === "event" ? "Event" : "Article"}
                        </Badge>
                        {submission.date && (
                          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {submission.date}
                          </span>
                        )}
                        {submission.location && (
                          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                            <MapPin className="h-3.5 w-3.5" />
                            {submission.location}
                          </span>
                        )}
                      </div>

                      <h2 className="mt-3 text-xl font-semibold tracking-normal text-zinc-50">
                        {submission.title}
                      </h2>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-400">
                        {submission.summary}
                      </p>
                      {submission.contentMarkdown && submission.contentMarkdown !== submission.summary && (
                        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Full markdown article
                          </p>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-zinc-300">
                            {submission.contentMarkdown}
                          </pre>
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-500">
                        {submission.submittedByName && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {submission.submittedByName}
                          </span>
                        )}
                        {submission.submittedByEmail && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" />
                            {submission.submittedByEmail}
                          </span>
                        )}
                        {(submission.sourceUrl || submission.ctaUrl) && (
                          <a
                            href={submission.sourceUrl || submission.ctaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-zinc-300 hover:text-white"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Source link
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2 md:flex-col">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => publishOne(submission)}
                        disabled={updatePublicInfo.isPending}
                        className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                      >
                        Publish
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => dismissOne(submission)}
                        disabled={updatePublicInfo.isPending}
                        className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
