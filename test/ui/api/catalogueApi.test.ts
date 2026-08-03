import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../../src/ui/src/api/apiClient";
import {
  listCatalogueWines,
  requestCatalogueAssessments,
} from "../../../src/ui/src/api/catalogueApi";

function client(
  implementation: (path: string, options?: RequestInit) => Promise<unknown>,
) {
  const request = vi.fn(implementation);
  return {
    apiClient: { request: request as ApiClient["request"] },
    request,
  };
}

describe("catalogue API client", () => {
  it("passes supported filters, sorting and an opaque cursor unchanged", async () => {
    const { apiClient, request } = client(async () => ({
      data: { items: [] },
      meta: { requestId: "request-1", nextCursor: "next-cursor" },
    }));

    const page = await listCatalogueWines(
      apiClient,
      {
        q: "Barolo 2019",
        retailerId: "tws",
        region: "Piedmont",
        grape: "Nebbiolo",
        minPrice: "20.00",
        maxPrice: "50.50",
        fit: "strong",
        confidence: "medium_high",
        highlight: "true",
        freshness: "palate_profile_changed",
        sort: "first_seen",
        direction: "desc",
      },
      "opaque+cursor/value",
    );

    const requestedPath = request.mock.calls[0][0] as string;
    const query = new URL(
      requestedPath,
      "https://api.grapescrape.test",
    ).searchParams;

    expect(query.get("q")).toBe("Barolo 2019");
    expect(query.get("retailerId")).toBe("tws");
    expect(query.get("region")).toBe("Piedmont");
    expect(query.get("grape")).toBe("Nebbiolo");
    expect(query.get("minPrice")).toBe("20.00");
    expect(query.get("maxPrice")).toBe("50.50");
    expect(query.get("fit")).toBe("strong");
    expect(query.get("confidence")).toBe("medium_high");
    expect(query.get("highlight")).toBe("true");
    expect(query.get("freshness")).toBe("palate_profile_changed");
    expect(query.get("sort")).toBe("first_seen");
    expect(query.get("direction")).toBe("desc");
    expect(query.get("limit")).toBe("25");
    expect(query.get("cursor")).toBe("opaque+cursor/value");
    expect(page.nextCursor).toBe("next-cursor");
  });

  it("returns accurate queued and not-queued tuples from CM-41 partial failures", async () => {
    const queued = {
      sourceKey: "retailer:tws:one",
      requestId: "request-one",
      assessmentVersion: 3,
    };
    const notQueued = {
      sourceKey: "retailer:tws:two",
      assessmentVersion: 4,
    };
    const { apiClient, request } = client(async () => {
      throw new ApiError({
        status: 503,
        code: "ASSESSMENT_QUEUE_UNAVAILABLE",
        message: "One or more assessment requests could not be queued.",
        details: { queued: [queued], notQueued: [notQueued] },
      });
    });

    await expect(
      requestCatalogueAssessments(apiClient, [queued.sourceKey, notQueued.sourceKey]),
    ).resolves.toEqual({ queued: [queued], notQueued: [notQueued] });
    expect(JSON.parse((request.mock.calls[0][1] as RequestInit).body as string))
      .toEqual({ sourceKeys: [queued.sourceKey, notQueued.sourceKey] });
  });

  it("does not reinterpret unrelated or malformed failures as partial success", async () => {
    const error = new ApiError({
      status: 503,
      code: "ASSESSMENT_QUEUE_UNAVAILABLE",
      message: "Queue unavailable.",
      details: { queued: [{ sourceKey: "retailer:tws:one" }], notQueued: [] },
    });
    const { apiClient } = client(async () => {
      throw error;
    });

    await expect(
      requestCatalogueAssessments(apiClient, ["retailer:tws:one"]),
    ).rejects.toBe(error);
  });

  it("rejects a success response that omits a requested wine", async () => {
    const { apiClient } = client(async () => ({
      data: {
        requests: [{
          sourceKey: "retailer:tws:one",
          requestId: "request-one",
          assessmentVersion: 3,
        }],
      },
      meta: { requestId: "api-request" },
    }));

    await expect(
      requestCatalogueAssessments(apiClient, [
        "retailer:tws:one",
        "retailer:tws:two",
      ]),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      requestId: "api-request",
    });
  });
});
