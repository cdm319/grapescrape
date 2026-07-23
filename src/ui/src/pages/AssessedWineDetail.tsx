import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  getAssessedWine,
  listAssessments,
  type Assessment,
  type AssessmentEvidence,
  type AssessedWine,
  type Confidence,
  type Fit,
  type FreshnessStatus,
} from "../api/assessmentHistory";
import type { ApiClient } from "../api/apiClient";
import {
  ApiErrorState,
  Button,
  DetailDrawer,
  Skeleton,
  StatusBadge,
} from "../components/Primitives";

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

const freshnessLabels: Record<FreshnessStatus, string> = {
  current: "Current for this wine and your palate",
  palate_profile_changed: "Your palate profile has changed",
  source_changed: "The wine details have changed",
  palate_profile_and_source_changed:
    "Your palate profile and the wine details have changed",
  unassessed: "Not yet assessed",
};

const availabilityLabels = {
  current_retailer: "In stock",
  removed_retailer: "Removed retailer listing",
  active_manual: "Active manual wine",
  deleted_manual: "Deleted manual wine",
} as const;

const evidenceSourceLabels: Record<string, string> = {
  "wine.name": "Wine name",
  "wine.region": "Region",
  "wine.vintage": "Vintage",
  "wine.grape": "Grape",
  "wine.alcohol": "Alcohol",
  "wine.description": "Wine description",
  general_wine_knowledge: "General wine knowledge",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function uniqueAssessments(pages: { items: Assessment[] }[]): Assessment[] {
  const assessments = new Map<string, Assessment>();

  for (const page of pages) {
    for (const assessment of page.items) {
      if (!assessments.has(assessment.assessmentInputKey)) {
        assessments.set(assessment.assessmentInputKey, assessment);
      }
    }
  }

  return [...assessments.values()];
}

function EvidenceList({ evidence }: { evidence: AssessmentEvidence[] }) {
  return (
    <ul className="assessment-evidence">
      {evidence.map((item, index) => (
        <li key={`${item.source}-${index}`}>
          <span>
            {item.type === "direct" ? "Direct evidence" : "Inferred evidence"} ·{" "}
            {evidenceSourceLabels[item.source] ?? "Assessment evidence"}
          </span>
          <p>{item.text}</p>
        </li>
      ))}
    </ul>
  );
}

function TextList({
  items,
  emptyMessage,
}: {
  items: string[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <p className="assessment-section__empty">{emptyMessage}</p>;
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function AssessmentDetails({
  assessment,
  latest,
}: {
  assessment: Assessment;
  latest: boolean;
}) {
  return (
    <details className="assessment-version" open={latest}>
      <summary>
        <span>
          Assessment version {assessment.assessmentVersion}
          {latest ? " · Latest" : ""}
        </span>
        <span>{formatDate(assessment.completedAt)}</span>
      </summary>
      <div className="assessment-version__body">
        <div className="assessment-version__badges">
          <StatusBadge
            tone={
              assessment.fit === "strong" || assessment.fit === "good"
                ? "positive"
                : assessment.fit === "poor"
                  ? "warning"
                  : "neutral"
            }
          >
            {fitLabels[assessment.fit]}
          </StatusBadge>
          <StatusBadge>{confidenceLabels[assessment.confidence]}</StatusBadge>
          {assessment.highlight && (
            <StatusBadge tone="positive">Highlight</StatusBadge>
          )}
        </div>

        <h3>{assessment.headline ?? "Assessment details"}</h3>
        {assessment.summary && <p className="assessment-summary">{assessment.summary}</p>}
        <p className="assessment-profile-version">
          Assessed against palate profile version {assessment.palateProfileVersion}
        </p>

        <div className="assessment-sections">
          <details>
            <summary>Reasons ({assessment.reasons.length})</summary>
            <TextList
              items={assessment.reasons}
              emptyMessage="No reasons were recorded for this historic assessment."
            />
          </details>
          <details>
            <summary>Cautions ({assessment.cautions.length})</summary>
            <TextList
              items={assessment.cautions}
              emptyMessage="No cautions were recorded."
            />
          </details>
          <details>
            <summary>Evidence ({assessment.evidence.length})</summary>
            <EvidenceList evidence={assessment.evidence} />
          </details>
          <details>
            <summary>Assumptions ({assessment.assumptions.length})</summary>
            <TextList
              items={assessment.assumptions}
              emptyMessage="No assumptions were recorded."
            />
          </details>
        </div>
      </div>
    </details>
  );
}

function WineSummary({ wine }: { wine: AssessedWine }) {
  const isCurrentRetailer = wine.wine.availability === "current_retailer";

  return (
    <section className="history-detail-summary">
      <p className="history-detail-summary__identity">
        {[wine.wine.vintage, wine.wine.region, wine.wine.grape]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="history-detail-summary__badges">
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
      </div>

      {isCurrentRetailer && wine.wine.currentPrice && (
        <p className="history-detail-summary__price">
          Current price <strong>£{wine.wine.currentPrice.amount}</strong>
        </p>
      )}

      <div className="freshness-panel">
        <div>
          <span>Latest fit</span>
          <strong>{fitLabels[wine.latestAssessment.fit]}</strong>
        </div>
        <div>
          <span>Assessment freshness</span>
          <strong>{freshnessLabels[wine.freshness.status]}</strong>
        </div>
      </div>

      {!wine.freshness.isCurrent && (
        <p className="freshness-explanation">
          Assessment version {wine.latestAssessment.assessmentVersion} keeps its
          original fit and confidence. It used palate profile version{" "}
          {wine.freshness.assessedPalateProfileVersion ?? "unknown"}; your current
          profile is version {wine.freshness.currentPalateProfileVersion ?? "not set"}.
        </p>
      )}
    </section>
  );
}

export function AssessedWineDetail({ apiClient }: { apiClient: ApiClient }) {
  const { sourceKey = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const close = () =>
    navigate(
      {
        pathname: "/history",
        search: location.search,
      },
      { replace: true },
    );

  const assessedWine = useQuery({
    queryKey: ["assessed-wine", sourceKey],
    queryFn: () => getAssessedWine(apiClient, sourceKey),
    enabled: sourceKey.length > 0,
  });

  const assessmentHistory = useInfiniteQuery({
    queryKey: ["assessment-history", sourceKey],
    queryFn: ({ pageParam }) =>
      listAssessments(apiClient, sourceKey, pageParam ?? undefined),
    enabled: sourceKey.length > 0,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const assessments = uniqueAssessments(assessmentHistory.data?.pages ?? []);

  return (
    <DetailDrawer
      open
      title={assessedWine.data?.wine.name ?? "Wine assessment history"}
      onClose={close}
    >
      <div className="history-detail">
        {(assessedWine.isPending || assessmentHistory.isPending) && (
          <>
            <Skeleton label="Loading wine history" />
            <Skeleton label="Loading assessments" />
          </>
        )}

        {assessedWine.isError && (
          <ApiErrorState
            error={assessedWine.error}
            onRetry={() => void assessedWine.refetch()}
          />
        )}

        {assessedWine.data && <WineSummary wine={assessedWine.data} />}

        {assessmentHistory.isError && !assessmentHistory.isFetchNextPageError && (
          <ApiErrorState
            error={assessmentHistory.error}
            onRetry={() => void assessmentHistory.refetch()}
          />
        )}

        {assessments.length > 0 && (
          <section className="assessment-timeline" aria-labelledby="assessment-history-title">
            <div className="assessment-timeline__heading">
              <div>
                <p className="eyebrow">Version history</p>
                <h2 id="assessment-history-title">Completed assessments</h2>
              </div>
              <span>
                {assessedWine.data?.assessmentCount ?? assessments.length} total
              </span>
            </div>
            <p className="assessment-timeline__note">
              Newest versions appear first. Freshness above describes the latest
              assessment only.
            </p>
            <div className="assessment-timeline__items">
              {assessments.map((assessment, index) => (
                <AssessmentDetails
                  key={assessment.assessmentInputKey}
                  assessment={assessment}
                  latest={index === 0}
                />
              ))}
            </div>
          </section>
        )}

        {assessmentHistory.isFetchNextPageError && (
          <div className="history-pagination-error" role="alert">
            <p>We could not load the older assessments.</p>
            <Button
              variant="secondary"
              onClick={() => void assessmentHistory.fetchNextPage()}
            >
              Try loading older assessments again
            </Button>
          </div>
        )}

        {assessments.length > 0 && !assessmentHistory.isFetchNextPageError && (
          <div className="history-pagination">
            {assessmentHistory.hasNextPage ? (
              <Button
                variant="secondary"
                disabled={assessmentHistory.isFetchingNextPage}
                onClick={() => void assessmentHistory.fetchNextPage()}
              >
                {assessmentHistory.isFetchingNextPage
                  ? "Loading older assessments…"
                  : "Load older assessments"}
              </Button>
            ) : (
              <p>All completed assessments are shown.</p>
            )}
          </div>
        )}
      </div>
    </DetailDrawer>
  );
}
