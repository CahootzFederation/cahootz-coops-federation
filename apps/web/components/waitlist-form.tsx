"use client";

import type React from "react";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { api } from "@/lib/trpc/client";

interface WaitlistFormProps {
  source: "hero" | "contact";
  variant?: "hero" | "card";
  className?: string;
}

function WaitlistFormContent({
  source,
  variant = "hero",
  className = "",
}: WaitlistFormProps) {
  const searchParams = useSearchParams();
  const { data: coops = [] } = api.coopConfig.listActiveCoops.useQuery();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [suggestedCoop, setSuggestedCoop] = useState("");
  const [customCoopSuggestion, setCustomCoopSuggestion] = useState("");
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const coopFromQuery = searchParams.get("coop");
    if (coopFromQuery) {
      setSuggestedCoop(coopFromQuery);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const name = formData.get("name") as string;
    const coop = formData.get("suggestedCoop") as string;
    const customSuggestion = formData.get("customCoopSuggestion") as string;

    // Use custom suggestion if provided, otherwise use selected coop
    const finalCoopChoice = customSuggestion.trim() || coop;

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          name,
          source,
          suggestedCoop: finalCoopChoice,
        }),
      });

      const data = await response.json();
      console.log("waitlist-form response", data);
      setResult(data);

      if (data.success) {
        // Reset form on success
        e.currentTarget.reset();
        setSuggestedCoop(searchParams.get("coop") ?? "");
        setCustomCoopSuggestion("");
      }
    } catch (error) {
      console.error("Error joining waitlist", error);
      setResult({
        success: false,
        message: "Error joining waitlist. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (variant === "hero") {
    return (
      <div className={`mx-auto max-w-3xl ${className}`}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <input
              type="text"
              name="name"
              placeholder="Your name"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
              disabled={isSubmitting}
              data-ph-capture-attribute-name="true"
            />
            <input
              type="email"
              name="email"
              placeholder="Your email"
              required
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
              disabled={isSubmitting}
              data-ph-capture-attribute-email="true"
            />
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div>
                <input
                  type="text"
                  name="suggestedCoop"
                  list={`coop-options-${variant}`}
                  placeholder="Which commons do you want to join? *"
                  value={suggestedCoop}
                  onChange={(event) => setSuggestedCoop(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
                  disabled={isSubmitting}
                  required={!customCoopSuggestion}
                  data-ph-capture-attribute-suggestedcoop="true"
                />
                <datalist id={`coop-options-${variant}`}>
                  {coops.map((coop) => (
                    <option key={coop.coopId} value={coop.name} />
                  ))}
                </datalist>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-2xl bg-white px-6 py-3 font-medium text-slate-950 transition hover:bg-slate-200"
              >
                {isSubmitting ? "Joining..." : "Join Waitlist"}
              </button>
            </div>
            
            {/* Custom Coop Suggestion */}
            <div>
              <input
                type="text"
                name="customCoopSuggestion"
                placeholder="Or suggest a new commons idea (optional)"
                value={customCoopSuggestion}
                onChange={(event) => setCustomCoopSuggestion(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
                disabled={isSubmitting}
                data-ph-capture-attribute-customsuggestion="true"
              />
            </div>
          </div>

          {result && (
            <div
              className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
                result.success
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                  : "border-red-400/20 bg-red-400/10 text-red-200"
              }`}
            >
              {result.success ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
              {result.message}
            </div>
          )}

          <p className="text-center text-xs text-slate-500">
            * Required: Choose an active commons or suggest a new commons below.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-3">
          <input
            type="text"
            name="name"
            placeholder="Your name"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
            disabled={isSubmitting}
            data-ph-capture-attribute-name="true"
          />
          <input
            type="email"
            name="email"
            placeholder="Your email"
            required
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
            disabled={isSubmitting}
            data-ph-capture-attribute-email="true"
          />
          <input
            type="text"
            name="suggestedCoop"
            list={`coop-options-${variant}`}
            placeholder="Which commons do you want to join? *"
            value={suggestedCoop}
            onChange={(event) => setSuggestedCoop(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
            disabled={isSubmitting}
            required={!customCoopSuggestion}
            data-ph-capture-attribute-suggestedcoop="true"
          />
          <datalist id={`coop-options-${variant}`}>
            {coops.map((coop) => (
              <option key={coop.coopId} value={coop.name} />
            ))}
          </datalist>
          
          {/* Custom Coop Suggestion */}
          <input
            type="text"
            name="customCoopSuggestion"
            placeholder="Or suggest a new commons idea (optional)"
            value={customCoopSuggestion}
            onChange={(event) => setCustomCoopSuggestion(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
            disabled={isSubmitting}
            data-ph-capture-attribute-customsuggestion="true"
          />
          
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 font-medium text-slate-950 transition hover:bg-slate-200"
          >
            {isSubmitting ? (
              "Joining..."
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-2 h-4 w-4"
                >
                  <path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5C2 7 4 5 6.5 5H18c2.2 0 4 1.8 4 4v8Z" />
                  <polyline points="15,9 18,9 18,6" />
                  <path d="M18 9 9 18" />
                </svg>
                Join Waitlist
              </>
            )}
          </button>
        </div>

        {result && (
          <div
            className={`flex items-center gap-2 rounded p-3 text-sm ${
              result.success
                ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                : "border border-red-400/20 bg-red-400/10 text-red-200"
            }`}
          >
            {result.success ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {result.message}
          </div>
        )}

        <p className="text-xs leading-6 text-slate-500">
          * Required: Pick an active commons or suggest a new commons above.
        </p>
      </form>
    </div>
  );
}

export function WaitlistForm(props: WaitlistFormProps) {
  return (
    <Suspense fallback={<div className="text-slate-400">Loading...</div>}>
      <WaitlistFormContent {...props} />
    </Suspense>
  );
}
