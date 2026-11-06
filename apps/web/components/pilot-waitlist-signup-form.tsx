"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePostHog } from "posthog-js/react";

interface CoopOption {
  coopId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  isLive: boolean;
  hasPublishedPublicPage: boolean;
}

interface PilotWaitlistSignupFormProps {
  coops?: CoopOption[];
}

export function PilotWaitlistSignupForm({
  coops = [],
}: PilotWaitlistSignupFormProps) {
  const posthog = usePostHog();
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
          message:
            data.message ||
            "We couldn’t join you to the pilot. Check your details and try again.",
        });
        return;
      }

      setResult(data);

      if (data.success) {
        posthog.capture("homepage_experiment_waitlist_joined", {
          form: "group-buy-pilot",
        });
        formElement.reset();
        setSuggestedCoop("");
      }
    } catch (error) {
      console.error("Waitlist submission error:", error);
      setResult({
        success: false,
        message:
          "We couldn’t join you to the pilot. Check your connection and try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="pilot-form">
      <div className="pilot-field">
        <Label htmlFor="name" className="pilot-label">
          Name
        </Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Your name"
          className="pilot-input"
        />
      </div>

      <div className="pilot-field">
        <Label htmlFor="email" className="pilot-label">
          Email address
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="pilot-input"
        />
      </div>

      <div className="pilot-field">
        <Label htmlFor="suggestedCoop" className="pilot-label">
          Buying group and first product idea
        </Label>
        <Input
          id="suggestedCoop"
          name="suggestedCoop"
          type="text"
          list="member-waitlist-coop-options"
          value={suggestedCoop}
          onChange={(event) => setSuggestedCoop(event.target.value)}
          placeholder="Family Buy — laundry soap"
          className="pilot-input"
          aria-describedby="suggestedCoop-help"
        />
        <p className="pilot-helper" id="suggestedCoop-help">
          Name a group you would join and an everyday product under $30.
        </p>
        <datalist id="member-waitlist-coop-options">
          {coops.map((coop) => (
            <option key={coop.coopId} value={coop.coopId} label={coop.name} />
          ))}
        </datalist>
      </div>

      <Button type="submit" disabled={isSubmitting} className="pilot-submit">
        {isSubmitting ? "Joining…" : "Join the pilot"}
      </Button>

      {result && (
        <div
          className={`pilot-result ${
            result.success ? "pilot-result--success" : "pilot-result--error"
          }`}
          role="status"
          aria-live="polite"
        >
          {result.message}
        </div>
      )}
    </form>
  );
}
