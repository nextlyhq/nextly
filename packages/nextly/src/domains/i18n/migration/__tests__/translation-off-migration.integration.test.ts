/**
 * Turning a code-first collection's translation off through the files `nextly migrate:create`
 * writes, applied and rolled back through the real runner, on every dialect.
 *
 * The turn-off file puts each translated column back on the main table before the main file runs,
 * and the main file's snapshot records that table. The runner checks the main table against the
 * main file's two ends, so the restored column must be the one that snapshot records: on MySQL a
 * long text field is `text` on the main table, and a column restored wider (LONGTEXT) left the
 * table at neither end, which the runner refuses as drift.
 *
 * On a MySQL database older than the renderer's TEXT, the translations column is LONGTEXT and can
 * hold a value the restored `text` cannot. The copy then fails rather than cut it short, on a
 * server that is not strict too: the runner runs every migration in strict mode.
 *
 * Each case runs on a database of its own: the runner refuses a database holding tables it did not
 * make.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type mysql from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { installRegistryResolver } from "../../../../cli/utils/registry-resolver";
import { loadDialectTables } from "../../../../database/dialect-tables";
import { reconcileCore } from "../../../schema/migrate/core-reconcile";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../../schema/migrate-create/generate";
import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../../__tests__/helpers/fresh-database";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
  getDrizzle<T = unknown>(): T;
}

const DIALECTS: {
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}[] = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: url => createPostgresAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: url => createMySqlAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

const quiet = createLogger({ quiet: true });

// The driver the MySQL adapter loads, which may be another copy than this package's: the one whose
// pool and own connections the runner's sessions come from.
const adapterDriver = createRequire(
  createRequire(import.meta.url).resolve("@nextlyhq/adapter-mysql")
)("mysql2/promise") as typeof mysql;

/** A connection as mysql2's core pool hands it to a `connection` listener. */
interface CoreConnection {
  query(sql: string): void;
}

/**
 * Every session the MySQL adapter opens from here on starts with no strict mode, as on a server
 * configured that way: its pool's connections and the connections it opens of its own. The server's
 * own mode is left alone, since other suites share it.
 */
