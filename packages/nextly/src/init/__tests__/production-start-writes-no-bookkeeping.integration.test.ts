/**
 * A production start writes no bookkeeping, and runs the same number of
 * statements however many entities the site has, on every configured dialect.
 *
 * The bookkeeping is the registry rows of collections, Singles and components,
 * the permissions, the roles and their grants, and the user field definitions.
 * In production it arrives through `nextly migrate` (and a plugin's install and
 * uninstall), never through a start, so an older or a newer build starting
 * against the database cannot change what the deployment that migrated it
 * wrote.
 *
 * Each case migrates a database of its own for one configuration (the tables,
 * the registry rows, the permissions, the preset roles and the Public role, as
 * a deployment that ran `nextly migrate` and started once has them), then
 * starts Nextly in production through its real entry points (`getNextly`, or a
 * request through the route handlers), never the test harness, which syncs the
 * registry as a development start does. Every statement is recorded at the
 * driver (`record-statements`), from the moment the start is begun until it
 * and the work it leaves running have settled (`startSettled`).
 *
 * - The registry behind the configuration: the build declares a field and a
 *   collection the database was never migrated for.
 * - The registry ahead of it: the database was migrated by a build with that
 *   field and collection, and an older build without them starts.
 * - In both, one registered collection's permissions are missing, so a start
 *   that seeded would have permissions to add and grants to set.
 * - Begun by the Direct API, by a request, and by a request to route handlers
 *   given no configuration, which registers the services itself.
 *
 * Each finds no write to a bookkeeping table. The control is a development
 * start of the registry-behind case, recorded the same way, which still writes
 * the registry and the permissions, so the recorder and the classifier are
 * shown to see such writes.
 *
 * The count: the statements a production start sends before `getNextly()`
 * resolves are counted for a configuration of 5 entities and one of 50, each
 * against a database migrated for it, and must be the same number, with no
 * write among them but the start's own (below). Then again with migrations at
 * start turned on, against a database that step has already brought up to
 * date, counting the statements outside that step, which the test labels by
 * running it under an AsyncLocalStorage store the recorder reads. The warm-up
 * the start leaves running is labelled and left out the same way: its reads
 * land before or after the start resolves by timing alone.
 *
 * The start's own writes, the only writes a production start may make outside
 * the migrations at start: the setup token, the seals of stored secrets, and on
 * SQLite the journal mode (a pragma, which writes no row); after the start
 * resolves, the email templates' reconciliation and on SQLite the one-time
 * timestamp repair. None of these runs here before the start resolves but the
 * setup token's, in `nextly_meta`.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import {
  resetDispatcherForTests,
  setHandlerConfig,
} from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

/**
 * Which step a statement was sent from, where it is one the count leaves out:
 * the migrations at start, which are `nextly migrate`'s, and the warm-up of
 * the translated entities' tables, which the start begins and does not wait
 * for, so its reads land before or after `getNextly()` resolves by timing.
 */
const sentFrom = vi.hoisted(() => {
  const { AsyncLocalStorage } = process.getBuiltinModule(
    "node:async_hooks"
  ) as typeof import("node:async_hooks");
  return new AsyncLocalStorage<"migrations at start" | "left running">();
});

// Each run under a store the recorder reads, so their statements are told
// apart from the rest of the start's.
vi.mock("../prod-migrations", async original => {
  const actual = await original<typeof import("../prod-migrations")>();
  return {
    ...actual,
    runProdMigrationsIfEnabled: (
      ...args: Parameters<typeof actual.runProdMigrationsIfEnabled>
    ) =>
      sentFrom.run("migrations at start", () =>
        actual.runProdMigrationsIfEnabled(...args)
      ),
  };
});
vi.mock("../warm-companion-readiness", async original => {
  const actual = await original<typeof import("../warm-companion-readiness")>();
  return {
    ...actual,
    startCompanionReadinessWarmUp: (
      ...args: Parameters<typeof actual.startCompanionReadinessWarmUp>
    ) =>
      sentFrom.run("left running", () =>
        actual.startCompanionReadinessWarmUp(...args)
      ),
  };
});

/** The bookkeeping: registry, permission, role, grant and user field tables. */
const BOOKKEEPING = new Set([
  "dynamic_collections",
  "dynamic_singles",
  "dynamic_components",
  "permissions",
  "roles",
  "role_permissions",
  "role_inherits",
  "user_roles",
  "user_field_definitions",
]);

/**
 * The tables the start's own writes write to before it resolves: the setup
 * token, and the secret seals, which keep their keys in `nextly_meta`.
 */
const OWN_WRITES = new Set(["nextly_meta"]);

