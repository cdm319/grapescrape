import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../../src/ui/src/api/apiClient";
import {
  pollAssessmentUntilComplete,
  type AssessmentPollingResult,
  type ManualWine,
  type PublicAssessment,
} from "../../../src/ui/src/api/manualWineApi";
import { ManualWinesPage } from "../../../src/ui/src/pages/ManualWinesPage";

const sourceKey = "manual:ffbd54ef-0c8e-49c7-a98e-e6703c08410e";

const assessment: PublicAssessment = {
  assessmentInputKey: "assessment-key",
  sourceKey,
  assessmentVersion: 3,
  palateProfileVersion: 4,
  fit: "good",
  confidence: "medium_high",
  highlight: false,
  headline: "Ripe and polished",
  summary: "A likely match.",
  completedAt: "2026-07-23T11:00:00.000Z",
};

const manualWine: ManualWine = {
  id: "ffbd54ef-0c8e-49c7-a98e-e6703c08410e",
  sourceKey,
  name: "Cellar Example",
  vintage: "NV",
  description: "Rich red fruit with soft tannins.",
  status: "active",
  createdAt: "2026-07-23T10:00:00.000Z",
  updatedAt: "2026-07-23T10:00:00.000Z",
  deletedAt: null,
  latestAssessment: null,
  freshness: {
    status: "unassessed",
    isCurrent: false,
    profileChanged: false,
    sourceChanged: false,
    assessedPalateProfileVersion: null,
    currentPalateProfileVersion: 4,
  },
};

function envelope<T>(data: T, nextCursor: string | null = null) {
  return {
    data,
    meta: {
      requestId: "request-1",
      nextCursor,
    },
  };
}

function apiClient(
  implementation: (
    path: string,
    options?: RequestInit,
  ) => Promise<unknown>,
) {
  const request = vi.fn(implementation);

  return {
    client: { request: request as ApiClient["request"] },
    request,
  };
}

function renderPage(
  client: ApiClient,
  pollAssessment?: typeof pollAssessmentUntilComplete,
) {
  return render(
    <MemoryRouter>
      <ManualWinesPage
        apiClient={client}
        pollAssessment={pollAssessment}
      />
    </MemoryRouter>,
  );
}

function listResponse(items: ManualWine[]) {
  return envelope({ items });
}

function enterDraft() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Cellar Example" },
  });
  fireEvent.change(screen.getByLabelText("Vintage"), {
    target: { value: "NV" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Rich red fruit with soft tannins." },
  });
}

