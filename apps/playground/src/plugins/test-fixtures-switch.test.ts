/**
 * The playground's test fixtures come only with the test switch.
 *
 * The block fixture ("Test fixture: …" blocks in the builder's Add panel), the
 * widget-kit fixture ("Test fixture: …" dashboard widgets) and the
 * contributions fixture (a dashed card on the dashboard, and its pieces on
 * Posts) exist for the browser suite. Loaded against the real
 * `nextly.config.ts`: a plain run registers none of them, and the switch the
 * suite's own server sets (`NEXTLY_E2E_STYLE_FIXTURE=1`) registers all three.
 *
 * The browser half reads the same switch: each fixture's admin module
 * registers only with it on, and `next.config.ts` hands it to the bundle. That
 * hand-over is held here too, because a bundle handed "1" in a plain run would
 * offer the block fixture's blocks in the Add panel though the server declares
 * none.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** The three fixtures this switch brings, by plugin name. */
const SWITCHED_FIXTURES = [
  "block-fixture",
  "contributions-fixture",
  "widget-kit-fixture",
];

/**
 * Every switch the config reads for a fixture, so a plain run is plain whatever
 * the shell running the test has set.
 */
const FIXTURE_SWITCHES = [
  "NEXTLY_E2E_STYLE_FIXTURE",
  "NEXTLY_E2E_WIDGET_CHECK",
  "NEXTLY_E2E_SLOW_WIDGET",
  "NEXTLY_E2E_MISSING_WIDGET",
  "NEXTLY_PLAYGROUND_PLUGINS",
];

/** How every fixture label starts: "Test fixture: plain", "Fixture: excerpt". */
const FIXTURE_LABEL = /^(Test fixture|Fixture)\b/;

/** Loading the config loads every plugin it names, which takes a while cold. */
const LOAD_TIMEOUT = 60_000;

/** The plugins the config registers with the test switch set to `value`. */
async function pluginsWith(value: string) {
  vi.resetModules();
  for (const name of FIXTURE_SWITCHES) vi.stubEnv(name, "");
  vi.stubEnv("NEXTLY_E2E_STYLE_FIXTURE", value);
  const config = (await import("../../nextly.config")).default;
  return (config.plugins ?? []) as ReadonlyArray<{ readonly name: string }>;
}

/** Every string in a value, however deep, for the labels a plugin declares. */
function stringsIn(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap(each => stringsIn(each, seen));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the playground's test fixtures", () => {
  it(
    "are not registered in a plain run",
    async () => {
      const plugins = await pluginsWith("");
      const names = plugins.map(plugin => plugin.name);
      for (const fixture of SWITCHED_FIXTURES) {
        expect(names).not.toContain(fixture);
      }
      // What a person would meet: nothing any plugin declares is labelled
      // as a fixture.
      expect(
        stringsIn(plugins).filter(text => FIXTURE_LABEL.test(text))
      ).toEqual([]);
    },
    LOAD_TIMEOUT
  );

  it(
    "are not registered when the switch is anything but 1",
    async () => {
      const names = (await pluginsWith("0")).map(plugin => plugin.name);
      for (const fixture of SWITCHED_FIXTURES) {
        expect(names).not.toContain(fixture);
      }
    },
    LOAD_TIMEOUT
  );

  it(
    "are all registered with the test switch on",
    async () => {
      const plugins = await pluginsWith("1");
      expect(plugins.map(plugin => plugin.name)).toEqual(
        expect.arrayContaining(SWITCHED_FIXTURES)
      );
      // The labels the plain run must not show are there to be found, one
      // from each fixture.
      const labels = stringsIn(plugins).filter(text =>
        FIXTURE_LABEL.test(text)
      );
      expect(labels).toEqual(
        expect.arrayContaining([
          "Test fixture: plain",
          "Test fixture: widget kit",
          "Fixture: excerpt",
        ])
      );
    },
    LOAD_TIMEOUT
  );
});

/** The switch `next.config.ts` hands the bundle with the shell's set to `value`. */
async function bundledSwitchWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.NEXTLY_E2E_STYLE_FIXTURE;
  else vi.stubEnv("NEXTLY_E2E_STYLE_FIXTURE", value);
  const config = (await import("../../next.config")).default;
  return config.env?.NEXTLY_E2E_STYLE_FIXTURE;
}

describe("the switch the browser bundle is built with", () => {
  it(
    "is off when the shell leaves it unset",
    async () => {
      vi.stubEnv("NEXTLY_E2E_STYLE_FIXTURE", "");
      expect(await bundledSwitchWith(undefined)).toBe("");
    },
    LOAD_TIMEOUT
  );

  it(
    "is off for anything but 1, as the config reads it",
    async () => {
      expect(await bundledSwitchWith("0")).toBe("");
      expect(await bundledSwitchWith("true")).toBe("");
    },
    LOAD_TIMEOUT
  );

  it(
    "is on with the switch the suite's server sets",
    async () => {
      expect(await bundledSwitchWith("1")).toBe("1");
    },
    LOAD_TIMEOUT
  );
});
