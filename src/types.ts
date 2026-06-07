export type Severity = "info" | "low" | "medium" | "high";
/** Defense-in-depth layer a probe operates at (L1a static … L4 chronometric). */
export type DefenseLayer = "L1a" | "L1b" | "L2" | "L3" | "L4";
export type Verdict = "pass" | "suspect" | "bot" | "info";

/** One slim catalog entry (the committed snapshot the page probes against). */
export interface CatalogEntry {
  key: string;
  category: string;
  severity: Severity;
  botDetectionTell: boolean;
  layer: DefenseLayer | null;
  description: string;
  argMatch: string[] | null;
}

/** A single measured surface, shown as one row in the UI. */
export interface ProbeRow {
  /** Catalog key this row maps to, or a `beyond:` id for beyond-catalog probes. */
  key: string;
  /** Human-readable surface label. */
  surface: string;
  /** Measured value (monospace). */
  value: string;
  /** Whether the surface is present/available (null = indeterminate). */
  present: boolean | null;
  severity: Severity;
  botDetectionTell: boolean;
  layer: DefenseLayer | null;
  verdict: Verdict;
  /** Optional explanation, e.g. why a lie was detected. */
  note?: string;
  /** True when this probe has no corresponding catalog entry. */
  beyondCatalog?: boolean;
  /** Numeric/string signal contributed to the coherence engine. */
  signal?: { name: string; value: unknown };
  /** True for generic catalog-coverage auto-probes (excluded from the diag triad). */
  auto?: boolean;
}

export interface Probe {
  id: string;
  /** Catalog keys this probe claims for coverage. Empty for beyond-catalog. */
  keys: string[];
  run: () => ProbeRow[] | Promise<ProbeRow[]>;
}