describe("manual-wine management", () => {
  it("preserves all form fields when the API reports a duplicate identity", async () => {
    const { client } = apiClient(async (path, options) => {
      if (path.startsWith("/v1/manual-wines?")) {
        return listResponse([]);
      }
      if (path === "/v1/manual-wines" && options?.method === "POST") {
        throw new ApiError({
          status: 409,
          code: "MANUAL_WINE_ALREADY_EXISTS",
          message: "A manual wine with this name and vintage already exists.",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage(client);
    await screen.findByRole("heading", { name: "No active manual wines" });
    enterDraft();
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));

    expect(
      await screen.findByText(
        /already have a manual wine with this name and vintage/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Cellar Example");
    expect(screen.getByLabelText("Vintage")).toHaveValue("NV");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Rich red fruit with soft tannins.",
    );
  });

  it("rejects a non-canonical vintage without sending the form", async () => {
    const { client, request } = apiClient(async (path) => {
      if (path.startsWith("/v1/manual-wines?")) {
        return listResponse([]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage(client);
    await screen.findByRole("heading", { name: "No active manual wines" });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Cellar Example" },
    });
    fireEvent.change(screen.getByLabelText("Vintage"), {
      target: { value: "nv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));

    expect(
      await screen.findByText(/uppercase NV/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Vintage")).toHaveValue("nv");
    expect(
      request.mock.calls.some(
        ([path, options]) =>
          path === "/v1/manual-wines" &&
          (options as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("keeps a created wine and offers assessment retry when enqueue fails", async () => {
    const { client, request } = apiClient(async (path, options) => {
      if (path.startsWith("/v1/manual-wines?")) {
        return listResponse([]);
      }
      if (path === "/v1/manual-wines" && options?.method === "POST") {
        return envelope(manualWine);
      }
      if (path === "/v1/assessment-requests") {
        throw new ApiError({
          status: 503,
          code: "ASSESSMENT_QUEUE_UNAVAILABLE",
          message: "The assessment was not queued.",
          details: {
            queued: [],
            notQueued: [{
              sourceKey,
              assessmentVersion: 3,
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage(client);
    await screen.findByRole("heading", { name: "No active manual wines" });
    enterDraft();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Save and request assessment",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: /Cellar Example NV/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry assessment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/is saved, but its assessment was not queued/i),
    ).toBeInTheDocument();

    const createCall = request.mock.calls.find(
      ([path, options]) =>
        path === "/v1/manual-wines" &&
        (options as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toEqual({
      name: "Cellar Example",
      vintage: "NV",
      description: "Rich red fruit with soft tannins.",
    });
    expect(
      JSON.parse(
        (request.mock.calls.find(
          ([path]) => path === "/v1/assessment-requests",
        )?.[1] as RequestInit).body as string,
      ),
    ).toEqual({ sourceKeys: [sourceKey] });
  });

  it("shows queued and completed states before refetching the active wine", async () => {
    let listCalls = 0;
    let pollArguments:
      | Parameters<typeof pollAssessmentUntilComplete>[0]
      | undefined;
    let completePolling:
      | ((result: AssessmentPollingResult) => void)
      | undefined;
    const pollAssessment = vi.fn(
      (arguments_: Parameters<typeof pollAssessmentUntilComplete>[0]) => {
        pollArguments = arguments_;
        return new Promise<AssessmentPollingResult>((resolve) => {
          completePolling = resolve;
        });
      },
    );
    const { client, request } = apiClient(async (path, options) => {
      if (path.startsWith("/v1/manual-wines?")) {
        listCalls += 1;
        return listResponse([
          listCalls === 1
            ? manualWine
            : {
                ...manualWine,
                latestAssessment: assessment,
                freshness: {
                  ...manualWine.freshness,
                  status: "current",
                  isCurrent: true,
                  assessedPalateProfileVersion: 4,
                },
              },
        ]);
      }
      if (
        path === "/v1/assessment-requests" &&
        options?.method === "POST"
      ) {
        return envelope({
          requests: [{
            sourceKey,
            requestId: "assessment-request-1",
            assessmentVersion: 3,
          }],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage(
      client,
      pollAssessment as typeof pollAssessmentUntilComplete,
    );
    await screen.findByRole("heading", { name: /Cellar Example NV/i });
    fireEvent.click(
      screen.getByRole("button", { name: "Request assessment" }),
    );

    expect(
      await screen.findByText(/Queued for assessment/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Queued" }),
    ).toBeDisabled();

    act(() => {
      pollArguments?.onStatus("processing");
    });
    expect(
      await screen.findByText(/Waiting for the completed assessment/i),
    ).toBeInTheDocument();

    await act(async () => {
      completePolling?.({ status: "completed", assessment });
    });

    expect(
      await screen.findByText(/Assessment complete/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View it in History" }),
    ).toHaveAttribute("href", "/history");
    await waitFor(() => expect(listCalls).toBe(2));
    expect(
      request.mock.calls.filter(([path]) =>
        String(path).startsWith("/v1/manual-wines?"),
      ),
    ).toHaveLength(2);
  });

  it("offers reassessment for an assessed active wine", async () => {
    const assessedWine: ManualWine = {
      ...manualWine,
      latestAssessment: assessment,
      freshness: {
        ...manualWine.freshness,
        status: "current",
        isCurrent: true,
        assessedPalateProfileVersion: 4,
      },
    };
    const pollAssessment = vi.fn().mockResolvedValue({
      status: "cancelled",
    } satisfies AssessmentPollingResult);
    const { client, request } = apiClient(async (path, options) => {
      if (path.startsWith("/v1/manual-wines?")) {
        return listResponse([assessedWine]);
      }
      if (
        path === "/v1/assessment-requests" &&
        options?.method === "POST"
      ) {
        return envelope({
          requests: [{
            sourceKey,
            requestId: "assessment-request-2",
            assessmentVersion: 4,
          }],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage(
      client,
      pollAssessment as typeof pollAssessmentUntilComplete,
    );
    await screen.findByRole("button", { name: "Reassess" });
    fireEvent.click(screen.getByRole("button", { name: "Reassess" }));

    await waitFor(() => expect(pollAssessment).toHaveBeenCalledOnce());
    expect(
      JSON.parse(
        (request.mock.calls.find(
          ([path]) => path === "/v1/assessment-requests",
        )?.[1] as RequestInit).body as string,
      ),
    ).toEqual({ sourceKeys: [sourceKey] });
  });

  it("locks identity and sends only description when editing", async () => {
    const { client, request } = apiClient(async (path, options) => {
      if (path.startsWith("/v1/manual-wines?")) {
        return listResponse([manualWine]);
      }
      if (
        path === `/v1/manual-wines/${manualWine.id}` &&
        options?.method === "PATCH"
      ) {
        return envelope({
          ...manualWine,
          description: "Updated cellar note.",
          updatedAt: "2026-07-23T12:00:00.000Z",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage(client);
    await screen.findByRole("heading", { name: /Cellar Example NV/i });
    fireEvent.click(
      screen.getByRole("button", { name: "Edit description" }),
    );

    const drawer = await screen.findByRole("dialog", {
      name: "Edit manual wine",
    });
    expect(within(drawer).getByText(/Cellar Example/)).toBeInTheDocument();
    expect(within(drawer).getByText("NV")).toBeInTheDocument();
    expect(within(drawer).queryByLabelText("Name")).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText("Vintage")).not.toBeInTheDocument();

    fireEvent.change(within(drawer).getByLabelText("Description"), {
      target: { value: "Updated cellar note." },
    });
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Save description" }),
    );

    await waitFor(() => {
      const card = screen
        .getByRole("heading", { name: /Cellar Example NV/i })
        .closest("article");
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText("Updated cellar note."))
        .toBeInTheDocument();
    });
    const patchCall = request.mock.calls.find(
      ([path, options]) =>
        path === `/v1/manual-wines/${manualWine.id}` &&
        (options as RequestInit | undefined)?.method === "PATCH",
    );
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({
      description: "Updated cellar note.",
    });
  });

  it("confirms deletion, removes the active wine and preserves History messaging", async () => {
    const deletedWine: ManualWine = {
      ...manualWine,
      id: "85f5ffb2-5029-4e4a-b13d-105dd4fe6ad9",
      sourceKey: "manual:85f5ffb2-5029-4e4a-b13d-105dd4fe6ad9",
      name: "Already Deleted",
      status: "deleted",
      deletedAt: "2026-07-23T11:00:00.000Z",
    };
    const { client, request } = apiClient(async (path, options) => {
      if (path.startsWith("/v1/manual-wines?")) {
        return listResponse([manualWine, deletedWine]);
      }
      if (
        path === `/v1/manual-wines/${manualWine.id}` &&
        options?.method === "DELETE"
      ) {
        return envelope({
          id: manualWine.id,
          sourceKey,
          status: "deleted",
          deletedAt: "2026-07-23T12:00:00.000Z",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage(client);
    await screen.findByRole("heading", { name: /Cellar Example NV/i });
    expect(screen.queryByText("Already Deleted")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete wine" }));

    const confirmation = await screen.findByRole("dialog", {
      name: "Delete Cellar Example?",
    });
    expect(
      within(confirmation).getByText(/completed assessments stay in History/i),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Delete wine" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /Cellar Example NV/i }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText(/removed from active manual wines/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open History" }),
    ).toHaveAttribute("href", "/history");
    expect(
      screen.queryByRole("button", { name: "Request assessment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit description" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete wine" }),
    ).not.toBeInTheDocument();
    expect(
      request.mock.calls.some(
        ([path, options]) =>
          path === `/v1/manual-wines/${manualWine.id}` &&
          (options as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(true);
  });
});

describe("assessment completion polling", () => {
  it("polls the exact allocated version after two-second waits until completed", async () => {
    const statuses: string[] = [];
    const wait = vi.fn().mockResolvedValue(undefined);
    let pollCalls = 0;
    const { client, request } = apiClient(async (path) => {
      pollCalls += 1;

      if (pollCalls === 1) {
        throw new ApiError({
          status: 404,
          code: "ASSESSMENT_NOT_FOUND",
          message: "The assessment was not found.",
        });
      }

      return envelope(assessment);
    });

    await expect(
      pollAssessmentUntilComplete({
        apiClient: client,
        request: {
          sourceKey,
          requestId: "assessment-request-1",
          assessmentVersion: 3,
        },
        wait,
        onStatus: (status) => statuses.push(status),
      }),
    ).resolves.toEqual({ status: "completed", assessment });

    expect(wait).toHaveBeenNthCalledWith(1, 2_000);
    expect(wait).toHaveBeenNthCalledWith(2, 2_000);
    expect(statuses).toEqual(["processing", "completed"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(
      `/v1/assessed-wines/${encodeURIComponent(
        sourceKey,
      )}/assessments/3`,
    );
  });
});
