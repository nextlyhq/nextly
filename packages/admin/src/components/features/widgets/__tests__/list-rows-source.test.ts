/**
 * One way to draw a dashboard list, held by reading the source.
 *
 * Every list on the dashboard draws its rows with `EntityRow` inside `ListCard`, and says it holds
 * more in one footer. Held two ways: each list card renders the canonical component and draws no
 * list markup of its own, so a row design grown again under any name fails here; and the older
 * ways (a row component per card, the "More exist" line) stay gone by name.
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

/**
 * Each list card's source, and the one canonical component it draws its rows through. Needs
 * attention lays its kinds out itself and draws each as an `EntityRow`.
 */
const LIST_CARDS: ReadonlyArray<readonly [string, "ListCard" | "EntityRow"]> = [
  ["dashboard/RecentlyEdited.tsx", "ListCard"],
  ["dashboard/RecentActivity.tsx", "ListCard"],
  ["dashboard/RecentEntriesCard.tsx", "ListCard"],
  ["dashboard/UpcomingReleases.tsx", "ListCard"],
  ["widgets/archetypes/tiered-rows.tsx", "ListCard"],
  ["dashboard/NeedsAttention.tsx", "EntityRow"],
];

/** List markup a card drawing through `ListCard` has no reason to write itself. */
const OWN_LIST_MARKUP = /<(ul|ol|li|table|tr)[\s>]/;

describe("the dashboard's lists", () => {
  it.each(LIST_CARDS)("%s draws its rows through %s", (file, component) => {
    const text = readFileSync(join(FEATURES, file), "utf8");
    // 🔴 Imported and rendered, not merely named: a card that kept the import and drew rows of
    // its own beside it would pass a check for the name alone.
    expect(text).toMatch(
      new RegExp(
        `import[^;]*\\b${component}\\b[^;]*from "[^"]*frame/(list-card|entity-row)"`
      )
    );
    expect(text).toMatch(new RegExp(`<${component}\\b`));
    if (component === "ListCard") {
      expect(text).not.toMatch(OWN_LIST_MARKUP);
    }
  });

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
