import { Link } from "react-router-dom";
import { EmptyState } from "../components/Primitives";

function PageHeading({
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

export function HistoryPage() {
  return (
    <FeaturePlaceholder
      eyebrow="Previously assessed"
      title="Assessment history"
      description="Revisit assessments while keeping fit and freshness easy to distinguish."
      emptyTitle="Your history is on its way"
      emptyMessage="Assessed-wine history will be connected in its dedicated feature ticket."
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
