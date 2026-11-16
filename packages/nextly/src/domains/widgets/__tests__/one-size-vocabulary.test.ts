/**
 * A card's size is said in `{ w, h }` grid units and nothing else, and an
 * earlier stored layout is never converted.
 *
 * The named sizes and the layout conversions were removed outright, with no
 * alias, so a name coming back is a second vocabulary returning or a
 * conversion of a reset layout creeping back in. Neither shows as a failing
 * test elsewhere, since both read as working code. This scans every published
 * package's source, the playground, the templates and the browser suite for
 * the removed names.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../../..");
const SELF = fileURLToPath(import.meta.url);

/**
 * The removed names: the named sizes, widths and heights, their conversions,
 * and the stored layout's retirement and conversion code. Matched as whole
 * words, so a longer name that merely contains one is not mistaken for it.
 */
const REMOVED = [
  "WIDGET_SIZES",
  "WidgetSize",
  "WIDGET_WIDTHS",
  "WidgetWidth",
  "WIDGET_HEIGHTS",
  "WidgetHeight",
  "isWidgetWidth",
  "widthFromSize",
  "sizeFromWidth",
  "legacySizeToWidgetSize",
  "widthFromDeclaredSize",
  "allowedWidths",
  "defaultWidth",
  "RETIRED_WIDGETS",
  "widgetRetirements",
  "applyRetirements",
];

const PATTERN = new RegExp(`\\b(${REMOVED.join("|")})\\b`);

/** Where source lives: each package's `src`, the playground's, the templates and e2e. */
function roots(): string[] {
  const packages = readdirSync(join(REPO, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(REPO, "packages", entry.name, "src"));
  return [
    ...packages,
    join(REPO, "apps", "playground", "src"),
    join(REPO, "templates"),
    join(REPO, "e2e"),
  ];
}

/** Every TypeScript and JavaScript source file under `dir`, if it exists. */
function sources(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".next", ".turbo"].includes(entry.name)) {
        continue;
      }
      sources(full, out);
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name) && full !== SELF) {
      out.push(full);
    }
  }
  return out;
}

/** Each file holding a removed name, with the first one it holds. */
function offenders(files: readonly string[]): string[] {
  return files.flatMap(file => {
    const found = PATTERN.exec(readFileSync(file, "utf8"));
    return found ? [`${relative(REPO, file)}: ${found[1]}`] : [];
  });
}

describe("one size vocabulary", () => {
  it("leaves no removed size name or layout conversion in any source", () => {
    const files = roots().flatMap(root => sources(root));
    // 🔴 The scan must reach the code it guards, or an empty answer means
    // nothing: the grid size module and this package's own sources included.
    expect(files.some(file => file.endsWith("grid-size.ts"))).toBe(true);
    expect(files.length).toBeGreaterThan(1000);
    expect(offenders(files)).toEqual([]);
  });

  it("finds a removed name, and passes a longer name that only contains one", () => {
    // The control: the pattern matches what it is there to find.
    expect(PATTERN.test("import { WIDGET_WIDTHS } from './x';")).toBe(true);
    expect(PATTERN.test("const w: WidgetWidth = 'half';")).toBe(true);
    expect(PATTERN.test("type WidgetWidthPicker = {}")).toBe(false);
  });
});
