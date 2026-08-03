import { Link } from "react-router-dom";
import type { CatalogueWine } from "../../api/catalogueApi";
import type { Confidence, Fit, FreshnessStatus } from "../../api/assessmentHistory";
import { Button, StatusBadge } from "../../components/Primitives";

export type AssessmentState =
  | { status: "requesting" | "queued" | "processing" | "completed" }
  | { status: "timed_out" | "error"; message: string };

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
  current: "Assessment current",
  palate_profile_changed: "Palate profile changed",
  source_changed: "Wine details changed",
  palate_profile_and_source_changed: "Palate and wine changed",
  unassessed: "No assessment yet",
};

interface CatalogueWineRowProps {
  wine: CatalogueWine;
  selected: boolean;
  selectionFull: boolean;
  assessmentState?: AssessmentState;
  onSelect: () => void;
  onDetails: () => void;
}

export function CatalogueTableRow({
  wine,
  selected,
  selectionFull,
  assessmentState,
  onSelect,
  onDetails,
}: CatalogueWineRowProps) {
  return (
    <tr>
      <td className="catalogue-select-cell">
        <input
          type="checkbox"
          aria-label={`Select ${wine.name} ${wine.vintage}`}
          checked={selected}
          disabled={!selected && (selectionFull || isBusy(assessmentState))}
          onChange={onSelect}
        />
      </td>
      <td>
        <strong>{wine.name} <span>{wine.vintage}</span></strong>
        <small>{wineDetails(wine)}</small>
        <TransientAssessmentLabel state={assessmentState} />
      </td>
      <td>{wine.retailerLabel}</td>
      <td className="catalogue-price">£{wine.currentPrice.amount}</td>
      <td><FitPresentation wine={wine} /></td>
      <td>{wine.latestAssessment ? confidenceLabels[wine.latestAssessment.confidence] : "—"}</td>
      <td><FreshnessPresentation wine={wine} /></td>
      <td><Button variant="quiet" onClick={onDetails}>Details</Button></td>
    </tr>
  );
}

export function CatalogueMobileCard({
  wine,
  selected,
  selectionFull,
  assessmentState,
  onSelect,
  onDetails,
}: CatalogueWineRowProps) {
  return (
    <article className="catalogue-mobile-card">
      <div className="catalogue-mobile-card__heading">
        <label>
          <input
            type="checkbox"
            aria-label={`Select ${wine.name} ${wine.vintage}`}
            checked={selected}
            disabled={!selected && (selectionFull || isBusy(assessmentState))}
            onChange={onSelect}
          />
          <span>Select</span>
        </label>
        <strong>£{wine.currentPrice.amount}</strong>
      </div>
      <h2>{wine.name} <span>{wine.vintage}</span></h2>
      <p>{wineDetails(wine)}</p>
      <div className="catalogue-mobile-card__badges">
        <FitPresentation wine={wine} />
        <FreshnessPresentation wine={wine} />
      </div>
      {wine.latestAssessment && (
        <p className="catalogue-card-confidence">
          {confidenceLabels[wine.latestAssessment.confidence]}
          {wine.latestAssessment.highlight ? " · Highlight" : ""}
        </p>
      )}
      <TransientAssessmentLabel state={assessmentState} />
      <Button variant="secondary" onClick={onDetails}>View details</Button>
    </article>
  );
}

