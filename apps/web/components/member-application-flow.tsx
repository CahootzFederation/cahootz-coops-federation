"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { buildApplicationSubmissionInput } from "@/lib/application-submission";
import type { ApplicationAnswer, MemberApplicationFormData } from "@/lib/application-submission";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

interface CoopOption {
  id: string;
  name: string;
  tagline: string;
  description: string;
  mission: string;
  features: { title: string; description: string }[];
  eligibility: string;
  bgColor: string;
  accentColor: string;
}

interface MemberApplicationFlowProps {
  lockedCoop?: CoopOption;
  lockedCoopId?: string;
  successRedirectHref?: string;
  successRedirectDelayMs?: number;
}

interface ApplicationQuestion {
  id: string;
  type: string;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  validation?: Record<string, unknown>;
}

const initialFormData: MemberApplicationFormData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  agreeToCoopValues: false,
  agreeToTerms: false,
  agreeToPrivacy: false,
  dynamicAnswers: {},
};

const allStepKeys = ["choose", "profile", "questions", "submit"] as const;
const lockedStepKeys = ["profile", "questions", "submit"] as const;

type StepKey = (typeof allStepKeys)[number];

const stepLabelByKey: Record<StepKey, string> = {
  choose: "Choose",
  profile: "Profile",
  questions: "Questions",
  submit: "Submit",
};

function isBlank(value: unknown) {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value !== "string" || value.trim().length === 0;
}

function getMissingQuestionLabels(
  questions: ApplicationQuestion[],
  answers: MemberApplicationFormData["dynamicAnswers"],
) {
  return questions
    .filter((question) => question.required && isBlank(answers[question.id]))
    .map((question) => question.label);
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as unknown;
      if (Array.isArray(parsed)) {
        const messages = parsed
          .map((issue) => {
            if (typeof issue !== "object" || issue === null || !("message" in issue)) return null;
            return typeof issue.message === "string" ? issue.message : null;
          })
          .filter((message): message is string => Boolean(message));

        if (messages.length > 0) return messages.join(" ");
      }
    } catch {
      // Keep the original error message when it is not a serialized validation error.
    }

    return error.message;
  }
  return "Could not submit your application. Please try again.";
}

function mapConfigToCoopOption(config: {
  coopId: string;
  name?: string | null;
  tagline?: string | null;
  description?: string | null;
  displayMission?: string | null;
  displayFeatures?: unknown;
  eligibility?: string | null;
  bgColor?: string | null;
  accentColor?: string | null;
}): CoopOption {
  return {
    id: config.coopId,
    name: config.name || config.coopId,
    tagline: config.tagline || "A member-owned cooperative powered by Cahootz.",
    description:
      config.description ||
      "Apply to join this cooperative and participate in a member-owned local economy.",
    mission: config.displayMission || config.description || "",
    features: Array.isArray(config.displayFeatures)
      ? (config.displayFeatures as CoopOption["features"])
      : [],
    eligibility:
      config.eligibility ||
      "Open to applicants who align with the cooperative mission and community standards.",
    bgColor: config.bgColor || "#111111",
    accentColor: config.accentColor || "#f59e0b",
  };
}

