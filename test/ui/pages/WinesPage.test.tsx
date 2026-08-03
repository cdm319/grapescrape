import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../../src/ui/src/api/apiClient";
import type { CatalogueWine } from "../../../src/ui/src/api/catalogueApi";
import type {
  AssessmentPollingResult,
  PublicAssessment,
} from "../../../src/ui/src/api/manualWineApi";
import { WinesPage } from "../../../src/ui/src/pages/WinesPage";

const sourceOne = "retailer:tws:wine:one";
const sourceTwo = "retailer:tws:two";

function wine({
  sourceKey = sourceOne,
  name = "Barolo Classico",
  vintage = 2019,
  assessed = true,
  freshness = "palate_profile_changed",
}: {
  sourceKey?: string;
  name?: string;
  vintage?: string | number;
  assessed?: boolean;
  freshness?: CatalogueWine["freshness"]["status"];
} = {}): CatalogueWine {
  return {
    sourceKey,
    retailerId: "tws",
    retailerLabel: "The Wine Society",
    retailerWineId: sourceKey.split(":").at(-1) ?? "wine",
    name,
    vintage,
    region: "Piedmont",
    grape: "Nebbiolo",
    alcohol: "14%",
    description: "Rose, tar and ripe red fruit with firm structure.",
    currentPrice: { amount: "24.50", currency: "GBP" },
    firstSeenAt: "2026-07-20T10:00:00.000Z",
    lastSeenAt: "2026-08-03T10:00:00.000Z",
    latestAssessment: assessed
      ? {
          assessmentInputKey: "not-presented",
          sourceKey,
          assessmentVersion: 3,
          palateProfileVersion: 2,
          fit: "good",
          confidence: "medium_high",
          highlight: true,
          headline: "Structured and savoury",
          summary: "A good fit despite the older palate profile.",
          reasoningMode: "metadata_plus_description",
          reasons: ["The savoury structure aligns with your palate."],
          cautions: ["The tannin may be firm."],
          evidence: [],
          assumptions: [],
          completedAt: "2026-07-21T10:00:00.000Z",
        }
      : null,
    freshness: {
      status: assessed ? freshness : "unassessed",
      isCurrent: assessed && freshness === "current",
      profileChanged:
        assessed &&
        (freshness === "palate_profile_changed" ||
          freshness === "palate_profile_and_source_changed"),
      sourceChanged:
        assessed &&
        (freshness === "source_changed" ||
          freshness === "palate_profile_and_source_changed"),
      assessedPalateProfileVersion: assessed ? 2 : null,
      currentPalateProfileVersion: 4,
    },
  };
}

function envelope<T>(data: T, nextCursor: string | null = null) {
  return {
    data,
    meta: { requestId: "api-request", nextCursor },
  };
}

function client(
  implementation: (path: string, options?: RequestInit) => Promise<unknown>,
) {
  const request = vi.fn(implementation);
  return {
    apiClient: { request: request as ApiClient["request"] },
    request,
  };
}

