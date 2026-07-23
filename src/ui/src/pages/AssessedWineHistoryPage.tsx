import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  listAssessedWines,
  type AssessedWine,
  type AssessedWineFilters,
  type Availability,
  type Confidence,
  type Fit,
  type SourceType,
} from "../api/assessmentHistory";
import type { ApiClient } from "../api/apiClient";
import {
  ApiErrorState,
  Button,
  EmptyState,
  Skeleton,
  StatusBadge,
  WineCard,
} from "../components/Primitives";
import { PageHeading } from "./PlaceholderPages";

const sourceOptions = [
  ["", "All sources"],
  ["retailer", "Retailer wines"],
  ["manual", "Manual wines"],
] as const;

const availabilityOptions = [
  ["", "Any availability"],
  ["current_retailer", "Current retailer listings"],
  ["removed_retailer", "Removed retailer listings"],
  ["active_manual", "Active manual wines"],
  ["deleted_manual", "Deleted manual wines"],
  ["no_longer_listed", "No longer listed"],
] as const;

const fitOptions = [
  ["", "Any fit"],
  ["strong", "Strong fit"],
  ["good", "Good fit"],
  ["maybe", "Maybe"],
  ["poor", "Poor fit"],
] as const;

const confidenceOptions = [
  ["", "Any confidence"],
  ["high", "High"],
  ["medium_high", "Medium-high"],
  ["medium", "Medium"],
  ["low", "Low"],
] as const;

const highlightOptions = [
  ["", "Highlights and other wines"],
  ["true", "Highlights only"],
  ["false", "Not highlighted"],
] as const;

const fitLabels: Record<Fit, string> = {
  strong: "Strong fit",
  good: "Good fit",
  maybe: "Maybe",
  poor: "Poor fit",
};

const confidenceLabels: Record<Confidence, string> = {
  high: "High confidence",
  medium_high: "Medium-high confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const availabilityLabels: Record<Availability, string> = {
  current_retailer: "In stock",
  removed_retailer: "Removed retailer listing",
  active_manual: "Active manual wine",
  deleted_manual: "Deleted manual wine",
};

const allowedSources = new Set<SourceType>(["retailer", "manual"]);
const allowedAvailability = new Set([
  "current_retailer",
  "removed_retailer",
  "active_manual",
  "deleted_manual",
  "no_longer_listed",
]);
const allowedFits = new Set<Fit>(["strong", "good", "maybe", "poor"]);
const allowedConfidence = new Set<Confidence>([
  "high",
  "medium_high",
  "medium",
  "low",
]);

function filtersFromSearchParams(
  searchParams: URLSearchParams,
): AssessedWineFilters {
  const q = searchParams.get("q")?.trim();
  const sourceType = searchParams.get("source");
  const availability = searchParams.get("availability");
  const fit = searchParams.get("fit");
  const confidence = searchParams.get("confidence");
  const highlight = searchParams.get("highlight");

  return {
    ...(q ? { q } : {}),
    ...(sourceType && allowedSources.has(sourceType as SourceType)
      ? { sourceType: sourceType as SourceType }
      : {}),
    ...(availability && allowedAvailability.has(availability)
      ? {
          availability:
            availability === "no_longer_listed"
              ? "removed_retailer,deleted_manual"
              : availability,
        }
      : {}),
    ...(fit && allowedFits.has(fit as Fit) ? { fit: fit as Fit } : {}),
    ...(confidence && allowedConfidence.has(confidence as Confidence)
      ? { confidence: confidence as Confidence }
      : {}),
    ...(highlight === "true" || highlight === "false" ? { highlight } : {}),
  };
}

