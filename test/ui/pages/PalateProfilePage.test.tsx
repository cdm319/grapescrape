import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ApiClient,
} from "../../../src/ui/src/api/apiClient";
import {
  PalateProfilePageContent,
} from "../../../src/ui/src/pages/PalateProfilePage";
import type {
  PalateProfile,
  PalateProfileDraft,
  WineExampleSentiment,
} from "../../../src/ui/src/features/palate-profile/palateProfile";

const stylePreferences = {
  body: { preferred: ["full"], avoided: ["light"] },
  fruitRipeness: { preferred: ["ripe"], avoided: ["underripe"] },
  fruitCharacter: { preferred: ["black_fruit"], avoided: [] },
  texture: { preferred: ["plush"], avoided: ["thin"] },
  oakInfluence: { preferred: ["moderate"], avoided: ["none_detected"] },
  tannin: { preferred: ["moderate_plus"], avoided: ["firm_or_drying"] },
  acidity: { preferred: ["balanced"], avoided: ["sharp"] },
  development: { preferred: ["ready_to_drink"], avoided: [] },
  styleTags: { preferred: ["polished"], avoided: ["rustic"] },
} satisfies PalateProfile["stylePreferences"];

const profile: PalateProfile = {
  palateProfileVersion: 4,
  stylePreferences,
  wineExamples: [
    {
      id: "c5f751e0-cd3c-4b5b-9cf7-fd86d9acc234",
      name: "Example Estate",
      vintage: "2019",
      sentiment: "enjoyed",
      notes: "Ripe fruit and a plush texture.",
    },
  ],
  createdAt: "2026-07-23T10:30:00.000Z",
  updatedAt: "2026-07-23T10:30:00.000Z",
};

function profileEnvelope(data: PalateProfile) {
  return {
    data,
    meta: { requestId: "request-1" },
  };
}

function createApiClient(request: ReturnType<typeof vi.fn>): ApiClient {
  return {
    request: request as ApiClient["request"],
  };
}

function renderPage({
  request,
  createId = () => "5fa8279e-9a60-4ea8-afbb-3c977fc9280f",
}: {
  request: ReturnType<typeof vi.fn>;
  createId?: () => string;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <PalateProfilePageContent
        apiClient={createApiClient(request)}
        createId={createId}
      />
    </QueryClientProvider>,
  );
}

function exampleSection(sentiment: WineExampleSentiment) {
  return screen.getByRole("region", {
    name:
      sentiment === "enjoyed"
        ? "Wines I enjoyed"
        : "Wines I did not enjoy",
  });
}

