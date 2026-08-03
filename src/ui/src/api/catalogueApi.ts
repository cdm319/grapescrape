import { ApiError, type ApiClient } from "./apiClient";
import type {
  Assessment,
  AssessmentFreshness,
  Confidence,
  Fit,
  FreshnessStatus,
} from "./assessmentHistory";
import type { AssessmentRequest } from "./manualWineApi";

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
  currentPrice: {
    amount: string;
    currency: "GBP";
  };
  firstSeenAt: string;
  lastSeenAt: string;
  latestAssessment: Assessment | null;
  freshness: AssessmentFreshness;
}

export interface CatalogueFilters {
  q?: string;
  retailerId?: string;
  region?: string;
  grape?: string;
  minPrice?: string;
  maxPrice?: string;
  fit?: Fit;
  confidence?: Confidence;
  highlight?: "true" | "false";
  freshness?: FreshnessStatus;
  sort: "first_seen" | "price" | "name" | "fit";
  direction: "asc" | "desc";
}

export interface CataloguePage {
  items: CatalogueWine[];
  nextCursor: string | null;
}

export interface NotQueuedAssessment {
  sourceKey: string;
  assessmentVersion: number;
}

export interface AssessmentRequestBatchResult {
  queued: AssessmentRequest[];
  notQueued: NotQueuedAssessment[];
}

export async function listCatalogueWines(
  apiClient: ApiClient,
  filters: CatalogueFilters,
  cursor?: string,
): Promise<CataloguePage> {
  const query = new URLSearchParams({
    sort: filters.sort,
    direction: filters.direction,
    limit: "25",
  });

  for (const [name, value] of Object.entries(filters)) {
    if (name !== "sort" && name !== "direction" && value) {
      query.set(name, value);
    }
  }

  if (cursor) {
    query.set("cursor", cursor);
  }

  const response = await apiClient.request<{ items: CatalogueWine[] }>(
    `/v1/catalogue/wines?${query.toString()}`,
  );

  return {
    items: response.data.items,
    nextCursor: response.meta.nextCursor ?? null,
  };
}

export async function requestCatalogueAssessments(
  apiClient: ApiClient,
  sourceKeys: string[],
): Promise<AssessmentRequestBatchResult> {
  try {
    const response = await apiClient.request<{ requests: AssessmentRequest[] }>(
      "/v1/assessment-requests",
      {
        method: "POST",
        body: JSON.stringify({ sourceKeys }),
      },
    );
    const result = {
      queued: response.data.requests,
      notQueued: [],
    };

    if (!isCompleteBatchResult(result, sourceKeys)) {
      throw invalidAssessmentResponse(response.meta.requestId);
    }

    return result;
  } catch (error) {
    const partialResult = assessmentQueueResultFromError(error);

    if (partialResult) {
      if (!isCompleteBatchResult(partialResult, sourceKeys)) {
        throw invalidAssessmentResponse(
          error instanceof ApiError ? error.requestId : undefined,
        );
      }
      return partialResult;
    }

    throw error;
  }
}

export function assessmentQueueResultFromError(
  error: unknown,
): AssessmentRequestBatchResult | null {
  if (
    !(error instanceof ApiError) ||
    error.status !== 503 ||
    error.code !== "ASSESSMENT_QUEUE_UNAVAILABLE" ||
    !error.details ||
    Array.isArray(error.details)
  ) {
    return null;
  }

  const queued = Reflect.get(error.details, "queued");
  const notQueued = Reflect.get(error.details, "notQueued");

  if (!Array.isArray(queued) || !Array.isArray(notQueued)) {
    return null;
  }

  if (!queued.every(isAssessmentRequest) || !notQueued.every(isNotQueued)) {
    return null;
  }

  return { queued, notQueued };
}

function isAssessmentRequest(value: unknown): value is AssessmentRequest {
  return (
    !!value &&
    typeof value === "object" &&
    typeof Reflect.get(value, "sourceKey") === "string" &&
    typeof Reflect.get(value, "requestId") === "string" &&
    Number.isInteger(Reflect.get(value, "assessmentVersion")) &&
    Number(Reflect.get(value, "assessmentVersion")) > 0
  );
}

function isNotQueued(value: unknown): value is NotQueuedAssessment {
  return (
    !!value &&
    typeof value === "object" &&
    typeof Reflect.get(value, "sourceKey") === "string" &&
    Number.isInteger(Reflect.get(value, "assessmentVersion")) &&
    Number(Reflect.get(value, "assessmentVersion")) > 0
  );
}

function isCompleteBatchResult(
  result: AssessmentRequestBatchResult,
  sourceKeys: string[],
): boolean {
  if (
    !Array.isArray(result.queued) ||
    !Array.isArray(result.notQueued) ||
    !result.queued.every(isAssessmentRequest) ||
    !result.notQueued.every(isNotQueued)
  ) {
    return false;
  }

  const returnedSourceKeys = [
    ...result.queued.map((request) => request.sourceKey),
    ...result.notQueued.map((request) => request.sourceKey),
  ];

  return (
    returnedSourceKeys.length === sourceKeys.length &&
    new Set(returnedSourceKeys).size === sourceKeys.length &&
    sourceKeys.every((sourceKey) => returnedSourceKeys.includes(sourceKey))
  );
}

function invalidAssessmentResponse(requestId?: string): ApiError {
  return new ApiError({
    status: 200,
    code: "INVALID_RESPONSE",
    message: "The assessment request response was incomplete.",
    requestId,
  });
}
