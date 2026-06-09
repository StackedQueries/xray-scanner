/**
 * Calibration + invariant tests for the stealth scoring model (SPEC §10.1).
 * Run: `npm test` (tsx, node:assert — no extra deps).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { score, SCORE_SCHEMA_VERSION, SCORING_CONFIG, type ScoreInput } from "../src/scoring.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  coherenceScore: number;
  signals: Record<string, unknown>;
  rows: ScoreInput["rows"];
}

function load(name: string): ScoreInput {
  const f = JSON.parse(readFileSync(join(here, "fixtures", name), "utf8")) as Fixture;
  return { coherenceScore: f.coherenceScore, rows: f.rows, signals: new Map(Object.entries(f.signals)) };
}

let failures = 0;
function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${label}\n    ${(e as Error).message}`);
  }
}

console.log("scoring — calibration anchors");

const clean = score(load("clean-real-browser.json"));
check("clean real browser scores >= 90", () => assert.ok(clean.stealthScore >= 90, `got ${clean.stealthScore}`));
check("clean real browser trips no hard-fails", () => assert.equal(clean.hardFails.length, 0));
check("clean real browser has no leaks", () => assert.equal(clean.leaks.length, 0));

const bot = score(load("vanilla-automation.json"));
check("vanilla automation trips >= 1 hard-fail", () => assert.ok(bot.hardFails.length >= 1, `got ${bot.hardFails.length}`));
check("vanilla automation flags navigator.webdriver hard-fail", () => assert.ok(bot.hardFails.includes("navigator.webdriver")));
check("vanilla automation flags getEventListeners (CDP) hard-fail", () => assert.ok(bot.hardFails.includes("getEventListeners")));
check(`vanilla automation scores <= hardCap (${SCORING_CONFIG.hardCap})`, () => assert.ok(bot.stealthScore <= SCORING_CONFIG.hardCap, `got ${bot.stealthScore}`));
check("vanilla automation exposes its leaks for the bypass join", () => assert.ok(bot.leaks.length >= 2));

console.log("scoring — invariants");
check("clean is stealthier than bot", () => assert.ok(clean.stealthScore > bot.stealthScore));
check("schema version is set on results", () => assert.equal(bot.scoreSchemaVersion, SCORE_SCHEMA_VERSION));
check("stabilityScore null on single run, honored when passed", () => {
  assert.equal(clean.stealthScore >= 0, true);
  const withStab = score(load("clean-real-browser.json"), 100);
  assert.equal(withStab.stabilityScore, 100);
  assert.equal(clean.stabilityScore, null);
});
check("an added clean (pass) row never lowers stealth", () => {
  const base = load("clean-real-browser.json");
  const plus: ScoreInput = { ...base, rows: [...base.rows, { key: "navigator.vendor", verdict: "pass", severity: "low", botDetectionTell: false, layer: "L1a" }] };
  assert.ok(score(plus).stealthScore >= clean.stealthScore);
});

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall scoring checks passed");
