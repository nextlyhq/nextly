/**
 * The check a plugin's own suite runs: its package.json against its
 * definition, as a list of plain sentences a failing assertion prints.
 */
import { describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";

import { checkPluginPackageDeclaration } from "./check";

/** A fixture plugin, as a plugin's factory makes it. */
const fixturePlugin = () =>
  definePlugin({
    name: "@acme/notes",
    version: "0.1.0",
    nextly: "^0.0.2-alpha.81",
    contributes: { collections: [{ slug: "notes", fields: [] }] },
  });

/** Its package.json, declaring what it does. */
function manifest(nextly: Record<string, unknown> = {}) {
  return {
    name: "@acme/notes",
    version: "0.1.0",
    nextly: {
      format: 1,
      core: "^0.0.2-alpha.81",
      databases: ["sqlite", "postgresql"],
      plugin: { export: "notesPlugin", call: true },
      collections: ["notes"],
      ...nextly,
    },
  };
}

describe("a plugin's suite checking its declaration", () => {
  it("passes when the package.json matches the plugin", () => {
    expect(checkPluginPackageDeclaration(manifest(), fixturePlugin())).toEqual(
      []
    );
  });

  it("names a table the declaration lists and the plugin does not add", () => {
    expect(
      checkPluginPackageDeclaration(
        manifest({ tables: ["notes_log"] }),
        fixturePlugin()
      )
    ).toEqual([
      'The declaration lists the table "notes_log", which the plugin\'s definition does not have.',
    ]);
  });

  it("names a database the suite runs on and the declaration leaves out", () => {
    expect(
      checkPluginPackageDeclaration(manifest(), fixturePlugin(), {
        databases: ["sqlite", "mysql"],
      })
    ).toEqual([
      "The suite runs the plugin on mysql, and the declaration's databases do not list it.",
    ]);
  });

  it("says a format newer than this Nextly reads needs a newer Nextly", () => {
    const [problem, ...rest] = checkPluginPackageDeclaration(
      manifest({ format: 99, core: "^5.0.0" }),
      fixturePlugin()
    );
    expect(rest).toEqual([]);
    expect(problem).toBe(
      `The declaration is in format 99, and this Nextly reads formats up to 1: this format needs a newer Nextly, and the plugin says it works with Nextly "^5.0.0".`
    );
  });

  it("names each problem with a declaration that does not parse", () => {
    expect(
      checkPluginPackageDeclaration(
        manifest({ databases: ["oracle"] }),
        fixturePlugin()
      )
    ).toEqual([
      expect.stringMatching(
        /^The declaration does not parse: nextly\.databases\.0: /
      ),
    ]);
  });

  it.each([
    ["no nextly key", { name: "@acme/notes" }],
    [
      "only today's registration block",
      { nextly: { plugin: { export: "a" } } },
    ],
  ])("fails a package with %s", (_, pkg) => {
    expect(checkPluginPackageDeclaration(pkg, fixturePlugin())).toEqual([
      expect.stringMatching(/^The package\.json has no declaration/),
    ]);
  });
});

describe("a plugin's suite checking its registration against its entry", () => {
  it("passes when the entry exports the factory the registration calls", () => {
    expect(
      checkPluginPackageDeclaration(manifest(), fixturePlugin(), {
        exports: { notesPlugin: fixturePlugin },
      })
    ).toEqual([]);
  });

  it("names an export the entry does not have", () => {
    expect(
      checkPluginPackageDeclaration(manifest(), fixturePlugin(), {
        exports: { notesPlgin: fixturePlugin },
      })
    ).toEqual([
      "The declaration's registration does not fit the package's entry. It names the export notesPlugin, which its entry does not have.",
    ]);
  });

  it("names a called export that is not a function", () => {
    expect(
      checkPluginPackageDeclaration(manifest(), fixturePlugin(), {
        exports: { notesPlugin: fixturePlugin() },
      })
    ).toEqual([
      "The declaration's registration does not fit the package's entry. It says notesPlugin is called, and it is not a function.",
    ]);
  });

  it("names an export placed as it is that is not the plugin checked", () => {
    const plugin = fixturePlugin();
    const placed = manifest({ plugin: { export: "notesPlugin" } });
    // The control: the plugin itself, exported as it is, fits.
    expect(
      checkPluginPackageDeclaration(placed, plugin, {
        exports: { notesPlugin: plugin },
      })
    ).toEqual([]);
    expect(
      checkPluginPackageDeclaration(placed, plugin, {
        exports: { notesPlugin: fixturePlugin },
      })
    ).toEqual([
      "The declaration's registration places notesPlugin as it is, and the entry's notesPlugin is not the plugin this check was given: declare \"call\": true if it is a function that makes the plugin.",
    ]);
  });
});
