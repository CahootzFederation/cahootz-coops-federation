"use client";

import { useParams } from "next/navigation";
import { Activity, Bell, ClipboardList, MessageSquare, Sparkles, UserRound, Wallet } from "lucide-react";

import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";

const statIcons = {
  totalUsers: UserRound,
  onboardedUsers: Sparkles,
  activeMembers: Activity,
  pendingApplications: ClipboardList,
  missingWallets: Wallet,
  pushDevices: Bell,
  mediaPosts: MessageSquare,
  commonsSuggestions: ClipboardList,
};

function StatCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: keyof typeof statIcons;
}) {
  const Icon = statIcons[icon];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-zinc-400">{label}</p>
        <Icon className="h-4 w-4 text-orange-400" />
      </div>
      <p className="mt-3 text-3xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{helper}</p>
    </div>
  );
}

export default function CahootzOperatorPage() {
  const params = useParams<{ coopId: string }>();
  const coopId = params.coopId;
  const isCahootz = coopId === "cahootz";
  const { data, isLoading, error } = api.admin.getCahootzOperatorOverview.useQuery(
    { coopId: "cahootz" },
    { enabled: isCahootz }
  );

  if (!isCahootz) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 text-white">
        <h1 className="text-2xl font-black">Operator view is Cahootz-only</h1>
        <p className="mt-2 text-zinc-400">
          This screen is scoped to the root Cahootz coop while the operator model is still being built.
        </p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 text-white">
        <p className="text-zinc-400">Loading operator signals...</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 text-white">
        <h1 className="text-2xl font-black">Could not load operator view</h1>
        <p className="mt-2 text-zinc-400">{error?.message || "Try again in a moment."}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 text-white sm:px-6">
      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge className="border-orange-400/30 bg-orange-400/10 text-orange-100">
            Cahootz operator
          </Badge>
          <h1 className="mt-3 text-3xl font-black tracking-normal text-white">
            Organization Signals
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            A working view of whether Cahootz has enough people, profile context, wallet readiness, notifications, and post signal to coordinate action.
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Onboarding rate</p>
          <p className="text-2xl font-black text-orange-300">{data.stats.onboardingRate}%</p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={data.stats.totalUsers} helper="Total non-deleted accounts." icon="totalUsers" />
        <StatCard label="Profiles" value={data.stats.onboardedUsers} helper="Users with first-run profile signal." icon="onboardedUsers" />
        <StatCard label="Active members" value={data.stats.activeMembers} helper="Approved in the Cahootz commons." icon="activeMembers" />
        <StatCard label="Pending" value={data.stats.pendingApplications} helper="Waiting on Cahootz review." icon="pendingApplications" />
        <StatCard label="Missing wallets" value={data.stats.missingWallets} helper="Active users who still need wallet repair." icon="missingWallets" />
        <StatCard label="Push devices" value={data.stats.pushDevices} helper="Native iOS/Android notification endpoints." icon="pushDevices" />
        <StatCard label="Media posts" value={data.stats.mediaPosts} helper="Posts that include image or video media." icon="mediaPosts" />
        <StatCard label="Suggestions" value={data.stats.commonsSuggestions} helper="New suggested commons to review." icon="commonsSuggestions" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-lg font-black">Post Mix</h2>
          <div className="mt-4 space-y-3">
            {data.postClassifications.length ? (
              data.postClassifications.map((item) => (
                <div key={item.classification} className="flex items-center justify-between gap-3">
                  <span className="capitalize text-zinc-300">{item.classification.replace(/_/g, " ")}</span>
                  <Badge className="border-zinc-700 bg-zinc-900 text-zinc-200">{item.count}</Badge>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No classified posts yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-lg font-black">Recent Post Signal</h2>
          <div className="mt-4 divide-y divide-zinc-900">
            {data.recentPosts.length ? (
              data.recentPosts.map((post) => (
                <div key={post.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-zinc-100">{post.title}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {post.author} • {post.commentCount} comments • {post.supportCount} likes • {post.mediaCount} media
                      </p>
                    </div>
                    <Badge className="shrink-0 border-orange-400/20 bg-orange-400/10 text-orange-100">
                      {post.classification.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No recent posts in the last seven days.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-lg font-black">Newest Profiles</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.recentUsers.map((user) => (
            <div key={user.id} className="rounded-lg border border-zinc-900 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-zinc-100">{user.name || user.email}</p>
                  <p className="truncate text-xs text-zinc-500">{user.email}</p>
                </div>
                <Badge className="border-zinc-700 bg-zinc-900 text-zinc-200">{user.status}</Badge>
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-400">
                {[...user.skills, ...user.interests].slice(0, 8).join(", ") || "No structured signals yet."}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
