import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../../src/ui/src/api/apiClient";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("API client", () => {
  it("adds the access token and returns a valid success envelope", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { subject: "token-derived-subject" },
        meta: { requestId: "request-1" },
      }),
    );
    const client = createApiClient({
      baseUrl: "https://api.grapescrape.com",
      getAccessToken: () => "access-token",
      onUnauthenticated: vi.fn(),
      fetcher,
    });

    await expect(client.request("/v1/auth/session")).resolves.toEqual({
      data: { subject: "token-derived-subject" },
      meta: { requestId: "request-1" },
    });

    const [, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("preserves safe API error details and request correlation", async () => {
    const client = createApiClient({
      baseUrl: "https://api.grapescrape.com",
      getAccessToken: () => "access-token",
      onUnauthenticated: vi.fn(),
      fetcher: vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "The request did not pass validation.",
              details: [{ field: "name", reason: "is required" }],
            },
            meta: { requestId: "request-2" },
          },
          400,
        ),
      ),
    });

    await expect(client.request("/v1/example")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "request-2",
      details: [{ field: "name", reason: "is required" }],
    });
  });

  it("normalises the HTTP API authorizer response to UNAUTHENTICATED", async () => {
    const onUnauthenticated = vi.fn();
    const client = createApiClient({
      baseUrl: "https://api.grapescrape.com",
      getAccessToken: () => "expired-token",
      onUnauthenticated,
      fetcher: vi
        .fn()
        .mockResolvedValue(jsonResponse({ message: "Unauthorized" }, 401)),
    });

    await expect(client.request("/v1/auth/session")).rejects.toEqual(
      expect.objectContaining({
        status: 401,
        code: "UNAUTHENTICATED",
      }),
    );
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("does not send a request when no access token is available", async () => {
    const fetcher = vi.fn();
    const onUnauthenticated = vi.fn();
    const client = createApiClient({
      baseUrl: "https://api.grapescrape.com",
      getAccessToken: () => null,
      onUnauthenticated,
      fetcher,
    });

    await expect(client.request("/v1/auth/session")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });
});
