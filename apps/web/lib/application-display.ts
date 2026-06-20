const RESERVED_APPLICATION_DATA_KEYS = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "password",
  "confirmPassword",
  "coopId",
  "videoCID",
  "photoCID",
  "agreeToCoopValues",
  "agreeToTerms",
  "agreeToPrivacy",
  "dynamicAnswers",
  "identity",
  "agreeToMission",
  "spendingCategories",
  "monthlyCommitment",
  "useUC",
  "acceptFees",
  "voteOnInvestments",
  "coopExperience",
  "transparentTransactions",
  "motivation",
  "desiredService",
]);

export type ApplicationAnswerEntry = [string, unknown];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBlankApplicationAnswer(value: unknown) {
  if (Array.isArray(value)) return value.length === 0;
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

export function getApplicationAnswerEntries(data: unknown): ApplicationAnswerEntry[] {
  if (!isRecord(data)) return [];

  const answers = new Map<string, unknown>();

  for (const [key, value] of Object.entries(data)) {
    if (!RESERVED_APPLICATION_DATA_KEYS.has(key) && !isBlankApplicationAnswer(value)) {
      answers.set(key, value);
    }
  }

  if (isRecord(data.dynamicAnswers)) {
    for (const [key, value] of Object.entries(data.dynamicAnswers)) {
      if (!isBlankApplicationAnswer(value)) {
        answers.set(key, value);
      }
    }
  }

  return Array.from(answers.entries());
}

export function formatApplicationAnswer(value: unknown) {
  if (Array.isArray(value)) return value.map(formatApplicationAnswer).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  if (typeof value === "symbol") return value.description ?? value.toString();
  if (typeof value === "function") return "[function]";
  return JSON.stringify(value);
}
