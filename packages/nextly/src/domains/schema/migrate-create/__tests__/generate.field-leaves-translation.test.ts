/**
 * `migrate:create` for a field that stops being translated while its entity stays translated.
 *
 * The field's values live in the companion `<table>_locales`, one row per language. Making it
 * shared gives the main table a column for it; the migration has to fill that column with the
 * default language's value, keep the other languages in the archive, and only then drop the
 * companion column. Three files, ordered by name:
 *
 *   1. before the main file: the archive writes, so an archive that refuses them stops the run
 *      before the main table changes;
 *   2. the main file: the main table gains the column;
 *   3. after it: the copy of the default language's value and the companion drop. Its DOWN puts
 *      the column back and refills it, from main for the default language and from the archive
 *      for the others.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { generateMigration, type MinimalConfigEntity } from "../generate";

const TRANSLATED: MinimalConfigEntity = {
  slug: "docs",
  tableName: "dc_docs",
  localized: true,
  fields: [
    { name: "body", type: "text", localized: true },
    { name: "price", type: "number" },
  ],
};

const SHARED: MinimalConfigEntity = {
  ...TRANSLATED,
  fields: [
    { name: "body", type: "text", localized: false },
    { name: "price", type: "number" },
  ],
};

/**
 * Run `migrate:create` twice and return the files the second run wrote, in name order.
 * `beforeSecond` runs between the two, on the migrations directory.
 */
async function secondRun(
  dialect: SupportedDialect,
  next: MinimalConfigEntity | MinimalConfigEntity[],
  options: {
    first?: MinimalConfigEntity | MinimalConfigEntity[];
    onWarning?: (message: string) => void;
    beforeSecond?: (dir: string) => Promise<void>;
  } = {}
): Promise<{ name: string; sql: string }[]> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-field-leaves-"));
  const run = (
    entity: MinimalConfigEntity | MinimalConfigEntity[],
    name: string,
    at: string
  ) =>
    generateMigration({
      name,
      dialect,
      migrationsDir: dir,
      defaultLocale: "en",
      collections: [entity].flat(),
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date(at),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    });
  await run(options.first ?? TRANSLATED, "one", "2026-10-16T10:00:00.000Z");
  await options.beforeSecond?.(dir);
  const before = new Set(await readdir(dir));
  await run(next, "two", "2026-10-16T11:00:00.000Z");
  const written = (await readdir(dir))
    .filter(f => f.endsWith(".sql") && !before.has(f))
    .sort();
  return Promise.all(
    written.map(async name => ({
      name,
      sql: await readFile(resolve(dir, name), "utf-8"),
    }))
  );
}

