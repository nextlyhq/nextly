/**
 * One way to draw a dashboard list, held by reading the source.
 *
 * Every list on the dashboard draws its rows with `EntityRow` inside `ListCard`, and says it holds
 * more in one footer. The older ways (a row component per card, the "More exist" line, the
 * recent-entries card nothing drew) were removed, and this keeps them from coming back under the
 * same names: a card that grows its own again fails here rather than in review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Every source file under `dir`, tests left out: a test may name what it asserts is gone. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sources(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The dashboard's own cards, and the widget kit they and every plugin list draw with. */
const FEATURES = resolve(__dirname, "../..");
const DASHBOARD_SOURCES = [
  ...sources(join(FEATURES, "dashboard")),
  ...sources(join(FEATURES, "widgets")),
];

/** The removed ways, each as the source would spell it: a whole name, or the old line's text. */
const REMOVED: readonly RegExp[] = [
  /\bMoreExist\b/,
  /More exist/,
  /\bmoreExistHref\b/,
  /\bRecentEntriesWidget\b/,
  /\bEditRow\b/,
  /\bActivityItem\b/,
  /\bRowsList\b/,
  /\bRowsTable\b/,
];

describe("the dashboard's lists", () => {
  it("are found to read, so an empty scan cannot pass", () => {
    expect(DASHBOARD_SOURCES.length).toBeGreaterThan(50);
  });

  it("use none of the removed row designs or 'see more' lines", () => {
    const found = DASHBOARD_SOURCES.flatMap(path => {
      const text = readFileSync(path, "utf8");
      return REMOVED.filter(pattern => pattern.test(text)).map(
        pattern => `${path.slice(FEATURES.length + 1)}: ${pattern.source}`
      );
    });
    expect(found).toEqual([]);
  });
});
