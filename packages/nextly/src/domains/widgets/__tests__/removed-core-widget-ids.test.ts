/**
 * The core widgets removed outright are named nowhere in the packages' source
 * but here, where their absence is asserted: no shim, alias or conversion
 * keeps one alive under its old id.
 *
 * Read from the files themselves rather than from the registry, because an
 * alias that maps an old id to its replacement registers nothing under the
 * old id and still accepts it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CORE_WIDGET_IDS } from "../core-widgets/ids";

/** The removed ids, each beside the core widget that took its place. */
const REMOVED = [["core/recent-activity", "core/team-activity"]] as const;

const PACKAGES = path.resolve(__dirname, "../../../../..");
/** The files that may name a removed id: the tests asserting its absence. */
const ASSERTING = new Set(
  ["removed-core-widget-ids.test.ts", "core-widgets.test.ts"].map(file =>
    path.join(__dirname, file)
  )
);

/** Every source file under each package's `src`, built output and dependencies aside. */
function sourceFiles(): string[] {
  const files: string[] = [];
  for (const pkg of readdirSync(PACKAGES)) {
    const src = path.join(PACKAGES, pkg, "src");
    let entries: string[];
    try {
      entries = readdirSync(src, { recursive: true }).map(String);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.split(path.sep).includes("node_modules")) continue;
      if (/\.(ts|tsx|mts|cts|js|mjs|json|md|mdx)$/.test(entry)) {
        files.push(path.join(src, entry));
      }
    }
  }
  return files;
}

describe("the core widgets removed outright", () => {
  const files = sourceFiles();

  it("are read from the packages' source at all", () => {
    // The control: the walk reaches this package's own widgets, so a clean answer below is a
    // search that looked rather than one that found no files.
    expect(
      files.some(file => file.endsWith(path.join("core-widgets", "ids.ts")))
    ).toBe(true);
  });

  it.each(REMOVED)(
    "name %s nowhere outside the tests asserting it is gone, and %s is core's",
    (removed, replacement) => {
      const naming = files.filter(
        file =>
          !ASSERTING.has(file) && readFileSync(file, "utf8").includes(removed)
      );
      expect(naming.map(file => path.relative(PACKAGES, file))).toEqual([]);
      expect(CORE_WIDGET_IDS as readonly string[]).toContain(replacement);
    }
  );
});
