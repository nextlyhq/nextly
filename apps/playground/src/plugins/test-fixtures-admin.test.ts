/**
 * The test fixtures' admin modules: what each registers in the browser, with
 * and without the test switch.
 *
 * The committed component map is written with the fixtures off, so on the e2e
 * suite's server it registers none of their components; each fixture's own
 * `admin.tsx` does. Two ways that goes wrong, each caught here:
 *
 * - A module that registers without the switch. For the block fixture that
 *   is visible: the editor offers every block of every entry it is handed,
 *   declared or not, so its "Test fixture: …" blocks would be back in a plain
 *   run's Add panel.
 * - A component path a fixture declares that its module leaves out, which the
 *   map no longer catches: that card or place draws its error state.
 *
 * The two registries are replaced by recorders, so the test reads what each
 * module hands over rather than what an admin would make of it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** Everything handed to either registry, by path. */
const handed = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // The widget kit's card draws with it; the test never draws one.
  Widget: {},
  registerComponents: (components: Record<string, unknown>) => {
    for (const [path, component] of Object.entries(components)) {
      handed.set(path, component);
    }
  },
}));

vi.mock("@nextlyhq/plugin-page-builder/admin", () => ({
  registerBlockEditorModules: (modules: {
    entries?: Record<string, unknown>;
    components?: Record<string, unknown>;
  }) => {
    for (const [path, value] of Object.entries({
      ...modules.entries,
      ...modules.components,
    })) {
      handed.set(path, value);
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

/** Loading the fixtures' modules cold takes a while. */
const LOAD_TIMEOUT = 60_000;

/**
 * Every component path a plugin declares: each string in its definition that
 * names a module of this app's plugins, as the map would import it.
 */
function declaredPaths(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    return value.startsWith("@/plugins/") ? [value] : [];
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap(each => declaredPaths(each, seen));
}

/** What a fixture's admin module hands over with the switch set to `value`. */
async function handedWith(
  fixture: keyof typeof FIXTURES,
  value: string
): Promise<Map<string, unknown>> {
  vi.resetModules();
  handed.clear();
  vi.stubEnv("NEXTLY_E2E_STYLE_FIXTURE", value);
  await FIXTURES[fixture].admin();
  return new Map(handed);
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
        expect([...(await handedWith(fixture, "")).keys()]).toEqual([]);
      },
      LOAD_TIMEOUT
    );

    it(
      "registers every component its plugin declares, with the switch on",
      async () => {
        const declared = new Set(
          declaredPaths(await FIXTURES[fixture].plugin())
        );
        // The fixture does declare components, or every check below holds of
        // nothing.
        expect(declared.size).toBeGreaterThan(0);
        const registered = await handedWith(fixture, "1");
        expect([...registered.keys()].sort()).toEqual([...declared].sort());
        for (const path of declared) expect(registered.get(path)).toBeTruthy();
      },
      LOAD_TIMEOUT
    );
  }
);
