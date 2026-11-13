/**
 * The file that turns translation on creates each companion column with what the main column it
 * receives values from carries, as the previous snapshot records it. No field Nextly builds has a
 * column default today, so a default is put on the recorded main column by hand: the file then
 * creates the companion column with it.
 */
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { generateMigration, type MinimalConfigEntity } from "../generate";

/** `docs` with a text `heading`, translated or not. */
const docs = (localized: boolean): MinimalConfigEntity => ({
  slug: "docs",
  tableName: "dc_docs",
  localized,
  fields: [{ name: "heading", type: "text", localized }],
});

/** Every file under `dir` whose name ends with `suffix`, by its path. */
async function filesEnding(dir: string, suffix: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries
    .filter(name => name.endsWith(suffix))
    .sort()
    .map(name => join(dir, name));
}

describe.each(["postgresql", "mysql", "sqlite"] as SupportedDialect[])(
  "a file turning translation on, over a main column with a default (%s)",
  dialect => {
    it("creates the companion column with that default", async () => {
      const dir = await mkdtemp(join(tmpdir(), "nextly-carried-default-"));
      const run = (entity: MinimalConfigEntity, name: string, at: string) =>
        generateMigration({
          name,
          dialect,
          migrationsDir: dir,
          defaultLocale: "en",
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(at),
        });
      await run(docs(false), "one", "2026-11-12T10:00:00.000Z");

      // The recorded main column, given a default as a database may have it.
      const [snapshotPath] = await filesEnding(dir, ".snapshot.json");
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf-8")) as {
        snapshot: {
          tables: {
            name: string;
            columns: { name: string; default?: string }[];
          }[];
        };
      };
      const main = snapshot.snapshot.tables.find(t => t.name === "dc_docs");
      const heading = main?.columns.find(c => c.name === "heading");
      expect(heading).toBeDefined();
      if (heading) heading.default = "'none'";
      await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

      const before = new Set(await filesEnding(dir, ".sql"));
      await run(docs(true), "two", "2026-11-12T11:00:00.000Z");
      const written = (await filesEnding(dir, ".sql")).filter(
        f => !before.has(f)
      );
      const enable = written.find(f => /enable_localization_docs/.test(f));
      expect(enable).toBeDefined();
      const sql = await readFile(enable ?? "", "utf-8");
      expect(sql).toMatch(/["`]heading["`] \S+ DEFAULT 'none'/);
    });
  }
);
