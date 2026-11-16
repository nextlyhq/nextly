/**
 * A pending app migration is recorded applied without running only when its snapshot proves all
 * of it, on PostgreSQL, MySQL and SQLite.
 *
 * Each case generates two migrations with the real generator: `one` creates a collection, `two`
 * adds its `summary` column. `one` is applied; the database is then brought to `two`'s end
 * through what `nextly db:sync` runs (`syncCollections`), or left at its start.
 *
 * - At `two`'s end, the generated, unedited `two` is recorded applied without running.
 * - `two` edited to add an `UPDATE` that backfills `summary` is refused naming the file and the
 *   `UPDATE`, the column's values and the ledger as they were; once the `UPDATE` is run by hand and
 *   the file is recorded with `migrate:resolve --applied`, later runs go on.
 * - `two` with a trigger beside its column, its snapshot's checksum matching, is refused naming
 *   the trigger's statement; no trigger exists afterwards and the ledger is unchanged.
 * - At `two`'s start, the edited `two` runs whole and backfills the column.
 * - A pending data-only file and one that drops an index and creates it again, each starting and
 *   ending at the same schema, both run and are recorded applied by a run.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../../domains/schema/migrate-create/generate";
import {
  computeMigrationHash,
  parseSnapshotFile,
} from "../../../domains/schema/migrate-create/snapshot-io";
import { checksumOf } from "../../../domains/schema/migrate/applied-checksums";
import { NO_CONSENT } from "../../../domains/schema/migrate/data-loss-consent";
import { resolveMigration } from "../../../domains/schema/migrate/resolve";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../../../domains/schema/pipeline/diff/types";
import { NextlyError } from "../../../errors/nextly-error";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import type { ResolvedDevOptions } from "../db-sync";
import { syncCollections } from "../dev-build";
import { migrateCore, migrateExitCode } from "../migrate";

const logger = createLogger({ quiet: true });
const context = { logger, options: {} } as CommandContext;

const SLUG = "pfp_notes";
const TABLE = `dc_${SLUG}`;

/** The collection as `migrate:create` reads it, with `summary` or without. */
const entity = (withSummary: boolean): MinimalConfigEntity => ({
  slug: SLUG,
  tableName: TABLE,
  fields: [
    { name: "title", type: "text" },
    ...(withSummary ? [{ name: "summary", type: "text", index: true }] : []),
  ],
});

