"use client";

import { useId, useRef, useState } from "react";
import { put } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Check, X } from "lucide-react";

interface CompactImageUploadProps {
  uploadType?: "product" | "store" | "profile" | "offer";
  coopId?: string;
  resourceId?: string;
  label: string;
  value?: string;
  onChange?: (url: string) => void;
  onUploadComplete?: (url: string) => void;
}

export function CompactImageUpload({
  uploadType,
  coopId,
  resourceId,
  label,
  value,
  onChange,
  onUploadComplete,
}: CompactImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const currentValue = value || "";
  const handleChange = (url: string) => {
    onChange?.(url);
    onUploadComplete?.(url);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!uploadType || !coopId || !resourceId) {
      setError("This upload isn't set up right. Reload the page and try again.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("That isn't a photo. Pick a JPG, PNG or WebP image.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadSuccess(false);

    try {
      const tokenResponse = await fetch("/api/upload/presigned", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Coop-Id": coopId,
        },
        body: JSON.stringify({
          filename: file.name,
          uploadType,
          resourceId,
          contentType: file.type,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("We couldn't start the upload. Try again.");
      }

      const tokenData = await tokenResponse.json();

      if (!tokenData.success) {
        throw new Error(tokenData.error || "We couldn't start the upload. Try again.");
      }

      const blob = await put(tokenData.pathname, file, {
        access: "public",
        token: tokenData.clientToken,
        contentType: file.type,
      });

      handleChange(blob.url);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The photo didn't upload. Try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        id={inputId}
      />
      {currentValue && (
        <div className="relative h-12 w-12 overflow-hidden rounded border border-slate-700 bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentValue} alt={label} className="h-full w-full object-cover" />
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="border-slate-700 text-gray-300 hover:bg-slate-800"
      >
        {isUploading ? (
          <>
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Uploading...
          </>
        ) : uploadSuccess ? (
          <>
            <Check className="h-3 w-3 mr-1 text-green-500" />
            {label}
          </>
        ) : (
          <>
            <Upload className="h-3 w-3 mr-1" />
            {label}
          </>
        )}
      </Button>
      {currentValue && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => handleChange("")}
          className="h-8 px-2 text-gray-400 hover:bg-slate-800 hover:text-white"
          aria-label={`Remove ${label}`}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
      {error && (
        <div className="flex items-center gap-1">
          <X className="h-3 w-3 text-red-400" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}
    </div>
  );
}
