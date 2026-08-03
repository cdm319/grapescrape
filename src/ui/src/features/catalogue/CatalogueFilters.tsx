import type { FormEvent } from "react";
import type { CatalogueFilters } from "../../api/catalogueApi";
import type { Confidence, Fit, FreshnessStatus } from "../../api/assessmentHistory";
import { Button } from "../../components/Primitives";

export interface FilterDraft {
  q: string;
  retailerId: string;
  region: string;
  grape: string;
  minPrice: string;
  maxPrice: string;
  fit: string;
  confidence: string;
  highlight: string;
  freshness: string;
}

export const filterNames: (keyof FilterDraft)[] = [
  "q",
  "retailerId",
  "region",
  "grape",
  "minPrice",
  "maxPrice",
  "fit",
  "confidence",
  "highlight",
  "freshness",
];

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

const freshnessOptions = [
  ["", "Any freshness"],
  ["current", "Assessment current"],
  ["palate_profile_changed", "Palate profile changed"],
  ["source_changed", "Wine details changed"],
  ["palate_profile_and_source_changed", "Palate and wine changed"],
  ["unassessed", "Unassessed"],
] as const;

export const sortOptions = [
  ["fit:desc", "Best fit"],
  ["price:asc", "Price: low to high"],
  ["price:desc", "Price: high to low"],
  ["name:asc", "Name: A to Z"],
  ["name:desc", "Name: Z to A"],
  ["first_seen:desc", "Newest listing"],
] as const;

export function filterDraftFromSearch(
  searchParams: URLSearchParams,
): FilterDraft {
  return {
    q: searchParams.get("q") ?? "",
    retailerId: searchParams.get("retailerId") ?? "",
    region: searchParams.get("region") ?? "",
    grape: searchParams.get("grape") ?? "",
    minPrice: searchParams.get("minPrice") ?? "",
    maxPrice: searchParams.get("maxPrice") ?? "",
    fit: searchParams.get("fit") ?? "",
    confidence: searchParams.get("confidence") ?? "",
    highlight: searchParams.get("highlight") ?? "",
    freshness: searchParams.get("freshness") ?? "",
  };
}

export function catalogueFiltersFromSearch(
  searchParams: URLSearchParams,
): CatalogueFilters {
  const draft = filterDraftFromSearch(searchParams);
  const sort = searchParams.get("sort") ?? "name";
  const direction = searchParams.get("direction") ?? "asc";

  return {
    ...(draft.q ? { q: draft.q } : {}),
    ...(draft.retailerId ? { retailerId: draft.retailerId } : {}),
    ...(draft.region ? { region: draft.region } : {}),
    ...(draft.grape ? { grape: draft.grape } : {}),
    ...(draft.minPrice ? { minPrice: draft.minPrice } : {}),
    ...(draft.maxPrice ? { maxPrice: draft.maxPrice } : {}),
    ...(draft.fit ? { fit: draft.fit as Fit } : {}),
    ...(draft.confidence
      ? { confidence: draft.confidence as Confidence }
      : {}),
    ...(draft.highlight === "true" || draft.highlight === "false"
      ? { highlight: draft.highlight }
      : {}),
    ...(draft.freshness
      ? { freshness: draft.freshness as FreshnessStatus }
      : {}),
    sort: sort as CatalogueFilters["sort"],
    direction: direction as CatalogueFilters["direction"],
  };
}

export function CatalogueFilterForm({
  idPrefix,
  draft,
  error,
  onChange,
  onSubmit,
  onClear,
}: {
  idPrefix: string;
  draft: FilterDraft;
  error?: string;
  onChange: (name: keyof FilterDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
}) {
  return (
    <form className="catalogue-filter-form" onSubmit={onSubmit}>
      <label className="catalogue-search-field" htmlFor={`${idPrefix}-q`}>
        <span>Search name or vintage</span>
        <input
          id={`${idPrefix}-q`}
          value={draft.q}
          maxLength={120}
          placeholder="e.g. Barolo or 2019"
          onChange={(event) => onChange("q", event.target.value)}
        />
      </label>
      <FilterSelect
        id={`${idPrefix}-retailer`}
        label="Retailer"
        value={draft.retailerId}
        options={[["", "All retailers"], ["tws", "The Wine Society"]]}
        onChange={(value) => onChange("retailerId", value)}
      />
      <label htmlFor={`${idPrefix}-region`}>
        <span>Region</span>
        <input
          id={`${idPrefix}-region`}
          value={draft.region}
          maxLength={120}
          placeholder="Any region"
          onChange={(event) => onChange("region", event.target.value)}
        />
      </label>
      <label htmlFor={`${idPrefix}-grape`}>
        <span>Grape</span>
        <input
          id={`${idPrefix}-grape`}
          value={draft.grape}
          maxLength={120}
          placeholder="Any grape"
          onChange={(event) => onChange("grape", event.target.value)}
        />
      </label>
      <label htmlFor={`${idPrefix}-min-price`}>
        <span>Minimum price</span>
        <input
          id={`${idPrefix}-min-price`}
          value={draft.minPrice}
          inputMode="decimal"
          placeholder="£0.00"
          onChange={(event) => onChange("minPrice", event.target.value)}
        />
      </label>
      <label htmlFor={`${idPrefix}-max-price`}>
        <span>Maximum price</span>
        <input
          id={`${idPrefix}-max-price`}
          value={draft.maxPrice}
          inputMode="decimal"
          placeholder="No maximum"
          onChange={(event) => onChange("maxPrice", event.target.value)}
        />
      </label>
      <FilterSelect
        id={`${idPrefix}-fit`}
        label="Fit"
        value={draft.fit}
        options={fitOptions}
        onChange={(value) => onChange("fit", value)}
      />
      <FilterSelect
        id={`${idPrefix}-confidence`}
        label="Confidence"
        value={draft.confidence}
        options={confidenceOptions}
        onChange={(value) => onChange("confidence", value)}
      />
      <FilterSelect
        id={`${idPrefix}-highlight`}
        label="Highlight"
        value={draft.highlight}
        options={[["", "Highlights and other wines"], ["true", "Highlights only"], ["false", "Not highlighted"]]}
        onChange={(value) => onChange("highlight", value)}
      />
      <FilterSelect
        id={`${idPrefix}-freshness`}
        label="Freshness"
        value={draft.freshness}
        options={freshnessOptions}
        onChange={(value) => onChange("freshness", value)}
      />
      {error && <p className="field-error catalogue-filter-error">{error}</p>}
      <div className="catalogue-filter-actions">
        <Button type="submit">Apply filters</Button>
        <Button variant="quiet" onClick={onClear}>Clear all</Button>
      </div>
    </form>
  );
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
    <label htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

export function validatePriceRange(
  minPrice: string,
  maxPrice: string,
): string | undefined {
  const pricePattern = /^\d+(?:\.\d{1,2})?$/;
  if (minPrice && !pricePattern.test(minPrice)) {
    return "Minimum price must be a non-negative GBP amount with at most two decimal places.";
  }
  if (maxPrice && !pricePattern.test(maxPrice)) {
    return "Maximum price must be a non-negative GBP amount with at most two decimal places.";
  }
  if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
    return "Minimum price must not exceed maximum price.";
  }
  return undefined;
}
