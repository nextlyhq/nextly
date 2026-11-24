/**
 * A migration's companion files are published in the same step as the
 * migration itself, before the writer's last look at its hold: a writer that
 * has lost the project's migration files to another by the time its
 * companions are written stops and says so, rather than ending as a run that
 * wrote its migration and adding steps after its successor's unnoticed.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settingsOf } from "../entity-settings";
import { generateMigration, type MinimalConfigEntity } from "../generate";
import {
  WRITER_LOCK_FILE,
  isWriterHoldLost,
  setWriterHoldBounds,
  withMigrationWriterHold,
} from "../writer-hold";

/**
 * What a test does to the run's companion files: a step taken as the first
 * is moved to its name (once), a failure of the first one's writing, and a
 * failure of the move of the one whose name matches.
 */
const between = vi.hoisted(() => ({
  beforeCompanion: undefined as (() => void) | undefined,
  failWriting: false,
  failPlacing: undefined as RegExp | undefined,
  placed: [] as string[],
}));

vi.mock(
  "../../../i18n/migration/write-migration-file",
  async importOriginal => {
    const real =
      await importOriginal<
        typeof import("../../../i18n/migration/write-migration-file")
      >();
    return {
      ...real,
      prepareCompanionMigrationFile: async (
        ...args: Parameters<typeof real.prepareCompanionMigrationFile>
      ) => {
        if (between.failWriting) {
          between.failWriting = false;
          throw Object.assign(new Error("ENOSPC: no space left on device"), {
            code: "ENOSPC",
          });
        }
        const file = await real.prepareCompanionMigrationFile(...args);
        return {
          ...file,
          place: async () => {
            const step = between.beforeCompanion;
            between.beforeCompanion = undefined;
            step?.();
            if (between.failPlacing?.test(file.path) === true) {
              between.failPlacing = undefined;
              throw Object.assign(new Error("EACCES: permission denied"), {
                code: "EACCES",
              });
            }
            await file.place();
            between.placed.push(file.path);
          },
        };
      },
    };
  }
);

let migrationsDir: string;
let restore: () => void;

beforeEach(() => {
  migrationsDir = mkdtempSync(join(tmpdir(), "nextly-companions-published-"));
  restore = setWriterHoldBounds({
    waitMs: 0,
    leaseSeconds: 30,
    renewMs: 600_000,
  });
});

afterEach(() => {
  restore();
  between.beforeCompanion = undefined;
  between.failWriting = false;
  between.failPlacing = undefined;
  between.placed = [];
  rmSync(migrationsDir, { recursive: true, force: true });
});

/** A translated collection, whose migration comes with a companion file. */
const docs: MinimalConfigEntity = {
  slug: "docs",
  tableName: "dc_docs",
  localized: true,
  fields: [
    { name: "body", type: "longText", localized: true },
    { name: "price", type: "number" },
  ],
};

const generate = () =>
  withMigrationWriterHold({ migrationsDir, command: "migrate:create" }, () =>
    generateMigration({
      name: "create_docs",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [docs],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date("2026-07-09T12:00:00.000Z"),
    })
  );

const migrationFiles = () =>
  readdirSync(migrationsDir).filter(name => name.endsWith(".sql"));

/** Every file under the folder but the writer's own hold, by its path in it. */
const everyFile = () =>
  (readdirSync(migrationsDir, { recursive: true }) as string[])
    .filter(name => !name.includes(WRITER_LOCK_FILE))
    .filter(name => /\.(sql|json|tmp)$/.test(name))
    .sort();

