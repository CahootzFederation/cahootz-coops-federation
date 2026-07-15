"use client";

import type { FormEvent } from "react";
import { useId, useState } from "react";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { env } from "@/env";

interface NewsletterSubscribeFormProps {
  coopId: string;
  coopName: string;
}

export function NewsletterSubscribeForm({
  coopId,
  coopName,
}: NewsletterSubscribeFormProps) {
  const formId = useId();
  const [email, setEmail] = useState("");
  const [applyIntent, setApplyIntent] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl = (env.NEXT_PUBLIC_API_URL || "http://localhost:3001/trpc")
    .replace(/\/trpc$/, "")
    .replace(/\/$/, "");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/newsletter-subscriptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          coopId,
          coopName,
          applyIntent,
          source: "public-newsletter-page",
        }),
      });

      const data = (await response.json()) as { success?: boolean; message?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Please try again.");
      }

      setMessage(data.message || "You're subscribed. We'll keep you posted.");
      setEmail("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form className="grid gap-3" onSubmit={onSubmit}>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="sr-only" htmlFor={`${formId}-newsletter-email`}>
            Email address
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--newsletter-muted)]" />
            <Input
              id={`${formId}-newsletter-email`}
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11 rounded-none border-2 border-[color:var(--newsletter-ink)] bg-white pl-9 font-semibold"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-11 rounded-none border-2 border-[color:var(--newsletter-ink)] px-5 text-sm font-black no-underline hover:no-underline"
            style={{ backgroundColor: "var(--coop-primary)" }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Subscribing..." : "Subscribe"}
          </Button>
        </div>
        <div className="flex flex-col gap-2 text-xs font-semibold text-[color:var(--newsletter-muted)] sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[color:var(--coop-primary)]"
              checked={applyIntent}
              onChange={(event) => setApplyIntent(event.target.checked)}
            />
            <span>Send me reminders to apply later.</span>
          </label>
        </div>
      </form>

      {message && (
        <p className="mt-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}
    </>
  );
}
