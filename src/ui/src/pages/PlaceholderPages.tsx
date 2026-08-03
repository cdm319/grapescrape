import { Link } from "react-router-dom";
import { EmptyState } from "../components/Primitives";

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
