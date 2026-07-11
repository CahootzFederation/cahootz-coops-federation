"use client";

import type React from "react";
import { useState } from "react";
import { AlertCircle, CheckCircle2, Mail, Send } from "lucide-react";

interface ContactResult {
  success: boolean;
  message: string;
}

export function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ContactResult | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);

    const contactData = {
      name: formData.get("name"),
      email: formData.get("email"),
      organization: formData.get("organization"),
      topic: formData.get("topic"),
      message: formData.get("message"),
      website: formData.get("website"),
    };

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(contactData),
      });

      const data = (await response.json()) as ContactResult;
      setResult(data);

      if (response.ok && data.success) {
        formElement.reset();
      }
    } catch (error) {
      console.error("Contact form submission error:", error);
      setResult({
        success: false,
        message: "We could not send your message. Please email team@cahootzcoops.com directly.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="name" className="block text-sm font-semibold text-white">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            disabled={isSubmitting}
            placeholder="Your name"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f0975b]/60"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-semibold text-white">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            disabled={isSubmitting}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f0975b]/60"
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="organization" className="block text-sm font-semibold text-white">
            Organization
          </label>
          <input
            id="organization"
            name="organization"
            type="text"
            disabled={isSubmitting}
            placeholder="Co-op, business, or group"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f0975b]/60"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="topic" className="block text-sm font-semibold text-white">
            Topic
          </label>
          <select
            id="topic"
            name="topic"
            defaultValue="general"
            disabled={isSubmitting}
            className="w-full rounded-lg border border-white/10 bg-[#171717] px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#f0975b]/60"
          >
            <option value="general">General</option>
            <option value="start-coop">Start a co-op</option>
            <option value="business">Business interest</option>
            <option value="support">Support</option>
            <option value="partnership">Partnership</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="message" className="block text-sm font-semibold text-white">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          disabled={isSubmitting}
          rows={7}
          minLength={10}
          maxLength={4000}
          placeholder="Tell us what you are trying to build, fix, join, or figure out."
          className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f0975b]/60"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#f0975b] px-5 py-3 font-semibold text-[#111111] transition hover:bg-[#ffb36f] disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
      >
        {isSubmitting ? (
          <>
            <Mail className="h-4 w-4" />
            Sending
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Send message
          </>
        )}
      </button>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-4 text-sm ${
            result.success
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/25 bg-red-400/10 text-red-200"
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{result.message}</span>
        </div>
      )}
    </form>
  );
}
