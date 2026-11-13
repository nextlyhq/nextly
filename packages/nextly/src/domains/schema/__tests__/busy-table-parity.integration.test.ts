/**
 * The same busy database, met by every path that changes a table's structure outside the schema
 * pipeline, gives the same tries and the same stop: `nextly migrate`'s app file, `migrate:down`'s
 * down section, a collection's Builder save, the runner Singles' saves apply through, the runner
 * field groups' saves apply through, and a user field's column.
 *
 * An integration test, not a unit one: what it compares is each path's own seam reaching the
 * tries against a real held database, which a stand-in for the database could only assume. It runs
 * on SQLite, where a second connection's open write transaction holds the whole database, so every
 * path meets the same holder, with short bounds from the environment (1 s a try, 4 s in all, so the second try fits with time to
 * spare), as a
 * Builder save reads them. The paths through the schema pipeline (`db:sync`, the development push
 * and the Builder's schema dialog) join this comparison with the pipeline's own seam.
 *
 * Each path is driven at the call that sends its statements, once what it writes before them is
 * in place: on SQLite the holder blocks every write, so a definition or registry row written
 * before the statements would meet the holder outside the tries.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { runFileMigrations } from "../../../cli/commands/migrate";
import { downDatabaseDeps } from "../../../cli/commands/migrate-down";
import { createLogger } from "../../../cli/utils/logger";
import { defineConfig } from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { UserExtSchemaService } from "../../users/services/user-ext-schema-service";
import type { UserFieldDefinitionService } from "../../users/services/user-field-definition-service";
import { writeCollectionSave } from "../builder-save/collection-save";
import { busyTableBounds } from "../busy-table/bounds";
import { plannedTryStarts } from "../busy-table/schedule";
import {
  lockWorld,
  type LockWorld,
} from "../pipeline/__tests__/helpers/schema-lock-world";
import {
  applyMigrationStatements,
  applyMigrationWhole,
} from "../services/apply-migration-statements";

const quiet = createLogger({ quiet: true });
const quietSave = { info: () => {}, warn: () => {}, error: () => {} };

describe("a busy database, met by every path outside the schema pipeline (sqlite)", () => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let holderAdapter: DrizzleAdapter;
  let handle: TestNextly;
  let dir: string;
  let free: () => void = () => {};
  let holding: Promise<unknown> = Promise.resolve();

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "4");
    world = await lockWorld("sqlite", { fresh: true });
    vi.stubEnv("DB_DIALECT", "sqlite");
    vi.stubEnv("DATABASE_URL", `file:${world.url}`);
    _resetEnvCache();
    adapter = await world.connect();
    holderAdapter = await world.connect();
    handle = await createTestNextly({
      adapter: adapter as never,
      collections: [],
    });
    dir = mkdtempSync(join(tmpdir(), "nextly-busy-parity-"));
    mkdirSync(join(dir, "migrations"));
    await adapter.executeQuery("CREATE TABLE btp_hold (id integer)");
    await adapter.executeQuery("CREATE TABLE btp_target (id integer)");
  }, 120_000);

  afterEach(async () => {
    free();
    await holding.catch(() => {});
  });

  afterAll(async () => {
    await holderAdapter?.disconnect();
    await handle?.destroy();
    await world?.dispose();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    _resetEnvCache();
  }, 60_000);

  /** A second connection's open write transaction, which holds the whole database, until `free()`. */
  async function holdTheDatabase(): Promise<void> {
    let held: () => void = () => {};
    const isHeld = new Promise<void>(resolve => {
      held = resolve;
    });
    const freed = new Promise<void>(resolve => {
      free = resolve;
    });
    holding = holderAdapter.transaction(async tx => {
      await tx.queryStatement(
        sql.raw("INSERT INTO btp_hold (id) VALUES (0) RETURNING id")
      );
      held();
      await freed;
    });
    await isHeld;
  }

  const bounds = () => busyTableBounds({ env: process.env });
  const notices: string[] = [];
  const notify = (line: string) => {
    notices.push(line);
  };

  /** What each path stopped with, as the tries' error says it. */
  async function stopOf(run: () => Promise<unknown>): Promise<{
    code: string | undefined;
    tries: unknown;
    outcome: unknown;
  }> {
    await holdTheDatabase();
    const error = await run().then(
      () => undefined,
      (e: unknown) => e
    );
    free();
    await holding.catch(() => {});
    const stop = NextlyError.is(error)
      ? (
          error.logContext as {
            stop?: { tries?: unknown; outcome?: { kind?: unknown } };
          }
        )?.stop
      : undefined;
    return {
      code: NextlyError.is(error) ? error.code : String(error),
      tries: stop?.tries,
      outcome: stop?.outcome?.kind,
    };
  }

  const stops: Record<string, Awaited<ReturnType<typeof stopOf>>> = {};

  it("nextly migrate's app file", async () => {
    writeFileSync(
      join(dir, "migrations", "20261113_000001_000_btp_up.sql"),
      "-- Migration: btp_up\n\n-- UP\nALTER TABLE btp_target ADD COLUMN up_col integer;\n\n-- DOWN\n"
    );
    stops.migrate = await stopOf(() =>
      runFileMigrations({
        adapter: adapter as unknown as Parameters<
          typeof runFileMigrations
        >[0]["adapter"],
        db: adapter.getDrizzle(),
        dialect: "sqlite",
        migrationsDir: join(dir, "migrations"),
        logger: quiet,
        busyTable: { bounds: bounds(), notify },
      })
    );
    rmSync(join(dir, "migrations", "20261113_000001_000_btp_up.sql"));
  }, 30_000);

  it("migrate:down's down section", async () => {
    const deps = await downDatabaseDeps({
      adapter,
      dialect: "sqlite",
      busyTable: { bounds: bounds(), notify },
    });
    stops.down = await stopOf(() =>
      deps.execDown(
        ["ALTER TABLE btp_target ADD COLUMN down_col integer"],
        {
          source: "20261113_000002_000_btp_down.sql",
          transaction: true,
          direction: "down",
        },
        async () => {}
      )
    );
  }, 30_000);

  it("a collection's Builder save", async () => {
    const deps = {
      adapter,
      config: defineConfig({
        collections: [],
        db: { migrationsDir: "./migrations" },
      }),
      projectRoot: dir,
      migrationsDir: join(dir, "migrations"),
      applies: true,
      logger: { ...quietSave, warn: notify },
    };
    const posts = (fields: UiSchemaEntity["fields"]) =>
      ({
        slug: "btp_posts",
        labels: { singular: "Post", plural: "Posts" },
        fields,
      }) as UiSchemaEntity;
    const title = {
      name: "title",
      type: "text",
    } as UiSchemaEntity["fields"][number];
    const body = {
      name: "body",
      type: "text",
    } as UiSchemaEntity["fields"][number];
    await writeCollectionSave(deps, {
      slug: "btp_posts",
      previous: null,
      entity: posts([title]),
      change: "create",
    });
    stops.collection = await stopOf(() =>
      writeCollectionSave(deps, {
        slug: "btp_posts",
        previous: posts([title]),
        entity: posts([title, body]),
        change: "update",
      })
    );
  }, 60_000);

  it("the runner a Single's save applies through", async () => {
    stops.single = await stopOf(() =>
      applyMigrationWhole({
        db: adapter.getDrizzle(),
        dialect: "sqlite",
        migrationSQL: "ALTER TABLE btp_target ADD COLUMN single_col integer",
        entity: "single",
        busyTable: { adapter, notify },
      })
    );
  }, 30_000);

  it("the runner a field group's save applies through", async () => {
    stops.fieldGroup = await stopOf(() =>
      applyMigrationStatements(
        adapter,
        "ALTER TABLE btp_target ADD COLUMN group_col integer",
        {
          adapter,
          notify,
        }
      )
    );
  }, 30_000);

  it("a user field's column", async () => {
    const definitions = handle.getService(
      "userFieldDefinitionService"
    ) as unknown as UserFieldDefinitionService;
    await definitions.createField({
      name: "btpNickname",
      label: "Nickname",
      type: "text",
    } as never);
    const schema = handle.getService(
      "userExtSchemaService"
    ) as unknown as UserExtSchemaService;
    await schema.reloadMergedFields();
    stops.userField = await stopOf(() =>
      schema.ensureUserExtSchema(adapter.getDrizzle(), {
        strict: true,
        busyTable: { adapter, notify },
      })
    );
  }, 30_000);

  it("stops every one of them the same way, after the same tries", () => {
    const planned = plannedTryStarts(bounds()).length;
    expect(Object.keys(stops).sort()).toEqual(
      [
        "collection",
        "down",
        "fieldGroup",
        "migrate",
        "single",
        "userField",
      ].sort()
    );
    for (const [path, stop] of Object.entries(stops)) {
      expect(stop, path).toEqual({
        code: "NEXTLY_TABLE_BUSY",
        tries: planned,
        outcome: "nothing-changed",
      });
    }
  });
});
