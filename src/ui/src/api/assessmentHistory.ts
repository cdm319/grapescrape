import type { ApiClient } from "./apiClient";

export type Fit = "strong" | "good" | "maybe" | "poor";
export type Confidence = "high" | "medium_high" | "medium" | "low";
export type SourceType = "retailer" | "manual";
export type Availability =
  | "current_retailer"
  | "removed_retailer"
  | "active_manual"
  | "deleted_manual";
export type FreshnessStatus =
  | "current"
  | "palate_profile_changed"
  | "source_changed"
  | "palate_profile_and_source_changed"
  | "unassessed";

export interface AssessmentEvidence {
  type: "direct" | "inferred";
  source: string;
  text: string;
}

export interface Assessment {
  assessmentInputKey: string;
  sourceKey: string;
  assessmentVersion: number;
  palateProfileVersion: number;
  fit: Fit;
  confidence: Confidence;
  highlight: boolean;
  headline: string | null;
  summary: string | null;
  reasoningMode: string;
  reasons: string[];
  cautions: string[];
  evidence: AssessmentEvidence[];
  assumptions: string[];
  completedAt: string;
}

export interface AssessmentFreshness {
  status: FreshnessStatus;
  isCurrent: boolean;
  profileChanged: boolean;
  sourceChanged: boolean;
  assessedPalateProfileVersion: number | null;
  currentPalateProfileVersion: number | null;
}

export interface AssessedWine {
  sourceKey: string;
  sourceType: SourceType;
  retailerId: string | null;
  retailerLabel: string | null;
  wine: {
    name: string | null;
    vintage: string | null;
    region: string | null;
    grape: string | null;
    alcohol: string | null;
    description: string | null;
    availability: Availability;
    currentPrice: {
      amount: string;
      currency: "GBP";
    } | null;
  };
  latestAssessment: Assessment;
  freshness: AssessmentFreshness;
  assessmentCount: number;
  lastAssessedAt: string;
}

export interface AssessedWineFilters {
  q?: string;
  sourceType?: SourceType;
  availability?: string;
  fit?: Fit;
  confidence?: Confidence;
  highlight?: "true" | "false";
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export async function listAssessedWines(
  apiClient: ApiClient,
  filters: AssessedWineFilters,
  cursor?: string,
): Promise<CursorPage<AssessedWine>> {
  const query = new URLSearchParams({
    sort: "last_assessed",
    direction: "desc",
    limit: "12",
  });

  for (const [name, value] of Object.entries(filters)) {
    if (value) {
      query.set(name, value);
    }
  }

  if (cursor) {
    query.set("cursor", cursor);
  }

  const response = await apiClient.request<{ items: AssessedWine[] }>(
    `/v1/assessed-wines?${query.toString()}`,
  );

  return {
    items: response.data.items,
    nextCursor: response.meta.nextCursor ?? null,
  };
}

export async function getAssessedWine(
  apiClient: ApiClient,
  sourceKey: string,
): Promise<AssessedWine> {
  const response = await apiClient.request<AssessedWine>(
    `/v1/assessed-wines/${encodeURIComponent(sourceKey)}`,
  );

  return response.data;
}

export async function listAssessments(
  apiClient: ApiClient,
  sourceKey: string,
  cursor?: string,
): Promise<CursorPage<Assessment>> {
  const query = new URLSearchParams({ limit: "10" });

  if (cursor) {
    query.set("cursor", cursor);
  }

  const response = await apiClient.request<{ items: Assessment[] }>(
    `/v1/assessed-wines/${encodeURIComponent(sourceKey)}/assessments?${query.toString()}`,
  );

  return {
    items: response.data.items,
    nextCursor: response.meta.nextCursor ?? null,
  };
}
