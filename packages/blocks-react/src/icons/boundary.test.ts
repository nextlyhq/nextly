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

/** Every built file an entry loads, itself included. */
function loadedBy(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(/from\s*"(\.{1,2}\/[^"]+)"/g)) {
      if (specifier !== undefined) visit(join(dirname(file), specifier));
    }
  };
  visit(join(DIST, entry));
  return [...seen];
}

/** Whether a built file carries the icon data, by an alias only the data holds. */
const carriesIcons = (file: string): boolean =>
  readFileSync(file, "utf8").includes('"activity-square"');

describe("the icon set's reach", () => {
  it("is carried by the server entries, so the check can see it", () => {
    // The control: without it, a probe that never matched would pass below.
    expect(loadedBy("icons/lucide.mjs").some(carriesIcons)).toBe(true);
    expect(loadedBy("next.mjs").some(carriesIcons)).toBe(true);
  });

  it("is not loaded by the renderer, the blocks or the client entry", () => {
    for (const entry of ["index.mjs", "blocks/index.mjs", "environment.mjs"]) {
      expect(loadedBy(entry).filter(carriesIcons), entry).toEqual([]);
    }
  });
});
