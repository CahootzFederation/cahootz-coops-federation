/**
 * Things a local business could sell a Commons at a better price, and how we
 * spot demand for them. Each deal category maps from the need themes Sage
 * already saves (sage-private-signals.ts THEMES) and from words members use in
 * public Need posts. Health and money needs are never mapped: they stay out of
 * outreach the same way they stay out of community patterns.
 */
export interface DealCategory {
  key: string;
  label: string;
  /** Need themes from sage-private-signals.ts that point at this category. */
  themes: string[];
  /** Whole words or phrases in a public Need post that point at this category. */
  keywords: string[];
  /** Store.category / Product.category keys a matching Cahootz shop might use (phase 3 matching). */
  storeCategories: string[];
  /** The fixed question Sage posts to the whole Commons. No counts, no quotes, no names. */
  question: { title: string; ask: string };
}

export const DEAL_CATEGORIES: DealCategory[] = [
  {
    key: "groceries",
    label: "groceries",
    themes: ["food_access"],
    keywords: ["grocery", "groceries", "food", "rice", "produce", "meat", "staples", "pantry", "cooking oil", "beans", "flour"],
    storeCategories: ["FOOD_BEVERAGE", "FOOD", "BEVERAGES"],
    question: {
      title: "A better price on groceries?",
      ask: "Would a group deal on groceries help your household? We're looking for local stores that would give this Commons a lower price on everyday staples like rice, cooking oil and produce.",
    },
  },
  {
    key: "baby_supplies",
    label: "baby supplies",
    themes: ["childcare_and_care"],
    keywords: ["diaper", "diapers", "formula", "baby wipes", "wipes", "baby supplies"],
    storeCategories: ["OTHER", "HEALTH"],
    question: {
      title: "A better price on baby supplies?",
      ask: "Would a group deal on diapers, wipes or formula help your family? We're looking for local shops that would give this Commons a lower price on baby supplies.",
    },
  },
  {
    key: "household_essentials",
    label: "household essentials",
    themes: ["shared_resources"],
    keywords: ["detergent", "toilet paper", "paper towels", "cleaning supplies", "soap", "household supplies"],
    storeCategories: ["HOME_GARDEN", "HOME_DECOR"],
    question: {
      title: "A better price on household basics?",
      ask: "Would a group deal on household basics like detergent, paper towels or cleaning supplies help? We're looking for local stores that would give this Commons a lower price.",
    },
  },
  {
    key: "auto_repair",
    label: "car repair",
    themes: ["transportation_access"],
    keywords: ["car repair", "mechanic", "oil change", "tires", "tire", "brakes", "auto repair"],
    storeCategories: ["AUTOMOTIVE"],
    question: {
      title: "A better price on car care?",
      ask: "Would a member price on oil changes, tires or repairs help keep you on the road? We're looking for local mechanics who would give this Commons a better rate.",
    },
  },
  {
    key: "phones_internet",
    label: "phones and internet",
    themes: ["digital_access"],
    keywords: ["phone", "phones", "internet", "wifi", "wi-fi", "laptop", "data plan", "phone repair"],
    storeCategories: ["TECH_ELECTRONICS", "ELECTRONICS"],
    question: {
      title: "A better price on phones and internet?",
      ask: "Would a group deal on phone repairs, devices or internet help your household? We're looking for local shops that would give this Commons a better price.",
    },
  },
  {
    key: "school_supplies",
    label: "school supplies",
    themes: ["learning_and_school"],
    keywords: ["school supplies", "backpack", "backpacks", "notebooks", "school uniform", "uniforms"],
    storeCategories: ["BOOKS_MEDIA", "BOOKS"],
    question: {
      title: "A better price on school supplies?",
      ask: "Would a group deal on backpacks, notebooks or uniforms help your family get ready for school? We're looking for local stores that would give this Commons a lower price.",
    },
  },
  {
    key: "home_repair",
    label: "home repairs",
    themes: ["housing_stability"],
    keywords: ["plumber", "plumbing", "electrician", "handyman", "home repair", "roof", "hvac"],
    storeCategories: ["SERVICES"],
    question: {
      title: "A better rate on home repairs?",
      ask: "Would a member rate from a trusted plumber, electrician or handyman help? We're looking for local pros who would give this Commons a better price.",
    },
  },
];

export const DEAL_QUESTION_CLOSING =
  "React 👍 if you'd buy, or reply with what you'd want most. If enough of us are in, we'll go look for a deal. Nobody pays anything unless a deal comes together and you choose to join.";

export function dealCategoryByKey(key: string | null | undefined): DealCategory | null {
  return DEAL_CATEGORIES.find((category) => category.key === key) ?? null;
}

export function dealCategoryForTheme(themeKey: string): DealCategory | null {
  return DEAL_CATEGORIES.find((category) => category.themes.includes(themeKey)) ?? null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYWORD_PATTERNS = DEAL_CATEGORIES.map((category) => ({
  key: category.key,
  pattern: new RegExp(`\\b(${category.keywords.map(escape).join("|")})\\b`, "i"),
}));

/** Deal categories a piece of member text points at (a post can match more than one). */
export function dealCategoriesInText(text: string): string[] {
  return KEYWORD_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ key }) => key);
}

export function dealQuestionText(categoryKey: string): { title: string; body: string } | null {
  const category = dealCategoryByKey(categoryKey);
  if (!category) return null;
  return { title: category.question.title, body: `${category.question.ask}\n\n${DEAL_QUESTION_CLOSING}` };
}
