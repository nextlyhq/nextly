/**
 * A script's own `CollectionFileManager`, over an adapter of its own, builds a
 * collection's table with no dialect loaded by anyone else.
 *
 * Each case runs in a process of its own, since a dialect once loaded stays
 * loaded and the test runner has loaded one already. The manager's own code is
 * bundled for it, and what it built is read back from what it printed, since
 * the manager logs a failure to build and goes on without a table.
 *
 * What would separate a manager that works from one that does not:
 * - no table, or one without the collection's columns, or another dialect's;
 * - a dialect loaded before the manager was asked, which would prove nothing;
 * - the translations' table left out.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE = fileURLToPath(new URL("../../../", import.meta.url));
const run = promisify(execFile);

const ENTRY = `
  import { entityKind, getColumns } from "drizzle-orm";
  import { loadedDialect } from "./database/dialect-tables";
  import { CollectionFileManager } from "./services/collection-file-manager";

  const [dialect, method] = process.argv.slice(2);
  const loaded = () => { try { loadedDialect(dialect); return true; } catch { return false; } };
  const kindOf = value => Object.getPrototypeOf(value).constructor[entityKind];
  const manager = new CollectionFileManager({}, { schemasDir: "/nowhere", migrationsDir: "/nowhere" });
  manager.setAdapter({ dialect });
  manager.setMetadataFetcher(async () => ({
    fields: [
      { name: "body", type: "text", localized: true },
      { name: "price", type: "number" },
    ],
    tableName: "dc_pages",
    localized: true,
  }));
  const before = loaded();
  const built = await manager[method]("pages");
  const table = method === "loadDynamicSchema" ? built : built?.table;
  process.stdout.write("\\nANSWER " + JSON.stringify({
    before,
    kind: table ? kindOf(table) : null,
    columns: table ? Object.keys(getColumns(table)) : null,
  }) + "\\n");
`;

let folder: string;
beforeAll(async () => {
  // Inside the package, so that the packages it is built with are found.
  const cache = join(PACKAGE, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  folder = mkdtempSync(join(cache, "own-adapter-"));
  await build({
    stdin: { contents: ENTRY, resolveDir: join(PACKAGE, "src"), loader: "js" },
    bundle: true,
    // What is imported when it is needed stays apart from what is loaded first.
    splitting: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outdir: folder,
    entryNames: "entry",
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
  });
}, 60_000);
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

interface Answer {
  before: boolean;
  kind: string | null;
  columns: string[] | null;
}

async function answered(dialect: string, method: string): Promise<Answer> {
  const { stdout, stderr } = await run(
    process.execPath,
    [join(folder, "entry.mjs"), dialect, method],
    { cwd: PACKAGE }
  );
  const line = stdout.split("\n").find(each => each.startsWith("ANSWER "));
  expect(line, `${stdout}${stderr}`).toBeDefined();
  return JSON.parse((line ?? "").slice("ANSWER ".length)) as Answer;
}

describe.each([
  ["postgresql", "PgTable"],
  ["mysql", "MySqlTable"],
  ["sqlite", "SQLiteTable"],
])(
  "a script's own file manager on %s, with no dialect loaded",
  (dialect, kind) => {
    it("builds the collection's table", async () => {
      const answer = await answered(dialect, "loadDynamicSchema");

      expect(answer.before).toBe(false);
      expect(answer.kind).toBe(kind);
      expect(answer.columns).toEqual(expect.arrayContaining(["id", "price"]));
      // Translated values are in the other table.
      expect(answer.columns).not.toContain("body");
    }, 60_000);

    it("builds its translations' table", async () => {
      const answer = await answered(dialect, "loadCompanionSchema");

      expect(answer.before).toBe(false);
      expect(answer.kind).toBe(kind);
      expect(answer.columns).toEqual(
        expect.arrayContaining(["_parent", "_locale", "body"])
      );
    }, 60_000);
  }
);
