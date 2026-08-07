"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/trpc/client";

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

export function WaitlistSignupForm({ coops: initialCoops = [] }: WaitlistSignupFormProps) {
  const { data: coops = initialCoops } =
    api.coopConfig.listActiveCoops.useQuery(undefined, {
      initialData: initialCoops,
    });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [suggestedCoop, setSuggestedCoop] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    const formData = new FormData(e.currentTarget);
    const formElement = e.currentTarget;

    const waitlistData = {
      email: formData.get("email") as string,
      name: formData.get("name") as string,
      source: "hero",
      suggestedCoop: suggestedCoop.trim(),
    };

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(waitlistData),
      });

      const data = await response.json();

      if (!response.ok) {
        setResult({
          success: false,
          message: data.message || "Error joining waitlist. Please try again.",
        });
        return;
      }

      setResult(data);

      if (data.success) {
        formElement.reset();
        setSuggestedCoop("");
      }
    } catch (error) {
      console.error("Waitlist submission error:", error);
      setResult({
        success: false,
        message: "Error joining waitlist. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name" className="text-[#1a1a1a] font-semibold">
          Name
        </Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Your name"
          className="bg-white border-white/30 text-[#1a1a1a] placeholder:text-slate-400"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email" className="text-[#1a1a1a] font-semibold">
          Email address
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="bg-white border-white/30 text-[#1a1a1a] placeholder:text-slate-400"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="suggestedCoop" className="text-[#1a1a1a] font-semibold">
          Commons you want to join or create
        </Label>
        <Input
          id="suggestedCoop"
          name="suggestedCoop"
          type="text"
          list="member-waitlist-coop-options"
          value={suggestedCoop}
          onChange={(event) => setSuggestedCoop(event.target.value)}
          placeholder="Choose a commons from the list, or describe your own idea"
          className="bg-white border-white/30 text-[#1a1a1a] placeholder:text-slate-400"
        />
        <datalist id="member-waitlist-coop-options">
          {coops.map((coop) => (
            <option key={coop.coopId} value={coop.coopId} label={coop.name} />
          ))}
        </datalist>
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-[#1a1a1a] text-white hover:bg-[#252525] font-semibold"
      >
        {isSubmitting ? "Joining..." : "Join Waitlist"}
      </Button>

      {result && (
        <div
          className={`rounded-lg p-4 text-sm font-medium ${
            result.success
              ? "bg-white/20 text-[#1a1a1a] border border-[#1a1a1a]/30"
              : "bg-white/20 text-[#1a1a1a] border border-[#1a1a1a]/30"
          }`}
        >
          {result.message}
        </div>
      )}
    </form>
  );
}
