/**
 * `nextly db:sync --demote` and a code-first sync of the same project never interleave.
 *
 * Every road that writes a code-first collection's registry row holds the schema lock for the
 * whole of its read and its writes: a development start, a development reload, `nextly db:sync`
 * and `nextly migrate`'s registry phase. The demote holds the same lock for its re-read and its
 * write. So whichever takes the lock first finishes before the other reads anything, in both
 * orders, and a demote never ends with the handed-over record written from code and locked again.
 *
 * Each case runs two "processes" on one database, each on a connection of its own, and pauses the
 * first inside the lock:
 *
 * - **The demote first.** It is paused before its re-read, holding the lock; the road started
 *   meanwhile must not reach its registry read until the demote has written. A road that ran
 *   anyway would change the record under the demote, which then refuses.
 * - **The road first.** It is paused just after it read every registry row, holding the lock; the
 *   demote started meanwhile must not finish until the road has written. A demote that finished
 *   inside that window would be written over by the road's stale read, and the record locked again.
 *
 * Plus the database whose `nextly_schema_lock` table no run of this version has made: the demote
 * makes it, so it holds the lock there too.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

/**
 * `nextly migrate`'s registry writes, observed: each row it writes goes through `inRegistryStep`
 * after the registry phase read every row, so the first call is where that phase is paused.
 */
