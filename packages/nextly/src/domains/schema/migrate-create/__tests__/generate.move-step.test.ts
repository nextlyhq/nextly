/**
 * On MySQL a run that moves fields writes the moves as a migration of their own, ahead of everything
 * else it changes: the first file's snapshot describes exactly what its statements leave, the second
 * starts from it, and the two are written together or not at all. Elsewhere the run stays one file.
 *
 * The two properties a plausible broken step would miss: the column a move into a group leaves is not
 * dropped by the first file, whose statements commit before the registry row says where the field is;
 * and the first snapshot records the moved declaration, which `nextly migrate` writes a registry from.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { defineCollection, group, text } from "../../../../config";
import { splitSqlStatements } from "../../migrate/split-sql";
import { parseSqlSections } from "../../migrate/sql-sections";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { generateMigration, type GenerateArgs } from "../generate";
import type { SnapshotFile } from "../snapshot-io";

// The layout every installation runs. The moved fields are shared, kept on the entry's own row; the
// title is translated, kept in the language table, which no file here changes.
perLanguageStorageSuite();

const TABLE = "dc_posts";
const shared = { localized: false } as const;

let migrationsDir: string;
let clock = 0;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-move-step-"));
});

afterEach(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

type Fields = Parameters<typeof defineCollection>[0]["fields"];
const posts = (fields: Fields) => [
  defineCollection({
    slug: "posts",
    fields: [text({ name: "title" }), ...fields],
  }),
];
const meta = (fields: Fields) => group({ name: "meta", fields: [...fields] });
const note = text({ name: "note", ...shared });
const summary = text({ name: "summary", ...shared });

function generate(
  declared: unknown[],
  args: Partial<GenerateArgs> = {}
): ReturnType<typeof generateMigration> {
  clock += 1;
  return generateMigration({
    name: "change",
    dialect: "mysql",
    migrationsDir,
    collections: toMinimalEntities(declared, e =>
      resolveCollectionTableName(e.slug, e.dbName)
    ),
    singles: [],
    components: [],
    nonInteractive: true,
    codeMoves: { acceptAll: true },
    now: new Date(Date.UTC(2026, 9, 28, 12, 0, clock)),
    ...args,
  });
}

/** The folder's migration files, in run order. */
const files = async () =>
  (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();

/** The snapshots beside them: a language table's file has none. */
const snapshotNames = async () =>
  (await readdir(join(migrationsDir, "meta")))
    .filter(f => f.endsWith(".snapshot.json"))
    .sort();

/** One file's statements each way, and its snapshot. */
async function read(file: string) {
  const sections = parseSqlSections(
    await readFile(join(migrationsDir, file), "utf-8")
  );
  const snapshot = JSON.parse(
    await readFile(
      join(migrationsDir, "meta", file.replace(/\.sql$/, ".snapshot.json")),
      "utf-8"
    )
  ) as SnapshotFile;
  return {
    up: splitSqlStatements(sections.upSql, "mysql"),
    down: splitSqlStatements(sections.downSql, "mysql"),
    snapshot,
  };
}

const columnIn = (snapshot: SnapshotFile, name: string) =>
  snapshot.snapshot.tables
    .find(table => table.name === TABLE)
    ?.columns.find(column => column.name === name);
const fieldsIn = (snapshot: SnapshotFile) =>
  snapshot.entities?.collections.posts?.settings.fields;
/**
 * A statement that writes rows of the posts. Anchored: MySQL rebuilds a column's definition in a
 * statement whose text names UPDATE too (`ON UPDATE`).
 */
const WRITES = new RegExp(`^\\s*UPDATE\\s+\`${TABLE}\``, "i");
const mentions = (statements: readonly string[], what: RegExp) =>
  statements.some(statement => what.test(statement));

/** The change's files after a first file that made the table, as `before`. */
async function change(before: Fields, after: Fields) {
  await generate(posts(before));
  const made = await files();
  const result = await generate(posts(after));
  const written = (await files()).filter(file => !made.includes(file));
  return { result, written, read: await Promise.all(written.map(read)) };
}

describe("a field moved into a group, on MySQL", () => {
  it("is copied by a first file that keeps its column, and dropped by the second", async () => {
    const {
      written,
      read: [step, rest],
    } = await change([summary, meta([note])], [meta([note, summary])]);
    expect(written).toHaveLength(2);
    expect(written[0]).toMatch(/_change_moves\.sql$/);
    expect(written[1]).toMatch(/_change\.sql$/);
    // The copy, and no drop: a run stopped after it reads the field where the registry has it.
    expect(mentions(step.up, /JSON_SET|JSON_MERGE|JSON_OBJECT/i)).toBe(true);
    expect(mentions(step.up, /DROP COLUMN/i)).toBe(false);
    expect(columnIn(step.snapshot, "summary")).toMatchObject({
      nullable: true,
    });
    expect(fieldsIn(step.snapshot)).toEqual(fieldsIn(rest.snapshot));
    // The second drops the column, and copies nothing.
    expect(mentions(rest.up, /DROP COLUMN `summary`/i)).toBe(true);
    expect(mentions(rest.up, /JSON_/i)).toBe(false);
    expect(columnIn(rest.snapshot, "summary")).toBeUndefined();
  });

  it("a Required one's column takes no value from then on, and is required again on the way back, last", async () => {
    const required = text({ name: "summary", ...shared, required: true });
    const {
      read: [step],
    } = await change([required, meta([note])], [meta([note, required])]);
    expect(columnIn(step.snapshot, "summary")).toMatchObject({
      nullable: true,
    });
    // Back: the values first, then NOT NULL.
    const copied = step.down.findIndex(s => WRITES.test(s));
    const tightened = step.down.flatMap((statement, at) =>
      /MODIFY COLUMN `summary`.*NOT NULL/is.test(statement) ? [at] : []
    );
    expect(copied).toBeGreaterThanOrEqual(0);
    expect(tightened.length).toBeGreaterThan(0);
    // None before the copy, which a column already NOT NULL would refuse an empty value from.
    expect(Math.min(...tightened)).toBeGreaterThan(copied);
  });
});

describe("a field moved out of a group, on MySQL", () => {
  it("optional, is one file: added, filled and recorded, with nothing left to change", async () => {
    const {
      written,
      read: [only],
    } = await change([meta([note, summary])], [summary, meta([note])]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/_change\.sql$/);
    expect(mentions(only.up, /ADD COLUMN `summary`/i)).toBe(true);
    expect(columnIn(only.snapshot, "summary")).toMatchObject({
      nullable: true,
    });
  });

  it("Required, is made required by the second file alone", async () => {
    const {
      written,
      read: [step, rest],
    } = await change(
      [meta([note, summary])],
      [text({ name: "summary", ...shared, required: true }), meta([note])]
    );
    expect(written).toHaveLength(2);
    expect(columnIn(step.snapshot, "summary")).toMatchObject({
      nullable: true,
    });
    expect(
      (fieldsIn(step.snapshot) as { name: string; required?: boolean }[]).find(
        field => field.name === "summary"
      )?.required
    ).toBe(false);
    expect(columnIn(rest.snapshot, "summary")).toMatchObject({
      nullable: false,
    });
    // It carries no value: the copy and the cleared key are the first file's.
    expect(rest.up.filter(statement => WRITES.test(statement))).toEqual([]);
  });
});

describe("the two files together", () => {
  it("every other change of the run is in the second, which is written from the first", async () => {
    const {
      written,
      read: [step, rest],
    } = await change(
      [summary, meta([note])],
      [text({ name: "extra", ...shared }), meta([note, summary])]
    );
    expect(columnIn(step.snapshot, "extra")).toBeUndefined();
    expect(mentions(rest.up, /ADD COLUMN `extra`/i)).toBe(true);
    const base = (file: string) => file.replace(/\.sql$/, "");
    expect(step.snapshot.migration).toBe(base(written[0] ?? ""));
    expect(rest.snapshot.parent).toBe(base(written[0] ?? ""));
    expect(rest.snapshot.merges).toBeUndefined();
  });

  it("neither is written where the run is refused", async () => {
    await generate(posts([summary, meta([note])]));
    const before = await files();
    const snapshots = await snapshotNames();
    await expect(
      generate(posts([meta([note, summary])]), {
        judgeDeletions: () => Promise.reject(new Error("refused")),
      })
    ).rejects.toThrow("refused");
    expect(await files()).toEqual(before);
    expect(await snapshotNames()).toEqual(snapshots);
  });

  it("a dry run names both and writes neither", async () => {
    await generate(posts([summary, meta([note])]));
    const before = await files();
    const result = await generate(posts([meta([note, summary])]), {
      dryRun: true,
    });
    expect(result?.moveStep?.sqlPath).toMatch(/_change_moves\.sql$/);
    expect(result?.sqlPath).toMatch(/_change\.sql$/);
    expect(await files()).toEqual(before);
  });

  it("a declined move stays a delete and an add, in one file", async () => {
    await generate(posts([summary, meta([note])]));
    const before = await files();
    await generate(posts([meta([note, summary])]), {
      codeMoves: { acceptAll: false },
    });
    const written = (await files()).filter(file => !before.includes(file));
    expect(written).toHaveLength(1);
    const only = await read(written[0] ?? "");
    expect(mentions(only.up, /DROP COLUMN `summary`/i)).toBe(true);
    expect(mentions(only.up, /JSON_/i)).toBe(false);
  });

  it("migrated again over the two, nothing is left to write", async () => {
    await change([summary, meta([note])], [meta([note, summary])]);
    expect(await generate(posts([meta([note, summary])]))).toBeNull();
  });
});

it.each(["postgresql", "sqlite"] as const)(
  "on %s a move and every other change stay one file",
  async dialect => {
    await generate(posts([summary, meta([note])]), { dialect });
    const before = await files();
    const result = await generate(
      posts([text({ name: "extra", ...shared }), meta([note, summary])]),
      { dialect }
    );
    expect((await files()).filter(file => !before.includes(file))).toHaveLength(
      1
    );
    expect(result?.moveStep).toBeUndefined();
  }
);
