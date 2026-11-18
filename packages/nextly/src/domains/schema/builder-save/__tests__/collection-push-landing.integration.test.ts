/**
 * A collection's Schema Builder save that the development push applies, and that fails: whether
 * its migration files stay depends on whether the push may have changed the database.
 *
 * - A refusal before the push runs, or a busy table's stop that says nothing ran, leaves nothing:
 *   no file, no snapshot, no change to the definition, the table or the registry row.
 * - On MySQL, which commits each schema statement as it runs, a push that fails after a statement
 *   committed keeps its files, recorded applied nowhere, so the next `nextly migrate` names the
 *   change the database already holds part of.
 *
 * Each save switches a relationship from one entry to many (`reachesRelationStorage`), a change
 * the push applies on every dialect.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";

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

    // The failure comes through the test's seam on the push's statement executor: the first
    // statement runs, which MySQL commits and SQLite's push keeps, and the second fails. No
    // production hook.
    it.runIf(dialect === "mysql" || dialect === "sqlite")(
      "keeps the files of a push whose second statement failed after its first committed",
      async () => {
        const filesBefore = Object.keys(filesIn(migrationsDir(), ".sql"));
        const definitionOf = () =>
          readTableDefinition(
            statement => exec(statement),
            adapterOf().getCapabilities().dialect,
            "dc_posts"
          );
        const tableBefore = await definitionOf();
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

        await expect(save(SWITCHED)).rejects.toBeInstanceOf(Error);
        failing.mockRestore();

        expect(sent.length, sent.join("\n")).toBeGreaterThan(1);
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
      },
      60_000
    );
  });
}