/**
 * A statement that changes rows or structure, and the table it names. Each
 * dialect's driver is handed the verb first; a name may be quoted or
 * schema-qualified.
 */
const WRITE =
  /^\s*(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|update|delete\s+from|alter\s+table|create\s+(?:unique\s+)?(?:table|index)(?:\s+if\s+not\s+exists)?|drop\s+(?:table|index)(?:\s+if\s+exists)?|truncate(?:\s+table)?)\s+(?:[`"]?\w+[`"]?\.)?[`"]?(\w+)[`"]?/i;

/** The table `call` writes, or undefined when it writes nothing. */
function writtenTable(call: RecordedStatement): string | undefined {
  return WRITE.exec(call.text)?.[1]?.toLowerCase();
}

/** `call`, short enough to read in a failure. */
const shown = (call: RecordedStatement): string =>
  call.text.replace(/\s+/g, " ").slice(0, 120);

/** The writes among `calls` to a bookkeeping table. */
function bookkeepingWrites(calls: readonly RecordedStatement[]): string[] {
  return calls
    .filter(call => BOOKKEEPING.has(writtenTable(call) ?? ""))
    .map(shown);
}

/** The writes among `calls` outside the start's own. */
function writesOutsideOwn(calls: readonly RecordedStatement[]): string[] {
  return calls
    .filter(call => {
      const table = writtenTable(call);
      return table !== undefined && !OWN_WRITES.has(table);
    })
    .map(shown);
}

/** How a start is begun. */
const ENTRIES = [
  "the Direct API",
  "a request",
  "a request to route handlers given no configuration",
] as const;
type Entry = (typeof ENTRIES)[number];

/** Readable by anyone, so a request reads the entries as a visitor. */
const READABLE = { read: () => true };

/**
 * `count` entities, collections and Singles in turn, each with a field, and
 * with `subtitle` on the first of each kind and one collection more where
 * `ahead` asks for the newer build's shape.
 */
function entities(count: number, newer: boolean) {
  const collections = [];
  const singles = [];
  for (let i = 0; i < count; i++) {
    const fields = [
      text({ name: "title" }),
      ...(newer && i < 2 ? [text({ name: "subtitle" })] : []),
    ];
    if (i % 2 === 0) {
      collections.push(
        defineCollection({ slug: `pwnb_c${i}`, fields, access: READABLE })
      );
    } else {
      singles.push(
        defineSingle({ slug: `pwnb_s${i}`, fields, access: READABLE })
      );
    }
  }
  if (newer) {
    collections.push(
      defineCollection({
        slug: "pwnb_added",
        fields: [text({ name: "title" })],
        access: READABLE,
      })
    );
  }
  return { collections, singles };
}

describe.each(getConfiguredTestDialects())(
  "a production start writes no bookkeeping (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let migrationsDir: string;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeEach(async () => {
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-pwnb-migrations-"));
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-pwnb-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_pwnb");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The request path opens the database the environment names.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // A production start validates its address before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      _resetEnvCache();
    }, 180_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      resetDispatcherForTests();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(migrationsDir, { recursive: true, force: true });
    });

    /**
     * Migrate the database for `shape` and seed it, as a deployment that ran
     * `nextly migrate` and started once has it: tables, registry rows,
     * permissions, preset roles, the Public role and its grants.
     */
    async function migrated(
      shape: ReturnType<typeof entities>,
      { permissionsMissingFor }: { permissionsMissingFor?: string } = {}
    ): Promise<void> {
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        ...shape,
        seedPublic: true,
      });
      await shutdownServices();
      if (permissionsMissingFor !== undefined) {
        // A registry row whose permissions are not there, so a start that
        // seeds would have them to write.
        const check = await adapterFor();
        await check.executeQuery(
          `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource = '${permissionsMissingFor}')`
        );
        await check.executeQuery(
          `DELETE FROM permissions WHERE resource = '${permissionsMissingFor}'`
        );
        await check.disconnect().catch(() => undefined);
      }
      await setup.disconnect().catch(() => undefined);
    }

    /** The configuration a build of `shape` starts with. */
    function configOf(
      shape: ReturnType<typeof entities>,
      migrationsAtStart = false
    ) {
      return sanitizeConfig(
        defineConfig({
          ...shape,
          ...(migrationsAtStart
            ? { db: { runMigrationsOnBoot: true, migrationsDir } }
            : {}),
        })
      ) as never;
    }

    /**
     * Every statement one start sends, begun as `entry` says, in `mode`: those
     * sent before it resolved, and all of them once it and the work it leaves
     * running have settled.
     */
    async function recordStart(
      config: never,
      entry: Entry,
      mode: "production" | "development" = "production"
    ): Promise<{
      beforeResolved: RecordedStatement[];
      all: RecordedStatement[];
    }> {
      vi.stubEnv("NODE_ENV", mode);
      _resetEnvCache();
      // Only to find the driver to record on: the recorder is installed on
      // the driver's prototypes, so the start's own connections are recorded.
      const probe = await adapterFor();
      const recorder = await recordStatements(probe, dialect, {
        context: () => sentFrom.getStore(),
      });
      let beforeResolved: RecordedStatement[] = [];
      try {
        if (entry === "the Direct API") {
          await getNextly({ config });
          beforeResolved = [...recorder.calls];
        } else {
          // Without a configuration, the request registers the services
          // itself rather than through `getNextly`: route handlers in a
          // process never given one, so none stored by an earlier case.
          if (entry !== "a request") setHandlerConfig(null as never);
          const handlers = createDynamicHandlers(
            entry === "a request" ? { config } : undefined
          );
          const path = ["collections", "pwnb_c0", "entries"];
          await handlers.GET(
            new Request(`http://localhost/api/${path.join("/")}`),
            { params: Promise.resolve({ params: path }) }
          );
        }
        await startSettled();
        return { beforeResolved, all: [...recorder.calls] };
      } finally {
        recorder.uninstall();
        await probe.disconnect().catch(() => undefined);
        await shutdownNextly();
        await shutdownServices();
        resetDispatcherForTests();
      }
    }

    it.each(ENTRIES)(
      "against a registry behind the configuration, begun by %s",
      async entry => {
        await migrated(entities(5, false), {
          permissionsMissingFor: "pwnb_c2",
        });

        const { all } = await recordStart(configOf(entities(5, true)), entry);

        expect(all.length, "the start was recorded").toBeGreaterThan(0);
        expect(bookkeepingWrites(all)).toEqual([]);
      },
      240_000
    );

    it.each(ENTRIES)(
      "against a registry ahead of the configuration, begun by %s",
      async entry => {
        await migrated(entities(5, true), {
          permissionsMissingFor: "pwnb_c2",
        });

        const { all } = await recordStart(configOf(entities(5, false)), entry);

        expect(all.length, "the start was recorded").toBeGreaterThan(0);
        expect(bookkeepingWrites(all)).toEqual([]);
      },
      240_000
    );

    it("the control: a development start of the registry behind the configuration writes it", async () => {
      await migrated(entities(5, false));

      const { all } = await recordStart(
        configOf(entities(5, true)),
        "the Direct API",
        "development"
      );

      const written = new Set(all.map(writtenTable));
      expect(written, "the registry is written").toContain(
        "dynamic_collections"
      );
      expect(written, "the new collection's permissions are added").toContain(
        "permissions"
      );
    }, 240_000);

    /**
     * The statements a production start of `count` entities sends before it
     * resolves, against a database migrated for them, outside the migrations
     * at start where `migrationsAtStart` turns them on.
     */
    async function countedStart(
      count: number,
      migrationsAtStart: boolean
    ): Promise<RecordedStatement[]> {
      const shape = entities(count, false);
      await migrated(shape);
      const config = configOf(shape, migrationsAtStart);
      if (migrationsAtStart) {
        // The step's first run against this database records what it finds;
        // the start counted is a later one, against a database it has already
        // brought up to date.
        await recordStart(config, "the Direct API");
      }
      const { beforeResolved } = await recordStart(config, "the Direct API");
      // The step ran where it is on, and only there, so the statements left
      // out below are its own.
      expect(
        beforeResolved.some(call => call.context === "migrations at start"),
        "the migrations at start ran"
      ).toBe(migrationsAtStart);
      return beforeResolved.filter(call => call.context === undefined);
    }

    it.each([false, true])(
      "runs the same statements for 5 entities and for 50 (migrations at start: %s)",
      async migrationsAtStart => {
        const five = await countedStart(5, migrationsAtStart);
        // A database of its own for the second configuration.
        await drop();
        if (dialect === "sqlite") {
          const dir = mkdtempSync(join(tmpdir(), "nextly-pwnb-"));
          url = `file:${join(dir, "start.db")}`;
          drop = async () => rmSync(dir, { recursive: true, force: true });
        } else {
          const scratch = await createScratchDatabase(dialect, "nextly_pwnb");
          url = scratch.url;
          drop = scratch.drop;
        }
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const fifty = await countedStart(50, migrationsAtStart);

        expect(five.length, "the start was recorded").toBeGreaterThan(0);
        expect(writesOutsideOwn(five)).toEqual([]);
        expect(writesOutsideOwn(fifty)).toEqual([]);
        expect(fifty.length).toBe(five.length);
      },
      600_000
    );
  }
);
