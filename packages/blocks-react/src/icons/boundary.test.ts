/**
 * The icon set reaches only the entries that render on a server.
 *
 * The blocks render in the editor's canvas too, in the browser, so a block
 * importing the set would put every icon in the editor's bundle. Asked of the
 * BUILT entries, following each one's relative imports to the chunks it
 * loads, because a bundler may hoist the data into a chunk an entry shares:
 * what decides the cost is the graph the browser loads, not the source a
 * person reads.
 *
 * @module icons/boundary.test
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");

/**
 * Every built file an entry loads, itself included: through static imports
 * alone, or through dynamic `import()` too, which is everything it can EVER
 * load.
 */
function loadedBy(entry: string, through: "static" | "any" = "any"): string[] {
  const pattern =
    through === "static"
      ? /from\s*"(\.{1,2}\/[^"]+)"/g
      : /(?:from\s*|import\s*\(\s*)"(\.{1,2}\/[^"]+)"/g;
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(pattern)) {
      if (specifier !== undefined) visit(join(dirname(file), specifier));
    }
  };
  visit(join(DIST, entry));
  return [...seen];
}

/**
 * The set's three tables, each of which a bundler can keep or drop on its
 * own: an entry importing only the bodies would carry them without the
 * aliases. The build keeps each table's declared name, which no other code
 * declares.
 */
const TABLES = ["LUCIDE_ICONS", "LUCIDE_ALIASES", "LUCIDE_TAGS"];

/** Which of the set's tables a built file declares. */
const tablesIn = (file: string): string[] => {
  const source = readFileSync(file, "utf8");
  return TABLES.filter(table =>
    new RegExp(`\\b(?:const|let|var)\\s+${table}\\b`).test(source)
  );
};

/** Whether a built file carries any of the icon data. */
const carriesIcons = (file: string): boolean => tablesIn(file).length > 0;

describe("the icon set's reach", () => {
  it("is carried by the server entries, so the check can see it", () => {
    // The control: without it, a probe that never matched would pass below.
    // Every table is seen, so the probe is not one table's.
    const seen = new Set(loadedBy("icons/lucide.mjs").flatMap(tablesIn));
    expect([...seen].sort()).toEqual([...TABLES].sort());
    expect(loadedBy("icons/lucide.mjs").some(carriesIcons)).toBe(true);
    expect(loadedBy("next.mjs").some(carriesIcons)).toBe(true);
  });

  it("is loaded by the server only when a page draws an icon", () => {
    // Not on its static graph: a render, or a cold start, that draws no icon
    // never parses the set.
    for (const entry of ["next.mjs", "icons/lucide.mjs"]) {
      expect(loadedBy(entry, "static").filter(carriesIcons), entry).toEqual([]);
    }
  });

  it("can never be loaded by the renderer, the blocks or the client entry", () => {
    for (const entry of ["index.mjs", "blocks/index.mjs", "environment.mjs"]) {
      expect(loadedBy(entry).filter(carriesIcons), entry).toEqual([]);
    }
  });
});
