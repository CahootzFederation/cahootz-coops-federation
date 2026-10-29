"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MEMBER_APP_STORE_URL } from "@/lib/member-app";
import { api } from "@/lib/trpc/client";
import { usePostHog } from "posthog-js/react";

interface CoopOption {
  coopId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  isLive: boolean;
  hasPublishedPublicPage: boolean;
}

interface WaitlistSignupFormProps {
  coops?: CoopOption[];
}

/** Picked when someone's commons isn't on the list yet. */
const SOMEWHERE_ELSE = "somewhere-else";

/**
 * The homepage waitlist. People pick the commons they're interested in (a
 * "Join the waitlist" link on a commons row preselects it with ?commons=), and
 * after signing up they're pointed to the member app.
 */
export function WaitlistSignupForm({ coops: initialCoops = [] }: WaitlistSignupFormProps) {
  const posthog = usePostHog();
  const searchParams = useSearchParams();
  const { data: coops = initialCoops } =
    api.coopConfig.listActiveCoops.useQuery(undefined, {
      initialData: initialCoops,
    });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinedCommons, setJoinedCommons] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [otherCommons, setOtherCommons] = useState("");

  // A commons row's "Join the waitlist" link lands here with ?commons=<id>.
  const requested = searchParams.get("commons");
  useEffect(() => {
    if (requested && coops.some((coop) => coop.coopId === requested)) {
      setChoice(requested);
      setJoinedCommons(null);
    }
  }, [requested, coops]);

  const picked = coops.find((coop) => coop.coopId === choice);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!choice) {
      setError("Pick the commons you're interested in.");
      return;
    }
    if (choice === SOMEWHERE_ELSE && !otherCommons.trim()) {
      setError("Tell us where you are or what you want to start.");
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const commonsName = picked ? picked.name : otherCommons.trim();

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email") as string,
          name: formData.get("name") as string,
          source: "hero",
          coopId: picked?.coopId,
          suggestedCoop: commonsName,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setError(data.message || "We couldn't add you to the waitlist. Check your connection and try again.");
        return;
      }

      posthog.capture("homepage_experiment_waitlist_joined", {
        form: "community-waitlist",
        commons: picked?.coopId ?? SOMEWHERE_ELSE,
      });
      setJoinedCommons(commonsName);
      setChoice("");
      setOtherCommons("");
    } catch (submitError) {
      console.error("Waitlist submission error:", submitError);
      setError("We couldn't add you to the waitlist. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (joinedCommons) {
    return (
      <div className="space-y-4" role="status" aria-label="You're on the waitlist">
        <h3 className="text-xl font-semibold text-[#1a1a1a]">You&apos;re on the list.</h3>
        <p className="text-[#1a1a1a]">
          We&apos;ll let you know when {joinedCommons} opens up. While you wait, get the Cahootz
          app so you&apos;re ready to go.
        </p>
        <a
          className="inline-flex w-full items-center justify-center rounded-md bg-[#1a1a1a] px-4 py-2 font-semibold text-white hover:bg-[#252525]"
          href={MEMBER_APP_STORE_URL}
        >
          Get the app
        </a>
        <button
          type="button"
          className="text-sm font-medium text-[#1a1a1a] underline"
          onClick={() => setJoinedCommons(null)}
        >
          Add someone else
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-label="Join the waitlist">
      <div className="space-y-2">
        <Label htmlFor="waitlist-commons" className="text-[#1a1a1a] font-semibold">
          Which commons are you interested in?
        </Label>
        <select
          id="waitlist-commons"
          name="commons"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          className="flex h-10 w-full rounded-md border border-white/30 bg-white px-3 py-2 text-sm text-[#1a1a1a]"
        >
          <option value="">Pick a commons</option>
          {coops.map((coop) => (
            <option key={coop.coopId} value={coop.coopId}>
              {coop.name}
            </option>
          ))}
          <option value={SOMEWHERE_ELSE}>Somewhere else, or start a new one</option>
        </select>
      </div>

      {choice === SOMEWHERE_ELSE && (
        <div className="space-y-2">
          <Label htmlFor="waitlist-other" className="text-[#1a1a1a] font-semibold">
            Where are you, or what do you want to start?
          </Label>
          <Input
            id="waitlist-other"
            name="otherCommons"
            type="text"
            maxLength={200}
            value={otherCommons}
            onChange={(event) => setOtherCommons(event.target.value)}
            placeholder="A neighborhood in Atlanta, a family group, a church..."
            className="bg-white border-white/30 text-[#1a1a1a] placeholder:text-slate-400"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="waitlist-name" className="text-[#1a1a1a] font-semibold">
          Name
        </Label>
        <Input
          id="waitlist-name"
          name="name"
          type="text"
          maxLength={120}
          placeholder="Your name"
          className="bg-white border-white/30 text-[#1a1a1a] placeholder:text-slate-400"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="waitlist-email" className="text-[#1a1a1a] font-semibold">
          Email address
        </Label>
        <Input
          id="waitlist-email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="bg-white border-white/30 text-[#1a1a1a] placeholder:text-slate-400"
        />
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-[#1a1a1a] text-white hover:bg-[#252525] font-semibold"
      >
        {isSubmitting ? "Joining..." : "Join the waitlist"}
      </Button>

      {error && (
        <div role="alert" className="rounded-lg border border-[#1a1a1a]/30 bg-white/20 p-4 text-sm font-medium text-[#1a1a1a]">
          {error}
        </div>
      )}
    </form>
  );
}