function renderPage({
  apiClient,
  pollAssessment,
  initialEntry = "/wines",
}: {
  apiClient: ApiClient;
  pollAssessment?: NonNullable<Parameters<typeof WinesPage>[0]["pollAssessment"]>;
  initialEntry?: string;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <WinesPage apiClient={apiClient} pollAssessment={pollAssessment} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("current-stock catalogue", () => {
  it("shows current price and canonical fit independently from stale freshness", async () => {
    const unassessed = wine({
      sourceKey: sourceTwo,
      name: "Unassessed Cuvée",
      assessed: false,
    });
    const { apiClient } = client(async () => envelope({ items: [wine(), unassessed] }));

    renderPage({ apiClient });

    expect(await screen.findAllByText("Barolo Classico")).not.toHaveLength(0);
    expect(screen.getAllByText("£24.50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Good fit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Medium-high confidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Palate profile changed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unassessed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No assessment yet").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.88")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    const drawer = await screen.findByRole("dialog", { name: "Barolo Classico" });
    expect(within(drawer).getByText(/Rose, tar and ripe red fruit/)).toBeInTheDocument();
    expect(within(drawer).getByText("Structured and savoury")).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "View assessment history →" }))
      .toHaveAttribute("href", `/history/${encodeURIComponent(sourceOne)}`);
  });

  it("traps focus in the mobile filter sheet and restores the trigger on close", async () => {
    const { apiClient } = client(async () => envelope({ items: [] }));

    renderPage({ apiClient });
    await screen.findByRole("heading", { name: "No wines match those filters" });
    const trigger = screen.getByRole("button", { name: "Filters" });
    trigger.focus();
    fireEvent.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: "Catalogue filters" });
    await waitFor(() => expect(sheet).toHaveFocus());
    const firstControl = within(sheet).getByRole("button", { name: "Close filters" });
    const lastControl = within(sheet).getByRole("button", { name: "Clear all" });

    fireEvent.keyDown(sheet, { key: "Tab" });
    expect(firstControl).toHaveFocus();
    lastControl.focus();
    fireEvent.keyDown(lastControl, { key: "Tab" });
    expect(firstControl).toHaveFocus();
    firstControl.focus();
    fireEvent.keyDown(firstControl, { key: "Tab", shiftKey: true });
    expect(lastControl).toHaveFocus();

    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Catalogue filters" }))
        .not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("applies supported identity, price, fit and freshness filters and sorting", async () => {
    const { apiClient, request } = client(async () => envelope({ items: [] }));

    renderPage({ apiClient });
    await screen.findByRole("heading", { name: "No wines match those filters" });

    fireEvent.change(screen.getByLabelText("Search name or vintage"), {
      target: { value: "Barolo 2019" },
    });
    fireEvent.change(screen.getByLabelText("Retailer"), { target: { value: "tws" } });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "Piedmont" } });
    fireEvent.change(screen.getByLabelText("Grape"), { target: { value: "Nebbiolo" } });
    fireEvent.change(screen.getByLabelText("Minimum price"), { target: { value: "20.00" } });
    fireEvent.change(screen.getByLabelText("Maximum price"), { target: { value: "50.00" } });
    fireEvent.change(screen.getByLabelText("Fit"), { target: { value: "good" } });
    fireEvent.change(screen.getByLabelText("Confidence"), { target: { value: "medium_high" } });
    fireEvent.change(screen.getByLabelText("Highlight"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("Freshness"), {
      target: { value: "palate_profile_changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "first_seen:desc" },
    });

    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThanOrEqual(2));
    const lastPath = request.mock.calls.at(-1)?.[0] as string;
    const query = new URL(lastPath, "https://api.grapescrape.test").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      q: "Barolo 2019",
      retailerId: "tws",
      region: "Piedmont",
      grape: "Nebbiolo",
      minPrice: "20.00",
      maxPrice: "50.00",
      fit: "good",
      confidence: "medium_high",
      highlight: "true",
      freshness: "palate_profile_changed",
      sort: "first_seen",
      direction: "desc",
    });
  });

  it("preserves hidden selections and allows review instead of silently clearing them", async () => {
    let listCalls = 0;
    const visibleAfterFiltering = wine({
      sourceKey: sourceTwo,
      name: "Rioja Reserva",
      vintage: "NV",
    });
    const { apiClient } = client(async (path) => {
      if (path.startsWith("/v1/catalogue/wines?")) {
        listCalls += 1;
        return envelope({
          items: listCalls === 1 ? [wine(), visibleAfterFiltering] : [visibleAfterFiltering],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage({ apiClient });
    await screen.findAllByText("Barolo Classico");
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "Bordeaux" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(await screen.findByText(/1 not currently visible/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select all visible wines"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review selection" }));
    const review = await screen.findByRole("dialog", { name: "Review selected wines" });
    expect(within(review).getByText(/Barolo Classico 2019/)).toBeInTheDocument();
    expect(within(review).queryByText(/Rioja Reserva/)).not.toBeInTheDocument();
  });

  it("confirms the exact OpenAI count and reports per-wine partial queue failure", async () => {
    const secondWine = wine({ sourceKey: sourceTwo, name: "Rioja Reserva", vintage: "NV" });
    const pollAssessment = vi.fn().mockResolvedValue({
      status: "cancelled",
    } satisfies AssessmentPollingResult);
    const { apiClient, request } = client(async (path, options) => {
      if (path.startsWith("/v1/catalogue/wines?")) {
        return envelope({ items: [wine(), secondWine] });
      }
      if (path === "/v1/assessment-requests" && options?.method === "POST") {
        throw new ApiError({
          status: 503,
          code: "ASSESSMENT_QUEUE_UNAVAILABLE",
          message: "One or more requests were not queued.",
          details: {
            queued: [{ sourceKey: sourceOne, requestId: "request-one", assessmentVersion: 4 }],
            notQueued: [{ sourceKey: sourceTwo, assessmentVersion: 5 }],
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage({ apiClient, pollAssessment });
    await screen.findAllByText("Barolo Classico");
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    fireEvent.click(screen.getByRole("button", { name: "Reassess selected (2)" }));
    const confirmation = await screen.findByRole("dialog", {
      name: "Reassess selected wines?",
    });
    expect(within(confirmation).getByText(/exactly/)).toHaveTextContent(
      "This will request exactly 2 OpenAI assessments.",
    );
    fireEvent.click(within(confirmation).getByRole("button", { name: "Request 2 assessments" }));

    expect(await screen.findByText("1 of 2 assessments queued.")).toBeInTheDocument();
    expect(screen.getByText(/Not queued: Rioja Reserva/)).toBeInTheDocument();
    await waitFor(() => expect(pollAssessment).toHaveBeenCalledOnce());
    expect(pollAssessment.mock.calls[0][0].request).toEqual({
      sourceKey: sourceOne,
      requestId: "request-one",
      assessmentVersion: 4,
    });
    const postCall = request.mock.calls.find(([path]) => path === "/v1/assessment-requests");
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({
      sourceKeys: [sourceOne, sourceTwo],
    });
  });

  it("prevents a duplicate submission while an assessment request is in flight", async () => {
    let completeRequest:
      | ((value: ReturnType<typeof envelope>) => void)
      | undefined;
    const { apiClient, request } = client(async (path, options) => {
      if (path.startsWith("/v1/catalogue/wines?")) {
        return envelope({ items: [wine()] });
      }
      if (path === "/v1/assessment-requests" && options?.method === "POST") {
        return new Promise((resolve) => {
          completeRequest = resolve;
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage({
      apiClient,
      pollAssessment: vi.fn().mockResolvedValue({ status: "cancelled" }),
    });
    await screen.findAllByText("Barolo Classico");
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    const drawer = await screen.findByRole("dialog", { name: "Barolo Classico" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Reassess" }));
    const confirmation = await screen.findByRole("dialog", { name: "Request assessment?" });
    const submit = within(confirmation).getByRole("button", { name: "Request 1 assessment" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(
      request.mock.calls.filter(([path]) => path === "/v1/assessment-requests"),
    ).toHaveLength(1);

    await act(async () => {
      completeRequest?.(envelope({
        requests: [{ sourceKey: sourceOne, requestId: "request-one", assessmentVersion: 4 }],
      }));
    });
  });

  it("refreshes the catalogue as soon as an exact assessment version completes", async () => {
    let listCalls = 0;
    const completedAssessment: PublicAssessment = {
      assessmentInputKey: "completed",
      sourceKey: sourceOne,
      assessmentVersion: 4,
      palateProfileVersion: 4,
      fit: "strong",
      confidence: "high",
      highlight: true,
      headline: "Now a strong fit",
      summary: "Fresh result.",
      completedAt: "2026-08-03T12:00:00.000Z",
    };
    const pollAssessment = vi.fn().mockResolvedValue({
      status: "completed",
      assessment: completedAssessment,
    } satisfies AssessmentPollingResult);
    const refreshedWine = wine({ freshness: "current" });
    refreshedWine.latestAssessment = {
      ...refreshedWine.latestAssessment!,
      ...completedAssessment,
    };
    const { apiClient } = client(async (path, options) => {
      if (path.startsWith("/v1/catalogue/wines?")) {
        listCalls += 1;
        return envelope({ items: [listCalls === 1 ? wine() : refreshedWine] });
      }
      if (path === "/v1/assessment-requests" && options?.method === "POST") {
        return envelope({
          requests: [{ sourceKey: sourceOne, requestId: "request-one", assessmentVersion: 4 }],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderPage({ apiClient, pollAssessment });
    await screen.findAllByText("Barolo Classico");
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    const drawer = await screen.findByRole("dialog", { name: "Barolo Classico" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Reassess" }));
    const confirmation = await screen.findByRole("dialog", { name: "Request assessment?" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Request 1 assessment" }));

    await waitFor(() => expect(listCalls).toBe(2));
    await waitFor(() => {
      expect(within(drawer).getByText("Strong fit")).toBeInTheDocument();
      expect(within(drawer).getByText("Assessment current")).toBeInTheDocument();
      expect(within(drawer).getByText("Now a strong fit")).toBeInTheDocument();
      expect(within(drawer).getByText("Assessment complete.")).toBeInTheDocument();
    });
    expect(
      within(drawer).queryByText("Assessment completed. Catalogue details are refreshing."),
    ).not.toBeInTheDocument();
  });

  it("enforces the 25-wine selection cap before confirmation", async () => {
    const wines = Array.from({ length: 26 }, (_, index) =>
      wine({
        sourceKey: `retailer:tws:${index}`,
        name: `Wine ${String(index + 1).padStart(2, "0")}`,
      }),
    );
    const { apiClient } = client(async () => envelope({ items: wines }));

    renderPage({ apiClient });
    await screen.findAllByText("Wine 01");
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    expect(screen.getByText("25 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select visible" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reassess selected (25)" }));
    const confirmation = await screen.findByRole("dialog", {
      name: "Reassess selected wines?",
    });
    expect(confirmation).toHaveTextContent("exactly 25 OpenAI assessments");
  });

  it("shows loading, empty and safe retryable error states", async () => {
    let rejectLoad: ((error: unknown) => void) | undefined;
    const { apiClient } = client(
      () => new Promise((_resolve, reject) => { rejectLoad = reject; }),
    );

    renderPage({ apiClient });
    expect(screen.getAllByText("Loading current wines")).toHaveLength(3);

    await act(async () => {
      rejectLoad?.(new ApiError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "The catalogue could not be loaded.",
      }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The catalogue could not be loaded.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
