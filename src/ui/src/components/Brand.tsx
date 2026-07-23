import { Link } from "react-router-dom";

function GrapeScrapeMark() {
  return (
    <svg
      aria-hidden="true"
      className="brand-mark"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="9.6" stroke="currentColor" strokeWidth="2.1" opacity=".18" />
      <circle
        cx="12"
        cy="12"
        r="9.6"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeDasharray="43.4 60.3"
        transform="rotate(-90 12 12)"
      />
      <circle cx="2.9" cy="13.8" r="1.9" fill="currentColor" />
      <path
        d="M8 6.9c.3 6.1 7.7 6.1 8 0M12 11.6v3.7M9.6 15.3h4.8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ linked = false }: { linked?: boolean }) {
  const content = (
    <>
      <GrapeScrapeMark />
      <span className="brand-name">GrapeScrape</span>
    </>
  );

  if (linked) {
    return (
      <Link className="brand" to="/" aria-label="GrapeScrape home">
        {content}
      </Link>
    );
  }

  return (
    <span className="brand" aria-label="GrapeScrape">
      {content}
    </span>
  );
}
