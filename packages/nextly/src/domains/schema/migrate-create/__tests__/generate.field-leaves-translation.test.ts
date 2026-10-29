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
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { formatSnapshotRecordFile } from "../format-file";
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

    /**
     * The three files of a field leaving translation with a setting: the main file creates the
     * shared column without it, and the shared file applies it between the copy and the companion
     * column's drop, so a value the database refuses is still on the companion.
     */
    async function leavingWith(
      next: MinimalConfigEntity,
      first?: MinimalConfigEntity
    ) {
      const files = await secondRun(dialect, next, first ? { first } : {});
      const main = sections(
        files.find(f => f.name.endsWith("_two.sql"))?.sql ?? ""
      );
      const shared = sections(
        files.find(f => f.name.includes("_shared_localization_"))?.sql ?? ""
      );
      return { main, shared };
    }

    it("makes a required field required after its values are copied, before the companion drop", async () => {
      const { main, shared } = await leavingWith({
        ...SHARED,
        fields: [
          { name: "body", type: "text", localized: false, required: true },
          { name: "price", type: "number" },
        ],
      });

      // Created nullable: no NOT NULL in the main file's ADD.
      const add = main.up
        .split("\n")
        .find(line => line.includes(`ADD COLUMN ${q("body")}`));
      expect(add).toBeDefined();
      expect(add).not.toMatch(/NOT NULL/);
      // Then copied, made required, and only then dropped from the companion.
      const copy = shared.up.indexOf(`UPDATE ${q("dc_docs")}`);
      const required =
        dialect === "sqlite"
          ? shared.up.indexOf(`CREATE TABLE ${q("__new_dc_docs")}`)
          : shared.up.search(
              dialect === "postgresql"
                ? new RegExp(`ALTER COLUMN ${escape(q("body"))} SET NOT NULL`)
                : new RegExp(`MODIFY COLUMN ${escape(q("body"))} [^;]*NOT NULL`)
            );
      const drop = shared.up.indexOf(
        `ALTER TABLE ${q("dc_docs_locales")} DROP COLUMN ${q("body")}`
      );
      expect(copy).toBeGreaterThanOrEqual(0);
      expect(required).toBeGreaterThan(copy);
      expect(drop).toBeGreaterThan(required);
    });

    it.each([
      {
        how: "its own flag",
        field: { name: "body", type: "text", localized: false, unique: true },
        column: "body",
      },
      {
        how: "a declared unique index",
        field: { name: "body", type: "text", localized: false },
        indexes: [{ fields: ["body"], unique: true }],
        column: "body",
      },
    ])(
      "creates the unique index from $how after the values are copied, and drops it first on the way down",
      async ({ field, indexes, column }) => {
        const { main, shared } = await leavingWith({
          ...SHARED,
          fields: [field, { name: "price", type: "number" }],
          ...(indexes ? { indexes } : {}),
        });

        const unique = new RegExp(
          `CREATE UNIQUE INDEX[^;]*\\(${escape(q(column))}\\)`
        );
        expect(main.up).not.toMatch(unique);
        const copy = shared.up.indexOf(`UPDATE ${q("dc_docs")}`);
        const index = shared.up.search(unique);
        const drop = shared.up.indexOf(
          `ALTER TABLE ${q("dc_docs_locales")} DROP COLUMN ${q(column)}`
        );
        expect(index).toBeGreaterThan(copy);
        expect(drop).toBeGreaterThan(index);
        // The index goes before the column it covers: SQLite drops no indexed column. PostgreSQL
        // spells it as the constraint first, then the index.
        expect(shared.down.trimStart()).toMatch(
          /^(DROP INDEX|ALTER TABLE \S+ DROP CONSTRAINT)/
        );
      }
    );

    it("creates a slug's automatic unique index after its values are copied", async () => {
      // No `unique` flag and no declared index: every `slug` column gets a unique index of its own.
      const withSlug = (localized: boolean) => ({
        ...TRANSLATED,
        fields: [
          { name: "slug", type: "text", localized },
          { name: "price", type: "number" },
        ],
      });
      const { main, shared } = await leavingWith(
        withSlug(false),
        withSlug(true)
      );

      const unique = new RegExp(
        `CREATE UNIQUE INDEX[^;]*\\(${escape(q("slug"))}\\)`
      );
      expect(main.up).not.toMatch(unique);
      expect(shared.up).toMatch(unique);
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
      translatedFieldsRecorded?: boolean;
      snapshot: { tables: Record<string, unknown>[] };
    };
    delete file.translatedFieldsRecorded;
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
async function forgetCompanionIntents(
  dir: string,
  only: RegExp = /_localization_/
): Promise<void> {
  for (const name of await readdir(dir)) {
    if (!only.test(name)) continue;
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

/**
 * A project whose companions came from outside its migration files, as a development sync or
 * `db:sync` makes them, and whose snapshot predates the record: no file and no snapshot says
 * which fields are translated.
 */
async function forgetCompanionFiles(dir: string): Promise<void> {
  await forgetTranslatedFieldRecord(dir);
  for (const name of await readdir(dir)) {
    if (name.includes("_localization_")) await rm(resolve(dir, name));
  }
}

/**
 * A project whose snapshot predates the record and whose localization files say neither what
 * they are for nor which entity they are about, as a hand-edited one may.
 */
async function forgetCompanionHeaders(dir: string): Promise<void> {
  await forgetTranslatedFieldRecord(dir);
  for (const name of await readdir(dir)) {
    if (!name.includes("_localization_")) continue;
    const path = resolve(dir, name);
    const kept = (await readFile(path, "utf-8"))
      .split("\n")
      .filter(
        line =>
          !line.startsWith("-- Localization:") &&
          !/^-- (Collections|Singles|Field groups|Components):/.test(line)
      );
    await writeFile(path, kept.join("\n"), "utf-8");
  }
}

/** A collection that isn't translated, with one field more in `NOTES_GROWN`. */
const NOTES: MinimalConfigEntity = {
  slug: "notes",
  tableName: "dc_notes",
  fields: [{ name: "title", type: "text" }],
};
const NOTES_GROWN: MinimalConfigEntity = {
  ...NOTES,
  fields: [...NOTES.fields, { name: "summary", type: "text" }],
};

/** `migrate:create` on `dir` for `collections`, as `name`, at the minute `at` past 10:00. */
function generate(
  dialect: SupportedDialect,
  dir: string,
  collections: MinimalConfigEntity[],
  name: string,
  at: number,
  options: { recordSnapshot?: boolean; onWarning?: (m: string) => void } = {}
) {
  return generateMigration({
    name,
    dialect,
    migrationsDir: dir,
    defaultLocale: "en",
    collections,
    singles: [],
    components: [],
    nonInteractive: true,
    now: new Date(Date.UTC(2026, 9, 16, 10, at)),
    ...options,
  });
}

/** A migrations directory after one `migrate:create` per step, each step's `after` run on it. */
async function projectAfter(
  dialect: SupportedDialect,
  steps: {
    collections: MinimalConfigEntity[];
    after?: (dir: string) => Promise<void>;
  }[]
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-field-leaves-"));
  for (const [i, step] of steps.entries()) {
    await generate(dialect, dir, step.collections, `step${i + 1}`, i);
    await step.after?.(dir);
  }
  return dir;
}

/** The names of the files one more `migrate:create` (`next`, at 11:00) writes to `dir`. */
async function filesOfRun(
  dialect: SupportedDialect,
  dir: string,
  collections: MinimalConfigEntity[]
): Promise<string[]> {
  const before = new Set(await readdir(dir));
  await generate(dialect, dir, collections, "next", 60);
  return (await readdir(dir))
    .filter(f => f.endsWith(".sql") && !before.has(f))
    .sort();
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

/** `docs` with `title` and `body`, the collection and each field translated or not. */
const titled = (
  localized: boolean,
  title: boolean,
  body: boolean
): MinimalConfigEntity => ({
  slug: "docs",
  tableName: "dc_docs",
  localized,
  fields: [
    { name: "title", type: "text", localized: title },
    { name: "body", type: "text", localized: body },
  ],
});

/** `TRANSLATED` with one more field. */
const withField = (
  field: MinimalConfigEntity["fields"][number]
): MinimalConfigEntity => ({
  ...TRANSLATED,
  fields: [...TRANSLATED.fields, field],
});

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "migrate:create on a project whose snapshots record translated fields (%s)",
  dialect => {
    it("reads a collection removed and added again untranslated as never translated", async () => {
      // Removing a collection writes no localization file, so the files still describe the
      // companion the first step made. The snapshot says the collection is not translated.
      const dir = await projectAfter(dialect, [
        { collections: [titled(true, true, true)] },
        { collections: [] },
        { collections: [titled(false, false, false)] },
      ]);

      expect(
        await filesOfRun(dialect, dir, [titled(true, true, false)])
      ).toEqual([
        expect.stringMatching(/_next\.sql$/),
        expect.stringMatching(/_enable_localization_docs\.sql$/),
      ]);
    });

    it.each([
      { before: "not translated", localized: false },
      { before: "translated with no translated field", localized: true },
    ])(
      "makes the companion of a collection $before that gains only new translated fields",
      async ({ localized }) => {
        // No translated column was ever on the main table, so its shape alone reads the same as a
        // companion already made.
        const dir = await projectAfter(dialect, [
          {
            collections: [
              {
                ...TRANSLATED,
                localized,
                fields: [{ name: "price", type: "number" }],
              },
            ],
          },
        ]);

        expect(await filesOfRun(dialect, dir, [TRANSLATED])).toEqual([
          expect.stringMatching(/_next\.sql$/),
          expect.stringMatching(/_create_localization_docs\.sql$/),
        ]);
      }
    );
  }
);

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "migrate:create when the last snapshot predates its record of translated fields (%s)",
  dialect => {
    it("refuses a field leaving translation on a collection no localization file is about, writing nothing", async () => {
      let dir = "";
      let before: Record<string, string> = {};
      const run = secondRun(dialect, SHARED, {
        beforeSecond: async d => {
          await forgetCompanionFiles(d);
          dir = d;
          before = await contentsOf(d);
        },
      });

      await expect(run).rejects.toThrow(/"body"/);
      await expect(run).rejects.toThrow(/--record-snapshot/);
      expect(await contentsOf(dir)).toEqual(before);
    });

    it("plans no companion over one no localization file is about", async () => {
      // Its translated column is not on the main table, so the companion is there; a file that
      // made it again would drop it on rollback.
      const files = await secondRun(dialect, [TRANSLATED, NOTES], {
        first: [TRANSLATED],
        beforeSecond: forgetCompanionFiles,
      });

      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_two\.sql$/),
      ]);
    });

    it("refuses what reads as a collection becoming translated beside a localization file that names no collection, writing nothing", async () => {
      // docs was translated with `headline`; its companion file now says neither what it did nor
      // whose it is. Dropping `headline` and translating `body` reads the same as turning
      // translation on, over a companion that file may have made.
      let dir = "";
      let before: Record<string, string> = {};
      const run = secondRun(
        dialect,
        {
          ...BODY_SHARED,
          fields: [{ name: "body", type: "text", localized: true }],
        },
        {
          first: BODY_SHARED,
          beforeSecond: async d => {
            await forgetCompanionHeaders(d);
            dir = d;
            before = await contentsOf(d);
          },
        }
      );

      await expect(run).rejects.toThrow(/"body"/);
      await expect(run).rejects.toThrow(/--record-snapshot/);
      expect(await contentsOf(dir)).toEqual(before);
    });

    it("refuses a column a collection that isn't translated gains beside a localization file that names no collection, naming the file", async () => {
      // The file may have made notes' companion, so `summary` may be coming back from it.
      let dir = "";
      let before: Record<string, string> = {};
      const run = secondRun(dialect, [TRANSLATED, NOTES_GROWN], {
        first: [TRANSLATED, NOTES],
        beforeSecond: async d => {
          await forgetTranslatedFieldRecord(d);
          // Hand-edited: the marker, and no header saying which entity it is about.
          await writeFile(
            resolve(d, "20261016_103000_000_hand_edited.sql"),
            "-- Generated: localization companion (create-only) (i18n)\n\n" +
              "-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n",
            "utf-8"
          );
          dir = d;
          before = await contentsOf(d);
        },
      });

      await expect(run).rejects.toThrow(/"summary" in collection "notes"/);
      await expect(run).rejects.toThrow(/20261016_103000_000_hand_edited\.sql/);
      await expect(run).rejects.toThrow(/--record-snapshot/);
      expect(await contentsOf(dir)).toEqual(before);
    });

    it("refuses turning translation off for a collection whose nameless localization file made its companion, writing nothing", async () => {
      let dir = "";
      let before: Record<string, string> = {};
      const run = secondRun(
        dialect,
        { ...TRANSLATED, localized: false },
        {
          beforeSecond: async d => {
            await forgetCompanionHeaders(d);
            dir = d;
            before = await contentsOf(d);
          },
        }
      );

      await expect(run).rejects.toThrow(/"body" in collection "docs"/);
      await expect(run).rejects.toThrow(/_create_localization_docs\.sql/);
      await expect(run).rejects.toThrow(/--record-snapshot/);
      expect(await contentsOf(dir)).toEqual(before);
    });

    it("refuses as before beside a record migration whose snapshot was never written", async () => {
      const run = secondRun(dialect, SHARED, {
        beforeSecond: async d => {
          await forgetEverything(d);
          // What `--record-snapshot` leaves when writing its snapshot fails: the migration alone.
          await writeFile(
            resolve(d, "20261016_103000_000_record_translated_fields.sql"),
            formatSnapshotRecordFile(
              "record_translated_fields",
              dialect,
              new Date("2026-10-16T10:30:00.000Z")
            ),
            "utf-8"
          );
        },
      });

      await expect(run).rejects.toThrow(/--record-snapshot/);
    });

    it("reads an older localization file as about only the collection its header names", async () => {
      const pages: MinimalConfigEntity = {
        ...TRANSLATED,
        slug: "pages",
        tableName: "dc_pages",
      };
      // docs' companion file is written first and pages' after it, so a file of pages' that may be
      // anyone's would leave docs' history unread too.
      const files = await secondRun(
        dialect,
        [withField({ name: "tagline", type: "text", localized: false }), pages],
        {
          first: [TRANSLATED, pages],
          beforeSecond: async d => {
            await forgetTranslatedFieldRecord(d);
            await forgetCompanionIntents(d, /_localization_pages\.sql$/);
          },
        }
      );

      // pages' file can't be read, but it names pages: docs' own files still say `tagline` is new.
      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_two\.sql$/),
      ]);
    });

    it("reads a file it can't read, after the one that made the companion, as possibly changing it", async () => {
      // The disable dropped the companion, but its file says nothing this build reads, so the
      // files read alone still have `body` translated.
      const dir = await projectAfter(dialect, [
        { collections: [TRANSLATED] },
        {
          collections: [{ ...TRANSLATED, localized: false }],
          after: async d => {
            await forgetCompanionIntents(d, /_disable_localization_/);
            await forgetTranslatedFieldRecord(d);
          },
        },
      ]);

      // `body` shared now: no file moves it out of the companion the files alone describe. The
      // new collection gives the run a main file to write either way.
      const files = await filesOfRun(dialect, dir, [
        {
          ...TRANSLATED,
          fields: [
            { name: "headline", type: "text", localized: true },
            ...SHARED.fields,
          ],
        },
        {
          slug: "notes",
          tableName: "dc_notes",
          fields: [{ name: "title", type: "text" }],
        },
      ]);
      expect(files).toEqual([expect.stringMatching(/_next\.sql$/)]);
    });

    it("refuses a column change once a file it can't read may be the collection's, whatever comes after it", async () => {
      // docs' first file can't be read; a readable disable after it vouches for nothing it did.
      const dir = await projectAfter(dialect, [
        { collections: [TRANSLATED], after: d => forgetCompanionIntents(d) },
        {
          collections: [{ ...TRANSLATED, localized: false }],
          after: forgetTranslatedFieldRecord,
        },
      ]);

      await expect(
        filesOfRun(dialect, dir, [
          withField({ name: "tagline", type: "text", localized: false }),
        ])
      ).rejects.toThrow(/in collection "docs".*--record-snapshot/s);
    });

    it("refuses a column change after a create that may run over a companion an unreadable file made", async () => {
      // An older file of docs' can't be read, and comes before the create that recorded `body`:
      // that create runs only where no companion is there, so it says nothing of what the older
      // file left.
      const dir = await projectAfter(dialect, [
        { collections: [{ ...TRANSLATED, localized: false }] },
        { collections: [TRANSLATED], after: forgetTranslatedFieldRecord },
      ]);
      await writeFile(
        resolve(dir, "20261016_095000_000_create_localization_docs.sql"),
        "-- Collections: docs\n" +
          "-- Generated: localization companion (create-only) (i18n)\n\n" +
          "-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n",
        "utf-8"
      );

      const run = filesOfRun(dialect, dir, [SHARED]);
      await expect(run).rejects.toThrow(/"body" in collection "docs"/);
      await expect(run).rejects.toThrow(/create_localization_docs\.sql/);
    });

    it("lets a field be added in a project that was never translated", async () => {
      const dir = await projectAfter(dialect, [
        { collections: [NOTES], after: forgetTranslatedFieldRecord },
      ]);

      expect(await filesOfRun(dialect, dir, [NOTES_GROWN])).toEqual([
        expect.stringMatching(/_next\.sql$/),
      ]);
    });

    it("refuses a translated field that goes while a shared one becomes translated, when no record says which were", async () => {
      const run = secondRun(
        dialect,
        {
          ...BODY_SHARED,
          fields: [{ name: "body", type: "text", localized: true }],
        },
        { first: BODY_SHARED, beforeSecond: forgetEverything }
      );

      await expect(run).rejects.toThrow(/"body"/);
      await expect(run).rejects.toThrow(/--record-snapshot/);
    });

    it.each([
      { records: "neither record says", forget: forgetEverything },
      {
        records: "only the migration files say",
        forget: forgetTranslatedFieldRecord,
      },
    ])(
      "refuses a collection that stops being translated when $records which fields were, writing nothing",
      async ({ forget }) => {
        let dir = "";
        let before: Record<string, string> = {};
        const run = secondRun(
          dialect,
          { ...TRANSLATED, localized: false },
          {
            beforeSecond: async d => {
              await forget(d);
              dir = d;
              before = await contentsOf(d);
            },
          }
        );

        await expect(run).rejects.toThrow(/collection "docs"/);
        await expect(run).rejects.toThrow(/--record-snapshot/);
        expect(await contentsOf(dir)).toEqual(before);
      }
    );

    it("refuses a shared field added to a translated collection, which reads the same as one leaving translation", async () => {
      const run = secondRun(
        dialect,
        withField({ name: "weight", type: "number" }),
        { beforeSecond: forgetEverything }
      );

      await expect(run).rejects.toThrow(/"weight"/);
    });

    it.each([
      {
        change: "a translated field made a password",
        next: {
          ...TRANSLATED,
          fields: [
            { name: "body", type: "password" },
            { name: "price", type: "number" },
          ],
        },
        named: /"body"/,
      },
      {
        // Read the same way from the main table alone: a column it gains.
        change: "a password field added",
        next: withField({ name: "secret", type: "password" }),
        named: /"secret"/,
      },
    ])(
      "refuses $change on a translated collection no record settles",
      async ({ next, named }) => {
        const run = secondRun(dialect, next, {
          beforeSecond: forgetEverything,
        });

        await expect(run).rejects.toThrow(named);
        await expect(run).rejects.toThrow(/--record-snapshot/);
      }
    );

    it.skipIf(process.getuid?.() === 0)(
      "refuses turning translation off when the migrations directory can't be listed, naming it",
      async () => {
        const dir = await projectAfter(dialect, [
          { collections: [TRANSLATED], after: forgetTranslatedFieldRecord },
        ]);
        // Written to and entered, but not listed: its files may have made the companion.
        await chmod(dir, 0o300);
        try {
          const run = generate(
            dialect,
            dir,
            [{ ...TRANSLATED, localized: false }],
            "next",
            60
          );
          await expect(run).rejects.toThrow(/"body" in collection "docs"/);
          await expect(run).rejects.toThrow(new RegExp(escape(dir)));
        } finally {
          await chmod(dir, 0o755);
        }
      }
    );

    it("names the run to make again by the name its file takes, after putting the config back", async () => {
      const dir = await projectAfter(dialect, [
        { collections: [TRANSLATED], after: forgetEverything },
      ]);
      const run = generate(dialect, dir, [SHARED], "Make body shared", 60);

      await expect(run).rejects.toThrow(/as it was at the last migration/);
      await expect(run).rejects.toThrow(
        /`nextly migrate:create --name make_body_shared`/
      );
    });

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

    it("refuses a column a collection that isn't translated gains, in a project whose translations no record settles", async () => {
      const notes = (fields: MinimalConfigEntity["fields"]) => ({
        slug: "notes",
        tableName: "dc_notes",
        fields,
      });
      const files = secondRun(
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

      // No file made notes' companion, so none says it never had one.
      await expect(files).rejects.toThrow(/"summary" in collection "notes"/);
    });

    it("refuses turning translation on for a collection no file is about, in a project with older files", async () => {
      const pages: MinimalConfigEntity = {
        ...TRANSLATED,
        slug: "pages",
        tableName: "dc_pages",
      };
      // A companion made outside the files reads the same as none.
      const run = secondRun(dialect, [pages, TRANSLATED], {
        first: [pages, { ...TRANSLATED, localized: false }],
        beforeSecond: forgetEverything,
      });

      await expect(run).rejects.toThrow(/"body" in collection "docs"/);
      await expect(run).rejects.toThrow(/--record-snapshot/);
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

      it("records nothing when the snapshot records the translated fields and the companion files don't", async () => {
        const dir = await projectAfter(dialect, [
          { collections: [TRANSLATED], after: d => forgetCompanionIntents(d) },
        ]);
        const before = await contentsOf(dir);

        expect(
          await generate(dialect, dir, [TRANSLATED], "record", 30, {
            recordSnapshot: true,
          })
        ).toBeNull();
        expect(await contentsOf(dir)).toEqual(before);
      });

      it("names the change that is pending, and the plain run that records the fields with it", async () => {
        const unique: MinimalConfigEntity = {
          ...TRANSLATED,
          fields: [
            { name: "code", type: "text", localized: true, unique: true },
            { name: "price", type: "number" },
          ],
        };
        const dir = await projectAfter(dialect, [
          { collections: [unique], after: forgetEverything },
        ]);

        // The per-language unique index is new to a snapshot that predates the record.
        const recording = generate(dialect, dir, [unique], "record", 30, {
          recordSnapshot: true,
        });
        await expect(recording).rejects.toThrow(/"dc_docs"/);
        await expect(recording).rejects.toThrow(
          /`nextly migrate:create --name <name>` instead/
        );
        await expect(
          generate(dialect, dir, [unique], "two", 40)
        ).resolves.not.toBeNull();
      });

      it("records a project with an older localization file that names no collection", async () => {
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
        await forgetTranslatedFieldRecord(dir);
        // A companion file from before files recorded their intent, naming no collection, so it
        // may be docs'.
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
        const before = new Set(await readdir(dir));
        await run(translated, "two", "2026-10-16T11:30:00.000Z");
        // The collection becoming translated, as the record says it was not.
        expect(
          (await readdir(dir))
            .filter(f => f.endsWith(".sql") && !before.has(f))
            .sort()
        ).toEqual([
          expect.stringMatching(/_two\.sql$/),
          expect.stringMatching(/_enable_localization_docs\.sql$/),
        ]);
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
        await forgetTranslatedFieldRecord(dir);
        const before = await contentsOf(dir);

        const recording = record(dir, SHARED, "2026-10-16T11:00:00.000Z");
        await expect(recording).rejects.toThrow(
          /--record-snapshot.*nextly migrate:create --name/
        );
        await expect(recording).rejects.toThrow(/"dc_docs"/);
        expect(await contentsOf(dir)).toEqual(before);
      });

      it("records nothing for a snapshot that records the fields, whatever the config holds", async () => {
        const dir = await projectAfter(dialect, [
          { collections: [TRANSLATED] },
        ]);
        const before = await contentsOf(dir);

        expect(
          await record(dir, SHARED, "2026-10-16T11:00:00.000Z")
        ).toBeNull();
        expect(await contentsOf(dir)).toEqual(before);
      });

      it("records nothing for a recording snapshot before a planner can refuse the config", async () => {
        const dir = await projectAfter(dialect, [
          { collections: [TRANSLATED] },
        ]);

        // A field that changes type as it leaves translation, which a plain run refuses.
        expect(
          await record(
            dir,
            {
              ...TRANSLATED,
              fields: [
                { name: "body", type: "number" },
                { name: "price", type: "number" },
              ],
            },
            "2026-10-16T11:00:00.000Z"
          )
        ).toBeNull();
      });
    });
  }
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
