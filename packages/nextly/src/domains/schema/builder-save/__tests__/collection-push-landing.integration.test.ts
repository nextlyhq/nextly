/**
 * A collection's Schema Builder save that the development push applies, and that fails: whether
 * its migration files stay depends on whether the push may have changed the database.
 *
 * - A refusal before the push runs, a refusal inside it before any statement ran, or a busy
 *   table's stop that says nothing ran, leaves nothing: no file, no snapshot, no change to the
 *   definition, the table or the registry row.
 * - On MySQL, which commits each schema statement as it runs, and on SQLite, whose push keeps the
 *   statements before the one that fails, a push that fails after a statement ran keeps its
 *   files, recorded applied nowhere, and the admin is told the database holds part of the change
 *   and what to run next. PostgreSQL's push, run in one transaction, leaves nothing.
 *
 * Each save switches a relationship from one entry to many (`reachesRelationStorage`), a change
 * the push applies on every dialect.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { readTableDefinition } from "../../__tests__/helpers/table-definition";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { CollectionRegistryService } from "../../../collections/services/collection-registry-service";
import type { CollectionService } from "../../../collections/services/collection-service";
import { RealPreCleanupExecutor } from "../../pipeline/pre-cleanup/executor";
import { PushSchemaPipeline } from "../../pipeline/pushschema-pipeline";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";

// The test's seam on the pipeline's pre-resolution phase (renames, drops, a relation's values
// rewritten), which runs its statements on the transaction itself rather than through the
// statement executor: each call is counted, and runs as it would.
const preResolution = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../pipeline/pre-resolution/executor", async importOriginal => {
  const original =
    await importOriginal<
      typeof import("../../pipeline/pre-resolution/executor")
    >();
  return {
    ...original,
    executePreResolutionOps: (
      ...args: Parameters<typeof original.executePreResolutionOps>
    ) => {
      preResolution.calls += 1;
      return original.executePreResolutionOps(...args);
    },
  };
});

type Field = Record<string, unknown>;

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const text = (name: string): Field => ({ name, type: "text" });
const author = (hasMany: boolean): Field => ({
  name: "author",
  type: "relationship",
  relationTo: "authors",
  ...(hasMany ? { hasMany: true } : {}),
});
/** The collection as created, and the save that switches its relationship to many. */
const BEFORE = [text("title"), text("code"), author(false)];
const SWITCHED = [text("title"), text("code"), author(true), text("body")];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a collection save the push applies, which fails (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;
    let free: () => void = () => {};
    let holding: Promise<unknown> = Promise.resolve();
    const previous = {
      tryBound: process.env.NEXTLY_LOCK_TIMEOUT,
      total: process.env.NEXTLY_LOCK_TIMEOUT_TOTAL,
    };

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-collection-landing-"));
      // The Builder's save runs its change in development only.
      vi.stubEnv("NODE_ENV", "development");
      // Short bounds, so a busy table's tries run in seconds.
      process.env.NEXTLY_LOCK_TIMEOUT = "1";
      process.env.NEXTLY_LOCK_TIMEOUT_TOTAL = "4";
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      for (const [name, fields] of [
        ["authors", [text("name")]],
        ["posts", BEFORE],
      ] as const) {
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          { name, label: name, fields }
        );
      }
    });

    afterEach(async () => {
      free();
      await holding.catch(() => {});
      vi.restoreAllMocks();
      await t?.destroy();
      vi.unstubAllEnvs();
      for (const [key, value] of [
        ["NEXTLY_LOCK_TIMEOUT", previous.tryBound],
        ["NEXTLY_LOCK_TIMEOUT_TOTAL", previous.total],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(basePath, { recursive: true, force: true });
    });

    /**
     * The history's snapshots of `table` without the index `name`, as a history written before
     * that index was made would read: only the snapshots change, so no applied file's checksum
     * moves.
     */
    const forgetIndexInHistory = (table: string, name: string) => {
      const meta = join(migrationsDir(), "meta");
      for (const file of readdirSync(meta).filter(f =>
        f.endsWith(".snapshot.json")
      )) {
        const path = join(meta, file);
        const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
          snapshot: {
            tables: { name: string; indexes?: { name: string }[] }[];
          };
        };
        for (const entry of parsed.snapshot.tables) {
          if (entry.name === table && entry.indexes !== undefined) {
            entry.indexes = entry.indexes.filter(index => index.name !== name);
          }
        }
        writeFileSync(path, JSON.stringify(parsed, null, 2));
      }
    };

    const adapterOf = () => t.adapter as unknown as DrizzleAdapter;
    const exec = <R>(sql: string) =>
      (
        t.adapter as unknown as { executeQuery<T>(sql: string): Promise<T[]> }
      ).executeQuery<R>(sql);
    const migrationsDir = () => join(basePath, "migrations");
    const filesIn = (dir: string, suffix: string) =>
      existsSync(dir)
        ? Object.fromEntries(
            readdirSync(dir)
              .filter(name => name.endsWith(suffix))
              .sort()
              .map(name => [name, readFileSync(join(dir, name), "utf-8")])
          )
        : {};
    const ledger = () =>
      new SchemaEventsRepository(
        adapterOf().getDrizzle() as never,
        adapterOf().getCapabilities().dialect
      );

    /**
     * Everything a save that changed nothing must leave as it found it: every migration and
     * snapshot with its contents, the definition, every apply the ledger holds (but an attempt
     * that records it changed nothing), the table's columns and the registry row's fields.
     */
    async function standing() {
      const definition = join(basePath, "ui-schema.json");
      const [row] = await exec<{ fields: unknown }>(
        "SELECT fields FROM dynamic_collections WHERE slug = 'posts'"
      );
      return {
        files: filesIn(migrationsDir(), ".sql"),
        snapshots: filesIn(join(migrationsDir(), "meta"), ".json"),
        definition: existsSync(definition)
          ? readFileSync(definition, "utf-8")
          : undefined,
        ledger: (await ledger().listFileApplies())
          .filter(entry => entry.status !== "nothing_applied")
          .map(entry => JSON.stringify(entry))
          .sort(),
        columns: (
          await readTableDefinition(
            statement => exec(statement),
            adapterOf().getCapabilities().dialect,
            "dc_posts"
          )
        ).columns
          .map(column => column.name)
          .sort(),
        fields:
          typeof row?.fields === "string"
            ? row.fields
            : JSON.stringify(row?.fields),
      };
    }

    async function save(fields: Field[]): Promise<unknown> {
      const [row] = await exec<{ version: number | string | null }>(
        "SELECT schema_version AS version FROM dynamic_collections WHERE slug = 'posts'"
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        { fields, confirmed: true, schemaVersion: Number(row?.version ?? 1) }
      );
    }

    /** A second session holds the posts table until `free()`: an open transaction that read it. */
    async function holdThePosts(): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      holding = adapterOf().transaction(async tx => {
        await tx.execute("SELECT id FROM dc_posts");
        held();
        await freed;
      });
      await isHeld;
    }

    // SQLite's shared schema lock stops a save over a busy database before any try, as a raw
    // SQLITE_BUSY: a known gap of its own, so the tries are judged on PostgreSQL and MySQL.
    it.skipIf(dialect === "sqlite")(
      "leaves nothing when a busy table stops the push before anything ran",
      async () => {
        const before = await standing();
        await holdThePosts();

        await expect(save(SWITCHED)).rejects.toBeInstanceOf(Error);

        free();
        await holding.catch(() => {});
        expect(await standing()).toEqual(before);
      },
      60_000
    );

    // A refusal inside the push, before it runs any statement: a column on the table that no field
    // describes, beside the field the save adds, reads as a rename the save never answered, and the
    // dialog's prompt refuses the apply at its first question rather than drop it. MySQL and SQLite
    // keep what a push ran, so the push counts as having changed nothing only because it stopped at
    // that first question, asked before any statement.
    it("leaves nothing when the push refuses before running any statement", async () => {
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await exec(
        `ALTER TABLE ${q("dc_posts")} ADD COLUMN ${q("legacy_notes")} text`
      );
      const before = await standing();
      const sent = vi.spyOn(
        DrizzleStatementExecutor.prototype,
        "executeStatements"
      );
      const cleanup = vi.spyOn(RealPreCleanupExecutor.prototype, "execute");
      preResolution.calls = 0;

      const refused: unknown = await save(SWITCHED).then(
        () => undefined,
        (error: unknown) => error
      );
      // What the rule rests on: the first question comes before any statement. No phase that runs
      // one was reached, so a pipeline that asked after running some would fail here first.
      expect(sent).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(preResolution.calls).toBe(0);
      // Refused, and told as a refusal: never as a change the database holds part of.
      expect(refused).toBeInstanceOf(Error);
      expect(
        (refused as { publicMessage?: string }).publicMessage
      ).not.toContain("The database now holds part of this change");
      // No file kept, no definition or ledger entry written, the table as it was.
      expect(await standing()).toEqual(before);
    }, 60_000);

    it("leaves nothing when a refusal before the push stops it", async () => {
      // Two posts sharing a code: a code made unique over them is refused before anything runs
      // (`refuseUniqueOverRepeats`), naming the field.
      for (const title of ["One", "Two"]) {
        await t.nextly.create({
          collection: "posts",
          data: { title, code: "same" },
        } as never);
      }
      const before = await standing();

      await expect(
        save([
          text("title"),
          { ...text("code"), unique: true },
          author(true),
          text("body"),
        ])
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect(await standing()).toEqual(before);
    }, 60_000);

    // The title every entry carries is kept out of the stored fields, so the stored list never
    // names it: made unique, it is still a field the table already holds, whose values may repeat.
    // On its own the change runs through the save writer; beside the switch the push applies it.
    const titleUnique = { ...text("title"), unique: true };
    for (const [how, fields] of [
      ["on its own", [titleUnique, text("code"), author(false)]],
      [
        "beside a change the push applies",
        [titleUnique, text("code"), author(true), text("body")],
      ],
    ] as const) {
      it(`refuses a title made unique over entries that share one, ${how}, and leaves nothing`, async () => {
        for (const code of ["one", "two"]) {
          await t.nextly.create({
            collection: "posts",
            data: { title: "Same", code },
          } as never);
        }
        const before = await standing();

        await expect(save([...fields])).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.title",
                code: "UNIQUE_OVER_DUPLICATES",
              }),
            ],
          },
        });

        expect(await standing()).toEqual(before);
      }, 60_000);

      // Titles that differ are made unique: the check refuses repeats, never the title itself.
      it(`makes a title unique where no two entries share one, ${how}`, async () => {
        for (const [title, code] of [
          ["One", "one"],
          ["Two", "two"],
        ]) {
          await t.nextly.create({
            collection: "posts",
            data: { title, code },
          } as never);
        }

        await expect(save([...fields])).resolves.toBeDefined();
        await expect(
          t.nextly.create({
            collection: "posts",
            data: { title: "One", code: "three" },
          } as never)
        ).rejects.toBeDefined();
      }, 60_000);
    }

    /**
     * The test's seam on the push's statement executor, with no production hook: every statement
     * the push sends, across its calls, is noted; the first runs, which MySQL commits, SQLite's push
     * keeps and PostgreSQL's transaction rolls back with the rest, and the second fails.
     */
    function failSecondStatement(): { sent: string[]; restore: () => void } {
      const run = DrizzleStatementExecutor.prototype.executeStatements;
      const sent: string[] = [];
      const failing = vi
        .spyOn(DrizzleStatementExecutor.prototype, "executeStatements")
        .mockImplementation(async function (
          this: DrizzleStatementExecutor,
          tx: unknown,
          statements: string[]
        ) {
          for (const statement of statements) {
            sent.push(statement);
            if (sent.length > 1) {
              throw new Error("the second statement failed");
            }
            await run.call(this, tx, [statement]);
          }
        });
      return { sent, restore: () => failing.mockRestore() };
    }

    const definitionOf = () =>
      readTableDefinition(
        statement => exec(statement),
        adapterOf().getCapabilities().dialect,
        "dc_posts"
      );

    /** The admin's update of the collection, through the metadata service's update road. */
    const update = (fields: Field[]) =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "posts" },
        { fields }
      );

    // Each road a collection's change is pushed by in development: the schema dialog's apply and
    // the admin's update. On MySQL the update's push sends this change as one statement through the
    // executor, so a second added field gives it the second statement the seam fails.
    for (const [road, change] of [
      ["the schema dialog", save],
      ["an update", (fields: Field[]) => update([...fields, text("summary")])],
    ] as const) {
      it.runIf(dialect === "mysql" || dialect === "sqlite")(
        `keeps the files of a push through ${road} whose second statement failed after its first committed, and says so`,
        async () => {
          const filesBefore = Object.keys(filesIn(migrationsDir(), ".sql"));
          const tableBefore = await definitionOf();
          const failing = failSecondStatement();

          const failure = await change(SWITCHED).then(
            () => undefined,
            (error: unknown) => error
          );
          failing.restore();

          expect(failing.sent.length, failing.sent.join("\n")).toBeGreaterThan(
            1
          );
          // The first statement stayed: the table is no longer as it was.
          expect(await definitionOf()).not.toEqual(tableBefore);
          const kept = Object.keys(filesIn(migrationsDir(), ".sql")).filter(
            name => !filesBefore.includes(name)
          );
          expect(kept).not.toEqual([]);
          const applied = (await ledger().listFileApplies())
            .filter(entry => entry.status === "applied")
            .map(entry => String(entry.filename));
          for (const file of kept) expect(applied).not.toContain(file);
          // The admin is told the database holds part of the change, which files were kept for
          // it, and what to run next.
          const told = (failure as { publicMessage?: string } | undefined)
            ?.publicMessage;
          expect(told, String(failure)).toContain(
            "The database now holds part of this change"
          );
          for (const file of kept) expect(told).toContain(file);
          expect(told).toContain("nextly migrate:resolve --applied");
        },
        60_000
      );
    }

    // On SQLite a relation switched from one entry to many keeps its text column and has only its
    // values rewritten, before the statements that change the table's shape. A push that fails at
    // the first of those has changed rows and no shape: its files stay all the same.
    it.runIf(dialect === "sqlite")(
      "keeps the files of a push that rewrote values and then failed before changing the table's shape",
      async () => {
        const writer = await t.nextly.create({
          collection: "authors",
          data: { name: "Writer" },
        } as never);
        await t.nextly.create({
          collection: "posts",
          data: {
            title: "One",
            code: "one",
            author: (writer.item as { id: string }).id,
          },
        } as never);
        // A table from an older Nextly, whose relation column carries no index and whose history
        // never recorded one: the table stands as the history says (one the history records with
        // an index the database lacks would be refused as drift before the push). The switch then
        // drops no index, and what runs before the failure is the values' rewrite alone.
        await exec('DROP INDEX "idx_dc_posts_author"');
        forgetIndexInHistory("dc_posts", "idx_dc_posts_author");
        const rows = () => exec("SELECT * FROM dc_posts");
        const rowsBefore = await rows();
        const filesBefore = Object.keys(filesIn(migrationsDir(), ".sql"));
        const tableBefore = await definitionOf();
        // The first statement handed to the executor fails: what ran before it is the
        // pre-resolution phase's alone.
        const failing = vi
          .spyOn(DrizzleStatementExecutor.prototype, "executeStatements")
          .mockRejectedValue(new Error("the first schema statement failed"));

        const failure = await save(SWITCHED).then(
          () => undefined,
          (error: unknown) => error
        );
        failing.mockRestore();

        // The case reaches its mechanism: the rows changed and the table's shape did not.
        expect(await rows()).not.toEqual(rowsBefore);
        expect(await definitionOf()).toEqual(tableBefore);
        const kept = Object.keys(filesIn(migrationsDir(), ".sql")).filter(
          name => !filesBefore.includes(name)
        );
        expect(kept).not.toEqual([]);
        const applied = (await ledger().listFileApplies())
          .filter(entry => entry.status === "applied")
          .map(entry => String(entry.filename));
        for (const file of kept) expect(applied).not.toContain(file);
        expect(
          (failure as { publicMessage?: string } | undefined)?.publicMessage,
          String(failure)
        ).toContain("The database now holds part of this change");
      },
      60_000
    );

    // The pipeline's apply completes, which on PostgreSQL commits its transaction, and the read
    // of the new schema versions after it fails: the change stands on every dialect, so its files
    // stay, recorded applied nowhere, and the admin is told so.
    it("keeps the files of a push whose apply completed before the work after it failed", async () => {
      const filesBefore = Object.keys(filesIn(migrationsDir(), ".sql"));
      const tableBefore = await definitionOf();
      const run = PushSchemaPipeline.prototype.apply;
      let applied = false;
      const pipeline = vi
        .spyOn(PushSchemaPipeline.prototype, "apply")
        .mockImplementation(async function (
          this: PushSchemaPipeline,
          ...args: Parameters<PushSchemaPipeline["apply"]>
        ) {
          const result = await run.apply(this, args);
          if (result.success) applied = true;
          return result;
        });
      const read = CollectionRegistryService.prototype.getCollectionBySlug;
      // The first registry read after the apply completed: the read of the new schema versions.
      const versions = vi
        .spyOn(CollectionRegistryService.prototype, "getCollectionBySlug")
        .mockImplementation(function (
          this: CollectionRegistryService,
          ...args: Parameters<CollectionRegistryService["getCollectionBySlug"]>
        ) {
          if (applied) {
            applied = false;
            versions.mockRestore();
            return Promise.reject(new Error("the version read failed"));
          }
          return read.apply(this, args);
        });

      const failure = await save(SWITCHED).then(
        () => undefined,
        (error: unknown) => error
      );
      pipeline.mockRestore();
      versions.mockRestore();

      // The apply stands: the table took the change.
      expect(await definitionOf()).not.toEqual(tableBefore);
      const kept = Object.keys(filesIn(migrationsDir(), ".sql")).filter(
        name => !filesBefore.includes(name)
      );
      expect(kept).not.toEqual([]);
      const applies = (await ledger().listFileApplies())
        .filter(entry => entry.status === "applied")
        .map(entry => String(entry.filename));
      for (const file of kept) expect(applies).not.toContain(file);
      expect(
        (failure as { publicMessage?: string } | undefined)?.publicMessage,
        String(failure)
      ).toContain("The database now holds part of this change");
    }, 60_000);

    // PostgreSQL's push runs in one transaction, which the failure rolls back whole: nothing of
    // the change stays, so its files are withdrawn and the admin is not told of a part held.
    it.runIf(dialect === "postgresql")(
      "leaves nothing when a push whose second statement failed is rolled back whole",
      async () => {
        const before = await standing();
        const failing = failSecondStatement();

        const failure = await save(SWITCHED).then(
          () => undefined,
          (error: unknown) => error
        );
        failing.restore();

        expect(failing.sent.length, failing.sent.join("\n")).toBeGreaterThan(1);
        expect(failure).toBeInstanceOf(Error);
        expect(
          (failure as { publicMessage?: string }).publicMessage ?? ""
        ).not.toContain("holds part of this change");
        expect(await standing()).toEqual(before);
      },
      60_000
    );
  });

  // A translated collection keeps the system `title` on the shared row, whatever a text field's
  // default: made unique as a shared field, its repeats are counted there.
  describe(`a translated collection's title made unique (${dialect})`, () => {
    let translated: TestNextly;
    let translatedPath: string;

    beforeEach(async () => {
      translatedPath = await mkdtemp(
        join(tmpdir(), "nextly-translated-title-")
      );
      vi.stubEnv("NODE_ENV", "development");
      translated = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath: translatedPath,
        db: DB,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      await translated.getService("collectionService").createCollection(
        {
          name: "posts",
          label: "Post",
          localized: true,
          fields: [{ ...text("code"), localized: false }],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
    });

    afterEach(async () => {
      await translated?.destroy();
      vi.unstubAllEnvs();
      await rm(translatedPath, { recursive: true, force: true });
    });

    const shared = (field: Field): Field => ({ ...field, localized: false });
    async function saveSharedTitleUnique(): Promise<unknown> {
      const [row] = await (
        translated.adapter as unknown as {
          executeQuery<T>(sql: string): Promise<T[]>;
        }
      ).executeQuery<{ version: number | string | null }>(
        "SELECT schema_version AS version FROM dynamic_collections WHERE slug = 'posts'"
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [
            shared({ ...text("title"), unique: true }),
            shared(text("code")),
          ],
          confirmed: true,
          schemaVersion: Number(row?.version ?? 1),
          localized: true,
        }
      );
    }
    const createPost = (title: string, code: string) =>
      translated.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title, code },
      } as never);

    it("refuses a shared title made unique over entries that share one", async () => {
      await createPost("Same", "one");
      await createPost("Same", "two");

      await expect(saveSharedTitleUnique()).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.title",
              code: "UNIQUE_OVER_DUPLICATES",
            }),
          ],
        },
      });
    }, 60_000);

    // Titles that differ are made unique: the check refuses repeats, never the title itself.
    it("makes a shared title unique where no two entries share one", async () => {
      await createPost("One", "one");
      await createPost("Two", "two");

      await expect(saveSharedTitleUnique()).resolves.toBeDefined();
      await expect(createPost("One", "three")).rejects.toBeDefined();
    }, 60_000);
  });
}
