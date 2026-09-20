export interface StarterGoal {
  label: string;
  description?: string;
}

export function isPlaceholderCharter(text: string, coopId?: string): boolean {
  const value = text.trim().toLowerCase();
  if (!value || value === "this charter is intentionally empty for now.") return true;
  if (coopId && value === `${coopId.toLowerCase()} co-op charter`) return true;
  if (value === "the sf nightlife coop charter - empowering nightlife workers through collective support.") return true;
  if (value === "the unity coop (cahootz) charter - building cooperative technology infrastructure.") return true;
  return /^(draft placeholder|demo charter|cahootz co-op charter)$/.test(value);
}

export function starterCharter(name: string, goals: StarterGoal[], mission?: string | null): string {
  const lines = [
    `# ${name} Starter Charter`,
    "Status: Platform-generated purpose statement. Members may replace this through the Commons' charter process.",
    "",
    `## Purpose`,
    mission?.trim() || `${name} exists to pursue the goals listed below through cooperative action.`,
    "",
    "## Stated goals",
    ...goals.filter((goal) => goal.label.trim()).map((goal) => `- ${goal.label.trim()}${goal.description?.trim() ? `: ${goal.description.trim()}` : ""}`),
    "",
    "This starter charter states purpose and goals only. It does not establish voting, financial, membership, or disciplinary rules.",
  ];
  return lines.join("\n");
}
