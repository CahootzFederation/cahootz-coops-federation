"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { useCoin } from "@/hooks/use-platform-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, Info, Send, MapPin } from "lucide-react";
import Link from "next/link";

export default function SubmitProposalPage() {
  const router = useRouter();
  const params = useParams();
  const coopId = params.coopId as string;
  const coin = useCoin();
  const [text, setText] = useState("");
  const [location, setLocation] = useState("");

  const { data: config } = api.coopConfig.getActive.useQuery({ coopId });

  const createProposal = api.proposal.create.useMutation({
    onSuccess: (data) => {
      router.push(`/portal/${coopId}/proposals/${data.id}`);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (text.length < 20) return;

    const fullText = location.trim()
      ? `Location: ${location.trim()}\n\n${text}`
      : text;

    await createProposal.mutateAsync({
      text: fullText,
      coopId,
    });
  };

  const minBalance = config?.minScBalanceToSubmit ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back Link */}
      <Link href={`/portal/${coopId}/proposals`} className="inline-flex items-center text-gray-400 hover:text-white text-sm">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to proposals
      </Link>

      <h1 className="text-2xl font-bold text-white">Submit a Proposal</h1>

      {/* Info Callout */}
      <Card className="bg-blue-500/10 border-blue-500/30">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-300">
            <p className="font-medium">AI-Powered Analysis</p>
            <p className="text-blue-300/80 mt-1">
              Write your proposal in plain text. Our AI engine will automatically extract structured details
              (category, budget, impact) and score it against the commons charter goals.
              The more detail you provide, the better the analysis.
            </p>
          </div>
        </CardContent>
      </Card>

      {minBalance > 0 && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-300">
              Minimum {coin.symbol} balance to submit: <strong>{minBalance} {coin.symbol}</strong>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Submit Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Location */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <MapPin className="h-4 w-4 text-amber-400" />
              Location <span className="text-sm font-normal text-gray-400">(optional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., Atlanta, GA or South Side Chicago"
              className="bg-slate-900 border-slate-700 text-white placeholder:text-gray-500"
              maxLength={200}
            />
            <p className="text-xs text-gray-500 mt-2">
              Where will this proposal primarily operate or benefit?
            </p>
          </CardContent>
        </Card>

        {/* Proposal Text */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-lg">Proposal Text</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe your proposal in detail. Include what you want to build/fund, the budget needed, expected impact (jobs, revenue, leakage reduction), and how it serves the commons mission..."
              className="bg-slate-900 border-slate-700 text-white placeholder:text-gray-500 min-h-[250px]"
              maxLength={10000}
            />
            <div className="flex justify-between mt-2">
              <span className="text-xs text-gray-500">
                {text.length < 20 ? `${20 - text.length} more characters needed` : `${text.length}/10,000`}
              </span>
            </div>
          </CardContent>
        </Card>

        {createProposal.isError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
            {createProposal.error?.message || "Failed to submit proposal"}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={text.length < 20 || createProposal.isPending}
            className="bg-amber-600 hover:bg-amber-700"
            size="lg"
          >
            {createProposal.isPending ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Analyzing Proposal...
              </>
            ) : (
              <>
                <Send className="h-5 w-5 mr-2" />
                Submit for AI Analysis
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
