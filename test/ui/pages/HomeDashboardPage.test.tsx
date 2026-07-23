import {
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../../src/ui/src/api/apiClient";
import type {
  AssessedWine,
  CatalogueWine,
  PalateProfile,
  PublicAssessmentSummary,
} from "../../../src/ui/src/api/homeDashboardApi";
import { HomeDashboardPage } from "../../../src/ui/src/pages/HomeDashboardPage";

const paths = {
  recommendations:
    "/v1/catalogue/wines?highlight=true&sort=fit&direction=desc&limit=12",
  recentlyAdded:
    "/v1/catalogue/wines?sort=first_seen&direction=desc&limit=4",
  palate: "/v1/palate-profile",
  assessments:
    "/v1/assessed-wines?sort=last_assessed&direction=desc&limit=4",
};

const defaultInnerWidth = window.innerWidth;

afterEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: defaultInnerWidth,
  });
});

function assessment(
  overrides: Partial<PublicAssessmentSummary> = {},
): PublicAssessmentSummary {
  return {
    assessmentInputKey: "assessment-input",
    sourceKey: "retailer:tws:wine",
    assessmentVersion: 2,
    palateProfileVersion: 4,
    fit: "good",
    confidence: "medium_high",
    highlight: true,
    headline: "Ripe and polished",
    summary: "A likely match.",
    completedAt: "2026-07-22T10:00:00.000Z",
    ...overrides,
  };
}

function catalogueWine(
  overrides: Partial<CatalogueWine> = {},
): CatalogueWine {
  const sourceKey = overrides.sourceKey ?? "retailer:tws:wine";

  return {
    sourceKey,
    retailerId: "tws",
    retailerLabel: "The Wine Society",
    retailerWineId: sourceKey.split(":").at(-1) ?? "wine",
    name: "Example Wine",
    vintage: 2020,
    region: "Bordeaux",
    grape: "Merlot",
    alcohol: "13.5%",
    description: "Ripe fruit.",
    currentPrice: {
      amount: "25.50",
      currency: "GBP",
    },
    firstSeenAt: "2026-07-20T10:00:00.000Z",
    lastSeenAt: "2026-07-23T10:00:00.000Z",
    latestAssessment: assessment({ sourceKey }),
    freshness: {
      status: "current",
      isCurrent: true,
      profileChanged: false,
      sourceChanged: false,
      assessedPalateProfileVersion: 4,
      currentPalateProfileVersion: 4,
    },
    ...overrides,
  };
}

function palateProfile(): PalateProfile {
  return {
    palateProfileVersion: 4,
    stylePreferences: {
      body: { preferred: ["medium_plus", "full"], avoided: ["light"] },
      fruitRipeness: { preferred: ["ripe"], avoided: ["underripe"] },
      fruitCharacter: { preferred: ["black_fruit"], avoided: [] },
      texture: { preferred: ["plush"], avoided: ["austere"] },
      oakInfluence: { preferred: ["moderate"], avoided: [] },
      tannin: { preferred: ["moderate_plus"], avoided: ["firm_or_drying"] },
      acidity: { preferred: ["fresh"], avoided: ["sharp"] },
      development: { preferred: ["ready_to_drink"], avoided: [] },
      styleTags: { preferred: ["polished"], avoided: ["rustic"] },
    },
    wineExamples: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Enjoyed Wine",
        vintage: "2020",
        sentiment: "enjoyed",
        notes: "",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Another Enjoyed Wine",
        vintage: "2019",
        sentiment: "enjoyed",
        notes: "",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Not Enjoyed Wine",
        vintage: "NV",
        sentiment: "not_enjoyed",
        notes: "",
      },
    ],
    createdAt: "2026-07-03T10:00:00.000Z",
    updatedAt: "2026-07-03T10:00:00.000Z",
  };
}

function assessedWine(
  overrides: Partial<AssessedWine> = {},
): AssessedWine {
  return {
    sourceKey: "retailer:tws:history",
    sourceType: "retailer",
    retailerId: "tws",
    retailerLabel: "The Wine Society",
    wine: {
      name: "History Wine",
      vintage: 2019,
      region: "Piedmont",
      grape: "Nebbiolo",
      alcohol: "14%",
      description: "Structured.",
      availability: "current_retailer",
      currentPrice: {
        amount: "34.00",
        currency: "GBP",
      },
    },
    latestAssessment: assessment({
      sourceKey: "retailer:tws:history",
      fit: "strong",
      completedAt: "2026-07-21T10:00:00.000Z",
    }),
    freshness: {
      status: "current",
      isCurrent: true,
      profileChanged: false,
      sourceChanged: false,
      assessedPalateProfileVersion: 4,
      currentPalateProfileVersion: 4,
    },
    assessmentCount: 2,
    lastAssessedAt: "2026-07-21T10:00:00.000Z",
    ...overrides,
  };
}

function envelope<T>(data: T) {
  return {
    data,
    meta: {
      requestId: "request-123",
    },
  };
}

