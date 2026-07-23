import { Link } from "react-router-dom";
import { EmptyState, InlineBanner, StatusBadge } from "../components/Primitives";

export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

export function HomePage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Your cellar companion"
        title="Wines chosen for the way you taste."
        description="GrapeScrape brings retailer stock, your palate and clear assessments together in one calm place."
      />
      <section className="foundation-grid" aria-label="GrapeScrape sections">
        <Link className="foundation-card foundation-card--feature" to="/wines">
          <span className="eyebrow">Explore</span>
          <h2>Find your next bottle</h2>
          <p>
            Browse current retailer wines and see how each one fits your
            palate.
          </p>
          <span className="text-link">Browse wines →</span>
        </Link>
        <Link className="foundation-card" to="/palate">
          <StatusBadge tone="positive">Personal</StatusBadge>
          <h2>Your palate</h2>
          <p>
            Shape recommendations with the styles and bottles that matter to
            you.
          </p>
          <span className="text-link">View palate →</span>
        </Link>
        <Link className="foundation-card" to="/history">
          <StatusBadge>Saved</StatusBadge>
          <h2>Assessment history</h2>
          <p>Return to earlier assessments and see how a wine was judged.</p>
          <span className="text-link">Open history →</span>
        </Link>
      </section>
      <InlineBanner>
        Feature data will appear as the catalogue, palate and history APIs are
        connected in their dedicated tickets.
      </InlineBanner>
    </div>
  );
}

function FeaturePlaceholder({
  eyebrow,
  title,
  description,
  emptyTitle,
  emptyMessage,
}: {
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyMessage: string;
}) {
  return (
    <div className="page-stack">
      <PageHeading eyebrow={eyebrow} title={title} description={description} />
      <section className="content-panel">
        <EmptyState title={emptyTitle} message={emptyMessage} />
      </section>
    </div>
  );
}

export function WinesPage() {
  return (
    <FeaturePlaceholder
      eyebrow="Current stock"
      title="Available wines"
      description="Search retailer stock and compare each wine with your palate."
      emptyTitle="The catalogue is on its way"
      emptyMessage="Current-stock browsing will be connected in the catalogue feature ticket."
    />
  );
}

export function PalatePage() {
  return (
    <FeaturePlaceholder
      eyebrow="Your preferences"
      title="Palate profile"
      description="Describe the styles you seek out and the bottles that have shaped your taste."
      emptyTitle="Your palate editor is on its way"
      emptyMessage="Profile editing will be connected after the versioned palate API is available."
    />
  );
}

export function AssessWinePage() {
  return (
    <FeaturePlaceholder
      eyebrow="A bottle of your own"
      title="Assess a wine"
      description="Add a wine that is not in retailer stock and assess it against your current palate."
      emptyTitle="Manual assessment is on its way"
      emptyMessage="The manual-wine workflow will be connected once its API is available."
    />
  );
}

export function NotFoundPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Not found"
        title="That page is not in the cellar."
        description="The address may be out of date, or the page may have moved."
      />
      <p>
        <Link className="text-link" to="/">
          Return home →
        </Link>
      </p>
    </div>
  );
}
