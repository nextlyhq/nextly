/**
 * The older widget shape is gone from every source, not only from the
 * published entry points.
 *
 * A plugin adds widgets one way, with `defineWidget` under
 * `contributes.dashboard.widgets`, and startup refuses the two older keys. The
 * contributed `PluginAdmin*Widget` family, the reducer that read
 * `contributes.admin.widgets`, the contributed set and its merge, the old-shape
 * id rules, and the plugin source fold were removed outright, with no alias. A
 * name coming back is a second channel returning, and it reads as working code
 * wherever it lands. This scans every published package's source, the
 * playground, the templates and the browser suite for them.
 *
 * The export snapshots and the export contract hold the published surface;
 * this holds what no entry point publishes, so a name kept internally fails
 * here too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../../..");
const SELF = fileURLToPath(import.meta.url);

/**
 * The removed names, matched as whole words, so a longer name that merely
 * contains one is not mistaken for it.
 */
const REMOVED = [
  // The contributed widget family and its archetype vocabulary.
  "PluginAdminWidget",
  "PluginAdminWidgetBase",
  "PluginAdminCustomWidget",
  "PluginAdminCustomWidgetBase",
  "PluginAdminDataWidget",
  "PluginAdminStatsWidget",
  "PluginAdminTextWidget",
  "PluginAdminActionsWidget",
  "PluginAdminDeclarativeWidget",
  "PluginAdminQuerylessWidget",
  "UnarmedQuerylessArchetype",
  "DeclarativeWidgetArchetype",
  // What read `contributes.admin.widgets`, on the server and in the admin.
  "validatedAdminWidgets",
  "assertAdminWidgets",
  "contributedWidgetSummaries",
  "setContributedWidgets",
  "canonicalWidgets",
  "mergeCanonical",
  "pluginLegacyWidgetIds",
  "LegacyWidgetIds",
  "resetLegacyIdWarnings",
  "carriedRemovedKey",
  "PluginWidgetMeta",
  "ReadableWidgetDeclaration",
  "mergeCollision",
  // What folded `contributes.widgetSources` into the source registry.
  "collectWidgetSources",
  "CollectedWidgetSource",
  "PluginWidgetSource",
  "PluginSourceResolver",
  "PluginManySourceResolver",
];

const PATTERN = new RegExp(`\\b(${REMOVED.join("|")})\\b`);

/**
 * The tests that hold a removed name's ABSENCE from a published surface, and
 * so spell it: each names its list, and holds nothing else of the old shape.
 */
const ABSENCE_TESTS = [
  "packages/nextly/src/__tests__/export-contract.test.ts",
  "packages/plugin-sdk/src/plugin-surface.test.ts",
];

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

describe("the older widget shape", () => {
  it("leaves no removed name in any source", () => {
    const files = roots().flatMap(root => sources(root));
    const absence = new Set(ABSENCE_TESTS.map(file => join(REPO, file)));
    // 🔴 The scan must reach the code it guards, or an empty answer means
    // nothing: the refusal that replaced the channel, and the admin's resolver
    // the merge lived in.
    expect(files.some(file => file.endsWith("removed-widget-keys.ts"))).toBe(
      true
    );
    expect(files.some(file => file.endsWith("resolve-widgets.ts"))).toBe(true);
    expect(files.length).toBeGreaterThan(1000);
    // The absence tests exist, so leaving them out leaves out nothing else.
    expect([...absence].filter(file => !files.includes(file))).toEqual([]);
    expect(offenders(files.filter(file => !absence.has(file)))).toEqual([]);
  });

  it("finds a removed name, and passes a longer name that only contains one", () => {
    // The control: the pattern matches what it is there to find.
    expect(PATTERN.test("import type { PluginAdminWidget } from 'x';")).toBe(
      true
    );
    expect(PATTERN.test("setContributedWidgets([]);")).toBe(true);
    expect(PATTERN.test("type PluginAdminWidgetLike = {}")).toBe(false);
  });
});
