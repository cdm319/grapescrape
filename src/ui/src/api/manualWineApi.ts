import { ApiError, type ApiClient } from "./apiClient";

export interface AssessmentFreshness {
  status:
    | "current"
    | "palate_profile_changed"
    | "source_changed"
    | "palate_profile_and_source_changed"
    | "unassessed";
  isCurrent: boolean;
  profileChanged: boolean;
  sourceChanged: boolean;
  assessedPalateProfileVersion: number | null;
  currentPalateProfileVersion: number | null;
}

export interface PublicAssessment {
  assessmentInputKey: string;
  sourceKey: string;
  assessmentVersion: number;
  palateProfileVersion: number;
  fit: "strong" | "good" | "maybe" | "poor";
  confidence: "high" | "medium_high" | "medium" | "low";
  highlight: boolean;
  headline: string | null;
  summary: string | null;
  completedAt: string;
}

export interface ManualWine {
  id: string;
  sourceKey: string;
  name: string;
  vintage: string;
  description: string;
  status: "active" | "deleted";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  latestAssessment: PublicAssessment | null;
  freshness: AssessmentFreshness;
}

export interface AssessmentRequest {
  sourceKey: string;
  requestId: string;
  assessmentVersion: number;
}

interface ManualWineList {
  items: ManualWine[];
}

interface AssessmentRequestList {
  requests: AssessmentRequest[];
}

export async function listActiveManualWines(
  apiClient: ApiClient,
): Promise<ManualWine[]> {
  const wines: ManualWine[] = [];
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({
      sort: "updated",
      direction: "desc",
      limit: "100",
    });

    if (cursor) {
      query.set("cursor", cursor);
    }

    const response = await apiClient.request<ManualWineList>(
      `/v1/manual-wines?${query.toString()}`,
    );
    wines.push(
      ...response.data.items.filter((wine) => wine.status === "active"),
    );
    cursor = response.meta.nextCursor ?? null;
  } while (cursor);

  return wines;
}

export async function createManualWine(
  apiClient: ApiClient,
  input: {
    name: string;
    vintage: string;
    description: string;
  },
): Promise<ManualWine> {
  const response = await apiClient.request<ManualWine>("/v1/manual-wines", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return response.data;
}

export async function updateManualWineDescription(
  apiClient: ApiClient,
  manualWineId: string,
  description: string,
): Promise<ManualWine> {
  const response = await apiClient.request<ManualWine>(
    `/v1/manual-wines/${encodeURIComponent(manualWineId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ description }),
    },
  );

  return response.data;
}

export async function deleteManualWine(
  apiClient: ApiClient,
  manualWineId: string,
): Promise<void> {
  await apiClient.request(
    `/v1/manual-wines/${encodeURIComponent(manualWineId)}`,
    { method: "DELETE" },
  );
}

export async function requestAssessment(
  apiClient: ApiClient,
  sourceKey: string,
): Promise<AssessmentRequest> {
  const response = await apiClient.request<AssessmentRequestList>(
    "/v1/assessment-requests",
    {
      method: "POST",
      body: JSON.stringify({ sourceKeys: [sourceKey] }),
    },
  );
  const request = response.data.requests.find(
    (item) => item.sourceKey === sourceKey,
  );

  if (!request) {
    throw new ApiError({
      status: 200,
      code: "INVALID_RESPONSE",
      message: "The assessment request response was incomplete.",
      requestId: response.meta.requestId,
    });
  }

  return request;
}

export type AssessmentPollingStatus = "processing" | "completed";

export type AssessmentPollingResult =
  | { status: "completed"; assessment: PublicAssessment }
  | { status: "timed_out" }
  | { status: "cancelled" };

const waitFor = (delayMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

export async function pollAssessmentUntilComplete({
  apiClient,
  request,
  onStatus,
  wait = waitFor,
  shouldContinue = () => true,
}: {
  apiClient: ApiClient;
  request: AssessmentRequest;
  onStatus: (status: AssessmentPollingStatus) => void;
  wait?: (delayMs: number) => Promise<void>;
  shouldContinue?: () => boolean;
}): Promise<AssessmentPollingResult> {
  let nextDelayMs = 2_000;
  let elapsedMs = 0;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!shouldContinue() || elapsedMs + nextDelayMs > 60_000) {
      break;
    }

    await wait(nextDelayMs);
    elapsedMs += nextDelayMs;

    if (!shouldContinue()) {
      return { status: "cancelled" };
    }

    try {
      const response = await apiClient.request<PublicAssessment>(
        `/v1/assessed-wines/${encodeURIComponent(
          request.sourceKey,
        )}/assessments/${request.assessmentVersion}`,
      );
      onStatus("completed");
      return {
        status: "completed",
        assessment: response.data,
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 404 &&
        error.code === "ASSESSMENT_NOT_FOUND"
      ) {
        onStatus("processing");
        nextDelayMs = 2_000;
        continue;
      }

      if (isRetryablePollingError(error)) {
        onStatus("processing");
        nextDelayMs = Math.min(nextDelayMs * 2, 10_000);
        continue;
      }

      throw error;
    }
  }

  return shouldContinue()
    ? { status: "timed_out" }
    : { status: "cancelled" };
}

export function queuedRequestFromError(
  error: unknown,
  sourceKey: string,
): AssessmentRequest | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== "ASSESSMENT_QUEUE_UNAVAILABLE" ||
    !error.details ||
    Array.isArray(error.details)
  ) {
    return null;
  }

  const queued = Reflect.get(error.details, "queued");

  if (!Array.isArray(queued)) {
    return null;
  }

  const request = queued.find(
    (item) =>
      item &&
      typeof item === "object" &&
      Reflect.get(item, "sourceKey") === sourceKey &&
      typeof Reflect.get(item, "requestId") === "string" &&
      Number.isInteger(Reflect.get(item, "assessmentVersion")),
  );

  return (request as AssessmentRequest | undefined) ?? null;
}

function isRetryablePollingError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}
