/**
 * The CLI judges field groups placed in a cycle as a start does, whether or not the app configures
 * a plugin: a cycle that takes in a code field group is refused, and one among the Builder's field
 * groups alone is named and the command goes on. A missing or unreadable ui-schema file still
 * leaves the configuration loadable, as before, since migrate:create and migrate:check report a
 * malformed one themselves.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { consoleLogger } from "../../../shared/types";
import { clearConfigCache, loadConfig } from "../config-loader";

/** What the app's config file exports, as its bundled code returns it. */
const exported = vi.hoisted(() => ({ config: {} as unknown }));

vi.mock("../config-bundler", () => ({
  bundleAndRequire: async () => ({
    mod: { default: exported.config },
    dependencies: [],
  }),
}));

const made: string[] = [];

afterEach(() => {
  clearConfigCache();
  vi.restoreAllMocks();
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A field group's fields: a title, and the field group `next` placed directly when given. */
function fields(next?: string): Record<string, unknown>[] {
  return [
    { name: "title", type: "text" },
    ...(next === undefined
      ? []
      : [{ name: next, type: "component", component: next }]),
  ];
}

/** A project with a config file and, when given, `ui-schema.json` holding `uiSchema` as written. */
function project(uiSchema?: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-fg-cycles-")));
  made.push(dir);
  writeFileSync(join(dir, "nextly.config.mjs"), "export default {};\n");
  if (uiSchema !== undefined) {
    writeFileSync(join(dir, "ui-schema.json"), uiSchema);
  }
  return dir;
}

/** The Builder's field groups as the ui-schema file holds them. */
function builderFieldGroups(groups: { slug: string; next?: string }[]): string {
  return JSON.stringify({
    version: 1,
    components: groups.map(({ slug, next }) => ({
      slug,
      fields: fields(next),
    })),
  });
}

/** The cycle warnings the load wrote. */
function cycleWarnings(warn: {
  mock: { calls: readonly (readonly unknown[])[] };
}): string[] {
  return warn.mock.calls
    .map(call => String(call[0]))
    .filter(message => message.includes("place each other in a cycle"));
}

describe("loading the configuration for a command, with no plugin configured", () => {
  it("names a cycle among the Builder's field groups alone, and loads", async () => {
    exported.config = { collections: [] };
    const cwd = project(
      builderFieldGroups([
        { slug: "ping", next: "pong" },
        { slug: "pong", next: "ping" },
      ])
    );
    const warn = vi.spyOn(consoleLogger, "warn");

    await loadConfig({ cwd });

    const named = cycleWarnings(warn);
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/ping → pong → ping|pong → ping → pong/);
  });

  it("refuses a cycle that a code field group closes with a Builder field group", async () => {
    exported.config = {
      collections: [],
      fieldGroups: [{ slug: "hero", fields: fields("card") }],
    };
    const cwd = project(builderFieldGroups([{ slug: "card", next: "hero" }]));

    await expect(loadConfig({ cwd })).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            code: "FIELD_GROUP_CYCLE",
            message: expect.stringContaining("hero → card → hero"),
          }),
        ],
      },
    });
  });

  it("still loads when the ui-schema file cannot be read, naming no cycle", async () => {
    exported.config = { collections: [] };
    const cwd = project("{ this is not json");
    const warn = vi.spyOn(consoleLogger, "warn");

    await expect(loadConfig({ cwd })).resolves.toBeDefined();
    expect(cycleWarnings(warn)).toEqual([]);
  });

  it("still loads when there is no ui-schema file", async () => {
    exported.config = { collections: [] };
    await expect(loadConfig({ cwd: project() })).resolves.toBeDefined();
  });
});
