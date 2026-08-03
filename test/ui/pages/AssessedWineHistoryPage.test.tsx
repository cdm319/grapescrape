import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  type Assessment,
  type AssessedWine,
  type CursorPage,
} from "../../../src/ui/src/api/assessmentHistory";
import type {
  ApiClient,
  SuccessEnvelope,
} from "../../../src/ui/src/api/apiClient";
import { AssessedWineDetail } from "../../../src/ui/src/pages/AssessedWineDetail";
import { AssessedWineHistoryPage } from "../../../src/ui/src/pages/AssessedWineHistoryPage";

function assessment({
  sourceKey,
  version,
  fit = "good",
  confidence = "medium_high",
  headline = `Assessment ${version}`,
}: {
  sourceKey: string;
  version: number;
  fit?: Assessment["fit"];
  confidence?: Assessment["confidence"];
  headline?: string;
}): Assessment {
  return {
    assessmentInputKey: `secret-input-${sourceKey}-${version}`,
    sourceKey,
    assessmentVersion: version,
    palateProfileVersion: version + 1,
    fit,
    confidence,
    highlight: version === 3,
    headline,
    summary: `Summary for assessment ${version}.`,
    reasoningMode: "metadata_plus_description",
    reasons: ["Ripe fruit suits your palate."],
    cautions: ["Tannin is inferred."],
    evidence: [
      {
        type: "direct",
        source: "wine.description",
        text: "The description mentions ripe black fruit.",
      },
    ],
    assumptions: ["The producer style is consistent."],
    completedAt: `2026-07-${String(20 + version).padStart(2, "0")}T10:00:00.000Z`,
  };
}

function assessedWine({
  sourceKey,
  name,
  availability,
  assessmentVersion = 3,
}: {
  sourceKey: string;
  name: string;
  availability: AssessedWine["wine"]["availability"];
  assessmentVersion?: number;
}): AssessedWine {
  const latestAssessment = assessment({
    sourceKey,
    version: assessmentVersion,
    headline: `${name} assessment`,
  });
  const currentRetailer = availability === "current_retailer";

  return {
    sourceKey,
    sourceType: sourceKey.startsWith("retailer:") ? "retailer" : "manual",
    retailerId: sourceKey.startsWith("retailer:") ? "tws" : null,
    retailerLabel: sourceKey.startsWith("retailer:")
      ? "The Wine Society"
      : null,
    wine: {
      name,
      vintage: "2019",
      region: "Piedmont",
      grape: "Nebbiolo",
      alcohol: null,
      description: "A structured red wine.",
      availability,
      currentPrice: currentRetailer
        ? { amount: "24.50", currency: "GBP" }
        : null,
    },
    latestAssessment,
    freshness: {
      status: currentRetailer ? "current" : "palate_profile_changed",
      isCurrent: currentRetailer,
      profileChanged: !currentRetailer,
      sourceChanged: false,
      assessedPalateProfileVersion: assessmentVersion + 1,
      currentPalateProfileVersion: assessmentVersion + 2,
    },
    assessmentCount: assessmentVersion,
    lastAssessedAt: latestAssessment.completedAt,
  };
}

const removedWine = assessedWine({
  sourceKey: "retailer:tws:removed",
  name: "Removed Cuvée",
  availability: "removed_retailer",
});
const deletedManualWine = assessedWine({
  sourceKey: "manual:deleted",
  name: "Deleted Manual Wine",
  availability: "deleted_manual",
});
const secondRemovedWine = assessedWine({
  sourceKey: "retailer:tws:second",
  name: "Another Removed Wine",
  availability: "removed_retailer",
});

function envelope<T>(
  data: T,
  nextCursor?: string | null,
): SuccessEnvelope<T> {
  return {
    data,
    meta: {
      requestId: "request-id",
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    },
  };
}

function createApiClient({
  firstPage = {
    items: [removedWine, deletedManualWine],
    nextCursor: "opaque-next",
  },
  secondPage = {
    items: [removedWine, secondRemovedWine],
    nextCursor: null,
  },
  detail = removedWine,
  history = [
    assessment({ sourceKey: removedWine.sourceKey, version: 3 }),
    assessment({
      sourceKey: removedWine.sourceKey,
      version: 2,
      fit: "maybe",
      confidence: "low",
    }),
  ],
}: {
  firstPage?: CursorPage<AssessedWine>;
  secondPage?: CursorPage<AssessedWine>;
  detail?: AssessedWine;
  history?: Assessment[];
} = {}) {
  const request = vi.fn(async (path: string) => {
    if (path.includes("/assessments?")) {
      return envelope({ items: history }, null);
    }

    if (path.startsWith("/v1/assessed-wines/")) {
      return envelope(detail);
    }

    const url = new URL(path, "https://api.grapescrape.test");
    const page = url.searchParams.has("cursor") ? secondPage : firstPage;

    return envelope({ items: page.items }, page.nextCursor);
  });

  return {
    apiClient: {
      request: request as ApiClient["request"],
    },
    request,
  };
}

