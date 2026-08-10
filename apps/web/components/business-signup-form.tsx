"use client";

import type React from "react";
import { Suspense, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Store } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { api } from "@/lib/trpc/client";

interface CoopOption {
  coopId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  isLive: boolean;
  hasPublishedPublicPage: boolean;
}

interface BusinessSignupFormProps {
  coops?: CoopOption[];
}

function BusinessSignupFormContent({ coops: initialCoops = [] }: BusinessSignupFormProps) {
  const searchParams = useSearchParams();
  const { data: coops = initialCoops } =
    api.coopConfig.listActiveCoops.useQuery(undefined, {
      initialData: initialCoops,
    });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [coopInterest, setCoopInterest] = useState("");
  const [coopId, setCoopId] = useState("");
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const coopFromQuery = searchParams.get("coop");
    const coopIdFromQuery = searchParams.get("coopId");
    if (coopFromQuery) {
      setCoopInterest(coopFromQuery);
    }
    if (coopIdFromQuery) {
      setCoopId(coopIdFromQuery);
    }
  }, [searchParams]);

  useEffect(() => {
    if (coopId || !coops.length) {
      return;
    }

    const matchingCoop = coops.find((coop) => coop.name === coopInterest);
    if (matchingCoop) {
      setCoopId(matchingCoop.coopId);
    }
  }, [coopId, coopInterest, coops]);

  const handleCoopInterestChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextCoopInterest = event.target.value;
    const matchingCoop = coops.find((coop) => coop.name === nextCoopInterest);

    setCoopInterest(nextCoopInterest);
    setCoopId(matchingCoop?.coopId ?? "");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    const formData = new FormData(e.currentTarget);
    const formElement = e.currentTarget; // Store reference before async operation
    
    const businessData = {
      ownerName: formData.get("ownerName") as string,
      ownerEmail: formData.get("ownerEmail") as string,
      businessName: formData.get("businessName") as string,
      businessAddress: formData.get("businessAddress") as string,
      businessType: formData.get("businessType") as string,
      coopInterest: formData.get("coopInterest") as string,
      description: formData.get("description") as string,
      coopId: coopId || undefined,
    };

    try {
      const response = await fetch("/api/business-waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(businessData),
      });

      console.log("Response status:", response.status, response.ok);
      
      const data = await response.json();
      console.log("business-form response", data);
      
      // Check if response was successful HTTP status
      if (!response.ok) {
        console.log("Response not OK, setting error state");
        setResult({
          success: false,
          message: data.message || "Error submitting business signup. Please try again.",
        });
        return;
      }
      
      console.log("Setting result data:", data);
      setResult(data);

      if (data.success) {
        console.log("Success! Resetting form");
        // Reset form on success
        formElement.reset();
        setCoopInterest(searchParams.get("coop") ?? "");
        setCoopId(searchParams.get("coopId") ?? "");
      }
    } catch (error) {
      console.error("Business form submission error:", error);
      setResult({
        success: false,
        message: "Error submitting business signup. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/80">
      <div className="border-b border-white/10 p-6">
        <div className="flex items-center gap-2">
          <Store className="h-6 w-6 text-orange-300" />
          <h2 className="text-xl font-semibold text-white">
            Business Partnership Interest
          </h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Tell us about your business, the commons you want to support, and how
          you want to participate in the network.
        </p>
      </div>
      <div className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="coopInterest" className="block text-sm text-white">
              Commons you want to support
            </label>
            <input
              id="coopInterest"
              name="coopInterest"
              type="text"
              list="business-coop-options"
              placeholder="Choose a commons from the list, or describe your own idea"
              value={coopInterest}
              onChange={handleCoopInterestChange}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-300/50"
              data-ph-capture-attribute-coopinterest="true"
            />
            <datalist id="business-coop-options">
              {coops.map((coop) => (
                <option key={coop.coopId} value={coop.name} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="ownerName" className="block text-sm text-white">
                Your Name *
              </label>
              <input
                id="ownerName"
                name="ownerName"
                type="text"
                placeholder="John Smith"
                required
                disabled={isSubmitting}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-300/50"
                data-ph-capture-attribute-ownername="true"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="ownerEmail" className="block text-sm text-white">
                Your Email *
              </label>
              <input
                id="ownerEmail"
                name="ownerEmail"
                type="email"
                placeholder="john@yourbusiness.com"
                required
                disabled={isSubmitting}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-300/50"
                data-ph-capture-attribute-owneremail="true"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="businessName" className="block text-sm text-white">
              Business Name *
            </label>
            <input
              id="businessName"
              name="businessName"
              type="text"
              placeholder="Smith's Corner Store"
              required
              disabled={isSubmitting}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
              data-ph-capture-attribute-businessname="true"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="businessAddress"
              className="block text-sm text-white"
            >
              Business Address *
            </label>
            <input
              id="businessAddress"
              name="businessAddress"
              type="text"
              placeholder="123 Main St, Atlanta, GA 30309"
              required
              disabled={isSubmitting}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
              data-ph-capture-attribute-businessaddress="true"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="businessType"
              className="block text-sm text-white"
            >
              Business Type *
            </label>
            <select
              id="businessType"
              name="businessType"
              required
              disabled={isSubmitting}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-300/50"
              data-ph-capture-attribute-businesstype="true"
            >
              <option value="">Select business type</option>
              <option value="restaurant">Restaurant/Food Service</option>
              <option value="retail">Retail Store</option>
              <option value="salon">Beauty/Hair Salon</option>
              <option value="automotive">Automotive Service</option>
              <option value="professional">Professional Services</option>
              <option value="health">Health/Wellness</option>
              <option value="construction">Construction/Trades</option>
              <option value="technology">Technology</option>
              <option value="entertainment">Entertainment/Events</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className="block text-sm text-white">
              Tell us more about your business (optional)
            </label>
            <textarea
              id="description"
              name="description"
              placeholder="What products/services do you offer? How many customers do you serve? Any questions about Unity Coin integration?"
              disabled={isSubmitting}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-300/50"
              data-ph-capture-attribute-description="true"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center rounded-lg bg-white px-4 py-3 font-medium text-slate-950 transition hover:bg-slate-200"
          >
            {isSubmitting ? (
              "Submitting..."
            ) : (
              <>
                <Store className="mr-2 h-4 w-4" />
                Submit Business Interest
              </>
            )}
          </button>

          {result && (
            <div
              className={`flex items-center gap-2 rounded p-3 text-sm ${
                result.success
                  ? "border border-orange-400/20 bg-orange-400/10 text-orange-200"
                  : "border border-red-400/20 bg-red-400/10 text-red-200"
              }`}
            >
              {result.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {result.message}
            </div>
          )}

          <p className="text-xs leading-6 text-slate-500">
            * Required fields. You can choose an active commons above or type the
            commons you want your business to help build.
          </p>
        </form>
      </div>
    </div>
  );
}

export function BusinessSignupForm({ coops }: BusinessSignupFormProps) {
  return (
    <Suspense fallback={<div className="text-slate-400">Loading form...</div>}>
      <BusinessSignupFormContent coops={coops} />
    </Suspense>
  );
}