/** A file's UP and DOWN sections. */
function sections(sql: string): { up: string; down: string } {
  const [, rest = ""] = sql.split("-- UP\n");
  const [up = "", down = ""] = rest.split("-- DOWN\n");
  return { up, down };
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "migrate:create when a field stops being translated (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it("archives first, adds the shared column, then copies and drops", async () => {
      const files = await secondRun(dialect, SHARED);

      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_archive_localization_docs\.sql$/),
        expect.stringMatching(/_two\.sql$/),
        expect.stringMatching(/_shared_localization_docs\.sql$/),
      ]);
      const [archive, main, shared] = files.map(f => sections(f.sql));

      expect(archive.up).toContain(`INSERT INTO ${q("nextly_i18n_archive")}`);
      expect(archive.up).toContain(`'body'`);
      expect(main.up).toContain(
        `ALTER TABLE ${q("dc_docs")} ADD COLUMN ${q("body")}`
      );
      expect(shared.up).toMatch(
        new RegExp(`UPDATE ${escape(q("dc_docs"))} SET ${escape(q("body"))}`)
      );
      expect(shared.up).toContain(
        `ALTER TABLE ${q("dc_docs_locales")} DROP COLUMN ${q("body")}`
      );
      // The copy runs before the drop that would lose its source.
      expect(shared.up.indexOf("UPDATE")).toBeLessThan(
        shared.up.indexOf("DROP COLUMN")
      );
      expect(shared.down).toContain(
        `ALTER TABLE ${q("dc_docs_locales")} ADD COLUMN ${q("body")}`
      );
      expect(shared.down).toContain(q("nextly_i18n_archive"));
    });

    it("refuses a field that changes type as it leaves, read from the migration history", async () => {
      // The snapshot records only the translated columns' names; the companion file the first run
      // wrote records that `body` is text.
      await expect(
        secondRun(dialect, {
          ...SHARED,
          fields: [
            { name: "body", type: "number", localized: false },
            { name: "price", type: "number" },
          ],
        })
      ).rejects.toThrow(/"body" changes how it is stored/);
    });

    it("refuses a slug leaving translation, which its automatic unique index covers", async () => {
      // No `unique` flag and no declared index: every `slug` column gets a unique index of its own,
      // which the main file creates while the column is still empty.
      const withSlug = (localized: boolean) => ({
        ...TRANSLATED,
        fields: [
          { name: "slug", type: "text", localized },
          { name: "price", type: "number" },
        ],
      });
      await expect(
        secondRun(dialect, withSlug(false), { first: withSlug(true) })
      ).rejects.toThrow(/"slug" is unique/);
    });

    it("refuses a field a unique index covers, naming it", async () => {
      await expect(
        secondRun(dialect, {
          ...SHARED,
          indexes: [{ fields: ["body"], unique: true }],
        })
      ).rejects.toThrow(/"body" is unique/);
    });

    it("warns when no migration file says how the field is stored", async () => {
      const warnings: string[] = [];
      // The companion file the first run wrote, gone: nothing describes `body`'s column now.
      const files = await secondRun(dialect, SHARED, {
        onWarning: message => warnings.push(message),
        beforeSecond: async dir => {
          for (const name of await readdir(dir)) {
            if (name.includes("_localization_")) await rm(resolve(dir, name));
          }
        },
      });

      expect(files.length).toBe(3);
      expect(warnings).toEqual([
        expect.stringMatching(
          /No migration file describes how "body" is stored/
        ),
      ]);
    });

    it.each([
      { before: false, after: true, rollbackWrites: false },
      { before: true, after: true, rollbackWrites: true },
    ])(
      "rolls back with _status only when Draft/Published was on before and stays on (before $before, after $after)",
      async ({ before, after, rollbackWrites }) => {
        const files = await secondRun(
          dialect,
          { ...SHARED, status: after },
          { first: { ...TRANSLATED, status: before } }
        );

        const shared = sections(
          files.find(f => f.name.includes("_shared_localization_"))?.sql ?? ""
        );
        expect(shared.down.includes(q("_status"))).toBe(rollbackWrites);
      }
    );

    it("warns when a translated field goes and a shared one arrives in the same change", async () => {
      const warnings: string[] = [];
      await secondRun(
        dialect,
        {
          ...TRANSLATED,
          fields: [
            { name: "content", type: "text", localized: false },
            { name: "price", type: "number" },
          ],
        },
        { onWarning: message => warnings.push(message) }
      );

      expect(warnings).toEqual([
        expect.stringMatching(
          /translated "body" is gone and shared "content" is new/
        ),
      ]);
    });

    it("refuses a required field leaving translation, naming it", async () => {
      await expect(
        secondRun(dialect, {
          ...SHARED,
          fields: [
            { name: "body", type: "text", localized: false, required: true },
            { name: "price", type: "number" },
          ],
        })
      ).rejects.toThrow(/"body" is required/);
    });
  }
);

/**
 * Takes the record of translated fields out of every snapshot in `dir`, as a snapshot written
 * before snapshots kept it reads.
 */
async function forgetTranslatedFieldRecord(dir: string): Promise<void> {
  const meta = resolve(dir, "meta");
  for (const name of await readdir(meta)) {
    const path = resolve(meta, name);
    const file = JSON.parse(await readFile(path, "utf-8")) as {
      snapshot: { tables: Record<string, unknown>[] };
    };
    for (const table of file.snapshot.tables) {
      delete table.localized;
      delete table.localizedColumns;
      delete table.uniqueLocalizedColumns;
    }
    await writeFile(path, JSON.stringify(file, null, 2), "utf-8");
  }
}

/**
 * Takes the intent line out of every companion file in `dir`, as a file written before companion
 * files recorded what they are for reads.
 */
async function forgetCompanionIntents(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    if (!name.includes("_localization_")) continue;
    const path = resolve(dir, name);
    const kept = (await readFile(path, "utf-8"))
      .split("\n")
      .filter(line => !line.startsWith("-- Localization:"));
    await writeFile(path, kept.join("\n"), "utf-8");
  }
}

/** A project both of whose records predate the translated-field record. */
async function forgetEverything(dir: string): Promise<void> {
  await forgetTranslatedFieldRecord(dir);
  await forgetCompanionIntents(dir);
}