export function CatalogueWineDetails({
  wine,
  assessmentState,
  onAssess,
}: {
  wine: CatalogueWine;
  assessmentState?: AssessmentState;
  onAssess: () => void;
}) {
  const assessment = wine.latestAssessment;

  return (
    <div className="catalogue-detail">
      <div className="catalogue-detail__identity">
        <p>{wine.vintage} · {wine.retailerLabel}</p>
        <strong>£{wine.currentPrice.amount}</strong>
      </div>
      <p>{wineDetails(wine)}</p>
      {wine.description && <p>{wine.description}</p>}
      <div className="catalogue-detail__badges">
        <FitPresentation wine={wine} />
        {assessment && <StatusBadge>{confidenceLabels[assessment.confidence]}</StatusBadge>}
        {assessment?.highlight && <StatusBadge tone="positive">Highlight</StatusBadge>}
        <FreshnessPresentation wine={wine} />
      </div>
      <TransientAssessmentLabel state={assessmentState} />

      {assessment ? (
        <section className="catalogue-assessment-summary" aria-labelledby="catalogue-assessment-title">
          <h3 id="catalogue-assessment-title">{assessment.headline ?? "Latest assessment"}</h3>
          {assessment.summary && <p>{assessment.summary}</p>}
          <details>
            <summary>Why it fits</summary>
            <ul>{assessment.reasons?.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </details>
          {assessment.cautions?.length > 0 && (
            <details>
              <summary>Cautions</summary>
              <ul>{assessment.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
            </details>
          )}
          <Link className="text-link" to={`/history/${encodeURIComponent(wine.sourceKey)}`}>
            View assessment history →
          </Link>
        </section>
      ) : (
        <p>This current wine has not been assessed against your palate yet.</p>
      )}

      <div className="form-actions">
        <Button onClick={onAssess} disabled={isBusy(assessmentState)}>
          {assessmentActionLabel(wine, assessmentState)}
        </Button>
      </div>
    </div>
  );
}

function FitPresentation({ wine }: { wine: CatalogueWine }) {
  if (!wine.latestAssessment) {
    return <StatusBadge>Unassessed</StatusBadge>;
  }

  return (
    <StatusBadge tone={fitTone(wine.latestAssessment.fit)}>
      {fitLabels[wine.latestAssessment.fit]}
    </StatusBadge>
  );
}

function FreshnessPresentation({ wine }: { wine: CatalogueWine }) {
  return (
    <StatusBadge tone={wine.freshness.isCurrent ? "positive" : "warning"}>
      {freshnessLabels[wine.freshness.status]}
    </StatusBadge>
  );
}

function TransientAssessmentLabel({ state }: { state?: AssessmentState }) {
  if (!state) {
    return null;
  }

  if (state.status === "error" || state.status === "timed_out") {
    return <p className="catalogue-request-status catalogue-request-status--error" role="alert">{state.message}</p>;
  }

  const messages = {
    requesting: "Requesting assessment…",
    queued: "Queued. The first completion check starts in two seconds.",
    processing: "Waiting for the completed assessment…",
    completed: "Assessment completed. Catalogue details are refreshing.",
  };

  return <p className="catalogue-request-status" role="status">{messages[state.status]}</p>;
}

export function RequestSummary({
  queuedNames,
  failedNames,
}: {
  queuedNames: string[];
  failedNames: string[];
}) {
  if (failedNames.length === 0) {
    return <span>{queuedNames.length} {queuedNames.length === 1 ? "assessment was" : "assessments were"} queued.</span>;
  }

  return (
    <div>
      <strong>{queuedNames.length} of {queuedNames.length + failedNames.length} assessments queued.</strong>
      <p>Not queued: {failedNames.join(", ")}. Request these wines again when ready.</p>
    </div>
  );
}

function wineDetails(wine: CatalogueWine): string {
  return [wine.region, wine.grape, wine.alcohol, wine.retailerLabel]
    .filter(Boolean)
    .join(" · ");
}

function fitTone(fit: Fit): "positive" | "warning" | "neutral" {
  if (fit === "strong" || fit === "good") return "positive";
  return fit === "poor" ? "warning" : "neutral";
}

function assessmentActionLabel(
  wine: CatalogueWine,
  state?: AssessmentState,
): string {
  if (state?.status === "requesting") return "Requesting…";
  if (state?.status === "queued") return "Queued";
  if (state?.status === "processing") return "Assessing…";
  if (state?.status === "error" || state?.status === "timed_out") return "Retry assessment";
  return wine.latestAssessment ? "Reassess" : "Request assessment";
}

export function isBusy(state?: AssessmentState): boolean {
  return (
    state?.status === "requesting" ||
    state?.status === "queued" ||
    state?.status === "processing"
  );
}
