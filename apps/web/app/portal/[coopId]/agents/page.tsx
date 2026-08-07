"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  PlayCircle,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useWeb3Auth } from "@/hooks/use-web3-auth";

type NewsletterAgentId = "article-writer" | "event-writer";
type AgentRunStatus = "success" | "empty" | "error";

interface NewsletterAgentSchedule {
  agentId: NewsletterAgentId;
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string;
  lastRunStatus?: AgentRunStatus;
  lastRunMessage?: string;
  lastCreatedCount?: number;
  updatedAt?: string;
}

interface PreviewOverrides {
  newsletterAgentSchedules?: unknown;
  [key: string]: unknown;
}

const agentCopy: Record<NewsletterAgentId, {
  label: string;
  description: string;
}> = {
  "article-writer": {
    label: "News Agent",
    description: "Researches sources, verifies an angle, writes, and quality-checks newsletter news drafts.",
  },
  "event-writer": {
    label: "Event Agent",
    description: "Finds events, verifies facts, checks goal fit, and drafts event listings.",
  },
};

const cadenceOptions = [
  { label: "Daily", value: "24", description: "Every 24 hours" },
  { label: "Twice a week", value: "84", description: "Every 3.5 days" },
  { label: "Weekly", value: "168", description: "Every 7 days" },
  { label: "Every 2 weeks", value: "336", description: "Every 14 days" },
  { label: "Monthly", value: "720", description: "Every 30 days" },
];

const defaultSchedules: Record<NewsletterAgentId, NewsletterAgentSchedule> = {
  "article-writer": {
    agentId: "article-writer",
    enabled: true,
    intervalHours: 168,
  },
  "event-writer": {
    agentId: "event-writer",
    enabled: true,
    intervalHours: 168,
  },
};

function normalizePreviewOverrides(value: unknown): PreviewOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PreviewOverrides)
    : {};
}

function normalizeSchedule(agentId: NewsletterAgentId, value: unknown): NewsletterAgentSchedule {
  const fallback = defaultSchedules[agentId];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...fallback };
  }

  const record = value as Record<string, unknown>;
  const intervalHours = typeof record.intervalHours === "number" && Number.isFinite(record.intervalHours)
    ? Math.min(Math.max(Math.round(record.intervalHours), 1), 24 * 60)
    : fallback.intervalHours;
  const lastRunStatus = ["success", "empty", "error"].includes(String(record.lastRunStatus))
    ? record.lastRunStatus as AgentRunStatus
    : undefined;

  return {
    agentId,
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    intervalHours,
    lastRunAt: typeof record.lastRunAt === "string" ? record.lastRunAt : undefined,
    lastRunStatus,
    lastRunMessage: typeof record.lastRunMessage === "string" ? record.lastRunMessage : undefined,
    lastCreatedCount: typeof record.lastCreatedCount === "number" && Number.isFinite(record.lastCreatedCount)
      ? Math.max(Math.round(record.lastCreatedCount), 0)
      : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function normalizeSchedules(value: unknown): Record<NewsletterAgentId, NewsletterAgentSchedule> {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    "article-writer": normalizeSchedule("article-writer", record["article-writer"]),
    "event-writer": normalizeSchedule("event-writer", record["event-writer"]),
  };
}

