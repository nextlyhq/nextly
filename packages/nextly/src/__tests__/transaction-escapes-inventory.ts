/**
 * The integration run's inventory of transaction escapes (`./transaction-escapes`).
 *
 * Every escape the suites report, accepted ones included, is appended to one
 * file by the forks that run them, and printed at the end of the run grouped by
 * dialect and call site, with the test files that reached each site. The list
 * of accepted escapes is built from this output, and a run's log is where it
 * came from, so the inventory has to be in the log rather than in a worker's
 * memory. It also prints how many reports named no call site: a stack cut off
 * before the code that made the query.
 *
 * @module __tests__/transaction-escapes-inventory
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TestProject } from "vitest/node";

import { KNOWN_ESCAPES } from "./transaction-escape-baseline";
import {
  INVENTORY_ENV,
  type KnownEscape,
  UNKNOWN_SITE,
} from "./transaction-escapes";

export interface InventoryLine {
  dialect: string;
  key: string;
  accepted: boolean;
  testFile?: string;
}

/**
 * Names the inventory file the forks append to, and at teardown prints it and
 * fails the run on a known escape that stopped happening (`staleKnownEscapes`).
 * A run filtered by test name skips that check: the witness's file ran, but
 * not all of it.
 */
export default function setup(project: TestProject): () => void {
  const dir = mkdtempSync(join(tmpdir(), "nextly-transaction-escapes-"));
  const log = join(dir, "escapes.jsonl");
  // Set before the forks start, so each inherits it.
  process.env[INVENTORY_ENV] = log;
  return () => {
    let text = "";
    try {
      text = readFileSync(log, "utf8");
    } catch {
      // No escape was reported, so nothing was appended.
    }
    rmSync(dir, { recursive: true, force: true });
    const { lines, ran } = parse(text);
    console.log(describeInventory(lines));
    if (project.config.testNamePattern !== undefined) return;
    const stale = staleKnownEscapes(KNOWN_ESCAPES, lines, ran, legDialects());
    if (stale.length > 0) throw new Error(describeStale(stale));
  };
}

/** The inventory's escapes, and the test files that ran, from `packages/` on. */
function parse(text: string): {
  lines: InventoryLine[];
  ran: Set<string>;
} {
  const lines: InventoryLine[] = [];
  const ran = new Set<string>();
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    const entry = JSON.parse(raw) as InventoryLine | { ran: string };
    if ("ran" in entry) ran.add(fromPackages(entry.ran));
    else lines.push(entry);
  }
  return { lines, ran };
}

/** The server dialects this run reaches: those whose database URL is set. */
function legDialects(): Set<string> {
  const dialects = new Set<string>();
  if (process.env.TEST_POSTGRES_URL) dialects.add("postgresql");
  if (process.env.TEST_MYSQL_URL) dialects.add("mysql");
  return dialects;
}

/**
 * The known escapes that stopped happening: the witness ran, on a dialect the
 * run reaches, and did not reach the entry. Each is either fixed, and its
 * entry is deleted, or still reached by other files, and given one of them as
 * its witness. This is what keeps the baseline shrinking.
 */
export function staleKnownEscapes(
  known: readonly KnownEscape[],
  lines: readonly InventoryLine[],
  ran: ReadonlySet<string>,
  dialects: ReadonlySet<string>
): KnownEscape[] {
  return known.filter(
    entry =>
      dialects.has(entry.dialect) &&
      ran.has(entry.witness) &&
      !lines.some(
        line =>
          line.dialect === entry.dialect &&
          line.key === entry.key &&
          fromPackages(line.testFile) === entry.witness
      )
  );
}

/** The failure for `stale` known escapes, naming each and what to do. */
function describeStale(stale: readonly KnownEscape[]): string {
  return (
    `${String(stale.length)} known transaction escape(s) no longer happen in ` +
    `the test file named as their witness. Delete each fixed one from ` +
    `src/__tests__/transaction-escape-baseline.ts, or name another test file ` +
    `that still reaches it (see the inventory above).\n` +
    stale
      .map(
        entry => `- ${entry.dialect} ${entry.key} (witness ${entry.witness})`
      )
      .join("\n")
  );
}

/** The test file from `packages/` on, as the keys spell files. */
function fromPackages(file: string | undefined): string {
  if (file === undefined) return "(unknown test file)";
  const at = file.indexOf("packages/");
  return at >= 0 ? file.slice(at) : file;
}

/** The inventory as text: per dialect, each site with its count and test files. */
export function describeInventory(lines: readonly InventoryLine[]): string {
  const unknown = lines.filter(line => line.key === UNKNOWN_SITE).length;
  const share =
    lines.length === 0 ? 0 : Math.round((unknown / lines.length) * 1000) / 10;
  const dialects = [...new Set(lines.map(line => line.dialect))].sort();
  return [
    `[transaction escapes] inventory: ${String(lines.length)} report(s), ` +
      `${String(unknown)} (${String(share)}%) with no call site`,
    ...dialects.flatMap(dialect =>
      describeDialect(
        dialect,
        lines.filter(line => line.dialect === dialect)
      )
    ),
  ].join("\n");
}

/** One dialect's sites, sorted, each with its count and the test files that reached it. */
function describeDialect(
  dialect: string,
  lines: readonly InventoryLine[]
): string[] {
  const bySite = new Map<string, InventoryLine[]>();
  for (const line of lines) {
    bySite.set(line.key, [...(bySite.get(line.key) ?? []), line]);
  }
  const sites = [...bySite.entries()].sort(([a], [b]) => a.localeCompare(b));
  return [
    `${dialect}:`,
    ...sites.flatMap(([key, group]) => [
      `  ${String(group.length)}x ${key}${group.some(line => line.accepted) ? " (accepted)" : ""}`,
      ...[...new Set(group.map(line => fromPackages(line.testFile)))]
        .sort()
        .map(file => `      ${file}`),
    ]),
  ];
}
