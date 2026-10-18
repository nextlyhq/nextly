/**
 * The two generated component-map files are written one way, whichever of
 * `generate:types` and the admin's development check writes them, and only
 * when their content changes, since Next reloads the admin when they do.
 */
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

  // POSIX permissions, which Windows does not apply, and which root ignores.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses, writing nothing, over a file it cannot read",
    async () => {
      const cwd = await app();
      const folder = join(cwd, "src/types/generated");
      await mkdir(folder, { recursive: true });
      const map = join(folder, COMPONENT_IMPORT_MAP_FILENAME);
      await writeFile(map, "// edited by hand\n", "utf-8");
      // Writable but not readable: what the writer cannot compare, it must not
      // replace.
      await chmod(map, 0o200);
      await expect(
        writeComponentMapFiles(
          [shop],
          "./src/types/generated/nextly-types.ts",
          cwd
        )
      ).rejects.toMatchObject({ code: "EACCES" });
      await chmod(map, 0o600);
      expect(await readFile(map, "utf-8")).toBe("// edited by hand\n");
    }
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "replaces neither file when the second cannot be read",
    async () => {
      const cwd = await app();
      const folder = join(cwd, "src/types/generated");
      await mkdir(folder, { recursive: true });
      const map = join(folder, COMPONENT_IMPORT_MAP_FILENAME);
      const list = join(folder, COMPONENT_PATHS_FILENAME);
      // Both out of date, so both would be written; the list, written second,
      // cannot be read. Replacing the map first would leave a pair that
      // disagrees, which the admin refuses to load.
      await writeFile(map, "// an older map\n", "utf-8");
      await writeFile(list, "// an older list\n", "utf-8");
      await chmod(list, 0o200);
      await expect(
        writeComponentMapFiles(
          [shop],
          "./src/types/generated/nextly-types.ts",
          cwd
        )
      ).rejects.toMatchObject({ code: "EACCES" });
      await chmod(list, 0o600);
      expect(await readFile(map, "utf-8")).toBe("// an older map\n");
      expect(await readFile(list, "utf-8")).toBe("// an older list\n");
    }
  );
});