function uniqueWines(pages: { items: AssessedWine[] }[]): AssessedWine[] {
  const wines = new Map<string, AssessedWine>();

  for (const page of pages) {
    for (const wine of page.items) {
      if (!wines.has(wine.sourceKey)) {
        wines.set(wine.sourceKey, wine);
      }
    }
  }

  return [...wines.values()];
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="history-filter">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function wineDetails(wine: AssessedWine): string {
  const details = [
    wine.wine.region,
    wine.wine.grape,
    wine.sourceType === "retailer"
      ? wine.retailerLabel ?? "Retailer wine"
      : "Manually entered",
  ].filter(Boolean);

  return details.join(" · ");
}

function fitTone(fit: Fit): "positive" | "warning" | "neutral" {
  if (fit === "strong" || fit === "good") {
    return "positive";
  }

  return fit === "poor" ? "warning" : "neutral";
}

function HistoryWineCard({
  wine,
  search,
}: {
  wine: AssessedWine;
  search: string;
}) {
  const isCurrentRetailer = wine.wine.availability === "current_retailer";

  return (
    <WineCard
      name={wine.wine.name ?? "Unnamed wine"}
      vintage={wine.wine.vintage ?? "Vintage unknown"}
      details={wineDetails(wine)}
      aside={
        isCurrentRetailer && wine.wine.currentPrice
          ? `£${wine.wine.currentPrice.amount}`
          : undefined
      }
    >
      <div className="history-card__badges">
        <StatusBadge>
          {wine.sourceType === "retailer" ? "Retailer" : "Manual"}
        </StatusBadge>
        <StatusBadge
          tone={
            wine.wine.availability === "current_retailer" ||
            wine.wine.availability === "active_manual"
              ? "positive"
              : "warning"
          }
        >
          {availabilityLabels[wine.wine.availability]}
        </StatusBadge>
        <StatusBadge tone={fitTone(wine.latestAssessment.fit)}>
          {fitLabels[wine.latestAssessment.fit]}
        </StatusBadge>
        <StatusBadge>{confidenceLabels[wine.latestAssessment.confidence]}</StatusBadge>
        {wine.latestAssessment.highlight && (
          <StatusBadge tone="positive">Highlight</StatusBadge>
        )}
        <StatusBadge tone={wine.freshness.isCurrent ? "positive" : "warning"}>
          {wine.freshness.isCurrent ? "Assessment current" : "Assessment needs review"}
        </StatusBadge>
      </div>
      <p className="history-card__headline">
        {wine.latestAssessment.headline ?? "Assessment details available"}
      </p>
      <div className="history-card__footer">
        <span>
          {wine.assessmentCount}{" "}
          {wine.assessmentCount === 1 ? "assessment" : "assessments"} · Last
          assessed {formatDate(wine.lastAssessedAt)}
        </span>
        <Link
          className="text-link"
          to={{
            pathname: encodeURIComponent(wine.sourceKey),
            search,
          }}
        >
          View history →
        </Link>
      </div>
    </WineCard>
  );
}

export function AssessedWineHistoryPage({
  apiClient,
}: {
  apiClient: ApiClient;
}) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftSearch, setDraftSearch] = useState(searchParams.get("q") ?? "");
  const filterKey = searchParams.toString();
  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  );

  useEffect(() => {
    setDraftSearch(searchParams.get("q") ?? "");
  }, [searchParams]);

  const assessedWines = useInfiniteQuery({
    queryKey: ["assessed-wines", filterKey],
    queryFn: ({ pageParam }) =>
      listAssessedWines(apiClient, filters, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const wines = uniqueWines(assessedWines.data?.pages ?? []);

  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);

    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }

    setSearchParams(next, { replace: true });
  };

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateFilter("q", draftSearch.trim());
  };

  const clearFilters = () => {
    setDraftSearch("");
    setSearchParams({}, { replace: true });
  };

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Previously assessed"
        title="Assessment history"
        description="Find assessed wines and revisit each version without confusing fit with whether an assessment is still current."
      />

      <section className="history-controls" aria-label="Search and filters">
        <form className="history-search" role="search" onSubmit={applySearch}>
          <label htmlFor="history-search">Search wine name or vintage</label>
          <div>
            <input
              id="history-search"
              value={draftSearch}
              maxLength={120}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="e.g. Barolo or 2019"
            />
            <Button type="submit">Search</Button>
          </div>
        </form>

        <div className="history-filters">
          <FilterSelect
            id="history-source"
            label="Source"
            value={searchParams.get("source") ?? ""}
            options={sourceOptions}
            onChange={(value) => updateFilter("source", value)}
          />
          <FilterSelect
            id="history-availability"
            label="Availability"
            value={searchParams.get("availability") ?? ""}
            options={availabilityOptions}
            onChange={(value) => updateFilter("availability", value)}
          />
          <FilterSelect
            id="history-fit"
            label="Fit"
            value={searchParams.get("fit") ?? ""}
            options={fitOptions}
            onChange={(value) => updateFilter("fit", value)}
          />
          <FilterSelect
            id="history-confidence"
            label="Confidence"
            value={searchParams.get("confidence") ?? ""}
            options={confidenceOptions}
            onChange={(value) => updateFilter("confidence", value)}
          />
          <FilterSelect
            id="history-highlight"
            label="Highlight"
            value={searchParams.get("highlight") ?? ""}
            options={highlightOptions}
            onChange={(value) => updateFilter("highlight", value)}
          />
        </div>

        {filterKey && (
          <Button variant="quiet" onClick={clearFilters}>
            Clear search and filters
          </Button>
        )}
      </section>

      <section aria-label="Assessed wines" aria-live="polite">
        {assessedWines.isPending && (
          <div className="history-list">
            <Skeleton label="Loading assessed wines" />
            <Skeleton label="Loading assessed wines" />
          </div>
        )}

        {assessedWines.isError && !assessedWines.isFetchNextPageError && (
          <ApiErrorState
            error={assessedWines.error}
            onRetry={() => void assessedWines.refetch()}
          />
        )}

        {!assessedWines.isPending && !assessedWines.isError && wines.length === 0 && (
          <EmptyState
            title="No assessed wines found"
            message="Try broadening your search or clearing one of the filters."
            action={
              filterKey ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear search and filters
                </Button>
              ) : undefined
            }
          />
        )}

        {wines.length > 0 && (
          <div className="history-list">
            {wines.map((wine) => (
              <HistoryWineCard
                key={wine.sourceKey}
                wine={wine}
                search={location.search}
              />
            ))}
          </div>
        )}

        {assessedWines.isFetchNextPageError && (
          <div className="history-pagination-error" role="alert">
            <p>We could not load the next wines. Your current results are unchanged.</p>
            <Button
              variant="secondary"
              onClick={() => void assessedWines.fetchNextPage()}
            >
              Try loading more again
            </Button>
          </div>
        )}

        {wines.length > 0 && !assessedWines.isFetchNextPageError && (
          <div className="history-pagination">
            {assessedWines.hasNextPage ? (
              <Button
                variant="secondary"
                disabled={assessedWines.isFetchingNextPage}
                onClick={() => void assessedWines.fetchNextPage()}
              >
                {assessedWines.isFetchingNextPage
                  ? "Loading more…"
                  : "Load more"}
              </Button>
            ) : (
              <p>You have reached the end of your assessment history.</p>
            )}
          </div>
        )}
      </section>

      <Outlet />
    </div>
  );
}
