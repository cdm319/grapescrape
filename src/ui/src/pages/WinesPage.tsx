import { useInfiniteQuery } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import type { ApiClient } from "../api/apiClient";
import {
  listCatalogueWines,
  requestCatalogueAssessments,
  type CatalogueWine,
} from "../api/catalogueApi";
import {
  pollAssessmentUntilComplete,
  type AssessmentPollingStatus,
  type AssessmentRequest,
} from "../api/manualWineApi";
import {
  CatalogueFilterForm,
  catalogueFiltersFromSearch,
  filterDraftFromSearch,
  filterNames,
  sortOptions,
  validatePriceRange,
} from "../features/catalogue/CatalogueFilters";
import {
  CatalogueMobileCard,
  CatalogueTableRow,
  CatalogueWineDetails,
  RequestSummary,
  isBusy,
  type AssessmentState,
} from "../features/catalogue/CatalogueWinePresentation";
import {
  ApiErrorState,
  Button,
  DetailDrawer,
  EmptyState,
  InlineBanner,
  Modal,
  Skeleton,
} from "../components/Primitives";
import { PageHeading } from "./PlaceholderPages";

type PollAssessment = typeof pollAssessmentUntilComplete;


function uniqueCatalogueWines(
  pages: { items: CatalogueWine[] }[],
): CatalogueWine[] {
  const wines = new Map<string, CatalogueWine>();

  for (const page of pages) {
    for (const wine of page.items) {
      if (!wines.has(wine.sourceKey)) {
        wines.set(wine.sourceKey, wine);
      }
    }
  }

  return [...wines.values()];
}

