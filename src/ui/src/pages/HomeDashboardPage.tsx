import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, type ApiClient } from "../api/apiClient";
import {
  getCurrentPalateProfile,
  getHomeRecommendations,
  getRecentAssessments,
  getRecentlyAddedWines,
  type AssessmentFreshness,
  type AssessedWine,
  type CatalogueWine,
  type Confidence,
  type Fit,
  type PalateProfile,
} from "../api/homeDashboardApi";
import { useApiClient } from "../api/useApiClient";
import {
  ApiErrorState,
  EmptyState,
  Skeleton,
  StatusBadge,
} from "../components/Primitives";
import type { PublicConfig } from "../config";

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

const freshnessLabels: Record<AssessmentFreshness["status"], string> = {
  current: "Current assessment",
  palate_profile_changed: "Palate changed",
  source_changed: "Wine details changed",
  palate_profile_and_source_changed: "Palate and wine changed",
  unassessed: "Unassessed",
};

const preferenceDimensions: Array<keyof PalateProfile["stylePreferences"]> = [
  "body",
  "fruitRipeness",
  "fruitCharacter",
  "texture",
  "oakInfluence",
  "tannin",
  "acidity",
  "development",
  "styleTags",
];

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function displayDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function displayPreference(value: string) {
  return value.replaceAll("_", " ");
}

function priceLabel({ amount }: CatalogueWine["currentPrice"]) {
  return `£${amount}`;
}

function freshnessTone(status: AssessmentFreshness["status"]) {
  if (status === "current") {
    return "positive";
  }

  return status === "unassessed" ? "neutral" : "warning";
}

function SectionHeader({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="dashboard-section-heading">
      <h2 id={id}>{title}</h2>
      {action}
    </div>
  );
}

