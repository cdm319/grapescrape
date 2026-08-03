import { Link } from "react-router-dom";

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