const failure = async (): Promise<unknown> => {
  try {
    await generate();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("a migration's companion files", () => {
  it("are written with it (the control: a run that keeps the folder writes both)", async () => {
    const result = await generate();

    expect(result).not.toBeNull();
    expect(migrationFiles().length).toBeGreaterThanOrEqual(2);
  });

  it("are written before the run's last look at its hold, so a run overtaken by then says so", async () => {
    const lock = join(migrationsDir, WRITER_LOCK_FILE);
    // As another writer leaves the folder once it has set this run's lapsed
    // hold aside and taken it: its own record at the hold's path.
    between.beforeCompanion = () => {
      const mine = JSON.parse(readFileSync(lock, "utf-8")) as Record<
        string,
        unknown
      >;
      renameSync(lock, `${lock}.set-aside`);
      rmSync(`${lock}.set-aside`);
      writeFileSync(
        lock,
        JSON.stringify({
          ...mine,
          token: "another-writer",
          command: "migrate:baseline",
        })
      );
    };

    let lost: unknown;
    try {
      await generate();
    } catch (error) {
      lost = error;
    }

    // The run does not end as one that wrote its migration: it stops as a
    // writer another overtook, naming the file it wrote.
    expect(isWriterHoldLost(lost)).toBe(true);
    expect((lost as { publicMessage: string }).publicMessage).toMatch(
      /as it wrote \S*create_docs\.sql/
    );
    // What it wrote is left, companions included: a writer removes no
    // migration file once it is in the folder.
    expect(migrationFiles().length).toBeGreaterThanOrEqual(2);
    // And the other writer's hold is untouched.
    expect(existsSync(lock)).toBe(true);
    expect(
      (JSON.parse(readFileSync(lock, "utf-8")) as { command: string }).command
    ).toBe("migrate:baseline");
  });

  it("leave nothing of the migration behind where one cannot be written, and the next run writes all of it", async () => {
    between.failWriting = true;

    const failed = await failure();

    expect(String(failed)).toMatch(/ENOSPC/);
    // No migration without its companion, and nothing left aside either.
    expect(everyFile()).toEqual([]);

    const result = await generate();
    expect(result).not.toBeNull();
    expect(migrationFiles()).toHaveLength(1 + result!.companionFiles.length);
    expect(result!.companionFiles.length).toBeGreaterThanOrEqual(1);
    for (const { path } of result!.companionFiles)
      expect(existsSync(path)).toBe(true);
  });

  it("are prepared before the migration is put in place, and follow it in the order they run", async () => {
    const result = await generate();

    // A companion that creates the translations table runs after the file
    // that creates the table it points to: it is placed after it too.
    expect(between.placed).toEqual(result!.companionFiles.map(f => f.path));
    expect(
      between.placed.every(path => path > result!.sqlPath),
      "the control: this migration's companions sort after it"
    ).toBe(true);
  });

  it("take the migration back out with them where one cannot be moved into place", async () => {
    between.failPlacing = /_localization_docs\.sql$/;

    const failed = await failure();

    // The migration file was in place by then; the run still holds the
    // folder, so it removes what it placed and says nothing was written.
    expect((failed as { publicMessage: string }).publicMessage).toMatch(
      /was not written: moving \S*_localization_docs\.sql into place failed \(EACCES\)/
    );
    expect(isWriterHoldLost(failed)).toBe(false);
    expect(everyFile()).toEqual([]);

    const result = await generate();
    expect(migrationFiles()).toHaveLength(1 + result!.companionFiles.length);
  });

  it("are left with it where the move failed in a run another writer had overtaken", async () => {
    const lock = join(migrationsDir, WRITER_LOCK_FILE);
    between.beforeCompanion = () => {
      const mine = JSON.parse(readFileSync(lock, "utf-8")) as Record<
        string,
        unknown
      >;
      writeFileSync(lock, JSON.stringify({ ...mine, token: "another-writer" }));
    };
    between.failPlacing = /_localization_docs\.sql$/;

    const failed = await failure();

    // Not this run's folder any more: the other writer may have built on
    // the migration file, so it stays and is named.
    expect(isWriterHoldLost(failed)).toBe(true);
    expect((failed as { publicMessage: string }).publicMessage).toMatch(
      /as it wrote \S*create_docs\.sql/
    );
    expect(migrationFiles()).toHaveLength(1);
  });

  it("that run before the migration are put in place before it", async () => {
    await generate();
    // Translation turned off: the file that puts the columns back on the
    // main table runs before the migration, and is named before it.
    let thereBefore: string[] | undefined;
    between.placed = [];
    between.beforeCompanion = () => {
      thereBefore = migrationFiles();
    };

    const result = await withMigrationWriterHold(
      { migrationsDir, command: "migrate:create" },
      () =>
        generateMigration({
          name: "untranslate_docs",
          dialect: "sqlite",
          migrationsDir,
          defaultLocale: "en",
          collections: [
            {
              ...docs,
              localized: false,
              fields: docs.fields.map(field => ({
                ...field,
                localized: false,
              })),
            },
          ],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date("2026-07-10T12:00:00.000Z"),
        })
    );

    const before = result!.companionFiles
      .map(f => f.path)
      .filter(path => path < result!.sqlPath);
    expect(before.length, "the control: a companion sorts before it").toBe(1);
    expect(between.placed[0]).toBe(before[0]);
    // The migration was not in the folder yet as that file was moved there.
    expect(thereBefore).toBeDefined();
    expect(thereBefore).not.toContain(basename(result!.sqlPath));
    expect(existsSync(result!.sqlPath)).toBe(true);
  });

  // A translated field taking another type has its translations column's change written as a
  // companion file of its own, prepared aside with the migration's files and put in place before
  // the migration, which it runs ahead of.
  it("that retype a translations column are prepared aside and put in place before it", async () => {
    // Each entity as `migrate:create` takes it from a configuration, with the settings its snapshot
    // records: the fields the next run reads the translations column's old type from.
    const declared = (type: string): MinimalConfigEntity => {
      const fields = docs.fields.map(field =>
        field.name === "body" ? { ...field, type } : field
      );
      return {
        ...docs,
        fields,
        settings: {
          source: "code",
          settings: settingsOf(
            { slug: "docs", localized: true, fields },
            "code"
          ),
        },
      };
    };
    await withMigrationWriterHold(
      { migrationsDir, command: "migrate:create" },
      () =>
        generateMigration({
          name: "create_docs",
          dialect: "sqlite",
          migrationsDir,
          defaultLocale: "en",
          collections: [declared("longText")],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date("2026-07-09T12:00:00.000Z"),
        })
    );
    let thereBefore: string[] | undefined;
    between.placed = [];
    between.beforeCompanion = () => {
      thereBefore = migrationFiles();
    };

    const result = await withMigrationWriterHold(
      { migrationsDir, command: "migrate:create" },
      () =>
        generateMigration({
          name: "number_body",
          dialect: "sqlite",
          migrationsDir,
          defaultLocale: "en",
          collections: [declared("number")],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date("2026-07-10T12:00:00.000Z"),
        })
    );

    const retypes = result!.companionFiles
      .map(f => f.path)
      .filter(path => /_retypes_localization_docs\.sql$/.test(path));
    expect(retypes, "the control: a retypes file is written").toHaveLength(1);
    expect(retypes[0] < result!.sqlPath).toBe(true);
    expect(between.placed[0]).toBe(retypes[0]);
    expect(readFileSync(retypes[0], "utf-8")).toMatch(/"kind":"retypes"/);
    // The migration was not in the folder yet as that file was moved there.
    expect(thereBefore).toBeDefined();
    expect(thereBefore).not.toContain(basename(result!.sqlPath));
    expect(existsSync(result!.sqlPath)).toBe(true);
  });
});