function RecommendationCard({ wine }: { wine: CatalogueWine }) {
  const assessment = wine.latestAssessment;

  if (!assessment) {
    return null;
  }

  return (
    <article className="recommendation-card">
      <div className="recommendation-card__heading">
        <div>
          <h3 className="recommendation-card__name">
            <span aria-label="Recommended">★</span> {wine.name}{" "}
            <span>{wine.vintage}</span>
          </h3>
          <p>
            {[wine.region, wine.retailerLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
        <p className="recommendation-card__price">
          {priceLabel(wine.currentPrice)}
        </p>
      </div>
      <div className="recommendation-card__metadata">
        <StatusBadge tone="positive">{fitLabels[assessment.fit]}</StatusBadge>
        <StatusBadge>{confidenceLabels[assessment.confidence]}</StatusBadge>
        <StatusBadge tone={freshnessTone(wine.freshness.status)}>
          {freshnessLabels[wine.freshness.status]}
        </StatusBadge>
      </div>
      {assessment.headline && (
        <p className="recommendation-card__headline">
          “{assessment.headline}”
        </p>
      )}
    </article>
  );
}

function RecommendationsSection({
  query,
}: {
  query: ReturnType<typeof useRecommendations>;
}) {
  return (
    <section aria-labelledby="recommendations-heading">
      <SectionHeader
        id="recommendations-heading"
        title="Top recommendations"
        action={
          <Link className="text-link" to="/wines">
            Browse all wines →
          </Link>
        }
      />
      {query.isPending && (
        <div className="dashboard-skeletons" aria-label="Loading recommendations">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} label="Loading recommendation" />
          ))}
        </div>
      )}
      {query.isError && (
        <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.isSuccess && query.data.length === 0 && (
        <EmptyState
          title="No recommendations yet"
          message="Highlighted matches will appear here after current retailer wines have completed assessments."
          action={
            <Link className="text-link" to="/wines">
              Browse current wines →
            </Link>
          }
        />
      )}
      {query.isSuccess && query.data.length > 0 && (
        <div className="recommendation-list">
          {query.data.map((wine) => (
            <RecommendationCard key={wine.sourceKey} wine={wine} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecentlyAddedSection({
  query,
}: {
  query: ReturnType<typeof useRecentlyAdded>;
}) {
  return (
    <section aria-labelledby="recently-added-heading">
      <SectionHeader
        id="recently-added-heading"
        title="Recently added by retailers"
      />
      {query.isPending && <Skeleton label="Loading recently added wines" />}
      {query.isError && (
        <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.isSuccess && query.data.length === 0 && (
        <EmptyState
          title="No recently added wines"
          message="New current listings will appear here when retailers add them."
        />
      )}
      {query.isSuccess && query.data.length > 0 && (
        <ol className="recent-wine-list">
          {query.data.map((wine) => (
            <li key={wine.sourceKey}>
              <div>
                <p className="recent-wine-list__name">
                  {wine.name} <span>{wine.vintage}</span>
                </p>
                <p>
                  {wine.retailerLabel} · Added{" "}
                  <time dateTime={wine.firstSeenAt}>
                    {displayDate(wine.firstSeenAt)}
                  </time>
                </p>
              </div>
              <div className="recent-wine-list__aside">
                <span>{priceLabel(wine.currentPrice)}</span>
                <StatusBadge
                  tone={wine.latestAssessment ? "positive" : "neutral"}
                >
                  {wine.latestAssessment ? "Assessed" : "Unassessed"}
                </StatusBadge>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function preferenceSummary(
  profile: PalateProfile,
  kind: "preferred" | "avoided",
) {
  return preferenceDimensions
    .flatMap((dimension) => profile.stylePreferences[dimension][kind])
    .map(displayPreference)
    .slice(0, 6);
}

function PalateSection({
  query,
}: {
  query: ReturnType<typeof usePalateProfile>;
}) {
  if (query.isPending) {
    return (
      <section className="dashboard-side-card" aria-label="Loading palate profile">
        <Skeleton label="Loading palate profile" />
      </section>
    );
  }

  if (query.isError) {
    const missingProfile =
      query.error instanceof ApiError &&
      query.error.code === "PALATE_PROFILE_NOT_FOUND";

    return (
      <section className="dashboard-side-card" aria-labelledby="palate-heading">
        <h2 id="palate-heading">Your palate</h2>
        {missingProfile ? (
          <EmptyState
            title="Add your palate profile"
            message="Create a profile before asking GrapeScrape to assess wines for you."
            action={
              <Link className="text-link" to="/palate">
                Create profile →
              </Link>
            }
          />
        ) : (
          <ApiErrorState
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )}
      </section>
    );
  }

  const preferred = preferenceSummary(query.data, "preferred");
  const avoided = preferenceSummary(query.data, "avoided");
  const enjoyed = query.data.wineExamples.filter(
    (wine) => wine.sentiment === "enjoyed",
  ).length;
  const notEnjoyed = query.data.wineExamples.length - enjoyed;

  return (
    <section className="dashboard-side-card" aria-labelledby="palate-heading">
      <div className="dashboard-side-card__heading">
        <h2 id="palate-heading">Your palate</h2>
        <StatusBadge tone="positive">
          v{query.data.palateProfileVersion}
        </StatusBadge>
      </div>
      <dl className="preference-summary">
        <div>
          <dt>Prefers</dt>
          <dd>
            {preferred.length > 0
              ? preferred.join(", ")
              : "No preferred styles saved"}
          </dd>
        </div>
        <div>
          <dt>Avoids</dt>
          <dd>
            {avoided.length > 0 ? avoided.join(", ") : "No avoided styles saved"}
          </dd>
        </div>
      </dl>
      <div className="palate-counts" aria-label="Palate example counts">
        <div>
          <strong>{enjoyed}</strong>
          <span>enjoyed</span>
        </div>
        <div>
          <strong>{notEnjoyed}</strong>
          <span>not enjoyed</span>
        </div>
      </div>
      <p className="dashboard-timestamp">
        Updated{" "}
        <time dateTime={query.data.updatedAt}>
          {displayDate(query.data.updatedAt)}
        </time>
      </p>
      <Link className="button button--secondary dashboard-card-action" to="/palate">
        View or edit profile
      </Link>
    </section>
  );
}

function assessmentSourceLabel(item: AssessedWine) {
  if (item.sourceType === "manual") {
    return "Manual wine";
  }

  return item.retailerLabel ?? "Retailer wine";
}

function RecentAssessmentsSection({
  query,
}: {
  query: ReturnType<typeof useRecentAssessments>;
}) {
  return (
    <section className="dashboard-side-card" aria-labelledby="assessments-heading">
      <div className="dashboard-side-card__heading">
        <h2 id="assessments-heading">Recent assessments</h2>
        <Link className="text-link" to="/history">
          View all →
        </Link>
      </div>
      {query.isPending && <Skeleton label="Loading recent assessments" />}
      {query.isError && (
        <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.isSuccess && query.data.length === 0 && (
        <p className="dashboard-card-empty">
          Completed assessments will appear here.
        </p>
      )}
      {query.isSuccess && query.data.length > 0 && (
        <ol className="assessment-list">
          {query.data.map((item) => (
            <li key={item.sourceKey}>
              <div>
                <p>
                  {item.wine.name ?? "Unnamed wine"}{" "}
                  <span>{item.wine.vintage ?? ""}</span>
                </p>
                <small>
                  {assessmentSourceLabel(item)} ·{" "}
                  <time dateTime={item.lastAssessedAt}>
                    {displayDate(item.lastAssessedAt)}
                  </time>
                </small>
              </div>
              <StatusBadge tone="positive">
                {fitLabels[item.latestAssessment.fit]}
              </StatusBadge>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const quickActions = [
  {
    to: "/wines",
    title: "Browse all wines",
    description: "Explore current retailer stock.",
  },
  {
    to: "/palate",
    title: "Edit palate profile",
    description: "Refine the preferences behind each assessment.",
  },
  {
    to: "/history",
    title: "Review history",
    description: "Return to completed wine assessments.",
  },
  {
    to: "/assess",
    title: "Assess a manual wine",
    description: "Add a bottle that is not in retailer stock.",
  },
];

function QuickActions() {
  return (
    <section aria-labelledby="quick-actions-heading">
      <SectionHeader id="quick-actions-heading" title="Quick actions" />
      <div className="quick-action-grid">
        {quickActions.map((action) => (
          <Link key={action.to} to={action.to}>
            <strong>{action.title}</strong>
            <span>{action.description}</span>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function useRecommendations(apiClient: ApiClient) {
  return useQuery({
    queryKey: ["home", "recommendations"],
    queryFn: () => getHomeRecommendations(apiClient),
  });
}

function useRecentlyAdded(apiClient: ApiClient) {
  return useQuery({
    queryKey: ["home", "recently-added"],
    queryFn: () => getRecentlyAddedWines(apiClient),
  });
}

function usePalateProfile(apiClient: ApiClient) {
  return useQuery({
    queryKey: ["home", "palate-profile"],
    queryFn: () => getCurrentPalateProfile(apiClient),
  });
}

function useRecentAssessments(apiClient: ApiClient) {
  return useQuery({
    queryKey: ["home", "recent-assessments"],
    queryFn: () => getRecentAssessments(apiClient),
  });
}

export function HomeDashboardPage({
  apiClient,
}: {
  apiClient: ApiClient;
}) {
  const recommendations = useRecommendations(apiClient);
  const recentlyAdded = useRecentlyAdded(apiClient);
  const palateProfile = usePalateProfile(apiClient);
  const recentAssessments = useRecentAssessments(apiClient);

  return (
    <div className="page-stack home-dashboard">
      <header className="home-dashboard__intro">
        <p className="eyebrow">Your cellar companion</p>
        <h1>Wines chosen for the way you taste.</h1>
        <p>
          Current bottles, recent discoveries and your latest assessments in
          one calm overview.
        </p>
      </header>
      <div className="home-dashboard__layout">
        <div className="home-dashboard__main">
          <RecommendationsSection query={recommendations} />
          <RecentlyAddedSection query={recentlyAdded} />
        </div>
        <aside className="home-dashboard__side" aria-label="Your GrapeScrape summary">
          <PalateSection query={palateProfile} />
          <RecentAssessmentsSection query={recentAssessments} />
        </aside>
      </div>
      <QuickActions />
    </div>
  );
}

export function HomeDashboardRoute({ config }: { config: PublicConfig }) {
  return <HomeDashboardPage apiClient={useApiClient(config)} />;
}
