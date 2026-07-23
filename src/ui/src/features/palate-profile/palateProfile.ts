export const STYLE_PREFERENCE_VALUES = {
  body: ["light", "medium_minus", "medium", "medium_plus", "full"],
  fruitRipeness: ["underripe", "fresh", "ripe", "very_ripe", "jammy"],
  fruitCharacter: [
    "red_fruit",
    "black_fruit",
    "dark_fruit",
    "blackcurrant",
    "blackberry",
    "plum",
    "black_cherry",
    "red_cherry",
    "dried_fruit",
    "cranberry",
  ],
  texture: [
    "supple",
    "silky",
    "velvety",
    "plush",
    "fleshy",
    "generous",
    "polished",
    "firm",
    "lean",
    "austere",
    "thin",
  ],
  oakInfluence: ["none_detected", "subtle", "moderate", "pronounced"],
  tannin: ["low", "moderate", "moderate_plus", "high", "firm_or_drying"],
  acidity: ["low", "balanced", "fresh", "high", "sharp"],
  development: ["youthful", "ready_to_drink", "developing", "mature"],
  styleTags: [
    "fruit_forward",
    "classic",
    "modern",
    "traditional",
    "opulent",
    "approachable",
    "structured",
    "rustic",
    "elegant",
    "spicy",
    "earthy",
    "savoury",
    "unoaked",
    "oak_influenced",
    "chillable",
    "food_wine",
    "polished",
  ],
} as const;

export type StylePreferenceKey = keyof typeof STYLE_PREFERENCE_VALUES;
export type StylePreferenceValue =
  (typeof STYLE_PREFERENCE_VALUES)[StylePreferenceKey][number];
export type WineExampleSentiment = "enjoyed" | "not_enjoyed";

export interface PreferenceSelection {
  preferred: StylePreferenceValue[];
  avoided: StylePreferenceValue[];
}

export type StylePreferences = Record<
  StylePreferenceKey,
  PreferenceSelection
>;

export interface WineExample {
  id: string;
  name: string;
  vintage: string;
  sentiment: WineExampleSentiment;
  notes: string;
}

export interface PalateProfileDraft {
  stylePreferences: StylePreferences;
  wineExamples: WineExample[];
}

export interface PalateProfile extends PalateProfileDraft {
  palateProfileVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExampleDraftValues {
  name: string;
  vintage: string;
  notes: string;
}

export interface ExampleDraftErrors {
  name?: string;
  vintage?: string;
  notes?: string;
  form?: string;
}

export const STYLE_PREFERENCE_DETAILS: Record<
  StylePreferenceKey,
  { label: string; description: string }
> = {
  body: {
    label: "Body",
    description: "How light or full-bodied you prefer a wine to feel.",
  },
  fruitRipeness: {
    label: "Fruit ripeness",
    description: "The ripeness and sweetness impression you enjoy in fruit.",
  },
  fruitCharacter: {
    label: "Fruit character",
    description: "The fruit families you seek out or tend to avoid.",
  },
  texture: {
    label: "Texture",
    description: "How you like a wine to feel across the palate.",
  },
  oakInfluence: {
    label: "Oak influence",
    description: "How evident you prefer oak character to be.",
  },
  tannin: {
    label: "Tannin",
    description: "The amount and feel of tannin that suits you.",
  },
  acidity: {
    label: "Acidity",
    description: "The level and character of freshness you prefer.",
  },
  development: {
    label: "Development",
    description: "Whether you gravitate towards youthful or evolved wines.",
  },
  styleTags: {
    label: "Style",
    description: "Broader styles that help describe your taste.",
  },
};

export const STYLE_PREFERENCE_KEYS = Object.keys(
  STYLE_PREFERENCE_VALUES,
) as StylePreferenceKey[];

export function createEmptyPalateProfileDraft(): PalateProfileDraft {
  return {
    stylePreferences: {
      body: { preferred: [], avoided: [] },
      fruitRipeness: { preferred: [], avoided: [] },
      fruitCharacter: { preferred: [], avoided: [] },
      texture: { preferred: [], avoided: [] },
      oakInfluence: { preferred: [], avoided: [] },
      tannin: { preferred: [], avoided: [] },
      acidity: { preferred: [], avoided: [] },
      development: { preferred: [], avoided: [] },
      styleTags: { preferred: [], avoided: [] },
    },
    wineExamples: [],
  };
}

export function profileToDraft(profile: PalateProfile): PalateProfileDraft {
  return structuredClone({
    stylePreferences: profile.stylePreferences,
    wineExamples: profile.wineExamples,
  });
}

export function preferenceValueLabel(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function formatProfileDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function characterLength(value: string): number {
  return Array.from(value).length;
}

export function validateExampleDraft({
  values,
  sentiment,
  wineExamples,
}: {
  values: ExampleDraftValues;
  sentiment: WineExampleSentiment;
  wineExamples: WineExample[];
}): ExampleDraftErrors {
  const errors: ExampleDraftErrors = {};
  const name = values.name.trim();
  const vintage = values.vintage.trim();

  if (characterLength(name) < 1 || characterLength(name) > 120) {
    errors.name = "Enter a wine name between 1 and 120 characters.";
  }

  if (!/^(?:[12]\d{3}|NV)$/.test(vintage)) {
    errors.vintage = "Use a year from 1000 to 2999, or uppercase NV.";
  }

  if (characterLength(values.notes) > 400) {
    errors.notes = "Keep notes to 400 characters or fewer.";
  }

  if (wineExamples.filter((example) => example.sentiment === sentiment).length >= 20) {
    errors.form = "This section has reached its 20-wine limit.";
  }

  if (errors.name || errors.vintage || errors.notes || errors.form) {
    return errors;
  }

  const identity = wineIdentity(name, vintage);
  const duplicate = wineExamples.find(
    (example) => wineIdentity(example.name, example.vintage) === identity,
  );

  if (duplicate) {
    errors.form =
      duplicate.sentiment === sentiment
        ? `This wine and vintage is already in ${sentimentLabel(sentiment)}.`
        : `This wine and vintage already appears in ${sentimentLabel(
            duplicate.sentiment,
          )}. Remove it there before adding it here.`;
  }

  return errors;
}

function wineIdentity(name: string, vintage: string): string {
  return `${name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase()}\u0000${vintage}`;
}

function sentimentLabel(sentiment: WineExampleSentiment): string {
  return sentiment === "enjoyed"
    ? "Wines I enjoyed"
    : "Wines I did not enjoy";
}
