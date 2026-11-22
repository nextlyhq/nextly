/**
 * The test fixtures' admin modules: what each registers in the browser, with
 * and without the test switch.
 *
 * The committed component map is written with the fixtures off, so on the e2e
 * suite's server it registers none of their components; each fixture's own
 * `admin.tsx` does. Three ways that goes wrong, each caught here:
 *
 * - A module that registers without the switch. For the block fixture that
 *   is visible: the editor offers every block of every entry it is handed,
 *   declared or not, so its "Test fixture: …" blocks would be back in a plain
 *   run's Add panel.
 * - A component path a fixture declares that its module leaves out, which the
 *   map no longer catches: that card or place draws its error state.
 * - A path handed to the wrong registry. The editor reads its blocks from the
 *   entries it is handed and a block's own inspector from the editor's
 *   components, so an entry registered only as a component offers no block,
 *   and an inspector missing from the editor's components draws none.
 *
 * Each registry is replaced by a recorder of its own, so the test reads what
 * each module hands to which, rather than what an admin would make of it. What
 * each must receive is read from the fixture's declaration, as the map's
 * generator reads it: the page builder's `editorEntry` goes to the editor's
 * entries only; a declared block's own components go to the editor's
 * components and, like every other declared path, to `registerComponents`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** What each registry was handed, by path. */
const handed = vi.hoisted(() => ({
  components: new Map<string, unknown>(),
  editorEntries: new Map<string, unknown>(),
  editorComponents: new Map<string, unknown>(),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // The widget kit's card draws with it; the test never draws one.
  Widget: {},
  registerComponents: (components: Record<string, unknown>) => {
    for (const [path, component] of Object.entries(components)) {
      handed.components.set(path, component);
    }
  },
}));

vi.mock("@nextlyhq/plugin-page-builder/admin", () => ({
  registerBlockEditorModules: (modules: {
    entries?: Record<string, unknown>;
    components?: Record<string, unknown>;
  }) => {
    for (const [path, value] of Object.entries(modules.entries ?? {})) {
      handed.editorEntries.set(path, value);
    }
    for (const [path, value] of Object.entries(modules.components ?? {})) {
      handed.editorComponents.set(path, value);
    }
  },
}));

/** Each fixture: its plugin, and the admin module that registers for it. */
const FIXTURES = {
  "block-fixture": {
    plugin: async () =>
      (await import("./block-fixture/plugin")).blockFixturePlugin,
    admin: () => import("./block-fixture/admin"),
  },
  "contributions-fixture": {
    plugin: async () =>
      (await import("./contributions-fixture/plugin"))
        .contributionsFixturePlugin,
    admin: () => import("./contributions-fixture/admin"),
  },
  "widget-kit-fixture": {
    plugin: async () =>
      (await import("./widget-kit-fixture/plugin")).widgetKitFixturePlugin,
    admin: () => import("./widget-kit-fixture/admin"),
  },
};

/** The consumer key a plugin's block declarations are addressed to. */
const PAGE_BUILDER = "@nextlyhq/plugin-page-builder";

/** Loading the fixtures' modules cold takes a while. */
const LOAD_TIMEOUT = 60_000;

/** A plain object, to read a declaration's fields without casting. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Every component path a value declares: each string in it that names a
 * module of this app's plugins, as the map would import it.
 */
function declaredPaths(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    return value.startsWith("@/plugins/") ? [value] : [];
  }
  if (!isRecord(value) || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap(each => declaredPaths(each, seen));
}

/** The plugin's declaration to the page builder, or nothing. */
function pageBuilderDeclaration(plugin: unknown): Record<string, unknown> {
  const contributes = isRecord(plugin) ? plugin.contributes : undefined;
  const declarations = isRecord(contributes)
    ? contributes.declarations
    : undefined;
  const declaration = isRecord(declarations)
    ? declarations[PAGE_BUILDER]
    : undefined;
  return isRecord(declaration) ? declaration : {};
}

/** What each registry must receive for a plugin, read from its declaration. */
function expectedFor(plugin: unknown) {
  const declared = new Set(declaredPaths(plugin));
  const blocks = pageBuilderDeclaration(plugin);
  const editorEntries = declaredPaths(blocks.editorEntry);
  return {
    declared,
    components: [...declared].filter(path => !editorEntries.includes(path)),
    editorEntries,
    editorComponents: declaredPaths(blocks.blocks),
  };
}

/** The paths a recorder was handed, sorted. */
function pathsOf(recorder: Map<string, unknown>): string[] {
  return [...recorder.keys()].sort();
}

/** What a fixture's admin module hands over with the switch set to `value`. */
async function handedWith(fixture: keyof typeof FIXTURES, value: string) {
  vi.resetModules();
  for (const recorder of Object.values(handed)) recorder.clear();
  vi.stubEnv("NEXTLY_E2E_STYLE_FIXTURE", value);
  await FIXTURES[fixture].admin();
  return {
    components: new Map(handed.components),
    editorEntries: new Map(handed.editorEntries),
    editorComponents: new Map(handed.editorComponents),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(Object.keys(FIXTURES) as (keyof typeof FIXTURES)[])(
  "%s's admin module",
  fixture => {
    it(
      "registers nothing in a plain run",
      async () => {
        const registered = await handedWith(fixture, "");
        expect(pathsOf(registered.components)).toEqual([]);
        expect(pathsOf(registered.editorEntries)).toEqual([]);
        expect(pathsOf(registered.editorComponents)).toEqual([]);
      },
      LOAD_TIMEOUT
    );

    it(
      "registers every path its plugin declares, each where the editor and the admin read it, with the switch on",
      async () => {
        const expected = expectedFor(await FIXTURES[fixture].plugin());
        // The fixture does declare components, or every check below holds of
        // nothing.
        expect(expected.declared.size).toBeGreaterThan(0);
        const registered = await handedWith(fixture, "1");
        expect(pathsOf(registered.components)).toEqual(
          [...expected.components].sort()
        );
        expect(pathsOf(registered.editorEntries)).toEqual(
          [...expected.editorEntries].sort()
        );
        expect(pathsOf(registered.editorComponents)).toEqual(
          [...expected.editorComponents].sort()
        );
        // Each path is handed something, not an import that came back empty.
        for (const recorder of Object.values(registered)) {
          for (const value of recorder.values()) expect(value).toBeTruthy();
        }
      },
      LOAD_TIMEOUT
    );
  }
);

describe("the block fixture's declaration", () => {
  it(
    "names an editor entry and a block with its own inspector, so the routing above is exercised",
    async () => {
      const expected = expectedFor(await FIXTURES["block-fixture"].plugin());
      expect(expected.editorEntries).toHaveLength(1);
      expect(expected.editorComponents.length).toBeGreaterThan(0);
    },
    LOAD_TIMEOUT
  );
});
