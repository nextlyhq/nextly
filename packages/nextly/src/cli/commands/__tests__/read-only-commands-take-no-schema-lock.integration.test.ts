/**
 * The commands that only read take no schema lock: with another process holding it, each still
 * answers at once rather than waiting for it or being refused.
 *
 * `migrate:status`, `migrate:create`, `migrate:check` and the field-group migration's preview
 * (`migrate:field-groups` without `--apply`) each run as a shell runs them, in a process of their
 * own, against a database a second process holds the lock on. A command that took the lock would
 * wait about a minute and then exit non-zero naming the holder, or with `fail-fast` exit non-zero
 * at once; so each case asserts a zero exit, and then that the lock is STILL held, which shows the
 * holder held it for the whole run rather than letting it lapse.
 *
 * Each dialect runs on a database of its own, because the core reconcile builds the system tables.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { NextlyError } from "../../../errors/nextly-error";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";

const CONFIG = `
export default {
  collections: [{ slug: "rocl_posts", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`;

/** A migration the core run applies, so `migrate:status` has a row of this database to report. */
const APPLIED = "20261103_000001_rocl_applied";

const logger = createLogger({ quiet: true });

describe.each(LOCK_DIALECTS)(
  "a read-only command with the schema lock held on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let project: string;
    let holder: Holder | undefined;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      project = mkdtempSync(join(tmpdir(), "nextly-read-only-lock-"));
      writeFileSync(join(project, "nextly.config.ts"), CONFIG);
      mkdirSync(join(project, "migrations"));
    }, 60_000);

    afterEach(async () => {
      if (holder !== undefined) {
        holder.kill("SIGKILL");
        await holder.exited;
        holder = undefined;
      }
      await adapter.disconnect();
      rmSync(project, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    /** The core reconcile, applying whatever the project's migrations directory holds. */
    async function migrate(): Promise<void> {
      await migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: join(project, "migrations"),
        logger,
        lockMode: "wait",
        lockWaitMs: 1_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
    }

    async function holdTheLock(): Promise<void> {
      holder = startHolder(world, {
        command: "nextly migrate",
        leaseSeconds: 30,
        prefix: "rocl_holder",
      });
      await holder.printed("held");
    }

    /** The lock is held still: a run asking for it at once is refused. */
    async function expectStillHeld(): Promise<void> {
      const error = await withMigrateLock(adapter, dialect, async () => {}, {
        command: "a read-only command test",
        mode: "fail-fast",
      }).then(
        () => undefined,
        (e: unknown) => e
      );
      expect(NextlyError.is(error) ? error.code : error).toBe(
        "NEXTLY_MIGRATE_LOCK_BUSY"
      );
    }

    /** `nextly <args>` in the project, on this database, the dialect from the URL alone. */
    const nextly = (args: string[]) =>
      runNextly(args, project, {
        DATABASE_URL: dialect === "sqlite" ? `file:${world.url}` : world.url,
        DB_DIALECT: undefined,
      });

    it(
      "migrate:status reports this database's ledger",
      async () => {
        writeFileSync(
          join(project, "migrations", `${APPLIED}.sql`),
          `-- Migration: ${APPLIED}\n\n-- UP\nCREATE TABLE rocl_items (id varchar(36) PRIMARY KEY);\n\n-- DOWN\nDROP TABLE rocl_items;\n`,
          "utf8"
        );
        await migrate();
        await holdTheLock();

        const status = await nextly(["migrate:status", "--json"]);
        expect(status.status, `${status.stdout}\n${status.stderr}`).toBe(0);
        // Read from this database: the file the core run applied is reported applied.
        const report = JSON.parse(status.stdout) as {
          migrations: Array<{ filename: string; status: string }>;
        };
        expect(
          report.migrations.map(m => [m.filename, m.status])
        ).toContainEqual([expect.stringContaining(APPLIED), "applied"]);
        await expectStillHeld();
      },
      2 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "migrate:create writes its migration, and migrate:check passes it",
      async () => {
        await migrate();
        await holdTheLock();

        const created = await nextly(["migrate:create", "init"]);
        expect(created.status, `${created.stdout}\n${created.stderr}`).toBe(0);
        expect(
          readdirSync(join(project, "migrations"), { recursive: true }).filter(
            name => String(name).endsWith(".sql")
          )
        ).toHaveLength(1);

        const checked = await nextly(["migrate:check"]);
        expect(checked.status, `${checked.stdout}\n${checked.stderr}`).toBe(0);
        await expectStillHeld();
      },
      3 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "the field-group migration's preview answers, and names the run holding the lock",
      async () => {
        await migrate();
        await holdTheLock();

        const preview = await nextly(["migrate:field-groups"]);
        expect(preview.status, `${preview.stdout}\n${preview.stderr}`).toBe(0);
        // The preview read the lock on this database and found it held: it was pointed at the
        // database the holder holds, so its zero exit is an answer under a held lock.
        expect(preview.stdout).toContain("A migration is running right now");
        await expectStillHeld();
      },
      2 * NEXTLY_RUN_TIMEOUT
    );
  }
);
