"use client";

import { ArrowRight, Users } from "lucide-react";

interface MobileAppRedirectProps {
  variant?: "hero" | "card";
  className?: string;
}

export function MobileAppRedirect({
  variant = "hero",
  className = "",
}: MobileAppRedirectProps) {
  const handleRedirect = () => {
    window.location.href = "/#join";
  };

  if (variant === "card") {
    return (
      <div className={`rounded-xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm ${className}`}>
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-full bg-orange-500/20 p-3">
            <Users className="h-6 w-6 text-orange-400" />
          </div>
          <h3 className="text-xl font-semibold text-white">Join a Commons</h3>
        </div>

        <p className="mb-6 text-slate-300">
          Ready to join? Submit an application for a live commons directly from the website.
        </p>

        <button
          onClick={handleRedirect}
          className="group flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-semibold text-white transition-all hover:from-orange-600 hover:to-orange-700 hover:shadow-lg hover:shadow-orange-500/25"
        >
          Submit an Application
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </button>

        <p className="mt-4 text-center text-sm text-slate-400">
          Choose a commons, answer its questions, and get a reference number.
        </p>
      </div>
    );
  }

  // Hero variant
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <button
        onClick={handleRedirect}
        className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 px-8 py-4 text-lg font-semibold text-white transition-all hover:from-orange-600 hover:to-orange-700 hover:shadow-lg hover:shadow-orange-500/25"
      >
        <Users className="h-5 w-5" />
        Submit an Application
        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
      </button>
      
      <p className="text-sm text-slate-400">
        Apply from the website
      </p>
    </div>
  );
}
