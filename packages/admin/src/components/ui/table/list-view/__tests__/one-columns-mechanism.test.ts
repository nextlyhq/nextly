/**
 * "Which columns has this reader hidden" has ONE implementation.
 *
 * `useColumnVisibility` owns the storage. `useListColumns` adapts it to the
 * shape `ListView` renders, and is the only thing product code should reach
 * for. A surface that calls the storage hook directly gets a second spelling of
 * the same question — which is how the entry list ended up with its own
 * visibility record while ten other lists used a predicate, and how a reader's
 * choice came to persist on one list and evaporate on the rest.
 *
 * There is a second, sharper reason this is a boundary rather than advice: the
 * storage hook re-reads in an effect keyed on its ARRAY arguments, so an inline
 * `defaultVisible` loops forever. `useListColumns` keys by value and prevents
 * it. Calling the storage hook directly re-opens that trap.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** The adapter, and the hook's own definition and tests, may name it. */
const ALLOWED = [
  join("hooks", "useColumnVisibility.ts"),
  join("hooks", "index.ts"),
  join("list-view", "useListColumns.ts"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("one columns mechanism", () => {
  const files = walk(SRC);

  /**
   * Population before verdict: a scan that reached nothing reports no direct
   * callers in exactly the same words as a clean one. Asserted by MEMBERSHIP,
   * because a count passes on any set of the right size.
   */
  it("reads the admin source, including both hooks", () => {
    // `relative`, not a prefix strip: the scan builds paths with the
    // platform separator, so stripping a hardcoded `/` leaves every path
    // absolute on Windows and the membership check below can never match.
    const rel = files.map(f => relative(SRC, f));
    expect(rel).toContain(join("hooks", "useColumnVisibility.ts"));
    expect(rel).toContain(
      join("components", "ui", "table", "list-view", "useListColumns.ts")
    );
  });

  it("has no product code calling the storage hook directly", () => {
    const offenders = files
      .filter(file => !ALLOWED.some(allowed => file.endsWith(allowed)))
      .filter(file => /useColumnVisibility/.test(readFileSync(file, "utf8")))
      .map(file => relative(SRC, file));

    expect(
      offenders,
      "These call `useColumnVisibility` directly. Use `useListColumns` from " +
        "`components/ui/table/list-view` instead: it is the one adapter, and " +
        "it stabilises its array arguments by value, which the storage hook " +
        "requires and does not enforce."
    ).toEqual([]);
  });
});