export function WinesPage({
  apiClient,
  pollAssessment = pollAssessmentUntilComplete,
}: {
  apiClient: ApiClient;
  pollAssessment?: PollAssessment;
}) {
  const mounted = useRef(true);
  const submissionInFlight = useRef(false);
  const filterSheet = useRef<HTMLElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterDraft, setFilterDraft] = useState(() =>
    filterDraftFromSearch(searchParams),
  );
  const [filterError, setFilterError] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedWines, setSelectedWines] = useState<
    Record<string, CatalogueWine>
  >({});
  const [selectionReviewOpen, setSelectionReviewOpen] = useState(false);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const [detailWine, setDetailWine] = useState<CatalogueWine>();
  const [confirmationWines, setConfirmationWines] = useState<CatalogueWine[]>(
    [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string>();
  const [assessmentStates, setAssessmentStates] = useState<
    Record<string, AssessmentState>
  >({});
  const [requestSummary, setRequestSummary] = useState<{
    queuedNames: string[];
    failedNames: string[];
  }>();

  const filterKey = searchParams.toString();
  const filters = useMemo(
    () => catalogueFiltersFromSearch(searchParams),
    [searchParams],
  );
  const catalogue = useInfiniteQuery({
    queryKey: ["catalogue-wines", filterKey],
    queryFn: ({ pageParam }) =>
      listCatalogueWines(apiClient, filters, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const wines = uniqueCatalogueWines(catalogue.data?.pages ?? []);
  const selected = Object.values(selectedWines);
  const visibleSourceKeys = new Set(wines.map((wine) => wine.sourceKey));
  const hiddenSelectionCount = selected.filter(
    (wine) => !visibleSourceKeys.has(wine.sourceKey),
  ).length;
  const activeFilterCount = filterNames.filter(
    (name) => searchParams.get(name),
  ).length;
  const selectedHasBusyWine = selected.some((wine) =>
    isBusy(assessmentStates[wine.sourceKey]),
  );

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setFilterDraft(filterDraftFromSearch(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (filtersOpen) {
      filterSheet.current?.focus();
    }
  }, [filtersOpen]);

  const setAssessmentState = (
    sourceKey: string,
    state: AssessmentState,
  ) => {
    if (!mounted.current) {
      return;
    }

    setAssessmentStates((current) => ({ ...current, [sourceKey]: state }));
  };

  const pollQueuedAssessments = (requests: AssessmentRequest[]) => {
    void Promise.all(
      requests.map(async (request) => {
        try {
          const result = await pollAssessment({
            apiClient,
            request,
            shouldContinue: () => mounted.current,
            onStatus: (status: AssessmentPollingStatus) => {
              setAssessmentState(request.sourceKey, { status });
            },
          });

          if (result.status === "completed") {
            setAssessmentState(request.sourceKey, { status: "completed" });
            if (mounted.current) {
              void catalogue.refetch();
            }
          } else if (result.status === "timed_out") {
            setAssessmentState(request.sourceKey, {
              status: "timed_out",
              message:
                "This assessment is taking longer than expected. It may still complete in the background.",
            });
          }
        } catch (error) {
          setAssessmentState(request.sourceKey, {
            status: "error",
            message: safeErrorMessage(
              error,
              "The completed assessment could not be checked. You can try again.",
            ),
          });
        }
      }),
    );
  };

  const toggleSelection = (wine: CatalogueWine) => {
    setSelectedWines((current) => {
      if (current[wine.sourceKey]) {
        const next = { ...current };
        delete next[wine.sourceKey];
        setSelectionAnnouncement(
          `${wine.name} removed. ${Object.keys(next).length} selected.`,
        );
        return next;
      }

      if (Object.keys(current).length >= 25) {
        setSelectionAnnouncement(
          "The 25-wine selection limit has been reached.",
        );
        return current;
      }

      const next = { ...current, [wine.sourceKey]: wine };
      setSelectionAnnouncement(
        `${wine.name} selected. ${Object.keys(next).length} selected.`,
      );
      return next;
    });
  };

  const selectVisible = () => {
    setSelectedWines((current) => {
      const unselected = wines.filter(
        (wine) => !current[wine.sourceKey] && !isBusy(assessmentStates[wine.sourceKey]),
      );
      const additions = unselected.slice(0, 25 - Object.keys(current).length);
      const next = { ...current };

      for (const wine of additions) {
        next[wine.sourceKey] = wine;
      }

      setSelectionAnnouncement(
        `${Object.keys(next).length} wines selected${
          additions.length < unselected.length
            ? "; the 25-wine selection limit has been reached"
            : ""
        }.`,
      );
      return next;
    });
  };

  const deselectVisible = () => {
    setSelectedWines((current) => {
      const next = { ...current };
      for (const wine of wines) {
        delete next[wine.sourceKey];
      }
      setSelectionAnnouncement(
        `${wines.length} visible ${wines.length === 1 ? "wine" : "wines"} removed. ${Object.keys(next).length} selected.`,
      );
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedWines({});
    setSelectionReviewOpen(false);
    setSelectionAnnouncement("Selection cleared.");
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = validatePriceRange(filterDraft.minPrice, filterDraft.maxPrice);

    if (error) {
      setFilterError(error);
      return;
    }

    const next = new URLSearchParams(searchParams);

    for (const name of filterNames) {
      const value = filterDraft[name].trim();
      if (value) {
        next.set(name, value);
      } else {
        next.delete(name);
      }
    }

    next.delete("cursor");
    setSearchParams(next, { replace: true });
    setFilterError(undefined);
    setFiltersOpen(false);
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    for (const name of filterNames) {
      next.delete(name);
    }
    setSearchParams(next, { replace: true });
    setFilterDraft(filterDraftFromSearch(next));
    setFilterError(undefined);
    setFiltersOpen(false);
  };

  const updateSort = (value: string) => {
    const [sort, direction] = value.split(":");
    const next = new URLSearchParams(searchParams);
    next.set("sort", sort);
    next.set("direction", direction);
    setSearchParams(next, { replace: true });
  };

  const openAssessmentConfirmation = (winesToAssess: CatalogueWine[]) => {
    if (
      winesToAssess.length < 1 ||
      winesToAssess.length > 25 ||
      winesToAssess.some((wine) => isBusy(assessmentStates[wine.sourceKey]))
    ) {
      return;
    }

    setConfirmationWines(winesToAssess);
    setSubmissionError(undefined);
  };

  const closeAssessmentConfirmation = () => {
    if (!isSubmitting) {
      setConfirmationWines([]);
      setSubmissionError(undefined);
    }
  };

  const submitAssessmentRequests = async () => {
    if (submissionInFlight.current || confirmationWines.length < 1) {
      return;
    }

    const sourceKeys = confirmationWines.map((wine) => wine.sourceKey);
    const namesBySourceKey = new Map(
      confirmationWines.map((wine) => [wine.sourceKey, wine.name]),
    );
    submissionInFlight.current = true;
    setIsSubmitting(true);
    setSubmissionError(undefined);
    setRequestSummary(undefined);
    for (const sourceKey of sourceKeys) {
      setAssessmentState(sourceKey, { status: "requesting" });
    }

    try {
      const result = await requestCatalogueAssessments(apiClient, sourceKeys);
      const queuedNames = result.queued.map(
        (request) => namesBySourceKey.get(request.sourceKey) ?? request.sourceKey,
      );
      const failedNames = result.notQueued.map(
        (request) => namesBySourceKey.get(request.sourceKey) ?? request.sourceKey,
      );

      for (const request of result.queued) {
        setAssessmentState(request.sourceKey, { status: "queued" });
      }
      for (const request of result.notQueued) {
        setAssessmentState(request.sourceKey, {
          status: "error",
          message:
            "This wine was not queued. Its allocated version was not submitted, so it is safe to request again.",
        });
      }

      setRequestSummary({ queuedNames, failedNames });
      setConfirmationWines([]);
      setSelectedWines({});
      setSelectionAnnouncement("Selection cleared after the assessment request.");
      pollQueuedAssessments(result.queued);
    } catch (error) {
      const message = safeErrorMessage(
        error,
        "The assessment request could not be submitted. No completed result has been confirmed.",
      );
      setSubmissionError(message);
      for (const sourceKey of sourceKeys) {
        setAssessmentState(sourceKey, { status: "error", message });
      }
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const allVisibleSelected =
    wines.length > 0 &&
    wines.every((wine) => Boolean(selectedWines[wine.sourceKey]));
  const sortValue = `${filters.sort}:${filters.direction}`;

  return (
    <div className="page-stack catalogue-page">
      <PageHeading
        eyebrow="Current stock"
        title="Available wines"
        description="Search current retailer stock, compare each wine with your palate and request fresh assessments when you choose."
      />

      {requestSummary && (
        <InlineBanner tone={requestSummary.failedNames.length ? "warning" : "info"}>
          <RequestSummary {...requestSummary} />
        </InlineBanner>
      )}

      <div className="catalogue-toolbar">
        <Button
          className="catalogue-filter-toggle"
          variant="secondary"
          onClick={() => setFiltersOpen(true)}
          aria-expanded={filtersOpen}
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </Button>
        <label className="catalogue-sort">
          <span>Sort</span>
          <select value={sortValue} onChange={(event) => updateSort(event.target.value)}>
            {sortOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="catalogue-filters catalogue-filters--desktop" aria-label="Catalogue filters">
        <CatalogueFilterForm
          idPrefix="catalogue"
          draft={filterDraft}
          error={filterError}
          onChange={(name, value) => {
            setFilterDraft((current) => ({ ...current, [name]: value }));
            setFilterError(undefined);
          }}
          onSubmit={applyFilters}
          onClear={clearFilters}
        />
      </section>

      {filtersOpen && (
        <div className="catalogue-filter-layer is-open">
          <button
            className="catalogue-filter-backdrop"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          />
          <aside
            ref={filterSheet}
            className="catalogue-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-filter-title"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setFiltersOpen(false);
              }
            }}
          >
            <div className="overlay-heading">
              <h2 id="mobile-filter-title">Catalogue filters</h2>
              <Button variant="quiet" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                ×
              </Button>
            </div>
            <CatalogueFilterForm
              idPrefix="mobile-catalogue"
              draft={filterDraft}
              error={filterError}
              onChange={(name, value) => {
                setFilterDraft((current) => ({ ...current, [name]: value }));
                setFilterError(undefined);
              }}
              onSubmit={applyFilters}
              onClear={clearFilters}
            />
          </aside>
        </div>
      )}

      {selected.length > 0 && (
        <section className="selection-bar" aria-label="Selected wines">
          <div>
            <strong>{selected.length} selected</strong>
            {hiddenSelectionCount > 0 && (
              <span>
                {hiddenSelectionCount} not currently visible. Your selection is preserved.
              </span>
            )}
          </div>
          <div>
            <Button variant="quiet" onClick={() => setSelectionReviewOpen(true)}>
              Review selection
            </Button>
            <Button variant="quiet" onClick={clearSelection}>
              Clear
            </Button>
            <Button
              onClick={() => openAssessmentConfirmation(selected)}
              disabled={selectedHasBusyWine}
            >
              Reassess selected ({selected.length})
            </Button>
          </div>
        </section>
      )}

      <p className="visually-hidden" aria-live="polite">
        {selectionAnnouncement}
      </p>

      {catalogue.isPending && (
        <div className="catalogue-loading">
          <Skeleton label="Loading current wines" />
          <Skeleton label="Loading current wines" />
          <Skeleton label="Loading current wines" />
        </div>
      )}
      {!catalogue.isPending && catalogue.isError && (
        <ApiErrorState error={catalogue.error} onRetry={() => void catalogue.refetch()} />
      )}
      {!catalogue.isPending && !catalogue.isError && wines.length === 0 && (
        <EmptyState
          title="No wines match those filters"
          message={
            hiddenSelectionCount > 0
              ? `${hiddenSelectionCount} selected ${hiddenSelectionCount === 1 ? "wine is" : "wines are"} hidden by the current filters. Review the selection or clear filters.`
              : "Try widening the price range or clearing a filter."
          }
          action={<Button variant="secondary" onClick={clearFilters}>Clear all filters</Button>}
        />
      )}
      {!catalogue.isPending && !catalogue.isError && wines.length > 0 && (
        <>
          <div className="catalogue-result-heading">
            <p>
              {wines.length} {wines.length === 1 ? "wine" : "wines"} loaded
            </p>
            <Button variant="quiet" onClick={selectVisible} disabled={allVisibleSelected || selected.length >= 25}>
              Select visible
            </Button>
          </div>

          <div className="catalogue-table-wrap">
            <table className="catalogue-table">
              <thead>
                <tr>
                  <th className="catalogue-select-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all visible wines"
                      checked={allVisibleSelected}
                      onChange={() => (allVisibleSelected ? deselectVisible() : selectVisible())}
                    />
                  </th>
                  <th>Wine</th>
                  <th>Retailer</th>
                  <th>Price</th>
                  <th>Fit</th>
                  <th>Confidence</th>
                  <th>Freshness</th>
                  <th><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {wines.map((wine) => (
                  <CatalogueTableRow
                    key={wine.sourceKey}
                    wine={wine}
                    selected={Boolean(selectedWines[wine.sourceKey])}
                    selectionFull={selected.length >= 25}
                    assessmentState={assessmentStates[wine.sourceKey]}
                    onSelect={() => toggleSelection(wine)}
                    onDetails={() => setDetailWine(wine)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="catalogue-mobile-list">
            {wines.map((wine) => (
              <CatalogueMobileCard
                key={wine.sourceKey}
                wine={wine}
                selected={Boolean(selectedWines[wine.sourceKey])}
                selectionFull={selected.length >= 25}
                assessmentState={assessmentStates[wine.sourceKey]}
                onSelect={() => toggleSelection(wine)}
                onDetails={() => setDetailWine(wine)}
              />
            ))}
          </div>

          <div className="catalogue-pagination">
            {catalogue.hasNextPage ? (
              <Button
                variant="secondary"
                onClick={() => void catalogue.fetchNextPage()}
                disabled={catalogue.isFetchingNextPage}
              >
                {catalogue.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : (
              <p>You have reached the end of the current catalogue.</p>
            )}
          </div>
        </>
      )}

      <DetailDrawer
        open={Boolean(detailWine)}
        title={detailWine?.name ?? "Wine details"}
        onClose={() => setDetailWine(undefined)}
      >
        {detailWine && (
          <CatalogueWineDetails
            wine={detailWine}
            assessmentState={assessmentStates[detailWine.sourceKey]}
            onAssess={() => openAssessmentConfirmation([detailWine])}
          />
        )}
      </DetailDrawer>

      {confirmationWines.length > 0 && (
        <Modal
          open
          title={confirmationWines.length === 1 ? "Request assessment?" : "Reassess selected wines?"}
          onClose={closeAssessmentConfirmation}
        >
          <div className="confirmation-content catalogue-confirmation">
            <p>
              This will request exactly <strong>{confirmationWines.length}</strong>{" "}
              OpenAI {confirmationWines.length === 1 ? "assessment" : "assessments"}.
              Each request may incur provider cost.
            </p>
            <ul>
              {confirmationWines.map((wine) => (
                <li key={wine.sourceKey}>{wine.name} {wine.vintage}</li>
              ))}
            </ul>
            {submissionError && <InlineBanner tone="error">{submissionError}</InlineBanner>}
            <div className="form-actions form-actions--end">
              <Button variant="secondary" onClick={closeAssessmentConfirmation} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={() => void submitAssessmentRequests()} disabled={isSubmitting}>
                {isSubmitting ? "Requesting…" : `Request ${confirmationWines.length} ${confirmationWines.length === 1 ? "assessment" : "assessments"}`}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {selectionReviewOpen && (
        <Modal
          open
          title="Review selected wines"
          onClose={() => setSelectionReviewOpen(false)}
        >
          <div className="confirmation-content selection-review">
            <p>
              {selected.length} selected. {hiddenSelectionCount} not currently visible.
            </p>
            <ul>
              {selected.map((wine) => (
                <li key={wine.sourceKey}>
                  <span>{wine.name} {wine.vintage}</span>
                  <Button variant="quiet" onClick={() => toggleSelection(wine)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div className="form-actions form-actions--end">
              <Button variant="secondary" onClick={() => setSelectionReviewOpen(false)}>Done</Button>
              <Button variant="quiet" onClick={clearSelection}>Clear selection</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