function renderHistory({
  apiClient,
  initialEntry = "/history",
}: {
  apiClient: ApiClient;
  initialEntry?: string;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/history"
            element={<AssessedWineHistoryPage apiClient={apiClient} />}
          >
            <Route
              path=":sourceKey"
              element={<AssessedWineDetail apiClient={apiClient} />}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("assessed-wine history", () => {
  it("maps filters to CM-40 query parameters and deduplicates cursor pages", async () => {
    const { apiClient, request } = createApiClient();

    renderHistory({
      apiClient,
      initialEntry:
        "/history?q=Barolo&source=manual&availability=no_longer_listed&fit=good&confidence=medium_high&highlight=true",
    });

    expect(
      await screen.findByRole("heading", { name: "Removed Cuvée 2019" }),
    ).toBeInTheDocument();

    const firstListCall = vi
      .mocked(request)
      .mock.calls.map(([path]) => path as string)
      .find((path) => path.startsWith("/v1/assessed-wines?"));
    const query = new URL(
      firstListCall ?? "",
      "https://api.grapescrape.test",
    ).searchParams;

    expect(query.get("q")).toBe("Barolo");
    expect(query.get("sourceType")).toBe("manual");
    expect(query.get("availability")).toBe(
      "removed_retailer,deleted_manual",
    );
    expect(query.get("fit")).toBe("good");
    expect(query.get("confidence")).toBe("medium_high");
    expect(query.get("highlight")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(
      await screen.findByRole("heading", {
        name: "Another Removed Wine 2019",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Removed Cuvée 2019" }),
    ).toHaveLength(1);
    expect(
      screen.getByText("You have reached the end of your assessment history."),
    ).toBeInTheDocument();
  });

  it("keeps loaded pages, filters and scroll context mounted around detail", async () => {
    const { apiClient, request } = createApiClient();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 640,
    });

    renderHistory({
      apiClient,
      initialEntry: "/history?availability=no_longer_listed",
    });

    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("heading", {
        name: "Another Removed Wine 2019",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("link", { name: "View history →" })[0],
    );

    expect(
      await screen.findByRole("dialog", { name: "Removed Cuvée" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Availability")).toHaveValue(
      "no_longer_listed",
    );
    expect(
      screen.getByRole("heading", { name: "Another Removed Wine 2019" }),
    ).toBeInTheDocument();
    expect(window.scrollY).toBe(640);
    expect(request).toHaveBeenCalledWith(
      "/v1/assessed-wines/retailer%3Atws%3Aremoved",
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Close details" }).at(-1)!,
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      vi
        .mocked(request)
        .mock.calls.filter(([path]) =>
          String(path).startsWith("/v1/assessed-wines?"),
        ),
    ).toHaveLength(2);
    expect(window.scrollY).toBe(640);
  });

  it("renders ordered progressive detail without price or internal metadata", async () => {
    const { apiClient } = createApiClient();

    renderHistory({
      apiClient,
      initialEntry: "/history/retailer%3Atws%3Aremoved",
    });

    expect(
      await screen.findByRole("dialog", { name: "Removed Cuvée" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Good fit").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Your palate profile has changed"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Current price/)).not.toBeInTheDocument();

    const latestVersionHeading = screen.getByText(
      "Assessment version 3 · Latest",
      { selector: ".assessment-version > summary > span:first-child" },
    );
    const previousVersionHeading = screen.getByText("Assessment version 2", {
      selector: ".assessment-version > summary > span:first-child",
    });
    expect(
      latestVersionHeading.compareDocumentPosition(previousVersionHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const latestAssessment = latestVersionHeading.closest("details");
    expect(latestAssessment).not.toBeNull();
    const latest = within(latestAssessment!);

    fireEvent.click(latest.getByText("Reasons (1)"));
    fireEvent.click(latest.getByText("Cautions (1)"));
    fireEvent.click(latest.getByText("Evidence (1)"));
    fireEvent.click(latest.getByText("Assumptions (1)"));

    expect(
      latest.getByText("Ripe fruit suits your palate."),
    ).toBeInTheDocument();
    expect(latest.getByText("Tannin is inferred.")).toBeInTheDocument();
    expect(
      latest.getByText("The description mentions ripe black fruit."),
    ).toBeInTheDocument();
    expect(
      latest.getByText("The producer style is consistent."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/secret-input/)).not.toBeInTheDocument();
    expect(screen.queryByText("metadata_plus_description")).not.toBeInTheDocument();
    expect(screen.queryByText("0.88")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reassess/i }),
    ).not.toBeInTheDocument();
  });
});
