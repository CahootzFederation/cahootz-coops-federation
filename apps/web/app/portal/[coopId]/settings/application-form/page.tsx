"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { useWeb3Auth } from "@/hooks/use-web3-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, ShieldAlert, Plus, Trash2, GripVertical, Save } from "lucide-react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Question {
  id: string;
  type: string;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  validation?: Record<string, unknown>;
}

const QUESTION_TYPES = [
  { value: "text", label: "Short Text" },
  { value: "textarea", label: "Long Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-Select" },
  { value: "radio", label: "Radio Buttons" },
  { value: "checkbox", label: "Checkboxes" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
];

export default function ApplicationFormEditor() {
  const params = useParams();
  const coopId = params.coopId as string;
  const { isAdmin } = useWeb3Auth();

  const { data: questionsData, refetch, isLoading } = api.coopConfig.getApplicationQuestions.useQuery({ coopId });
  const updateQuestions = api.coopConfig.updateApplicationQuestions.useMutation({
    onSuccess: () => {
      refetch();
      setHasChanges(false);
    },
  });

  const [questions, setQuestions] = useState<Question[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (questionsData?.questions) {
      setQuestions(questionsData.questions);
    }
  }, [questionsData]);

  const addQuestion = () => {
    const newQuestion: Question = {
      id: `q_${Date.now()}`,
      type: "text",
      label: "",
      required: false,
    };
    setQuestions([...questions, newQuestion]);
    setHasChanges(true);
  };

  const updateQuestion = (index: number, updates: Partial<Question>) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], ...updates };
    setQuestions(updated);
    setHasChanges(true);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const moveQuestion = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= questions.length) return;
    
    const updated = [...questions];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setQuestions(updated);
    setHasChanges(true);
  };

  const addOption = (questionIndex: number) => {
    const updated = [...questions];
    const question = updated[questionIndex];
    if (!question.options) question.options = [];
    question.options.push({ value: `option_${Date.now()}`, label: "" });
    setQuestions(updated);
    setHasChanges(true);
  };

  const updateOption = (questionIndex: number, optionIndex: number, updates: Partial<{ value: string; label: string }>) => {
    const updated = [...questions];
    const question = updated[questionIndex];
    if (question.options) {
      question.options[optionIndex] = { ...question.options[optionIndex], ...updates };
      setQuestions(updated);
      setHasChanges(true);
    }
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    const updated = [...questions];
    const question = updated[questionIndex];
    if (question.options) {
      question.options = question.options.filter((_, i) => i !== optionIndex);
      setQuestions(updated);
      setHasChanges(true);
    }
  };

  const saveQuestions = async () => {
    await updateQuestions.mutateAsync({ coopId, questions });
  };

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <ShieldAlert className="h-12 w-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-bold">Admin Access Required</h2>
        <p className="text-muted-foreground">Only admins can manage application forms.</p>
        <Button asChild variant="outline">
          <Link href={`/portal/${coopId}/proposals/config`}>Back to Commons Config</Link>
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/portal/${coopId}/proposals/config`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Application Form Editor</h1>
            <p className="text-muted-foreground mt-1">
              Manage membership application questions
            </p>
          </div>
        </div>
        <Button
          onClick={saveQuestions}
          disabled={!hasChanges || updateQuestions.isPending}
        >
          {updateQuestions.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>

      {hasChanges && (
        <Card className="border-amber-500 bg-amber-500/10">
          <CardContent className="pt-6">
            <p className="text-sm text-amber-200">
              You have unsaved changes. Click "Save Changes" to update the application form.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Application Questions</CardTitle>
          <CardDescription>
            Define the questions asked during membership application. Changes take effect immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {questions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No questions configured yet.</p>
              <Button onClick={addQuestion} variant="outline" className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Add First Question
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((question, index) => (
                <Card key={question.id} className="border-muted">
                  <CardContent className="pt-6 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col gap-2 pt-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 cursor-move"
                          disabled
                        >
                          <GripVertical className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => moveQuestion(index, "up")}
                          disabled={index === 0}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => moveQuestion(index, "down")}
                          disabled={index === questions.length - 1}
                        >
                          ↓
                        </Button>
                      </div>

                      <div className="flex-1 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Question Type</Label>
                            <Select
                              value={question.type}
                              onValueChange={(value) => updateQuestion(index, { type: value })}
                            >
                              <SelectTrigger className="bg-background text-foreground">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-background text-foreground">
                                {QUESTION_TYPES.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-end gap-2">
                            <div className="flex items-center space-x-2">
                              <Switch
                                id={`required-${question.id}`}
                                checked={question.required}
                                onCheckedChange={(checked) => updateQuestion(index, { required: checked })}
                              />
                              <Label htmlFor={`required-${question.id}`}>Required</Label>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>Question Label</Label>
                          <Input
                            value={question.label}
                            onChange={(e) => updateQuestion(index, { label: e.target.value })}
                            placeholder="e.g., What is your occupation?"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Description (optional)</Label>
                          <Textarea
                            value={question.description || ""}
                            onChange={(e) => updateQuestion(index, { description: e.target.value })}
                            placeholder="Additional context or instructions"
                            rows={2}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Placeholder (optional)</Label>
                          <Input
                            value={question.placeholder || ""}
                            onChange={(e) => updateQuestion(index, { placeholder: e.target.value })}
                            placeholder="e.g., Enter your answer here"
                          />
                        </div>

                        {(question.type === "select" || question.type === "multiselect" || question.type === "radio" || question.type === "checkbox") && (
                          <div className="space-y-2">
                            <Label>Options</Label>
                            <div className="space-y-2">
                              {question.options?.map((option, optionIndex) => (
                                <div key={optionIndex} className="flex gap-2">
                                  <Input
                                    value={option.value}
                                    onChange={(e) => updateOption(index, optionIndex, { value: e.target.value })}
                                    placeholder="Value"
                                    className="flex-1"
                                  />
                                  <Input
                                    value={option.label}
                                    onChange={(e) => updateOption(index, optionIndex, { label: e.target.value })}
                                    placeholder="Label"
                                    className="flex-1"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeOption(index, optionIndex)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => addOption(index)}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Option
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQuestion(index)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Button onClick={addQuestion} variant="outline" className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Question
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
