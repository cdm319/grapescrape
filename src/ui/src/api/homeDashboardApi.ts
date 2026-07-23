import type { ApiClient } from "./apiClient";

export type Fit = "strong" | "good" | "maybe" | "poor";
export type Confidence = "high" | "medium_high" | "medium" | "low";
export type FreshnessStatus =
  | "current"
  | "palate_profile_changed"
  | "source_changed"
  | "palate_profile_and_source_changed"
  | "unassessed";

export interface AssessmentFreshness {
  status: FreshnessStatus;
  isCurrent: boolean;
  profileChanged: boolean;
  sourceChanged: boolean;
  assessedPalateProfileVersion: number | null;
  currentPalateProfileVersion: number | null;
}

export interface PublicAssessmentSummary {
  assessmentInputKey: string;
  sourceKey: string;
  assessmentVersion: number;
  palateProfileVersion: number;
  fit: Fit;
  confidence: Confidence;
  highlight: boolean;
  headline: string | null;
  summary: string | null;
  completedAt: string;
}

export interface CurrentPrice {
  amount: string;
  currency: "GBP";
}

export interface CatalogueWine {
  sourceKey: string;
  retailerId: string;
  retailerLabel: string;
  retailerWineId: string;
  name: string;
  vintage: string | number;
  region: string | null;
  grape: string | null;
  alcohol: string | null;
  description: string | null;
  currentPrice: CurrentPrice;
  firstSeenAt: string;
  lastSeenAt: string;
  latestAssessment: PublicAssessmentSummary | null;
  freshness: AssessmentFreshness;
}

type PreferenceGroup = {
  preferred: string[];
  avoided: string[];
};

export interface PalateProfile {
  palateProfileVersion: number;
  stylePreferences: {
    body: PreferenceGroup;
    fruitRipeness: PreferenceGroup;
    fruitCharacter: PreferenceGroup;
    texture: PreferenceGroup;
    oakInfluence: PreferenceGroup;
    tannin: PreferenceGroup;
    acidity: PreferenceGroup;
    development: PreferenceGroup;
    styleTags: PreferenceGroup;
  };
  wineExamples: Array<{
    id: string;
    name: string;
    vintage: string;
    sentiment: "enjoyed" | "not_enjoyed";
    notes: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface AssessedWine {
  sourceKey: string;
  sourceType: "retailer" | "manual";
  retailerId: string | null;
  retailerLabel: string | null;
  wine: {
    name: string | null;
    vintage: string | number | null;
    region: string | null;
    grape: string | null;
    alcohol: string | null;
    description: string | null;
    availability:
      | "current_retailer"
      | "removed_retailer"
      | "active_manual"
      | "deleted_manual";
    currentPrice: CurrentPrice | null;
  };
  latestAssessment: PublicAssessmentSummary;
  freshness: AssessmentFreshness;
  assessmentCount: number;
  lastAssessedAt: string;
}

interface ListData<T> {
  items: T[];
}

const fitRank: Record<Fit, number> = {
  strong: 4,
  good: 3,
  maybe: 2,
  poor: 1,
};

const confidenceRank: Record<Confidence, number> = {
  high: 4,
  medium_high: 3,
  medium: 2,
  low: 1,
};

export function rankRecommendations(wines: CatalogueWine[]) {
  return wines
    .filter((wine) => wine.latestAssessment?.highlight === true)
    .sort((left, right) => {
      const leftAssessment = left.latestAssessment;
      const rightAssessment = right.latestAssessment;

      if (!leftAssessment || !rightAssessment) {
        return left.sourceKey.localeCompare(right.sourceKey);
      }

      return (
        fitRank[rightAssessment.fit] - fitRank[leftAssessment.fit] ||
        confidenceRank[rightAssessment.confidence] -
          confidenceRank[leftAssessment.confidence] ||
        left.sourceKey.localeCompare(right.sourceKey)
      );
    })
    .slice(0, 3);
}

export async function getHomeRecommendations(apiClient: ApiClient) {
  const response = await apiClient.request<ListData<CatalogueWine>>(
    "/v1/catalogue/wines?highlight=true&sort=fit&direction=desc&limit=12",
  );

  return rankRecommendations(response.data.items);
}

export async function getRecentlyAddedWines(apiClient: ApiClient) {
  const response = await apiClient.request<ListData<CatalogueWine>>(
    "/v1/catalogue/wines?sort=first_seen&direction=desc&limit=4",
  );

  return response.data.items.slice().sort(
    (left, right) =>
      right.firstSeenAt.localeCompare(left.firstSeenAt) ||
      left.sourceKey.localeCompare(right.sourceKey),
  );
}

export async function getCurrentPalateProfile(apiClient: ApiClient) {
  const response = await apiClient.request<PalateProfile>(
    "/v1/palate-profile",
  );

  return response.data;
}

export async function getRecentAssessments(apiClient: ApiClient) {
  const response = await apiClient.request<ListData<AssessedWine>>(
    "/v1/assessed-wines?sort=last_assessed&direction=desc&limit=4",
  );

  return response.data.items;
}