/** Every file under `dir` with its contents, to show a run wrote nothing. */
async function contentsOf(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const sub of ["", "meta"]) {
    for (const name of await readdir(resolve(dir, sub))) {
      if (name === "meta") continue;
      out[join(sub, name)] = await readFile(resolve(dir, sub, name), "utf-8");
    }
  }
  return out;
}

/** A translated collection whose `body` is shared from the start. */
const BODY_SHARED: MinimalConfigEntity = {
  slug: "docs",
  tableName: "dc_docs",
  localized: true,
  fields: [
    { name: "headline", type: "text", localized: true },
    { name: "body", type: "text", localized: false },
  ],
};

/** `BODY_SHARED` with `body` translated too. */
const BODY_JOINS: MinimalConfigEntity = {
  ...BODY_SHARED,
  fields: [
    { name: "headline", type: "text", localized: true },
    { name: "body", type: "text", localized: true },
  ],
};

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "migrate:create when the last snapshot predates its record of translated fields (%s)",
  dialect => {
    it("reads a field leaving translation from the migration files", async () => {
      const files = await secondRun(dialect, SHARED, {
        beforeSecond: forgetTranslatedFieldRecord,
      });

      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_archive_localization_docs\.sql$/),
        expect.stringMatching(/_two\.sql$/),
        expect.stringMatching(/_shared_localization_docs\.sql$/),
      ]);
    });

    it("reads a field joining translation from the migration files", async () => {
      const files = await secondRun(dialect, BODY_JOINS, {
        first: BODY_SHARED,
        beforeSecond: forgetTranslatedFieldRecord,
      });

      // Moved into the companion the first run made, not read as the collection becoming
      // translated, which would make that companion again.
      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_joins_localization_docs\.sql$/),
        expect.stringMatching(/_two\.sql$/),
      ]);
    });

    it.each([
      { change: "leaving", first: TRANSLATED, next: SHARED },
      { change: "joining", first: BODY_SHARED, next: BODY_JOINS },
    ])(
      "refuses a field $change translation when no record says it was translated, writing nothing",
      async ({ first, next }) => {
        let dir = "";
        let before: Record<string, string> = {};
        const run = secondRun(dialect, next, {
          first,
          beforeSecond: async d => {
            await forgetEverything(d);
            dir = d;
            before = await contentsOf(d);
          },
        });

        await expect(run).rejects.toThrow(/collection "docs"/);
        await expect(run).rejects.toThrow(/"body"/);
        await expect(run).rejects.toThrow(/Nothing was written/);
        await expect(run).rejects.toThrow(
          /`nextly migrate:create --record-snapshot`.*`nextly migrate:create --name two`/
        );
        expect(await contentsOf(dir)).toEqual(before);
      }
    );

    it("lets a change that moves no field between translated and shared through", async () => {
      const notes = (fields: MinimalConfigEntity["fields"]) => ({
        slug: "notes",
        tableName: "dc_notes",
        fields,
      });
      const files = await secondRun(
        dialect,
        [
          TRANSLATED,
          notes([
            { name: "title", type: "text" },
            { name: "summary", type: "text" },
          ]),
        ],
        {
          first: [TRANSLATED, notes([{ name: "title", type: "text" }])],
          beforeSecond: forgetEverything,
        }
      );

      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_two\.sql$/),
      ]);
      expect(files[0].sql).toContain(
        `ALTER TABLE ${dialect === "mysql" ? "`dc_notes`" : '"dc_notes"'} ADD COLUMN`
      );
    });

    it("makes a collection that was never translated translated, in a project with older files", async () => {
      const pages: MinimalConfigEntity = {
        ...TRANSLATED,
        slug: "pages",
        tableName: "dc_pages",
      };
      const warnings: string[] = [];
      const files = await secondRun(dialect, [pages, TRANSLATED], {
        first: [pages, { ...TRANSLATED, localized: false }],
        onWarning: message => warnings.push(message),
        beforeSecond: forgetEverything,
      });

      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_two\.sql$/),
        expect.stringMatching(/_enable_localization_docs\.sql$/),
      ]);
      expect(warnings).toEqual([]);
    });

    describe("--record-snapshot", () => {
      const record = (dir: string, entity: MinimalConfigEntity, at: string) =>
        generateMigration({
          name: "record_translated_fields",
          dialect,
          migrationsDir: dir,
          defaultLocale: "en",
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          recordSnapshot: true,
          now: new Date(at),
        });

      it("records the translated fields, once, and lets the change through after it", async () => {
        let recorded: Awaited<ReturnType<typeof record>> = null;
        let again: Awaited<ReturnType<typeof record>> = null;
        let afterRecord: Record<string, string> = {};
        let afterAgain: Record<string, string> = {};
        const files = await secondRun(dialect, SHARED, {
          beforeSecond: async d => {
            await forgetEverything(d);
            recorded = await record(d, TRANSLATED, "2026-10-16T10:30:00.000Z");
            afterRecord = await contentsOf(d);
            again = await record(d, TRANSLATED, "2026-10-16T10:40:00.000Z");
            afterAgain = await contentsOf(d);
          },
        });

        expect(recorded).not.toBeNull();
        const sql = await readFile(recorded!.sqlPath, "utf-8");
        // Nothing for `nextly migrate` to change either way: comments up, a read down.
        expect(
          sections(sql)
            .up.replace(/^--.*$/gm, "")
            .trim()
        ).toBe("");
        expect(
          sections(sql)
            .down.replace(/^--.*$/gm, "")
            .trim()
        ).toBe("SELECT 1;");
        const snapshot = JSON.parse(
          await readFile(recorded!.snapshotPath, "utf-8")
        ) as {
          snapshot: {
            tables: {
              name: string;
              localized?: boolean;
              localizedColumns?: string[];
            }[];
          };
        };
        expect(
          snapshot.snapshot.tables.find(t => t.name === "dc_docs")
        ).toMatchObject({ localized: true, localizedColumns: ["body"] });

        // A second run with nothing new to record writes nothing.
        expect(again).toBeNull();
        expect(afterAgain).toEqual(afterRecord);

        // And the change it was run for now moves the values.
        expect(files.map(f => f.name)).toEqual([
          expect.stringMatching(/_archive_localization_docs\.sql$/),
          expect.stringMatching(/_two\.sql$/),
          expect.stringMatching(/_shared_localization_docs\.sql$/),
        ]);
      });

      it("records a project whose older localization file no table is translated for", async () => {
        const shared: MinimalConfigEntity = {
          ...BODY_SHARED,
          localized: false,
        };
        // Translated now, with a field that is new beside one the main table holds: the same shape
        // as a field joining translation, with nothing to tell them apart.
        const translated: MinimalConfigEntity = {
          ...BODY_JOINS,
          fields: [...BODY_JOINS.fields, { name: "tagline", type: "text" }],
        };
        const dir = await mkdtemp(join(tmpdir(), "nextly-record-"));
        const run = (
          entity: MinimalConfigEntity,
          name: string,
          at: string,
          recordSnapshot = false
        ) =>
          generateMigration({
            name,
            dialect,
            migrationsDir: dir,
            defaultLocale: "en",
            collections: [entity],
            singles: [],
            components: [],
            nonInteractive: true,
            recordSnapshot,
            now: new Date(at),
          });
        await run(shared, "one", "2026-10-16T10:00:00.000Z");
        // A companion file from before files recorded their intent, for a collection since gone.
        await writeFile(
          resolve(dir, "20261016_100000_001_create_localization_pages.sql"),
          "-- Migration: 20261016_100000_001_create_localization_pages\n" +
            "-- Generated: localization companion (create-only) (i18n)\n\n" +
            "-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n",
          "utf-8"
        );

        await expect(
          run(translated, "two", "2026-10-16T11:00:00.000Z")
        ).rejects.toThrow(/--record-snapshot/);
        expect(
          await run(
            shared,
            "record_translated_fields",
            "2026-10-16T11:10:00.000Z",
            true
          )
        ).not.toBeNull();
        expect(
          await run(
            shared,
            "record_translated_fields",
            "2026-10-16T11:20:00.000Z",
            true
          )
        ).toBeNull();
        await expect(
          run(translated, "two", "2026-10-16T11:30:00.000Z")
        ).resolves.not.toBeNull();
      });

      it("refuses while the config holds a change to migrate, writing nothing", async () => {
        const dir = await mkdtemp(join(tmpdir(), "nextly-record-"));
        await generateMigration({
          name: "one",
          dialect,
          migrationsDir: dir,
          defaultLocale: "en",
          collections: [TRANSLATED],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date("2026-10-16T10:00:00.000Z"),
        });
        const before = await contentsOf(dir);

        await expect(
          record(dir, SHARED, "2026-10-16T11:00:00.000Z")
        ).rejects.toThrow(/--record-snapshot.*nextly migrate:create --name/);
        expect(await contentsOf(dir)).toEqual(before);
      });
    });
  }
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