const registryStep = vi.hoisted(() => ({
  onFirst: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("../../../domains/schema/schema-version", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../../domains/schema/schema-version")
    >();
  return {
    ...actual,
    inRegistryStep: (async (...args: unknown[]) => {
      const onFirst = registryStep.onFirst;
      registryStep.onFirst = undefined;
      if (onFirst) await onFirst();
      return (actual.inRegistryStep as (...a: unknown[]) => unknown)(...args);
    }) as typeof actual.inRegistryStep,
  };
});

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { getService } from "../../../di/service-access";
import { CollectionRegistryService } from "../../../domains/collections/services/collection-registry-service";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { PLAN_CHANGED_AFTER_CONSENT } from "../../../domains/schema/migrate/plan-changed-after-consent";
import { DEMOTED_FROM_CODE } from "../../../domains/schema/pipeline/demoted-from-code";
import {
  EARLIER_MIGRATE_LOCK_TABLE,
  SCHEMA_LOCK_TABLE,
} from "../../../domains/schema/pipeline/schema-lock";
import { reloadNextlyConfig } from "../../../init/reload-config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { consoleLogger } from "../../../shared/types";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { demoteCollection } from "../db-sync-demote";
import { openCollectionRegistry } from "../db-sync-registry";
import { runDbSync } from "../db-sync";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

/** The collection as code declares it when the demote is asked for. */
const POSTS = defineCollection({
  slug: "dsi_posts",
  fields: [text({ name: "headline" })],
});

/** The same entry, edited since: what the road racing the demote writes from code. */
const POSTS_EDITED = defineCollection({
  slug: "dsi_posts",
  fields: [text({ name: "headline" }), text({ name: "extra" })],
});

function configOf(collection: ReturnType<typeof defineCollection>) {
  return defineConfig({
    collections: [collection],
    db: { migrationsDir: "./migrations" },
  });
}

/**
 * How long a road started beside a held lock is given to reach its registry read. A road that
 * holds the lock waits a minute for it, so a road that has not got there by now is waiting; a road
 * that does not hold it gets there in well under this.
 */
const WINDOW_MS = 8_000;

const quiet = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

/** A one-shot signal one side of a race opens and the other waits for. */
interface Gate {
  opened: Promise<void>;
  open(): void;
}

/** Every gate a case made, opened when it ends, so a failed case leaves nothing waiting. */
const gates: Gate[] = [];

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>(resolve => {
    open = resolve;
  });
  const made = { opened, open };
  gates.push(made);
  return made;
}

/** What a tracked run settled with, for a failure message. */
function described(outcome: { value?: unknown; error?: unknown }): string {
  if (outcome.error === undefined) return `value ${String(outcome.value)}`;
  const error = outcome.error as { code?: unknown; logContext?: unknown };
  return `error ${String(outcome.error)} ${String(error.code)} ${JSON.stringify(error.logContext)}`;
}

/** A promise that records when it settled, and what it settled with, without ever rejecting. */
interface Tracked<T> {
  settled: boolean;
  outcome: Promise<{ value?: T; error?: unknown }>;
}

function tracked<T>(work: Promise<T>): Tracked<T> {
  const state: Tracked<T> = {
    settled: false,
    outcome: work.then(
      value => ({ value }),
      (error: unknown) => ({ error })
    ),
  };
  void state.outcome.then(() => {
    state.settled = true;
  });
  return state;
}

/** Waits until `done` answers true or `ms` pass. */
async function until(done: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Whether `error` is the demote's refusal of a record that changed after the operator agreed. */
function changedAfterConsent(error: unknown): boolean {
  return (
    (error as { logContext?: { reason?: unknown } } | undefined)?.logContext
      ?.reason === PLAN_CHANGED_AFTER_CONSENT
  );
}

/**
 * The registry a demote reads and writes through, paused before its second read: the re-read the
 * demote makes holding the lock, before it writes. `held` opens when it gets there.
 */
class PausedBeforeReRead extends CollectionRegistryService {
  private reads = 0;

  constructor(
    adapter: DrizzleAdapter,
    private readonly held: Gate,
    private readonly release: Gate
  ) {
    super(adapter, quiet as never);
  }

  override async getCollectionBySlug(
    slug: string
  ): ReturnType<CollectionRegistryService["getCollectionBySlug"]> {
    this.reads += 1;
    if (this.reads === 2) {
      this.held.open();
      await this.release.opened;
    }
    return super.getCollectionBySlug(slug);
  }
}

/** The code-first sync's one read of every registry row, as the class declares it. */
type RecordsBySlug = { recordsBySlug(): Promise<unknown> };

/**
 * Observes the code-first sync's read of every registry row, on every road that syncs collections
 * through the registry service; `pause` keeps it from returning until it is released.
 */
function watchSyncRead(pause?: Gate): { reached: () => boolean; at: Gate } {
  const at = gate();
  let reached = false;
  const proto = CollectionRegistryService.prototype as unknown as RecordsBySlug;
  const original = proto.recordsBySlug;
  vi.spyOn(proto, "recordsBySlug").mockImplementation(async function (
    this: RecordsBySlug
  ) {
    const read = await original.call(this);
    reached = true;
    at.open();
    if (pause) await pause.opened;
    return read;
  });
  return { reached: () => reached, at };
}

/** The same for `nextly migrate`'s registry phase, at its first write after its read. */
function watchMigrateRegistryWrite(pause?: Gate): {
  reached: () => boolean;
  at: Gate;
} {
  const at = gate();
  let reached = false;
  registryStep.onFirst = async () => {
    reached = true;
    at.open();
    if (pause) await pause.opened;
  };
  return { reached: () => reached, at };
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a demote and a code-first sync of one project, ${dialect}`, () => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    const connections: DrizzleAdapter[] = [];

    /** A connection of its own to the case's database, as another process would open. */
    async function connect(): Promise<DrizzleAdapter> {
      const adapter = (await createAdapter({
        type: dialect,
        url,
      } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      connections.push(adapter);
      return adapter;
    }

    function context(): CommandContext {
      return {
        logger: createLogger({ quiet: true }),
        options: {},
        cwd: dir,
      } as CommandContext;
    }

    /**
     * The registry on a connection of its own, opened as the promote and demote commands open
     * theirs (`openCollectionRegistry`), with the resolver the registry's tables are read through.
     */
    async function openRegistry() {
      const opened = await openCollectionRegistry(
        createLogger({ quiet: true })
      );
      if (opened === undefined) throw new Error("the database is not there");
      connections.push(opened.adapter);
      return opened;
    }

    /** The collection's registry record, read on a connection of the test's own. */
    async function record() {
      const { registry } = await openRegistry();
      return registry.getCollectionBySlug(POSTS.slug);
    }

    /**
     * `nextly db:sync --demote`, answered yes, on a connection of its own. With `pause`, it stops
     * holding the lock before its re-read, until released.
     */
    async function demote(pause?: { held: Gate; release: Gate }) {
      const { registry, adapter } = await openRegistry();
      return demoteCollection({
        collection: POSTS as never,
        logger: createLogger({ quiet: true }),
        registry: pause
          ? new PausedBeforeReRead(adapter, pause.held, pause.release)
          : registry,
        adapter,
        confirm: async () => true,
        lockWaitMs: 120_000,
      });
    }

    /** A development start of `collection`, on a connection of its own. */
    async function start(collection: ReturnType<typeof defineCollection>) {
      loaded.config = configOf(collection);
      clearCachedSnapshot();
      clearLiveSnapshots();
      return createTestNextly({
        adapter: (await connect()) as never,
        collections: [collection],
      });
    }

    /** A development reload of `collection`, in the running app. */
    async function reload(collection: ReturnType<typeof defineCollection>) {
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configOf(collection);
      return reloadNextlyConfig({
        resolver: name =>
          name === "logger"
            ? { ...consoleLogger, ...quiet }
            : getService(name as Parameters<typeof getService>[0]),
      });
    }

    /** `nextly db:sync` of `collection`; refused by throwing, as its exit would end it. */
    async function dbSync(collection: ReturnType<typeof defineCollection>) {
      loaded.config = configOf(collection);
      clearCachedSnapshot();
      clearLiveSnapshots();
      const exit = vi.spyOn(process, "exit").mockImplementation((code => {
        throw new Error(`db:sync exited ${String(code)}`);
      }) as never);
      try {
        await runDbSync(
          { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
          context()
        );
      } finally {
        exit.mockRestore();
      }
    }

    /** `nextly migrate:create --name <name>` of `collection`. */
    async function migrateCreate(
      name: string,
      collection: ReturnType<typeof defineCollection>
    ) {
      loaded.config = configOf(collection);
      setNonInteractive(true);
      try {
        await runMigrateCreate(name, { cwd: dir } as never, context());
      } finally {
        setNonInteractive(false);
      }
      // A second migration in the same second would sort by its name, not its time.
      await new Promise(resolve => setTimeout(resolve, 1_100));
    }

    /** `nextly migrate` of `collection`, failing by throwing. */
    async function migrate(collection: ReturnType<typeof defineCollection>) {
      loaded.config = configOf(collection);
      clearCachedSnapshot();
      clearLiveSnapshots();
      await runMigrate(
        { cwd: dir, throwOnFailure: true } as Parameters<typeof runMigrate>[0],
        context()
      );
    }

    /** The record as the demote leaves it: the Schema Builder's, unlocked, marked as handed over. */
    async function expectHandedOver(): Promise<void> {
      expect(await record()).toMatchObject({
        source: "ui",
        locked: false,
        configPath: DEMOTED_FROM_CODE,
      });
    }

    /** The record as the road writes it from the edited entry: code's, locked, with `extra`. */
    async function expectWrittenFromCode(): Promise<void> {
      const now = await record();
      expect(now).toMatchObject({ source: "code", locked: true });
      expect((now?.fields ?? []).map(field => field.name)).toContain("extra");
    }

    /**
     * The demote first: it holds the lock, paused before its re-read, while `road` starts. The
     * road must not reach its registry read (`reached`) until the demote has written.
     */
    async function demoteFirst(
      road: () => Promise<unknown>,
      reached: () => boolean
    ): Promise<{ road: { value?: unknown; error?: unknown } }> {
      const pause = { held: gate(), release: gate() };
      const demoting = tracked(demote(pause));
      await Promise.race([
        pause.held.opened,
        demoting.outcome.then(outcome => {
          throw new Error(
            `the demote ended before it held the lock: ${described(outcome)}`
          );
        }),
      ]);

      const racing = tracked(road());
      await until(() => reached() || racing.settled, WINDOW_MS);
      // A road holding the lock is still waiting for it here, its read not made.
      expect(reached(), "the road read the registry beside the demote").toBe(
        false
      );

      pause.release.open();
      const demoted = await demoting.outcome;
      expect(demoted.error).toBeUndefined();
      expect(demoted.value).toBe("demoted");
      const road_ = await racing.outcome;
      await expectHandedOver();
      return { road: road_ };
    }

    /**
     * The road first: it holds the lock, paused just after it read every registry row (`at`),
     * while the demote starts. The demote must not finish until the road has written.
     */
    async function roadFirst(
      road: () => Promise<unknown>,
      at: Gate,
      release: Gate
    ): Promise<void> {
      const racing = tracked(road());
      await at.opened;

      const demoting = tracked(demote());
      await until(() => demoting.settled, WINDOW_MS);
      // A demote holding the lock is still waiting for it here, nothing written.
      expect(
        demoting.settled,
        `the demote finished inside the road's read and write: ${
          demoting.settled ? described(await demoting.outcome) : ""
        }`
      ).toBe(false);

      release.open();
      const road_ = await racing.outcome;
      expect(road_.error).toBeUndefined();
      // The road wrote the record from code since the operator agreed, so the demote stops.
      const demoted = await demoting.outcome;
      expect(changedAfterConsent(demoted.error), String(demoted.error)).toBe(
        true
      );
      await expectWrittenFromCode();
    }

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-demote-sync-"));
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "test.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_dsi");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      clearServices();
    }, 60_000);

    afterEach(async () => {
      registryStep.onFirst = undefined;
      for (const made of gates.splice(0)) made.open();
      vi.restoreAllMocks();
      await shutdownServices().catch(() => {});
      clearServices();
      for (const adapter of connections.splice(0)) {
        await adapter.disconnect().catch(() => {});
      }
      await drop();
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    }, 60_000);

    describe("a development start", () => {
      beforeEach(async () => {
        await start(POSTS);
      }, 60_000);

      it("waits for a demote that holds the lock, then follows the Schema Builder", async () => {
        const read = watchSyncRead();
        const { road } = await demoteFirst(
          () => start(POSTS_EDITED),
          read.reached
        );
        expect(road.error).toBeUndefined();
      }, 180_000);

      it("holds a demote off until its registry writes are done", async () => {
        const release = gate();
        const read = watchSyncRead(release);
        await roadFirst(() => start(POSTS_EDITED), read.at, release);
      }, 180_000);
    });

    describe("a development reload", () => {
      beforeEach(async () => {
        await start(POSTS);
      }, 60_000);

      it("is refused while a demote holds the lock, and the demote's record stands", async () => {
        const read = watchSyncRead();
        const { road } = await demoteFirst(
          () => reload(POSTS_EDITED),
          read.reached
        );
        expect(road.value).toBe("refused");
      }, 180_000);

      it("holds a demote off until its registry writes are done", async () => {
        const release = gate();
        const read = watchSyncRead(release);
        await roadFirst(() => reload(POSTS_EDITED), read.at, release);
      }, 180_000);
    });

    describe("nextly db:sync", () => {
      beforeEach(async () => {
        await dbSync(POSTS);
      }, 60_000);

      it("waits for a demote that holds the lock, then follows the Schema Builder", async () => {
        const read = watchSyncRead();
        const { road } = await demoteFirst(
          () => dbSync(POSTS_EDITED),
          read.reached
        );
        expect(road.error).toBeUndefined();
      }, 180_000);

      it("holds a demote off until its registry writes are done", async () => {
        const release = gate();
        const read = watchSyncRead(release);
        await roadFirst(() => dbSync(POSTS_EDITED), read.at, release);
      }, 180_000);
    });

    describe("nextly migrate's registry phase", () => {
      beforeEach(async () => {
        await migrateCreate("init", POSTS);
        await migrate(POSTS);
        await migrateCreate("edit", POSTS_EDITED);
      }, 120_000);

      it("waits for a demote that holds the lock, then follows the Schema Builder", async () => {
        const write = watchMigrateRegistryWrite();
        const { road } = await demoteFirst(
          () => migrate(POSTS_EDITED),
          write.reached
        );
        expect(road.error).toBeUndefined();
      }, 180_000);

      it("holds a demote off until its registry writes are done", async () => {
        const release = gate();
        const write = watchMigrateRegistryWrite(release);
        await roadFirst(() => migrate(POSTS_EDITED), write.at, release);
      }, 180_000);
    });

    describe("a database whose schema lock table no run of this version has made", () => {
      beforeEach(async () => {
        await start(POSTS);
        await shutdownServices().catch(() => {});
        clearServices();
        // Every lock table the demote could hold, gone, as on a database an earlier version
        // last ran against; the field-group lock's table is not made on a new database.
        const adapter = await connect();
        for (const table of [
          SCHEMA_LOCK_TABLE,
          EARLIER_MIGRATE_LOCK_TABLE,
          "nextly_field_group_lock",
        ]) {
          if (await adapter.tableExists(table)) {
            await adapter.executeQuery(`DROP TABLE ${table}`);
          }
        }
      }, 60_000);

      it("makes the table, so a development start waits for the demote", async () => {
        const read = watchSyncRead();
        const { road } = await demoteFirst(
          () => start(POSTS_EDITED),
          read.reached
        );
        expect(road.error).toBeUndefined();
      }, 180_000);
    });
  });
}