export function MemberApplicationFlow({
  lockedCoop,
  lockedCoopId,
  successRedirectHref,
  successRedirectDelayMs = 12000,
}: MemberApplicationFlowProps = {}) {
  const router = useRouter();
  const posthog = usePostHog();
  const stepKeys = lockedCoopId ? lockedStepKeys : allStepKeys;
  const [step, setStep] = useState(0);
  const [selectedCoopId, setSelectedCoopId] = useState(lockedCoopId ?? "");
  const [formData, setFormData] = useState<MemberApplicationFormData>(initialFormData);
  const [errorMessage, setErrorMessage] = useState("");
  const [applicationReference, setApplicationReference] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const coopsQuery = api.coopConfig.listAvailableCoops.useQuery(undefined, {
    enabled: !lockedCoopId,
  });
  const lockedCoopQuery = api.coopConfig.getActive.useQuery(
    { coopId: lockedCoopId || "__none__" },
    { enabled: Boolean(lockedCoopId) },
  );
  const questionsQuery = api.coopConfig.getApplicationQuestions.useQuery(
    { coopId: selectedCoopId || "__none__" },
    { enabled: Boolean(selectedCoopId) },
  );
  const submitApplication = api.application.submitApplication.useMutation();

  const lockedCoopOption = useMemo(() => {
    if (lockedCoopQuery.data) return mapConfigToCoopOption(lockedCoopQuery.data);
    return lockedCoop;
  }, [lockedCoop, lockedCoopQuery.data]);

  const coops = useMemo(() => {
    if (lockedCoopId) return lockedCoopOption ? [lockedCoopOption] : [];
    return (coopsQuery.data ?? []);
  }, [coopsQuery.data, lockedCoopId, lockedCoopOption]);
  const questions = useMemo(
    () => (questionsQuery.data?.questions ?? []) as ApplicationQuestion[],
    [questionsQuery.data?.questions],
  );
  const selectedCoop = useMemo(
    () => coops.find((coop) => coop.id === selectedCoopId),
    [coops, selectedCoopId],
  );

  const resetFlow = useCallback(() => {
    setStep(0);
    setSelectedCoopId(lockedCoopId ?? "");
    setFormData(initialFormData);
    setErrorMessage("");
    setApplicationReference("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [lockedCoopId]);

  useEffect(() => {
    if (!lockedCoopId) return;
    setSelectedCoopId(lockedCoopId);
  }, [lockedCoopId]);

  useEffect(() => {
    if (!applicationReference) return;

    const timeout = window.setTimeout(() => {
      resetFlow();
      if (successRedirectHref) {
        router.push(successRedirectHref);
      }
    }, successRedirectDelayMs);

    return () => window.clearTimeout(timeout);
  }, [applicationReference, resetFlow, router, successRedirectDelayMs, successRedirectHref]);

  const updateField = <K extends keyof MemberApplicationFormData>(
    field: K,
    value: MemberApplicationFormData[K],
  ) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrorMessage("");
  };

  const updateDynamicAnswer = (questionId: string, value: ApplicationAnswer) => {
    setFormData((current) => ({
      ...current,
      dynamicAnswers: {
        ...current.dynamicAnswers,
        [questionId]: value,
      },
    }));
    setErrorMessage("");
  };

  const validatePersonalInfo = () => {
    const missing = [];
    if (!formData.firstName.trim()) missing.push("First name");
    if (!formData.lastName.trim()) missing.push("Last name");
    if (!formData.email.trim()) missing.push("Email");
    if (!formData.phone.trim()) missing.push("Phone number");
    if (!formData.password) missing.push("Password");
    if (!formData.confirmPassword) missing.push("Confirm password");

    if (missing.length > 0) {
      setErrorMessage(`Please complete: ${missing.join(", ")}.`);
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setErrorMessage("Please enter a valid email address.");
      return false;
    }

    if (formData.password.length < 8) {
      setErrorMessage("Your password must be at least 8 characters long.");
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setErrorMessage("Your passwords do not match.");
      return false;
    }

    return true;
  };

  const validateQuestions = () => {
    const missing = getMissingQuestionLabels(questions, formData.dynamicAnswers);
    if (missing.length > 0) {
      setErrorMessage(`Please answer: ${missing.join(", ")}.`);
      return false;
    }
    return true;
  };

  const validateAgreements = () => {
    if (!formData.agreeToCoopValues || !formData.agreeToTerms || !formData.agreeToPrivacy) {
      setErrorMessage("Please accept the co-op values, terms, and privacy policy.");
      return false;
    }
    return true;
  };

  const goNext = () => {
    const currentStep = stepKeys[step];

    if (currentStep === "choose" && !selectedCoopId) {
      setErrorMessage("Choose the co-op you want to apply to.");
      return;
    }

    if (currentStep === "profile" && !validatePersonalInfo()) return;
    if (currentStep === "questions" && !validateQuestions()) return;

    setErrorMessage("");
    setStep((current) => Math.min(current + 1, stepKeys.length - 1));
  };

  const goBack = () => {
    setErrorMessage("");
    setStep((current) => Math.max(current - 1, 0));
  };

  const handleSubmit = async () => {
    if (!selectedCoopId) {
      setErrorMessage("Choose the co-op you want to apply to.");
      setStep(0);
      return;
    }

    if (!validatePersonalInfo()) {
      setStep(lockedCoopId ? 0 : 1);
      return;
    }

    if (!validateQuestions()) {
      setStep(lockedCoopId ? 1 : 2);
      return;
    }

    if (!validateAgreements()) return;

    try {
      const result = await submitApplication.mutateAsync(
        buildApplicationSubmissionInput(selectedCoopId, formData),
      );

      try {
        const applicantEmail = formData.email.trim().toLowerCase();
        const applicantName = `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim();
        const properties = {
          user_id: result.userId,
          email: applicantEmail,
          name: applicantName,
          coop_id: selectedCoopId,
          coop_name: selectedCoop?.name,
          application_id: result.applicationId,
          application_status: "SUBMITTED",
          user_type: "applicant",
          signup_type: "application",
        };

        posthog.identify(result.userId, properties);
        posthog.capture("application_submitted", properties);
      } catch (posthogError) {
        console.error("PostHog applicant identification error:", posthogError);
      }

      setApplicationReference(result.applicationId);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    }
  };

  if (applicationReference) {
    return (
      <div className="overflow-hidden rounded-lg border border-emerald-900/20 bg-white text-[#111111] shadow-xl">
        <div className="border-b border-emerald-900/10 bg-emerald-50 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-2xl font-black">Application submitted</h3>
              <p className="mt-1 text-sm text-emerald-900/70">
                Your application is ready for community review.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-lg border border-[#111111]/10 bg-[#f59e0b]/15 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-[#111111]/60">
              Application Reference
            </p>
            <p className="mt-2 break-all text-xl font-black">#{applicationReference}</p>
            <p className="mt-2 text-sm leading-6 text-[#111111]/65">
              Keep this reference for your records. This page will be ready for another application shortly.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {["Community review", "Possible interview", "Approval notice"].map((item) => (
              <div key={item} className="rounded-lg border border-[#111111]/10 p-3">
                <Check className="h-4 w-4 text-emerald-700" />
                <p className="mt-2 text-sm font-bold">{item}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-sm font-semibold text-[#111111]/60">
            This form will reset automatically so another person can apply from this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#111111]/10 bg-white text-[#111111] shadow-xl">
      <div className="border-b border-[#111111]/10 bg-[#111111] p-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-[#facc15]">
              Member application
            </p>
            <h3 className="mt-2 text-2xl font-black">
              {lockedCoopId ? `Apply to ${selectedCoop?.name ?? "this co-op"}` : "Apply to a live co-op"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {lockedCoopId
                ? "Answer the member questions and submit directly to the review queue."
                : "Pick your community, answer its member questions, and submit for review from the website."}
            </p>
          </div>
          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#f59e0b] text-[#111111] sm:flex">
            <Users className="h-6 w-6" />
          </div>
        </div>

        <div className={cn("mt-6 grid gap-2", lockedCoopId ? "grid-cols-3" : "grid-cols-4")}>
          {stepKeys.map((stepKey, index) => (
            <div key={stepKey} className="min-w-0">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  index <= step ? "bg-[#f59e0b]" : "bg-white/15",
                )}
              />
              <p className="mt-2 truncate text-[11px] font-bold uppercase tracking-wider text-slate-300">
                {stepLabelByKey[stepKey]}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-6">
        {errorMessage && (
          <div className="mb-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-6">{errorMessage}</p>
          </div>
        )}

        {stepKeys[step] === "choose" && (
          <CoopSelectionStep
            coops={coops}
            isLoading={coopsQuery.isLoading}
            selectedCoopId={selectedCoopId}
            onSelect={(coopId) => {
              setSelectedCoopId(coopId);
              setErrorMessage("");
              setFormData((current) => ({ ...current, dynamicAnswers: {} }));
            }}
          />
        )}

        {stepKeys[step] === "profile" && (
          <PersonalInfoStep
            formData={formData}
            showPassword={showPassword}
            showConfirmPassword={showConfirmPassword}
            onTogglePassword={() => setShowPassword((current) => !current)}
            onToggleConfirmPassword={() => setShowConfirmPassword((current) => !current)}
            onChange={updateField}
          />
        )}

        {stepKeys[step] === "questions" && (
          <QuestionsStep
            coopName={selectedCoop?.name}
            questions={questions}
            isLoading={questionsQuery.isLoading}
            answers={formData.dynamicAnswers}
            onChange={updateDynamicAnswer}
          />
        )}

        {stepKeys[step] === "submit" && (
          <ReviewStep
            selectedCoop={selectedCoop}
            formData={formData}
            questions={questions}
            onChange={updateField}
          />
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={step === 0 || submitApplication.isPending}
            className="text-[#111111] hover:bg-[#111111]/5"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {step < stepKeys.length - 1 ? (
            <Button
              type="button"
              onClick={goNext}
              disabled={coopsQuery.isLoading || questionsQuery.isLoading}
              className="bg-[#111111] text-white hover:bg-[#252525]"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitApplication.isPending}
              className="bg-[#111111] text-white hover:bg-[#252525]"
            >
              {submitApplication.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting
                </>
              ) : (
                <>
                  Submit application
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CoopSelectionStep({
  coops,
  isLoading,
  selectedCoopId,
  onSelect,
}: {
  coops: CoopOption[];
  isLoading: boolean;
  selectedCoopId: string;
  onSelect: (coopId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-[#111111]/10 bg-[#111111]/[0.03]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[#111111]/70">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading available co-ops
        </div>
      </div>
    );
  }

  if (coops.length === 0) {
    return (
      <div className="rounded-lg border border-[#111111]/10 bg-[#111111]/[0.03] p-5">
        <h4 className="text-lg font-black">No live applications yet</h4>
        <p className="mt-2 text-sm leading-6 text-[#111111]/65">
          Join the waitlist below and tell us which co-op you want to create or join.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-lg font-black">Choose your co-op</h4>
      <p className="mt-2 text-sm leading-6 text-[#111111]/65">
        Each co-op can ask its own application questions, so start with the community that fits you best.
      </p>
      <div className="mt-5 grid gap-3">
        {coops.map((coop) => {
          const selected = selectedCoopId === coop.id;
          return (
            <button
              key={coop.id}
              type="button"
              onClick={() => onSelect(coop.id)}
              className={cn(
                "w-full rounded-lg border p-4 text-left transition",
                selected
                  ? "border-[#111111] bg-[#111111] text-white"
                  : "border-[#111111]/10 bg-white hover:border-[#111111]/30 hover:bg-[#111111]/[0.03]",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-black">{coop.name}</p>
                  <p className={cn("mt-1 text-sm", selected ? "text-slate-300" : "text-[#111111]/65")}>
                    {coop.tagline}
                  </p>
                </div>
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-[#f59e0b] bg-[#f59e0b] text-[#111111]" : "border-[#111111]/20",
                  )}
                >
                  {selected && <Check className="h-4 w-4" />}
                </div>
              </div>
              <p className={cn("mt-3 text-xs leading-5", selected ? "text-slate-300" : "text-[#111111]/55")}>
                {coop.description}
              </p>
              {selected && (
                <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-white/[0.06] p-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-[#facc15]">Eligibility</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">{coop.eligibility}</p>
                  </div>
                  {coop.features.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {coop.features.slice(0, 4).map((feature) => (
                        <div key={feature.title} className="rounded-lg bg-black/15 p-2">
                          <p className="text-xs font-black text-white">{feature.title}</p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-300">{feature.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PersonalInfoStep({
  formData,
  showPassword,
  showConfirmPassword,
  onTogglePassword,
  onToggleConfirmPassword,
  onChange,
}: {
  formData: MemberApplicationFormData;
  showPassword: boolean;
  showConfirmPassword: boolean;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
  onChange: <K extends keyof MemberApplicationFormData>(
    field: K,
    value: MemberApplicationFormData[K],
  ) => void;
}) {
  return (
    <div>
      <h4 className="text-lg font-black">Your profile</h4>
      <p className="mt-2 text-sm leading-6 text-[#111111]/65">
        This creates the pending member account attached to your application.
      </p>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" id="firstName">
            <Input
              id="firstName"
              value={formData.firstName}
              onChange={(event) => onChange("firstName", event.target.value)}
              className="border-[#111111]/15 bg-white"
              placeholder="Marcus"
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name" id="lastName">
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(event) => onChange("lastName", event.target.value)}
              className="border-[#111111]/15 bg-white"
              placeholder="Johnson"
              autoComplete="family-name"
            />
          </Field>
        </div>

        <Field label="Email" id="applicationEmail">
          <Input
            id="applicationEmail"
            type="email"
            value={formData.email}
            onChange={(event) => onChange("email", event.target.value)}
            className="border-[#111111]/15 bg-white"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>

        <Field label="Phone number" id="applicationPhone">
          <Input
            id="applicationPhone"
            type="tel"
            value={formData.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            className="border-[#111111]/15 bg-white"
            placeholder="(555) 123-4567"
            autoComplete="tel"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <PasswordField
            id="applicationPassword"
            label="Password"
            value={formData.password}
            show={showPassword}
            onToggle={onTogglePassword}
            onChange={(value) => onChange("password", value)}
          />
          <PasswordField
            id="applicationConfirmPassword"
            label="Confirm password"
            value={formData.confirmPassword}
            show={showConfirmPassword}
            onToggle={onToggleConfirmPassword}
            onChange={(value) => onChange("confirmPassword", value)}
          />
        </div>
      </div>
    </div>
  );
}

function QuestionsStep({
  coopName,
  questions,
  isLoading,
  answers,
  onChange,
}: {
  coopName?: string;
  questions: ApplicationQuestion[];
  isLoading: boolean;
  answers: MemberApplicationFormData["dynamicAnswers"];
  onChange: (questionId: string, value: ApplicationAnswer) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-[#111111]/10 bg-[#111111]/[0.03]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[#111111]/70">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading application questions
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-lg font-black">{coopName ? `${coopName} questions` : "Application questions"}</h4>
      <p className="mt-2 text-sm leading-6 text-[#111111]/65">
        These questions are configured by the individual co-op.
      </p>

      {questions.length === 0 ? (
        <div className="mt-5 rounded-lg border border-[#111111]/10 bg-[#111111]/[0.03] p-5">
          <p className="text-sm leading-6 text-[#111111]/70">
            This co-op does not have extra questions right now.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {questions.map((question) => (
            <DynamicQuestion
              key={question.id}
              question={question}
              value={answers[question.id]}
              onChange={(value) => onChange(question.id, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewStep({
  selectedCoop,
  formData,
  questions,
  onChange,
}: {
  selectedCoop?: CoopOption;
  formData: MemberApplicationFormData;
  questions: ApplicationQuestion[];
  onChange: <K extends keyof MemberApplicationFormData>(
    field: K,
    value: MemberApplicationFormData[K],
  ) => void;
}) {
  const answeredCount = questions.filter((question) => !isBlank(formData.dynamicAnswers[question.id])).length;

  return (
    <div>
      <h4 className="text-lg font-black">Review and submit</h4>
      <p className="mt-2 text-sm leading-6 text-[#111111]/65">
        Your application will be sent to the co-op review queue.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Co-op" value={selectedCoop?.name ?? "Selected"} />
        <SummaryTile label="Applicant" value={`${formData.firstName} ${formData.lastName}`.trim()} />
        <SummaryTile label="Questions" value={`${answeredCount}/${questions.length}`} />
      </div>

      <div className="mt-5 space-y-3 rounded-lg border border-[#111111]/10 p-4">
        <AgreementCheckbox
          id="agreeToCoopValues"
          checked={formData.agreeToCoopValues}
          onCheckedChange={(checked) => onChange("agreeToCoopValues", checked)}
          label="I align with this co-op's values and mission"
        />
        <AgreementCheckbox
          id="agreeToTerms"
          checked={formData.agreeToTerms}
          onCheckedChange={(checked) => onChange("agreeToTerms", checked)}
          label="I agree to the Terms of Service and Community Charter"
        />
        <AgreementCheckbox
          id="agreeToPrivacy"
          checked={formData.agreeToPrivacy}
          onCheckedChange={(checked) => onChange("agreeToPrivacy", checked)}
          label="I agree to the Privacy Policy"
        />
      </div>

      <div className="mt-5 flex gap-3 rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#92400e]" />
        <p className="text-sm leading-6 text-[#111111]/70">
          After submission, you will receive a real application reference from the same backend used by the mobile app.
        </p>
      </div>
    </div>
  );
}

function DynamicQuestion({
  question,
  value,
  onChange,
}: {
  question: ApplicationQuestion;
  value?: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const selectedValues = Array.isArray(value) ? value : [];
  const isTextLike =
    question.type === "text" ||
    question.type === "email" ||
    question.type === "phone" ||
    !["textarea", "radio", "select", "multiselect"].includes(question.type);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-black text-[#111111]" htmlFor={`question-${question.id}`}>
        {question.label}
        {question.required && <span className="text-red-700"> *</span>}
      </Label>
      {question.description && (
        <p className="text-sm leading-6 text-[#111111]/60">{question.description}</p>
      )}

      {question.type === "textarea" && (
        <Textarea
          id={`question-${question.id}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder ?? ""}
          className="min-h-28 border-[#111111]/15 bg-white"
        />
      )}

      {isTextLike && (
        <Input
          id={`question-${question.id}`}
          type={question.type === "email" ? "email" : question.type === "phone" ? "tel" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder ?? ""}
          className="border-[#111111]/15 bg-white"
        />
      )}

      {question.type === "radio" && (
        <RadioGroup
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
          className="grid gap-2 sm:grid-cols-2"
        >
          {question.options?.map((option) => (
            <Label
              key={option.value}
              htmlFor={`question-${question.id}-${option.value}`}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#111111]/10 p-3 text-sm font-semibold hover:bg-[#111111]/[0.03]"
            >
              <RadioGroupItem id={`question-${question.id}-${option.value}`} value={option.value} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
      )}

      {question.type === "select" && (
        <select
          id={`question-${question.id}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-md border border-[#111111]/15 bg-white px-3 py-2 text-sm text-[#111111] outline-none focus:ring-2 focus:ring-[#111111]/30"
        >
          <option value="">Select an option</option>
          {question.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {question.type === "multiselect" && (
        <div className="grid gap-2">
          {question.options?.map((option) => {
            const checked = selectedValues.includes(option.value);
            return (
              <Label
                key={option.value}
                htmlFor={`question-${question.id}-${option.value}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#111111]/10 p-3 text-sm font-semibold hover:bg-[#111111]/[0.03]"
              >
                <Checkbox
                  id={`question-${question.id}-${option.value}`}
                  checked={checked}
                  onCheckedChange={(nextChecked) => {
                    if (nextChecked === true) {
                      onChange([...selectedValues, option.value]);
                    } else {
                      onChange(selectedValues.filter((selected) => selected !== option.value));
                    }
                  }}
                />
                {option.label}
              </Label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="font-black text-[#111111]">
        {label}
      </Label>
      {children}
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  show,
  onToggle,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  show: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="border-[#111111]/15 bg-white pr-11"
          placeholder={label}
          autoComplete={id.includes("Confirm") ? "new-password" : "new-password"}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#111111]/60 hover:bg-[#111111]/5 hover:text-[#111111]"
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#111111]/10 bg-[#111111]/[0.03] p-3">
      <p className="text-xs font-black uppercase tracking-widest text-[#111111]/50">{label}</p>
      <p className="mt-1 truncate text-sm font-black">{value || "Not provided"}</p>
    </div>
  );
}

function AgreementCheckbox({
  id,
  checked,
  onCheckedChange,
  label,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm font-semibold leading-6">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
        className="mt-1"
      />
      <span>{label}</span>
    </Label>
  );
}