/** The same collection as configuration declares it, for `db:sync`. */
const config = (withSummary: boolean) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [
          text({ name: "title" }),
          ...(withSummary ? [text({ name: "summary", index: true })] : []),
        ],
      }),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a pending migration the database already stands at the end of (%s)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);
    let handle: TestNextly;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;
    /** The base names `generate` wrote: `one`'s, then `two`'s. */
    let one: string;
    let two: string;

    const query = (statement: string) => adapter.executeQuery(statement);
    const repo = () =>
      new SchemaEventsRepository(adapter.getDrizzle(), dialect);
    const metaDir = () => join(migrationsDir, "meta");

    async function generate(name: string, withSummary: boolean, at: string) {
      const before = new Set(await readdir(migrationsDir));
      await generateMigration({
        name,
        dialect,
        migrationsDir,
        collections: [entity(withSummary)],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date(at),
      });
      const added = (await readdir(migrationsDir)).filter(
        file => file.endsWith(".sql") && !before.has(file)
      );
      expect(added).toHaveLength(1);
      return added[0].replace(/\.sql$/, "");
    }

    const migrate = () =>
      migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "fail-fast",
        consent: NO_CONSENT,
        interactive: false,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      } as never);

    /** What `nextly db:sync` runs for the collection, with no terminal attached. */
    async function dbSync(withSummary: boolean): Promise<void> {
      clearCachedSnapshot();
      await syncCollections(
        { config: config(withSummary) } as LoadConfigResult,
        adapter as unknown as CLIDatabaseAdapter,
        { cwd: "", autoSync: true } as ResolvedDevOptions,
        context
      );
    }

    const sqlPath = (name: string) => join(migrationsDir, `${name}.sql`);
    const snapshotPath = (name: string) =>
      join(metaDir(), `${name}.snapshot.json`);

    /** `two`'s text with `statements` added at the end of its UP section. */
    async function withUp(name: string, statements: string[]): Promise<string> {
      const text = await readFile(sqlPath(name), "utf8");
      const at = text.indexOf("-- DOWN");
      expect(at).toBeGreaterThan(-1);
      const added = statements.map(statement => `${statement};\n`).join("");
      return `${text.slice(0, at)}${added}\n${text.slice(at)}`;
    }

    /** Record `text`'s checksum in `name`'s snapshot, as `migrate:create` would have written it. */
    async function rehash(name: string, text: string): Promise<void> {
      const file = JSON.parse(await readFile(snapshotPath(name), "utf8")) as {
        migrationHash: string;
      };
      file.migrationHash = computeMigrationHash(text);
      await writeFile(snapshotPath(name), JSON.stringify(file, null, 2));
    }

    async function targetOf(name: string): Promise<NextlySchemaSnapshot> {
      const file = `${name}.snapshot.json`;
      return parseSnapshotFile(await readFile(snapshotPath(name), "utf8"), file)
        .snapshot;
    }

    async function ledger(name: string) {
      const rows = await repo().findFileApplies(`${name}.sql`);
      return [...rows]
        .sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt))
        .map(row => ({
          status: row.status,
          statementsExecuted: row.statementsExecuted,
        }));
    }

    async function summaries(): Promise<unknown[]> {
      const rows = (await query(
        `SELECT ${q("summary")} AS summary FROM ${q(TABLE)} ORDER BY ${q("id")}`
      )) as Array<{ summary: unknown }>;
      return rows.map(row => row.summary);
    }

    /** A row of the collection, every required column filled. */
    async function insertRow(id: string): Promise<void> {
      const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
        TABLE,
      ]);
      const columns = live.tables[0].columns.filter(
        column => column.name === "id" || (!column.nullable && !column.default)
      );
      const value = (name: string, type: string) => {
        if (name === "id") return `'${id}'`;
        if (/time|date/i.test(type)) return "CURRENT_TIMESTAMP";
        if (/int|num|dec|bool|real|double|float/i.test(type)) return "0";
        return `'${id}'`;
      };
      await query(
        `INSERT INTO ${q(TABLE)} (${columns.map(c => q(c.name)).join(", ")}) VALUES (${columns
          .map(c => value(c.name, c.type))
          .join(", ")})`
      );
    }

    async function refusal(): Promise<NextlyError> {
      const error = await migrate().then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      if (!NextlyError.is(error))
        throw error ?? new Error("expected a refusal");
      return error;
    }

    async function resolveApplied(name: string): Promise<void> {
      await resolveMigration({
        mode: "applied",
        filename: `${name}.sql`,
        dialect,
        repo: repo(),
        fileExists: () => Promise.resolve(true),
        loadTargetSnapshot: () => targetOf(name),
        marksNoTransaction: () => Promise.resolve(false),
        fileChecksum: async () =>
          checksumOf(await readFile(sqlPath(name), "utf8")),
        introspectLive: () =>
          introspectLiveSnapshot(adapter.getDrizzle(), dialect, [TABLE]),
      });
    }

    beforeEach(async () => {
      handle = await createTestNextly({ dialect });
      adapter = handle.adapter as unknown as DrizzleAdapter;
      migrationsDir = await mkdtemp(join(tmpdir(), "nextly-pending-proof-"));
      one = await generate("one", false, "2026-11-16T10:00:00.000Z");
      two = await generate("two", true, "2026-11-16T11:00:00.000Z");
      // `one` alone: `two` written beside it, and its file kept aside while `one` applies.
      const twoText = await readFile(sqlPath(two), "utf8");
      await rm(sqlPath(two));
      await migrate();
      await writeFile(sqlPath(two), twoText);
      expect(await ledger(one)).toHaveLength(1);
      await insertRow("r1");
    }, 120_000);

    afterEach(async () => {
      await query(`DROP TABLE IF EXISTS ${q(TABLE)}`).catch(() => undefined);
      await handle?.destroy();
      await rm(migrationsDir, { recursive: true, force: true });
    }, 60_000);

    it("records a generated, unedited file the database already stands at the end of without running it", async () => {
      await dbSync(true);
      await migrate();
      expect(await ledger(two)).toEqual([
        { status: "applied", statementsExecuted: 0 },
      ]);
    });

    it("refuses an edited file whose backfill the snapshot cannot show, then goes on once it is run by hand and resolved", async () => {
      const backfill = `UPDATE ${q(TABLE)} SET ${q("summary")} = 'backfilled'`;
      await writeFile(sqlPath(two), await withUp(two, [backfill]));
      await dbSync(true);

      const error = await refusal();
      expect(error.code).toBe("NEXTLY_MIGRATION_NOT_PROVEN");
      expect(migrateExitCode(error)).toBe(2);
      expect(error.publicMessage).toContain(`${two}.sql is pending`);
      expect(error.publicMessage).toContain(
        "it has changed since its snapshot was written"
      );
      expect(error.publicMessage).toContain(
        `UPDATE ${q(TABLE)} SET ${q("summary")} = (not shown by its snapshot)`
      );
      expect(error.publicMessage).toContain(
        `\`nextly migrate:resolve --applied ${two}\``
      );
      expect(await summaries()).toEqual([null]);
      expect(await ledger(two)).toEqual([]);

      // The next step the refusal names.
      await query(backfill);
      await resolveApplied(two);
      await migrate();
      expect(await summaries()).toEqual(["backfilled"]);
      expect((await ledger(two)).map(row => row.status)).toEqual(["applied"]);
    });

    it("refuses a file whose trigger the snapshot cannot show, even with its checksum matching", async () => {
      const trigger = `${SLUG}_fill`;
      const statements =
        dialect === "postgresql"
          ? [
              `CREATE FUNCTION ${trigger}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.summary := 'filled'; RETURN NEW; END $$`,
              `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${q(TABLE)} FOR EACH ROW EXECUTE FUNCTION ${trigger}_fn()`,
            ]
          : dialect === "mysql"
            ? [
                `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${q(TABLE)} FOR EACH ROW SET NEW.summary = 'filled'`,
              ]
            : [
                `CREATE TRIGGER ${trigger} AFTER INSERT ON ${q(TABLE)} BEGIN UPDATE ${q(TABLE)} SET summary = 'filled' WHERE id = NEW.id; END`,
              ];
      const text = await withUp(two, statements);
      await writeFile(sqlPath(two), text);
      await rehash(two, text);
      await dbSync(true);

      const error = await refusal();
      expect(error.code).toBe("NEXTLY_MIGRATION_NOT_PROVEN");
      expect(error.publicMessage).not.toContain("it has changed");
      expect(error.publicMessage).toMatch(
        new RegExp(
          `CREATE TRIGGER ${trigger}[^\\n]*\\(not shown by its snapshot\\)`
        )
      );
      expect(await ledger(two)).toEqual([]);
      const triggers =
        dialect === "postgresql"
          ? await query(
              `SELECT tgname FROM pg_trigger WHERE tgname = '${trigger}'`
            )
          : dialect === "mysql"
            ? await query(
                `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = '${trigger}'`
              )
            : await query(
                `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = '${trigger}'`
              );
      expect(triggers).toEqual([]);
    });

    it.runIf(dialect === "postgresql")(
      "refuses a file whose index the database holds but cannot use",
      async () => {
        await dbSync(true);
        // What an interrupted CREATE INDEX CONCURRENTLY leaves: the index, marked invalid. The
        // snapshot comparison reads it as there; the file's statement would have built it whole.
        const target = await targetOf(two);
        const index = target.tables
          .find(table => table.name === TABLE)
          ?.indexes?.find(each => each.columns.includes("summary"));
        expect(index).toBeDefined();
        await query(
          `UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${q(index!.name)}'::regclass`
        );

        const error = await refusal();
        expect(error.code).toBe("NEXTLY_MIGRATION_NOT_PROVEN");
        expect(error.publicMessage).toContain(
          "(the database does not stand as it leaves it)"
        );
        expect(await ledger(two)).toEqual([]);
      }
    );

    it("runs the edited file whole where the database stands at its start, backfilling the column", async () => {
      const backfill = `UPDATE ${q(TABLE)} SET ${q("summary")} = 'backfilled'`;
      await writeFile(sqlPath(two), await withUp(two, [backfill]));
      await migrate();
      expect(await summaries()).toEqual(["backfilled"]);
      const [row] = await ledger(two);
      expect(row.status).toBe("applied");
      expect(row.statementsExecuted).toBeGreaterThan(0);
    });

    it("runs a pending data-only file and one that drops an index and creates it again", async () => {
      await migrate();
      const target = await targetOf(two);
      const index = target.tables
        .find(table => table.name === TABLE)
        ?.indexes?.find(each => each.columns.length > 0);
      expect(index).toBeDefined();
      const dataOnly = "20261116_120000_000_data_only";
      const rebuild = "20261116_130000_000_rebuild_index";
      const write = async (name: string, up: string[]) => {
        const text = `-- Migration: ${name}\n\n-- UP\n${up.map(s => `${s};\n`).join("")}\n-- DOWN\n`;
        await writeFile(sqlPath(name), text);
        // Starts and ends where `two` ends: the snapshot `two` recorded.
        const file = JSON.parse(await readFile(snapshotPath(two), "utf8")) as {
          migrationHash: string;
        };
        file.migrationHash = computeMigrationHash(text);
        await writeFile(snapshotPath(name), JSON.stringify(file, null, 2));
      };
      await write(dataOnly, [
        `UPDATE ${q(TABLE)} SET ${q("summary")} = 'data-only'`,
      ]);
      const columns = index!.columns.map(q).join(", ");
      const unique = index!.unique ? "UNIQUE " : "";
      await write(rebuild, [
        dialect === "mysql"
          ? `DROP INDEX ${q(index!.name)} ON ${q(TABLE)}`
          : `DROP INDEX ${q(index!.name)}`,
        `CREATE ${unique}INDEX ${q(index!.name)} ON ${q(TABLE)} (${columns})`,
      ]);

      await migrate();
      expect(await summaries()).toEqual(["data-only"]);
      for (const name of [dataOnly, rebuild]) {
        const [row] = await ledger(name);
        expect(row.status, name).toBe("applied");
        expect(row.statementsExecuted, name).toBeGreaterThan(0);
      }
    });
  }
);
