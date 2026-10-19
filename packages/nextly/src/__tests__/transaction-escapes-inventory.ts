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

import { INVENTORY_ENV, UNKNOWN_SITE } from "./transaction-escapes";

export interface InventoryLine {
  dialect: string;
  key: string;
  accepted: boolean;
  testFile?: string;
}

/** Names the inventory file the forks append to, and prints it at teardown. */
export default function setup(): () => void {
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
    console.log(describeInventory(parse(text)));
  };
}

function parse(text: string): InventoryLine[] {
  return text
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(line => JSON.parse(line) as InventoryLine);
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