function formatDateTime(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getNextRunAt(schedule: NewsletterAgentSchedule) {
  if (!schedule.enabled) return null;
  const anchor = schedule.lastRunAt || schedule.updatedAt || new Date().toISOString();
  const anchorDate = new Date(anchor);
  if (Number.isNaN(anchorDate.getTime())) return null;
  return new Date(anchorDate.getTime() + schedule.intervalHours * 60 * 60 * 1000).toISOString();
}

function cadenceDescription(intervalHours: number) {
  return cadenceOptions.find((option) => Number(option.value) === intervalHours)?.description
    || `Every ${intervalHours} hour${intervalHours === 1 ? "" : "s"}`;
}

export default function AgentsStatusPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const { isAdmin } = useWeb3Auth();
  const [statusMessage, setStatusMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [runningAgentId, setRunningAgentId] = useState<NewsletterAgentId | null>(null);

  const { data: publicInfo, isLoading, refetch } = api.publicCoopInfo.getForEdit.useQuery(
    { coopId },
    { enabled: isAdmin }
  );
  const updatePublicInfo = api.publicCoopInfo.update.useMutation({
    onSuccess: () => {
      refetch();
    },
  });
  const runNewsletterAgent = api.publicCoopInfo.runNewsletterAgent.useMutation();

  const editablePublicInfo = publicInfo as any;
  const previewOverrides = normalizePreviewOverrides(editablePublicInfo?.previewOverrides);
  const schedules = useMemo(
    () => normalizeSchedules(previewOverrides.newsletterAgentSchedules),
    [previewOverrides.newsletterAgentSchedules]
  );

  const saveSchedule = async (agentId: NewsletterAgentId, patch: Partial<NewsletterAgentSchedule>) => {
    const now = new Date().toISOString();
    const nextSchedules: Record<NewsletterAgentId, NewsletterAgentSchedule> = {
      ...schedules,
      [agentId]: {
        ...schedules[agentId],
        ...patch,
        agentId,
        updatedAt: now,
      },
    };

    await updatePublicInfo.mutateAsync({
      coopId,
      data: {
        previewOverrides: {
          ...previewOverrides,
          newsletterAgentSchedules: nextSchedules,
        },
      },
    });
    setStatusMessage({
      tone: "success",
      text: `${agentCopy[agentId].label} schedule updated.`,
    });
  };

  const runAgentNow = async (agentId: NewsletterAgentId) => {
    setRunningAgentId(agentId);
    setStatusMessage(null);

    try {
      const result = await runNewsletterAgent.mutateAsync({ coopId, agentId });
      await refetch();
      setStatusMessage({
        tone: "success",
        text: result.message,
      });
    } catch (error) {
      setStatusMessage({
        tone: "error",
        text: error instanceof Error ? error.message : `Could not run ${agentCopy[agentId].label}.`,
      });
    } finally {
      setRunningAgentId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardContent className="p-6 text-sm text-zinc-400">
            Only commons admins can view agent status.
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
              Admin status
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              {publicInfo?.name || coopId}
            </Badge>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-zinc-50">
            Agent schedules
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Review automated editorial agent timing, adjust cadence, and trigger the news or event agent when admins need fresh drafts.
          </p>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <Activity className="h-5 w-5 text-emerald-300" />
              Automation status
            </CardTitle>
            <CardDescription className="text-zinc-500">
              {isLoading ? "Loading schedules" : "Admin-triggered runs write to the newsletter review queue"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statusMessage ? (
              <div className={cn(
                "flex items-start gap-3 rounded-md border p-3 text-sm",
                statusMessage.tone === "success"
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                  : "border-red-400/30 bg-red-400/10 text-red-100",
              )}>
                {statusMessage.tone === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 text-red-300" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            ) : (
              <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-400">
                Runs update automatically when the scheduled worker or an admin trigger completes.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(Object.keys(agentCopy) as NewsletterAgentId[]).map((agentId) => {
            const schedule = schedules[agentId];
            const nextRunAt = getNextRunAt(schedule);
            const statusTone = schedule.lastRunStatus === "success"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
              : schedule.lastRunStatus === "empty"
                ? "border-sky-400/30 bg-sky-400/10 text-sky-100"
                : schedule.lastRunStatus === "error"
                  ? "border-red-400/30 bg-red-400/10 text-red-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300";

            return (
              <Card key={agentId} className="border-zinc-800 bg-zinc-950/70 shadow-none">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-zinc-100">{agentCopy[agentId].label}</CardTitle>
                        <CardDescription className="mt-1 text-zinc-500">
                          {agentCopy[agentId].description}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge className={cn("shrink-0 border", schedule.enabled ? statusTone : "border-zinc-700 bg-zinc-900 text-zinc-400")}>
                      {schedule.enabled ? schedule.lastRunStatus || "scheduled" : "paused"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        <Clock className="h-3.5 w-3.5" />
                        Last run
                      </div>
                      <p className="mt-2 text-sm font-medium text-zinc-100">
                        {formatDateTime(schedule.lastRunAt)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {typeof schedule.lastCreatedCount === "number"
                          ? `${schedule.lastCreatedCount} draft(s) created`
                          : "No run recorded"}
                      </p>
                    </div>

                    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Next run
                      </div>
                      <p className="mt-2 text-sm font-medium text-zinc-100">
                        {schedule.enabled ? formatDateTime(nextRunAt || undefined) : "Paused"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {schedule.enabled ? cadenceDescription(schedule.intervalHours) : "Automation off"}
                      </p>
                    </div>
                  </div>

                  {schedule.lastRunMessage ? (
                    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400">
                      {schedule.lastRunMessage}
                    </div>
                  ) : null}

                  <div className="grid gap-4 rounded-md border border-zinc-800 bg-zinc-950 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div className="space-y-2">
                      <Label className="text-zinc-300">Run rate</Label>
                      <Select
                        value={String(schedule.intervalHours)}
                        onValueChange={(value) => {
                          setStatusMessage(null);
                          saveSchedule(agentId, { intervalHours: Number(value) });
                        }}
                        disabled={updatePublicInfo.isPending || runNewsletterAgent.isPending}
                      >
                        <SelectTrigger className="border-zinc-700 bg-zinc-900 text-zinc-100">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {cadenceOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 sm:min-w-36">
                      <Label className="text-sm text-zinc-300">Enabled</Label>
                      <Switch
                        checked={schedule.enabled}
                        disabled={updatePublicInfo.isPending || runNewsletterAgent.isPending}
                        onCheckedChange={(checked) => {
                          setStatusMessage(null);
                          saveSchedule(agentId, { enabled: checked });
                        }}
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                    disabled={runNewsletterAgent.isPending || updatePublicInfo.isPending}
                    onClick={() => runAgentNow(agentId)}
                  >
                    {runningAgentId === agentId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PlayCircle className="h-4 w-4" />
                    )}
                    {runningAgentId === agentId ? "Running..." : `Run ${agentCopy[agentId].label}`}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
        <CardContent className="flex flex-col gap-3 p-4 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <span>Agent drafts still land in the existing newsletter review queue.</span>
          <Button
            asChild
            variant="outline"
            className="border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-900 hover:text-zinc-50"
          >
            <Link href={`/portal/${coopId}/newsletter/submissions`}>
              <Save className="h-4 w-4" />
              Review Queue
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