function beginSave() {
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Save version 5" }));
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

describe("palate profile page", () => {
  it("loads the current profile in a genuinely read-only view", async () => {
    const request = vi.fn().mockResolvedValue(profileEnvelope(profile));

    renderPage({ request });

    expect(await screen.findByText("Version 4")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Palate profile" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Updated 23 Jul 2026")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.getByText("Example Estate")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Profile changes create a new version. Existing wine assessments are not reassessed automatically.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Prefer / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove Example Estate/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add a wine" }),
    ).not.toBeInTheDocument();
  });

  it("sends the complete edited profile with the expected version and a stable client UUID", async () => {
    const request = vi.fn().mockImplementation(
      async (_path: string, options?: RequestInit) => {
        if (options?.method !== "PUT") {
          return profileEnvelope(profile);
        }

        const body = JSON.parse(String(options.body)) as {
          profile: PalateProfileDraft;
        };

        return profileEnvelope({
          palateProfileVersion: 5,
          ...body.profile,
          createdAt: "2026-07-24T09:00:00.000Z",
          updatedAt: "2026-07-24T09:00:00.000Z",
        });
      },
    );

    renderPage({ request });
    await screen.findByText("Version 4");

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Avoid Full" }));

    const notEnjoyed = exampleSection("not_enjoyed");
    fireEvent.click(within(notEnjoyed).getByRole("button", { name: "Add a wine" }));
    fireEvent.change(within(notEnjoyed).getByLabelText("Wine name"), {
      target: { value: "Too Much Oak" },
    });
    fireEvent.change(within(notEnjoyed).getByLabelText("Vintage"), {
      target: { value: "2021" },
    });
    fireEvent.change(within(notEnjoyed).getByLabelText("Notes"), {
      target: { value: "Vanilla and drying oak overwhelmed the fruit." },
    });
    fireEvent.click(
      within(notEnjoyed).getByRole("button", { name: "Add example" }),
    );
    expect(
      within(notEnjoyed).getByRole("button", {
        name: "Remove Too Much Oak 2021 from Wines I did not enjoy",
      }),
    ).toBeInTheDocument();

    beginSave();

    await screen.findByText("Version 5");
    const putCall = request.mock.calls.find(
      ([, options]) => options?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const [path, options] = putCall as [string, RequestInit];
    const body = JSON.parse(String(options.body));

    expect(path).toBe("/v1/palate-profile");
    expect(body).toEqual({
      expectedPalateProfileVersion: 4,
      profile: {
        stylePreferences: {
          ...stylePreferences,
          body: {
            preferred: [],
            avoided: ["light", "full"],
          },
        },
        wineExamples: [
          profile.wineExamples[0],
          {
            id: "5fa8279e-9a60-4ea8-afbb-3c977fc9280f",
            name: "Too Much Oak",
            vintage: "2021",
            sentiment: "not_enjoyed",
            notes: "Vanilla and drying oak overwhelmed the fruit.",
          },
        ],
      },
    });
    expect(Object.keys(body.profile.wineExamples[1])).toEqual([
      "id",
      "name",
      "vintage",
      "sentiment",
      "notes",
    ]);
    expect(
      screen.queryByRole("button", { name: /^Remove Too Much Oak/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps example input beside duplicate and character-limit errors", async () => {
    const request = vi.fn().mockResolvedValue(profileEnvelope(profile));

    renderPage({ request });
    await screen.findByText("Version 4");
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));

    const notEnjoyed = exampleSection("not_enjoyed");
    fireEvent.click(within(notEnjoyed).getByRole("button", { name: "Add a wine" }));
    fireEvent.click(
      within(notEnjoyed).getByRole("button", { name: "Add example" }),
    );

    expect(
      within(notEnjoyed).getByText(
        "Enter a wine name between 1 and 120 characters.",
      ),
    ).toBeInTheDocument();
    expect(
      within(notEnjoyed).getByText(
        "Use a year from 1000 to 2999, or uppercase NV.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(within(notEnjoyed).getByLabelText("Wine name"), {
      target: { value: "  example   estate " },
    });
    fireEvent.change(within(notEnjoyed).getByLabelText("Vintage"), {
      target: { value: "2019" },
    });
    fireEvent.click(
      within(notEnjoyed).getByRole("button", { name: "Add example" }),
    );

    expect(
      within(notEnjoyed).getByText(
        /already appears in Wines I enjoyed/i,
      ),
    ).toBeInTheDocument();
    expect(within(notEnjoyed).getByLabelText("Wine name")).toHaveValue(
      "  example   estate ",
    );

    const longNotes = "x".repeat(401);
    fireEvent.change(within(notEnjoyed).getByLabelText("Wine name"), {
      target: { value: "Different Estate" },
    });
    fireEvent.change(within(notEnjoyed).getByLabelText("Notes"), {
      target: { value: longNotes },
    });
    fireEvent.click(
      within(notEnjoyed).getByRole("button", { name: "Add example" }),
    );

    expect(
      within(notEnjoyed).getByText(
        "Keep notes to 400 characters or fewer.",
      ),
    ).toBeInTheDocument();
    expect(within(notEnjoyed).getByLabelText("Notes")).toHaveValue(longNotes);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      within(notEnjoyed).getByText(
        "Add this example or cancel the form before saving.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Save as version 5?" }),
    ).not.toBeInTheDocument();
    expect(within(notEnjoyed).getByLabelText("Notes")).toHaveValue(longNotes);
  });

  it("keeps the draft and places server validation beside the affected example", async () => {
    const request = vi.fn().mockImplementation(
      async (_path: string, options?: RequestInit) => {
        if (options?.method !== "PUT") {
          return profileEnvelope(profile);
        }

        throw new ApiError({
          status: 400,
          code: "VALIDATION_FAILED",
          message: "The request did not pass validation.",
          details: [
            {
              field: "profile.wineExamples[1].notes",
              reason: "must be a string no longer than 400 characters",
            },
          ],
          requestId: "request-validation",
        });
      },
    );

    renderPage({ request });
    await screen.findByText("Version 4");
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));

    const notEnjoyed = exampleSection("not_enjoyed");
    fireEvent.click(within(notEnjoyed).getByRole("button", { name: "Add a wine" }));
    fireEvent.change(within(notEnjoyed).getByLabelText("Wine name"), {
      target: { value: "Server Checked Estate" },
    });
    fireEvent.change(within(notEnjoyed).getByLabelText("Vintage"), {
      target: { value: "NV" },
    });
    fireEvent.click(
      within(notEnjoyed).getByRole("button", { name: "Add example" }),
    );

    beginSave();

    expect(
      await within(notEnjoyed).findByText(
        "must be a string no longer than 400 characters",
      ),
    ).toBeInTheDocument();
    expect(
      within(notEnjoyed).getByText("Server Checked Estate"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("keeps conflict edits for review and reloads only after explicit confirmation", async () => {
    const latestProfile: PalateProfile = {
      ...profile,
      palateProfileVersion: 5,
      stylePreferences: {
        ...profile.stylePreferences,
        body: { preferred: ["medium"], avoided: [] },
      },
      updatedAt: "2026-07-24T10:00:00.000Z",
    };
    let getCount = 0;
    const request = vi.fn().mockImplementation(
      async (_path: string, options?: RequestInit) => {
        if (options?.method === "PUT") {
          throw new ApiError({
            status: 409,
            code: "PROFILE_VERSION_CONFLICT",
            message: "The palate profile has changed.",
            details: { currentPalateProfileVersion: 5 },
            requestId: "request-conflict",
          });
        }

        getCount += 1;
        return profileEnvelope(getCount === 1 ? profile : latestProfile);
      },
    );

    renderPage({ request });
    await screen.findByText("Version 4");
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Prefer Medium" }));

    beginSave();

    expect(
      await screen.findByRole("heading", {
        name: "This profile changed elsewhere",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByText(
        /A newer profile \(version 5\) exists/i,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep reviewing my edits" }),
    );
    expect(screen.getByRole("button", { name: "Prefer Medium" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    beginSave();
    await screen.findByRole("heading", {
      name: "This profile changed elsewhere",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reload latest and discard draft",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Version 5")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Edit profile" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Prefer Medium" }),
    ).not.toBeInTheDocument();
  });

  it("supports creating an empty first profile without inventing fields", async () => {
    const request = vi.fn().mockImplementation(
      async (_path: string, options?: RequestInit) => {
        if (options?.method === "PUT") {
          const body = JSON.parse(String(options.body)) as {
            profile: PalateProfileDraft;
          };
          return profileEnvelope({
            palateProfileVersion: 1,
            ...body.profile,
            createdAt: "2026-07-24T12:00:00.000Z",
            updatedAt: "2026-07-24T12:00:00.000Z",
          });
        }

        throw new ApiError({
          status: 404,
          code: "PALATE_PROFILE_NOT_FOUND",
          message: "No palate profile was found.",
        });
      },
    );

    renderPage({ request });

    expect(
      await screen.findByRole("heading", { name: "Start your palate profile" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));

    expect(screen.getByText("New profile")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Prefer Light" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw json/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save version 1" }));

    await screen.findByText("Version 1");
    const putCall = request.mock.calls.find(
      ([, options]) => options?.method === "PUT",
    ) as [string, RequestInit];
    expect(JSON.parse(String(putCall[1].body))).toEqual({
      expectedPalateProfileVersion: null,
      profile: {
        stylePreferences: {
          body: { preferred: [], avoided: [] },
          fruitRipeness: { preferred: [], avoided: [] },
          fruitCharacter: { preferred: [], avoided: [] },
          texture: { preferred: [], avoided: [] },
          oakInfluence: { preferred: [], avoided: [] },
          tannin: { preferred: [], avoided: [] },
          acidity: { preferred: [], avoided: [] },
          development: { preferred: [], avoided: [] },
          styleTags: { preferred: [], avoided: [] },
        },
        wineExamples: [],
      },
    });
  });

  it("represents the per-sentiment limit beside the affected list", async () => {
    const limitedProfile: PalateProfile = {
      ...profile,
      wineExamples: Array.from({ length: 20 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `Not enjoyed ${index + 1}`,
        vintage: "2020",
        sentiment: "not_enjoyed" as const,
        notes: "",
      })),
    };
    const request = vi.fn().mockResolvedValue(profileEnvelope(limitedProfile));

    renderPage({ request });
    await screen.findByText("Version 4");
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));

    const notEnjoyed = exampleSection("not_enjoyed");
    expect(within(notEnjoyed).getByText("20 of 20")).toBeInTheDocument();
    expect(
      within(notEnjoyed).getByText(
        "This section has reached its 20-wine limit.",
      ),
    ).toBeInTheDocument();
    expect(
      within(notEnjoyed).queryByRole("button", { name: "Add a wine" }),
    ).not.toBeInTheDocument();
  });

  it("shows a retryable API error without exposing internal details", async () => {
    const request = vi.fn().mockRejectedValue(
      new ApiError({
        status: 503,
        code: "DEPENDENCY_UNAVAILABLE",
        message: "The palate profile service is temporarily unavailable.",
        requestId: "request-safe",
      }),
    );

    renderPage({ request });

    expect(
      await screen.findByRole(
        "heading",
        { name: "We could not load this" },
        { timeout: 2_500 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The palate profile service is temporarily unavailable.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Request request-safe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
