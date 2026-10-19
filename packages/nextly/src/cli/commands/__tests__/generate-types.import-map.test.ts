/**
 * `generate:types` writes the plugin component import map even for an app
 * whose code config declares no collections, Singles, field groups or user
 * fields — the app whose content is all made in the Schema Builder.
 *
 * That app still renders plugin admin components: a plugin's pages, its
 * settings, and a document view offered on a field type, which exists for
 * exactly that app. Without the map, a bundled admin cannot resolve those
 * components by their package specifiers and draws an empty slot.
 *
 * Driven through `runGenerateTypes` itself, with only the config loader
 * replaced, so the command's own early return is part of what is tested.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPONENT_IMPORT_MAP_FILENAME,
  COMPONENT_PATHS_FILENAME,
} from "../../../plugins/codegen/component-import-map";
import { definePlugin } from "../../../plugins/plugin-context";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-loader", () => ({ loadConfig }));

const { runGenerateTypes } = await import("../generate-types");
const { createContext } = await import("../../program");

const OUTPUT = "src/types/nextly-types.ts";
const dirs: string[] = [];

afterEach(async () => {
  loadConfig.mockReset();
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-import-map-"));
  dirs.push(dir);
  return dir;
}

/** A config with no schema of its own, only the plugins given. */
function schemaFreeConfig(plugins: unknown[]) {
  return {
    configPath: "nextly.config.ts",
    config: {
      collections: [],
      singles: [],
      fieldGroups: [],
      users: { fields: [] },
      plugins,
      typescript: { outputFile: OUTPUT },
    },
  };
}

const viewPlugin = definePlugin({
  name: "@acme/builder",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    fieldTypes: [
      {
        type: "canvas",
        storage: "json",
        component: "@acme/builder/admin#Field",
      },
    ],
    admin: {
      documentViews: [
        {
          path: "builder",
          fieldType: "canvas",
          component: "@acme/builder/admin#Builder",
        },
      ],
    },
  },
});

async function run(cwd: string, output = OUTPUT): Promise<void> {
  await runGenerateTypes(
    { cwd, output, quiet: true, zod: false },
    createContext({ quiet: true, cwd })
  );
}

describe("the import map for an app with no code-defined schema", () => {
  it("is written beside the configured types file, whatever --output names", async () => {
    // The admin page imports the map from one place, and the admin's check
    // rewrites and names it from the config: a map written beside an override
    // would be one nothing reads.
    const cwd = await workspace();
    loadConfig.mockResolvedValue(schemaFreeConfig([viewPlugin]));

    await run(cwd, "./elsewhere/types.ts");

    expect(
      await readFile(
        join(cwd, dirname(OUTPUT), COMPONENT_IMPORT_MAP_FILENAME),
        "utf-8"
      )
    ).toContain('"@acme/builder/admin#Builder"');
    await expect(
      readFile(join(cwd, "elsewhere", COMPONENT_IMPORT_MAP_FILENAME), "utf-8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is written, carrying a field-type document view's component", async () => {
    const cwd = await workspace();
    loadConfig.mockResolvedValue(schemaFreeConfig([viewPlugin]));

    await run(cwd);

    const map = await readFile(
      join(cwd, dirname(OUTPUT), COMPONENT_IMPORT_MAP_FILENAME),
      "utf-8"
    );
    expect(map).toContain('"@acme/builder/admin#Builder"');
    // And its path list beside it, for the admin's server layout.
    expect(
      await readFile(
        join(cwd, dirname(OUTPUT), COMPONENT_PATHS_FILENAME),
        "utf-8"
      )
    ).toContain('"@acme/builder/admin#Builder"');
  });

  it("is written empty when no plugin contributes a component any more", async () => {
    // Kept, not removed: the admin page and layout import both files. Empty,
    // so a map left from before no longer imports a package the app dropped.
    const cwd = await workspace();
    const stale = join(cwd, dirname(OUTPUT), COMPONENT_IMPORT_MAP_FILENAME);
    await mkdir(dirname(stale), { recursive: true });
    await writeFile(
      stale,
      'import * as _p0 from "@acme/gone/admin";\n',
      "utf-8"
    );
    loadConfig.mockResolvedValue(schemaFreeConfig([]));

    await run(cwd);

    // The dropped package is gone. The map still imports its own list, which
    // is what holds it to that list.
    expect(await readFile(stale, "utf-8")).not.toContain("@acme/gone/admin");
    expect(
      await readFile(
        join(cwd, dirname(OUTPUT), COMPONENT_PATHS_FILENAME),
        "utf-8"
      )
    ).toContain("export const registeredComponentPaths = [] as const;");
  });
});
