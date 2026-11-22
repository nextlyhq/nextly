/**
 * A command refuses a collection that opens its entries in a view it does not
 * have, as a start does, whether or not a plugin is configured, and judges a
 * disabled plugin's views as declared, so switching one off never stops it.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache, loadConfig } from "../config-loader";

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
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-opens-in-")));
  made.push(dir);
  writeFileSync(join(dir, "nextly.config.mjs"), "export default {};\n");
  return dir;
}

/** Notes: a title and a `blocks` field, opening in `opensIn`. */
function notes(opensIn: string) {
  return {
    slug: "notes",
    fields: [
      { name: "title", type: "text" },
      { name: "sections", type: "blocks" },
    ],
    admin: { opensIn },
  };
}

/** A plugin contributing the `blocks` field type and a `builder` view on it. */
function builderPlugin(enabled: boolean) {
  return {
    name: "@acme/builder",
    version: "1.0.0",
    nextly: "*",
    enabled,
    contributes: {
      fieldTypes: [
        { type: "blocks", storage: "json", component: "@acme/builder#Field" },
      ],
      admin: {
        documentViews: [
          {
            fieldType: "blocks",
            path: "builder",
            component: "@acme/builder#View",
          },
        ],
      },
    },
  };
}

describe("loading the configuration for a command", () => {
  it("refuses a view no plugin declares, naming the collection and the view", async () => {
    exported.config = { collections: [notes("builder")] };
    await expect(loadConfig({ cwd: project() })).rejects.toThrow(
      /"notes".*"builder"/
    );
  });

  it("loads the same collection opening in the form", async () => {
    // The plugin offering `blocks` is declared: a field type nothing offers is refused at load.
    exported.config = {
      collections: [notes("form")],
      plugins: [builderPlugin(true)],
    };
    await expect(loadConfig({ cwd: project() })).resolves.toBeDefined();
  });

  it("loads a view a disabled plugin declares", async () => {
    exported.config = {
      collections: [notes("builder")],
      plugins: [builderPlugin(false)],
    };
    await expect(loadConfig({ cwd: project() })).resolves.toBeDefined();
  });
});
