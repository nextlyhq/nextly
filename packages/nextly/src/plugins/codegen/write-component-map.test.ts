/**
 * The two generated component-map files are written one way, whichever of
 * `generate:types` and the admin's development check writes them, and only
 * when their content changes, since Next reloads the admin when they do.
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";

import {
  COMPONENT_IMPORT_MAP_FILENAME,
  COMPONENT_PATHS_FILENAME,
} from "./component-import-map";
import { writeComponentMapFiles } from "./write-component-map";

const shop = {
  name: "@acme/shop",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    dashboard: {
      widgets: [
        {
          id: "acme/revenue",
          display: { component: "@acme/shop/admin#Revenue" },
        },
      ],
    },
  },
} as unknown as PluginDefinition;

const made: string[] = [];
afterEach(async () => {
  await Promise.all(
    made.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

async function app(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-component-map-"));
  made.push(dir);
  return dir;
}

describe("writing the component map", () => {
  it("writes the map and its path list beside the types file, creating the folder", async () => {
    const cwd = await app();
    const written = await writeComponentMapFiles(
      [shop],
      "./src/types/generated/nextly-types.ts",
      cwd
    );
    const folder = join(cwd, "src/types/generated");
    expect(written.paths).toEqual([
      join(folder, COMPONENT_IMPORT_MAP_FILENAME),
      join(folder, COMPONENT_PATHS_FILENAME),
    ]);
    expect(written.changed).toEqual(written.paths);
    expect(await readFile(written.paths[0], "utf-8")).toContain(
      '"@acme/shop/admin#Revenue": _p0.Revenue,'
    );
    expect(await readFile(written.paths[1], "utf-8")).toContain(
      '["@acme/shop/admin#Revenue"]'
    );
  });

  it("leaves a file whose content is already right untouched", async () => {
    const cwd = await app();
    const types = "./src/types/generated/nextly-types.ts";
    const first = await writeComponentMapFiles([shop], types, cwd);
    const before = await stat(first.paths[0]);
    const again = await writeComponentMapFiles([shop], types, cwd);
    expect(again.changed).toEqual([]);
    expect((await stat(first.paths[0])).mtimeMs).toBe(before.mtimeMs);
    // The control: a change in the config is written.
    const changed = await writeComponentMapFiles([], types, cwd);
    expect(changed.changed).toEqual(first.paths);
  });
});
