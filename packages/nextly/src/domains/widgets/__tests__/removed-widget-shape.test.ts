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
  // The props a component drew a definition's query answer with, and the
  // admin's reading of that answer for core's list cards: a component is
  // handed `WidgetProps`, its data already loaded.
  "WidgetComponentProps",
  "readListSlot",
  "ListSlotReading",
  // The registry's own gate type, whose bare list meant any-of.
  "WidgetPermissionGate",
  // The refusal of a `chrome` field, which no channel can carry any more.
  "chromeFieldProblem",
  // The name-matched limit knob and the rule that guarded it, and the
  // definition settings whose `limit` name drove a query.
  "isLimitSetting",
  "rangedLimitSettingProblem",
  "RECENT_ACTIVITY_ITEMS",
  "CONTINUE_ITEMS",
  // The text, actions and stats archetypes' vocabulary, and the cells a stats
  // or custom card asked through the batch: every card is declared and asked
  // by its card, so none of these has a reader.
  "WidgetAction",
  "WidgetStatCell",
  "WidgetQueryCell",
  "WIDGET_CELL_TIERS",
  "WIDGET_CELL_CONDITIONS",
  "WidgetCellTier",
  "WidgetCellCondition",
  "MAX_STAT_CELLS",
  "MAX_TEXT_CONTENT",
  "statCellProblem",
  "CellWidgetArchetype",
  "QuerylessWidgetArchetype",
  "CellSlotLookup",
  // The definition path: core's list of definitions, the doors that replaced
  // or patched a registered definition, and the door that admitted a declared
  // one beside them.
  "CORE_WIDGETS",
  "CORE_WIDGET_LITERALS",
  "overrideWidget",
  "extendWidget",
  "WidgetPatch",
  "registerDeclaredDefinition",
];

const PATTERN = new RegExp(`\\b(${REMOVED.join("|")})\\b`);

/**
 * The tests that hold a removed name's ABSENCE from a published surface, and
 * so spell it: each names its list, and holds nothing else of the old shape.
 */
const ABSENCE_TESTS = [
  "packages/nextly/src/__tests__/export-contract.test.ts",
  "packages/plugin-sdk/src/plugin-surface.test.ts",
  // Holds the SDK's root to publishing none of the removed doors.
  "packages/plugin-sdk/src/index.test.ts",
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

/**
 * A widget field the older shape had, as code spells a property: a key being
 * written (`chrome: "none"`), a key named as a string, or a member read. A word
 * in a comment, such as the dashboard's own "chrome" around its grid, is none.
 */
const CHROME_FIELD = /\bchrome\??:[ \t]*\S|["']chrome["']|\.chrome\b/;

/**
 * A setting matched by its NAME to drive a query: the knob table's `limit`,
 * `dateRange`, `onlyMine` and `tab`. A declared widget's settings reach its
 * `load`, which reads them as it chooses, so nothing in the widget domain asks
 * a setting's name to decide what a query is.
 */
const NAME_MATCHED_KNOB =
  /\bname\s*===\s*["'](limit|dateRange|onlyMine|tab)["']/;

/** The widget domain's own source, and the admin's widget code and types. */
const WIDGET_CODE = [
  join(REPO, "packages", "nextly", "src", "domains", "widgets"),
  join(REPO, "packages", "admin", "src", "components", "features", "widgets"),
  join(REPO, "packages", "admin", "src", "types", "dashboard"),
];

/**
 * The flags a widget no longer carries, as code spells a property (written,
 * named as a string, or read), as `CHROME_FIELD` reads `chrome`: core builds
 * every card's data from its declaration, so `serverData` marks nothing, and
 * no card asks its own list query sized (`sizedQuery`).
 */
const OLD_FLAG_FIELD =
  /\b(serverData|sizedQuery)\??:[ \t]*\S|["'](serverData|sizedQuery)["']|\.(serverData|sizedQuery)\b/;

/** Each file whose text `pattern` matches, with what it matched. */
function matching(files: readonly string[], pattern: RegExp): string[] {
  return files.flatMap(file => {
    const found = pattern.exec(readFileSync(file, "utf8"));
    return found ? [`${relative(REPO, file)}: ${found[0]}`] : [];
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

  it("leaves no chrome field in the widget domain or the admin's widget code", () => {
    const files = WIDGET_CODE.flatMap(root => sources(root));
    // The scan reaches the code it guards: the definition's validator, and the
    // admin's card frame.
    expect(files.some(file => file.endsWith("definition.ts"))).toBe(true);
    expect(files.some(file => file.endsWith("WidgetCard.tsx"))).toBe(true);
    expect(matching(files, CHROME_FIELD)).toEqual([]);
  });

  it("leaves no serverData or sizedQuery flag in the widget domain or the admin's widget code", () => {
    const files = WIDGET_CODE.flatMap(root => sources(root));
    // The scan reaches the code it guards: the published shape, the card's
    // outcome and the admin's widget type.
    expect(files.some(file => file.endsWith("definition.ts"))).toBe(true);
    expect(files.some(file => file.endsWith("outcome.ts"))).toBe(true);
    expect(files.some(file => file.endsWith("widgets.ts"))).toBe(true);
    expect(matching(files, OLD_FLAG_FIELD)).toEqual([]);
  });

  it("leaves no setting matched by its name to drive a query", () => {
    const files = sources(WIDGET_CODE[0]).filter(
      file =>
        !file.includes(`${join("widgets", "__tests__")}`) &&
        !file.includes(".test.")
    );
    // The scan reaches the knob table.
    expect(files.some(file => file.endsWith("settings.ts"))).toBe(true);
    expect(matching(files, NAME_MATCHED_KNOB)).toEqual([]);
  });

  it("finds a chrome field and a name-matched knob, and passes the word in prose", () => {
    // The controls: each pattern matches what it is there to find.
    expect(CHROME_FIELD.test('{ chrome: "none" }')).toBe(true);
    expect(CHROME_FIELD.test("widget.chrome")).toBe(true);
    expect(CHROME_FIELD.test('Object.hasOwn(widget, "chrome")')).toBe(true);
    expect(CHROME_FIELD.test(" * its data and its chrome:\n")).toBe(false);
    expect(OLD_FLAG_FIELD.test("{ serverData: true }")).toBe(true);
    expect(OLD_FLAG_FIELD.test("widget.sizedQuery")).toBe(true);
    expect(OLD_FLAG_FIELD.test('"serverData"')).toBe(true);
    expect(
      OLD_FLAG_FIELD.test(" * whose data core builds on the server\n")
    ).toBe(false);
    expect(NAME_MATCHED_KNOB.test('setting.name === "onlyMine"')).toBe(true);
    expect(NAME_MATCHED_KNOB.test('setting.type === "number"')).toBe(false);
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
