/**
 * Coverage gate. Loads the catalog and the probe registry, and proves every
 * catalog key is exercised by at least one probe (a curated deep probe or an
 * auto-probe). Fails the build if any key is uncovered, or if a curated probe
 * claims a key that doesn't exist in the catalog (typo guard). Writes
 * coverage.json for the README table.
 *
 * Run: npm run coverage  (also runs automatically via `prebuild`).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CATALOG, CATALOG_KEYS } from "../src/catalog.js";
import { CURATED_PROBES, allProbes } from "../src/registry.js";

const catalogKeys = new Set(CATALOG_KEYS);
const probes = allProbes();

const covered = new Set<string>();
const beyondClaims: string[] = [];
for (const p of probes) {
  for (const k of p.keys) {
    if (catalogKeys.has(k)) covered.add(k);
    else beyondClaims.push(`${p.id} → ${k}`);
  }
}

const richClaimed = new Set<string>();
for (const p of CURATED_PROBES) for (const k of p.keys) if (catalogKeys.has(k)) richClaimed.add(k);

const missing = [...catalogKeys].filter((k) => !covered.has(k));

// Per-category breakdown for the README.
const byCat: Record<string, { total: number; rich: number }> = {};
for (const e of CATALOG) {
  const c = (byCat[e.category] ??= { total: 0, rich: 0 });
  c.total++;
  if (richClaimed.has(e.key)) c.rich++;
}

const coverage = {
  generatedBy: "scripts/coverage-check.ts",
  totalCatalogKeys: catalogKeys.size,
  covered: covered.size,
  missing,
  richCovered: richClaimed.size,
  autoCovered: covered.size - richClaimed.size,
  curatedProbes: CURATED_PROBES.length,
  totalProbes: probes.length,
  beyondCatalogClaims: beyondClaims,
  byCategory: Object.fromEntries(
    Object.entries(byCat)
      .sort()
      .map(([c, v]) => [c, { total: v.total, rich: v.rich, auto: v.total - v.rich }]),
  ),
};

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "..", "coverage.json"), JSON.stringify(coverage, null, 2));

const pct = Math.round((covered.size / catalogKeys.size) * 100);
console.log(`xray-scanner coverage: ${covered.size}/${catalogKeys.size} catalog keys (${pct}%)`);
console.log(`  curated (rich) probes: ${CURATED_PROBES.length} claiming ${richClaimed.size} keys`);
console.log(`  auto-probes: ${probes.length - CURATED_PROBES.length} covering ${covered.size - richClaimed.size} keys`);

let failed = false;
if (missing.length) {
  failed = true;
  console.error(`\n✗ ${missing.length} catalog key(s) have NO probe:`);
  for (const k of missing.slice(0, 40)) console.error(`    ${k}`);
  if (missing.length > 40) console.error(`    … and ${missing.length - 40} more`);
}
if (beyondClaims.length) {
  failed = true;
  console.error(`\n✗ ${beyondClaims.length} curated probe claim(s) reference a key not in the catalog (typo?):`);
  for (const b of beyondClaims) console.error(`    ${b}`);
}

if (failed) {
  console.error("\nCoverage gate FAILED.");
  process.exit(1);
}
console.log("\n✓ Coverage gate passed — every catalog key is probed. coverage.json written.");
