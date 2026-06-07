import raw from "./catalog.generated.json";
import type { CatalogEntry } from "./types.js";

export const CATALOG: CatalogEntry[] = raw as CatalogEntry[];

export const CATALOG_BY_KEY = new Map(CATALOG.map((e) => [e.key, e]));

export const CATALOG_KEYS: string[] = CATALOG.map((e) => e.key);

export const CATEGORIES: string[] = [...new Set(CATALOG.map((e) => e.category))].sort();

export function entry(key: string): CatalogEntry | undefined {
  return CATALOG_BY_KEY.get(key);
}
