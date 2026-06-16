"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  formatApplicationAnswer,
  getApplicationAnswerEntries,
} from "@/lib/application-display";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, ChevronRight, ChevronLeft } from "lucide-react";

export default function ApplicationsPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewNotes, setReviewNotes] = useState("");

  // Fetch pending applications
  const { data: applications, isLoading, error, refetch } = api.admin.getPendingApplications.useQuery();
  const { data: questionsData } = api.coopConfig.getApplicationQuestions.useQuery({ coopId });
  const questionLabelById = new Map(
    (questionsData?.questions ?? []).map((question: any) => [question.id, question.label]),
  );

  // Update status mutation
  const updateStatus = api.admin.updateUserStatus.useMutation({
    onSuccess: (data) => {
      console.log('✅ Mutation success:', data);
      setReviewNotes("");
      refetch();
      // Reset to first application after refetch
      setCurrentIndex(0);
    },
    onError: (error) => {
      console.error('❌ Mutation error:', error);
      alert(`Error: ${error.message}`);
    },
  });

  const handleApprove = () => {
    if (!currentApp) return;
    updateStatus.mutate({
      userId: currentApp.id,
      coopId,
      status: 'ACTIVE',
      reviewNotes: reviewNotes || undefined,
    } as any);
  };

  const handleReject = () => {
    if (!currentApp) return;
    updateStatus.mutate({
      userId: currentApp.id,
      coopId,
      status: 'REJECTED',
      reviewNotes: reviewNotes || undefined,
    } as any);
  };

  const handleNext = () => {
    if (applications && currentIndex < applications.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setReviewNotes("");
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setReviewNotes("");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="text-red-500 text-center">
          <p className="font-semibold">Error loading applications</p>
          <p className="text-sm text-gray-400 mt-2">{error.message}</p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  if (!applications || applications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">No Pending Applications</h2>
          <p className="text-gray-400">All applications have been reviewed!</p>
        </div>
      </div>
    );
  }

  // Ensure currentIndex is within bounds
  const safeIndex = Math.min(currentIndex, applications.length - 1);
  const currentApp = applications[safeIndex];

  if (!currentApp) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">No Application Found</h2>
          <p className="text-gray-400">Please refresh the page.</p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          Refresh
        </Button>
      </div>
    );
  }

  // Handle both singular and array format for applications
  const application = (currentApp as any).application || currentApp.applications?.[0];
  const appData = application?.data;
  const dynamicAnswerEntries = getApplicationAnswerEntries(appData);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Application Review</h1>
          <p className="text-gray-400 mt-1">
            Reviewing {safeIndex + 1} of {applications.length} pending applications
          </p>
        </div>
        <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 bg-yellow-500/10">
          {applications.length} Pending
        </Badge>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between bg-slate-900 rounded-lg p-4">
        <Button
          onClick={handlePrevious}
          disabled={safeIndex === 0}
          variant="ghost"
          size="sm"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <span className="text-sm text-gray-400">
          Application {safeIndex + 1} / {applications.length}
        </span>
        <Button
          onClick={handleNext}
          disabled={safeIndex === applications.length - 1}
          variant="ghost"
          size="sm"
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Application Details */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl text-white">{currentApp.name || 'No Name'}</CardTitle>
              <CardDescription className="text-base mt-2 text-gray-400">
                {currentApp.email} • {currentApp.phone || 'No phone'}
              </CardDescription>
            </div>
            <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
              PENDING
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {appData && (
            <>
              {/* Personal Information */}
              <div>
                <h3 className="font-semibold text-lg mb-3 text-amber-500">Personal Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Full Name:</span>{' '}
                    <span className="font-medium text-white">
                      {appData.firstName} {appData.lastName}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Identity:</span>{' '}
                    <span className="font-medium text-white capitalize">
                      {appData.identity?.replace(/-/g, ' ')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Commitment */}
              <div>
                <h3 className="font-semibold text-lg mb-3 text-amber-500">Commitment & Participation</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Agree to Mission:</span>{' '}
                    <Badge variant={appData.agreeToMission === 'yes' ? 'default' : 'secondary'} className="ml-2">
                      {appData.agreeToMission}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-gray-500">Monthly Commitment:</span>{' '}
                    <span className="font-medium text-white">${appData.monthlyCommitment}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Use UC:</span>{' '}
                    <Badge variant={appData.useUC === 'yes' ? 'default' : 'secondary'} className="ml-2">
                      {appData.useUC}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-gray-500">Vote on Investments:</span>{' '}
                    <Badge variant={appData.voteOnInvestments === 'yes' ? 'default' : 'secondary'} className="ml-2">
                      {appData.voteOnInvestments}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Spending Categories */}
              {appData.spendingCategories && appData.spendingCategories.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 text-amber-500">Spending Categories</h3>
                  <div className="flex flex-wrap gap-2">
                    {appData.spendingCategories.map((cat: string, i: number) => (
                      <Badge key={i} variant="outline" className="bg-slate-800 text-white border-slate-700">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Introduction Video */}
              {application?.videoCID && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 text-amber-500">Introduction Video</h3>
                  <div className="bg-slate-950 rounded-lg overflow-hidden">
                    <video
                      controls
                      className="w-full max-h-96"
                      preload="metadata"
                    >
                      <source
                        src={`https://gateway.pinata.cloud/ipfs/${application.videoCID}`}
                        type="video/mp4"
                      />
                      Your browser doesn't support video playback.
                    </video>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Stored on IPFS: {application.videoCID}
                  </p>
                </div>
              )}

              {/* Profile Photo */}
              {application?.photoCID && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 text-amber-500">Profile Photo</h3>
                  <div className="bg-slate-950 rounded-lg overflow-hidden p-4">
                    <img
                      src={`https://gateway.pinata.cloud/ipfs/${application.photoCID}`}
                      alt="Profile"
                      className="max-w-sm rounded-lg"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Stored on IPFS: {application.photoCID}
                  </p>
                </div>
              )}

              {/* Motivation & Desired Service */}
              {(appData.motivation || appData.desiredService) && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg text-amber-500">Additional Information</h3>
                  {appData.motivation && (
                    <div>
                      <Label className="text-gray-400 text-sm">Motivation:</Label>
                      <div className="mt-2 bg-slate-950 p-4 rounded-lg text-sm text-gray-200">
                        {appData.motivation}
                      </div>
                    </div>
                  )}
                  {appData.desiredService && (
                    <div>
                      <Label className="text-gray-400 text-sm">Desired Service:</Label>
                      <div className="mt-2 bg-slate-950 p-4 rounded-lg text-sm text-gray-200">
                        {appData.desiredService}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {dynamicAnswerEntries.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 text-amber-500">Application Answers</h3>
                  <div className="space-y-3">
                    {dynamicAnswerEntries.map(([questionId, answer]) => (
                      <div key={questionId}>
                        <Label className="text-gray-400 text-sm">
                          {questionLabelById.get(questionId) ?? questionId}
                        </Label>
                        <div className="mt-2 bg-slate-950 p-4 rounded-lg text-sm text-gray-200">
                          {formatApplicationAnswer(answer)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Review Notes */}
          <div className="pt-6 border-t border-slate-800">
            <Label htmlFor="review-notes" className="text-base font-semibold text-slate-100">
              Review Notes
            </Label>
            <Textarea
              id="review-notes"
              placeholder="Add notes about this application review... (optional)"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="mt-3 bg-slate-950 border-slate-700 min-h-[100px]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              onClick={handleReject}
              disabled={updateStatus.isPending}
              variant="outline"
              className="flex-1 border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200"
              size="lg"
            >
              <XCircle className="h-5 w-5 mr-2" />
              Reject Application
            </Button>
            <Button
              onClick={handleApprove}
              disabled={updateStatus.isPending}
              className="flex-1 bg-green-600 hover:bg-green-700"
              size="lg"
            >
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Approve Application
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