function laxSessions(): () => void {
  const openPool = adapterDriver.createPool.bind(adapterDriver);
  const openOwn = adapterDriver.createConnection.bind(adapterDriver);
  const pools = vi.spyOn(adapterDriver, "createPool").mockImplementation(((
    config: unknown
  ) => {
    const pool = openPool(config as never);
    (
      pool.pool as unknown as {
        on(event: "connection", listener: (c: CoreConnection) => void): void;
      }
    ).on("connection", connection =>
      connection.query("SET SESSION sql_mode = ''")
    );
    return pool;
  }) as never);
  const own = vi
    .spyOn(adapterDriver, "createConnection")
    .mockImplementation((async (config: unknown) => {
      const connection = await openOwn(config as never);
      await connection.query("SET SESSION sql_mode = ''");
      return connection;
    }) as never);
  return () => {
    pools.mockRestore();
    own.mockRestore();
  };
}

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`translation turned off through migrations (${entry.dialect})`, () => {
    const { dialect } = entry;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    let adapter: TestAdapter;
    let scratch: ScratchDatabase | null = null;
    let migrationsDir: string;
    // Per-run names, so a shared database cannot let two runs collide.
    let table: string;
    let translated: MinimalConfigEntity;
    let untranslated: MinimalConfigEntity;
    let created = 0;

    beforeEach(async () => {
      const tag = randomBytes(4).toString("hex");
      const slug = `notes${tag}`;
      table = `dc_notes${tag}`;
      // A long text field, which MySQL keeps as `text` on the main table, and a short one.
      translated = {
        slug,
        tableName: table,
        localized: true,
        fields: [
          { name: "body", type: "textarea", localized: true },
          { name: "label", type: "text", localized: true },
        ],
      };
      untranslated = { ...translated, localized: false };
      created = 0;
      scratch =
        dialect === "sqlite"
          ? null
          : await createScratchDatabase(dialect, "translation_off");
      adapter = entry.make(scratch?.url ?? entry.url ?? "");
      await adapter.connect();
      await loadDialectTables(dialect);
      // The static resolver every production adapter carries: the lock seeds its row through a
      // transaction insert, which an adapter refuses for a table its resolver does not hold.
      installRegistryResolver(adapter as unknown as DrizzleAdapter);
      // What `nextly migrate` creates first: the ledger, the owner registry and the archive.
      await reconcileCore({
        db: adapter.getDrizzle(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      migrationsDir = await mkdtemp(join(tmpdir(), "nextly-translation-off-"));
    });

    afterEach(async () => {
      // The case's database and folder go even when closing the connection fails.
      try {
        await adapter.disconnect();
      } finally {
        await scratch?.drop();
        scratch = null;
        await rm(migrationsDir, { recursive: true, force: true });
      }
    });

    /** `nextly migrate:create` for the entity as it is now. */
    async function migrateCreate(entity: MinimalConfigEntity): Promise<void> {
      created += 1;
      await generateMigration({
        name: `notes_${created}`,
        dialect,
        migrationsDir,
        defaultLocale: "en",
        collections: [entity],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date(Date.UTC(2026, 10, 18, 10, created)),
      });
    }

    function migrate(on: TestAdapter = adapter): Promise<number> {
      return runFileMigrations({
        adapter: on as never,
        db: on.getDrizzle(),
        dialect,
        migrationsDir,
        logger: quiet,
      });
    }

    async function mainValues(): Promise<{ body: string; label: string }[]> {
      return adapter.executeQuery<{ body: string; label: string }>(
        `SELECT ${q("body")} AS body, ${q("label")} AS label FROM ${q(table)} WHERE ${q("id")} = 'e1'`
      );
    }

    it("applies the files that turn translation off, the main table restored as its snapshot records it", async () => {
      await migrateCreate(translated);
      await migrate();
      await adapter.executeQuery(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e1', 'One', 'one')`
      );
      await adapter.executeQuery(
        `INSERT INTO ${q(`${table}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("body")}, ${q("label")}) ` +
          `VALUES ('e1', 'en', 'Hello', 'Hi'), ('e1', 'es', 'Hola', 'Ola')`
      );

      await migrateCreate(untranslated);
      await migrate();

      expect(await mainValues()).toEqual([{ body: "Hello", label: "Hi" }]);
      // Nothing is left for a later run: the database is at the newest snapshot.
      await expect(migrate()).resolves.toBe(0);
    });

    // A Required field goes back NOT NULL, as the main table's snapshot records it, once its values
    // are copied: the runner checks the next main file against that table.
    it("applies the files that turn translation off for a Required field, its column put back required", async () => {
      const required = (entity: MinimalConfigEntity): MinimalConfigEntity => ({
        ...entity,
        fields: entity.fields.map(f =>
          f.name === "label" ? { ...f, required: true } : f
        ),
      });
      await migrateCreate(required(translated));
      await migrate();
      await adapter.executeQuery(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e1', 'One', 'one')`
      );
      await adapter.executeQuery(
        `INSERT INTO ${q(`${table}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("body")}, ${q("label")}) ` +
          `VALUES ('e1', 'en', 'Hello', 'Hi'), ('e1', 'es', 'Hola', 'Ola')`
      );

      await migrateCreate(required(untranslated));
      await migrate();

      expect(await mainValues()).toEqual([{ body: "Hello", label: "Hi" }]);
      await expect(
        adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e2', 'Two', 'two')`
        )
      ).rejects.toThrow();
      await expect(migrate()).resolves.toBe(0);
    });

    // An entry whose language the copy keeps has no value: the column cannot be required over it.
    // The runner refuses before the setting, naming the field, and the translations stay.
    it("refuses to turn translation off for a Required field an entry holds no value of", async () => {
      const required = (entity: MinimalConfigEntity): MinimalConfigEntity => ({
        ...entity,
        fields: entity.fields.map(f =>
          f.name === "label" ? { ...f, required: true } : f
        ),
      });
      await migrateCreate(required(translated));
      await migrate();
      await adapter.executeQuery(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e1', 'One', 'one')`
      );
      await adapter.executeQuery(
        `INSERT INTO ${q(`${table}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('e1', 'en', 'Hello')`
      );

      await migrateCreate(required(untranslated));
      await expect(migrate()).rejects.toThrow(/label/);

      const kept = await adapter.executeQuery<{ body: string }>(
        `SELECT ${q("body")} AS body FROM ${q(`${table}_locales`)} WHERE ${q("_parent")} = 'e1'`
      );
      expect(kept).toEqual([{ body: "Hello" }]);
    });

    it.runIf(dialect === "mysql")(
      "refuses, on a server that is not strict, a value longer than the restored column holds, and keeps it",
      async () => {
        await migrateCreate(translated);
        await migrate();
        const companion = `${table}_locales`;
        // A translations column from before the renderer emitted TEXT.
        await adapter.executeQuery(
          `ALTER TABLE ${q(companion)} MODIFY ${q("body")} LONGTEXT`
        );
        const long = "x".repeat(70_000);
        await adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e1', 'One', 'one')`
        );
        await adapter.executeQuery(
          `INSERT INTO ${q(companion)} (${q("_parent")}, ${q("_locale")}, ${q("body")}, ${q("label")}) ` +
            `VALUES ('e1', 'en', '${long}', 'Hi'), ('e1', 'es', 'Hola', 'Ola')`
        );
        await migrateCreate(untranslated);

        const restore = laxSessions();
        const lax = entry.make(scratch?.url ?? entry.url ?? "");
        try {
          await lax.connect();
          await expect(migrate(lax)).rejects.toThrow(/too long/i);
        } finally {
          await lax.disconnect();
          restore();
        }

        const [kept] = await adapter.executeQuery<{ n: number | string }>(
          `SELECT CHAR_LENGTH(${q("body")}) AS n FROM ${q(companion)} WHERE ${q("_parent")} = 'e1' AND ${q("_locale")} = 'en'`
        );
        expect(Number(kept?.n)).toBe(70_000);
      }
    );
  });
}