function createApiClient(
  responses: Partial<Record<string, unknown | Error>> = {},
) {
  const request = vi.fn(async (path: string) => {
    const response = responses[path];

    if (response instanceof Error) {
      throw response;
    }

    if (response !== undefined) {
      return response;
    }

    if (path === paths.palate) {
      return envelope(palateProfile());
    }

    return envelope({ items: [] });
  });

  return {
    apiClient: { request } as unknown as ApiClient,
    request,
  };
}

function renderDashboard(apiClient: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomeDashboardPage apiClient={apiClient} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Home dashboard", () => {
  it("uses bounded API calls and ranks highlighted recommendations by canonical fit and confidence", async () => {
    const recommendations = [
      catalogueWine({
        sourceKey: "retailer:tws:good-high",
        name: "Good High",
        latestAssessment: assessment({
          sourceKey: "retailer:tws:good-high",
          fit: "good",
          confidence: "high",
        }),
      }),
      catalogueWine({
        sourceKey: "retailer:tws:strong-low",
        name: "Strong Low",
        latestAssessment: assessment({
          sourceKey: "retailer:tws:strong-low",
          fit: "strong",
          confidence: "low",
        }),
      }),
      catalogueWine({
        sourceKey: "retailer:tws:not-highlighted",
        name: "Not Highlighted",
        latestAssessment: assessment({
          sourceKey: "retailer:tws:not-highlighted",
          fit: "strong",
          confidence: "high",
          highlight: false,
        }),
      }),
      catalogueWine({
        sourceKey: "retailer:tws:strong-high",
        name: "Strong High",
        currentPrice: { amount: "48.00", currency: "GBP" },
        latestAssessment: assessment({
          sourceKey: "retailer:tws:strong-high",
          fit: "strong",
          confidence: "high",
          headline: "Savoury depth",
        }),
        freshness: {
          status: "palate_profile_changed",
          isCurrent: false,
          profileChanged: true,
          sourceChanged: false,
          assessedPalateProfileVersion: 3,
          currentPalateProfileVersion: 4,
        },
      }),
    ];
    const recentlyAdded = [
      catalogueWine({
        sourceKey: "retailer:tws:older",
        name: "Older Listing",
        firstSeenAt: "2026-07-20T10:00:00.000Z",
      }),
      catalogueWine({
        sourceKey: "retailer:tws:newer",
        name: "Newer Listing",
        firstSeenAt: "2026-07-23T10:00:00.000Z",
        latestAssessment: null,
        freshness: {
          status: "unassessed",
          isCurrent: false,
          profileChanged: false,
          sourceChanged: false,
          assessedPalateProfileVersion: null,
          currentPalateProfileVersion: 4,
        },
      }),
    ];
    const { apiClient, request } = createApiClient({
      [paths.recommendations]: envelope({ items: recommendations }),
      [paths.recentlyAdded]: envelope({ items: recentlyAdded }),
      [paths.palate]: envelope(palateProfile()),
      [paths.assessments]: envelope({ items: [assessedWine()] }),
    });

    renderDashboard(apiClient);

    expect(
      await screen.findByRole("heading", { name: /Strong High/ }),
    ).toBeInTheDocument();
    const recommendationHeadings = within(
      screen.getByRole("region", { name: "Top recommendations" }),
    ).getAllByRole("heading", { level: 3 });
    expect(recommendationHeadings.map((heading) => heading.textContent)).toEqual([
      expect.stringContaining("Strong High"),
      expect.stringContaining("Strong Low"),
      expect.stringContaining("Good High"),
    ]);
    expect(screen.queryByText("Not Highlighted")).not.toBeInTheDocument();

    const strongestCard = screen
      .getByRole("heading", { name: /Strong High/ })
      .closest("article");
    expect(strongestCard).not.toBeNull();
    expect(within(strongestCard!).getByText("Strong fit")).toBeInTheDocument();
    expect(
      within(strongestCard!).getByText("Palate changed"),
    ).toBeInTheDocument();
    expect(within(strongestCard!).getByText("£48.00")).toBeInTheDocument();
    expect(within(strongestCard!).getByText(/Savoury depth/)).toBeInTheDocument();

    await waitFor(() => {
      expect(request.mock.calls.map(([path]) => path).sort()).toEqual(
        Object.values(paths).sort(),
      );
    });
  });

  it("orders recently added wines from real firstSeenAt values and shows only assessed or unassessed durable state", async () => {
    const { apiClient } = createApiClient({
      [paths.recentlyAdded]: envelope({
        items: [
          catalogueWine({
            sourceKey: "retailer:tws:older",
            name: "Older Listing",
            firstSeenAt: "2026-07-20T10:00:00.000Z",
          }),
          catalogueWine({
            sourceKey: "retailer:tws:newer",
            name: "Newer Listing",
            firstSeenAt: "2026-07-23T10:00:00.000Z",
            latestAssessment: null,
          }),
        ],
      }),
    });

    renderDashboard(apiClient);

    await screen.findByText("Newer Listing");
    const section = await screen.findByRole("region", {
      name: "Recently added by retailers",
    });
    const listItems = within(section).getAllByRole("listitem");

    expect(listItems[0]).toHaveTextContent("Newer Listing");
    expect(listItems[0]).toHaveTextContent("23 Jul 2026");
    expect(listItems[0]).toHaveTextContent("Unassessed");
    expect(listItems[1]).toHaveTextContent("Older Listing");
    expect(listItems[1]).toHaveTextContent("Assessed");
    expect(section).not.toHaveTextContent(/queued|processing/i);
  });

  it("shows the current structured palate summary, version, timestamp and example counts", async () => {
    const { apiClient } = createApiClient();

    renderDashboard(apiClient);

    const palate = await screen.findByRole("region", { name: "Your palate" });

    expect(palate).toHaveTextContent("v4");
    expect(palate).toHaveTextContent("medium plus");
    expect(palate).toHaveTextContent("black fruit");
    expect(palate).toHaveTextContent("light");
    expect(palate).toHaveTextContent("2enjoyed");
    expect(palate).toHaveTextContent("1not enjoyed");
    expect(palate).toHaveTextContent("Updated 3 Jul 2026");
    expect(
      within(palate).getByRole("link", { name: "View or edit profile" }),
    ).toHaveAttribute("href", "/palate");
  });

  it("keeps successful sections usable when recommendations fail and retries only that section", async () => {
    const recommendationError = new ApiError({
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Catalogue recommendations are temporarily unavailable.",
      requestId: "request-recommendations",
    });
    const { apiClient, request } = createApiClient({
      [paths.recommendations]: recommendationError,
      [paths.recentlyAdded]: envelope({
        items: [
          catalogueWine({
            sourceKey: "retailer:tws:available",
            name: "Still Available",
          }),
        ],
      }),
      [paths.assessments]: envelope({
        items: [assessedWine({ sourceKey: "retailer:tws:durable" })],
      }),
    });

    renderDashboard(apiClient);

    expect(await screen.findByText("Still Available")).toBeInTheDocument();
    expect(screen.getByText("History Wine")).toBeInTheDocument();
    expect(screen.getByText(/medium plus/)).toBeInTheDocument();
    expect(
      screen.getByText("Catalogue recommendations are temporarily unavailable."),
    ).toBeInTheDocument();
    expect(screen.getByText("Request request-recommendations")).toBeInTheDocument();

    within(
      screen.getByRole("region", { name: "Top recommendations" }),
    )
      .getByRole("button", { name: "Try again" })
      .click();

    await waitFor(() => {
      expect(
        request.mock.calls.filter(([path]) => path === paths.recommendations),
      ).toHaveLength(2);
    });
    expect(
      request.mock.calls.filter(([path]) => path === paths.recentlyAdded),
    ).toHaveLength(1);
  });

  it("shows a useful missing-profile state without blanking the rest of Home", async () => {
    const { apiClient } = createApiClient({
      [paths.palate]: new ApiError({
        status: 404,
        code: "PALATE_PROFILE_NOT_FOUND",
        message: "No palate profile was found.",
      }),
      [paths.assessments]: envelope({ items: [assessedWine()] }),
    });

    renderDashboard(apiClient);

    expect(
      await screen.findByRole("heading", { name: "Add your palate profile" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Create profile/ }),
    ).toHaveAttribute("href", "/palate");
    expect(screen.getByText("History Wine")).toBeInTheDocument();
  });

  it("presents mobile-oriented semantic sections and all four reachable quick actions without unsupported score or image UI", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    window.dispatchEvent(new Event("resize"));
    const { apiClient } = createApiClient({
      [paths.recommendations]: envelope({
        items: [
          catalogueWine({
            sourceKey: "retailer:tws:mobile",
            name: "Mobile Recommendation",
          }),
        ],
      }),
    });

    renderDashboard(apiClient);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Wines chosen for the way you taste.",
      }),
    ).toBeInTheDocument();
    await screen.findByText("Mobile Recommendation");
    expect(document.querySelectorAll("article")).toHaveLength(1);

    const actions = screen.getByRole("region", { name: "Quick actions" });
    expect(within(actions).getAllByRole("link")).toHaveLength(4);
    expect(
      within(actions).getByRole("link", { name: /Browse all wines/ }),
    ).toHaveAttribute("href", "/wines");
    expect(
      within(actions).getByRole("link", { name: /Edit palate profile/ }),
    ).toHaveAttribute("href", "/palate");
    expect(
      within(actions).getByRole("link", { name: /Review history/ }),
    ).toHaveAttribute("href", "/history");
    expect(
      within(actions).getByRole("link", { name: /Assess a manual wine/ }),
    ).toHaveAttribute("href", "/assess");
    expect(document.querySelector("img")).toBeNull();
    expect(document.body).not.toHaveTextContent(/score|%/i);
  });

  it("announces independent loading skeletons for each dashboard section", () => {
    const request = vi.fn(
      () =>
        new Promise<never>(() => {
          // Intentionally pending so each section keeps its loading state.
        }),
    );

    renderDashboard({ request } as unknown as ApiClient);

    expect(screen.getByLabelText("Loading recommendations")).toBeInTheDocument();
    expect(
      screen.getByText("Loading recently added wines"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading palate profile")).toBeInTheDocument();
    expect(
      screen.getByText("Loading recent assessments"),
    ).toBeInTheDocument();
  });
});
