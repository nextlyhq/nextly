import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { NextlyError } from "../../errors";
import {
  _resetBootMigrationsGateForTest,
  awaitBootMigrations,
  openBootMigrationsGate,
} from "../boot-migrations-gate";

const shutdownServices = vi.fn();
vi.mock("../../di", () => ({ shutdownServices: () => shutdownServices() }));

/*
 * The registry reload is observed through its OWN module rather than through
 * the container, because what this file is about is WHEN the production path
 * asks for a reload -- and the container would let a reload that never happened
 * look the same as one that found nothing to do.
 */
const reloadDynamicTables = vi.fn(async () => undefined);
vi.mock("../reload-dynamic-tables", () => ({
  reloadDynamicTables: (label: string) => reloadDynamicTables(label),
}));
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runProdMigrationsIfEnabled } from "../prod-migrations";

const ORIG = process.env.NODE_ENV;
const ORIG_CWD = process.cwd();
beforeEach(() => {
  process.env.NODE_ENV = "production";
});
afterEach(() => {
  process.env.NODE_ENV = ORIG;
  process.chdir(ORIG_CWD);
});

function args(over: Record<string, unknown> = {}) {
  return {
    config: {
      db: {
        runMigrationsOnBoot: true,
        migrationsDir: "./src/db/migrations",
        migrateLockTtlSeconds: 900,
        uiSchemaFile: "ui-schema.json",
      },
      collections: [],
    },
    adapter: {
      dialect: "postgresql" as const,
      getDrizzle: () => ({}),
      tableExists: async () => true,
      executeQuery: async () => undefined,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    migrateCore: vi.fn(async () => ({
      applied: 1,
      coreChanged: false,
      ran: true,
    })),
    ...over,
  };
}

describe("runProdMigrationsIfEnabled", () => {
  beforeEach(() => {
    // Process-global by design — the refusal must outlive a request — so it has
    // to be cleared between cases or the first refusal fails every test after.
    _resetBootMigrationsGateForTest();
    shutdownServices.mockClear();
  });

  /**
   * The lock timing out tells this process nothing about whether the holder
   * migrated. Serving anyway is the case that put a replica on an unmigrated
   * schema while logging `complete (0 applied)` — `applied` is 0 here and 0 on
   * an up-to-date database, so the count cannot distinguish them.
   */
  /**
   * The refusal has to outlive the request that raised it. Both entry points
   * run migrations inside `if (!isServicesRegistered())`, and DI is already
   * marked registered by the time this throws — so without stickiness the very
   * next request skips migrations and serves the schema the process refused.
   *
   * Second call passes a migrateCore that would SUCCEED, so this cannot pass by
   * the failure simply repeating.
   */
  /**
   * The sticky flag lives inside this helper, and both entry points call it
   * only inside `if (!isServicesRegistered())` — which `registerServices()` has
   * already made false by the time the refusal is thrown. Without reopening
   * that gate the flag is unreachable: the next request skips this helper
   * entirely, builds the dispatcher, and serves the unverified schema.
   */
  it("tears services down so the refusal is reachable without leaking a pool", async () => {
    process.env.NODE_ENV = "production";
    const a = args({
      migrateCore: vi.fn(async () => ({
        applied: 0,
        coreChanged: false,
        ran: false,
      })),
    });

    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });

    // `shutdownServices`, not `clearServices`: the latter leaves the adapter
    // connected, so each retry would build another pool.
    expect(shutdownServices).toHaveBeenCalled();
  });

  it("keeps refusing on later calls, even when migrations would now succeed", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      runProdMigrationsIfEnabled(
        args({
          migrateCore: vi.fn(async () => ({
            applied: 0,
            coreChanged: false,
            ran: false,
          })),
        }) as never
      )
    ).rejects.toMatchObject({ code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN" });

    const wouldSucceed = vi.fn(async () => ({
      applied: 3,
      coreChanged: false,
      ran: true,
    }));
    await expect(
      runProdMigrationsIfEnabled(args({ migrateCore: wouldSucceed }) as never)
    ).rejects.toMatchObject({ code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN" });
    expect(wouldSucceed).not.toHaveBeenCalled();
  });

  /**
   * MySQL reports a busy lock by THROWING `NEXTLY_MIGRATE_LOCK_BUSY` rather
   * than returning `ran: false`, so a catch that rethrew only the refusal let
   * MySQL serve the unmigrated schema this change exists to prevent.
   */
  it("refuses when the lock was busy on a dialect that throws instead", async () => {
    process.env.NODE_ENV = "production";
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new NextlyError({
          code: "NEXTLY_MIGRATE_LOCK_BUSY",
          publicMessage: "busy",
        });
      }),
    });

    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
  });

  /**
   * `forceUnlock` deletes the Postgres lock ROW and returns immediately for
   * every other dialect, so telling a MySQL operator to run it during an
   * incident sends them to a no-op. MySQL's lock is session-scoped and dies
   * with its connection, which makes restarting the holder the real recovery.
   */
  it("gives dialect-appropriate recovery guidance", async () => {
    process.env.NODE_ENV = "production";
    const notRun = () => ({ applied: 0, coreChanged: false, ran: false });

    const pg = args({ migrateCore: vi.fn(async () => notRun()) });
    await expect(runProdMigrationsIfEnabled(pg as never)).rejects.toMatchObject(
      {
        publicMessage: expect.stringContaining("--force-unlock"),
      }
    );

    _resetBootMigrationsGateForTest();

    const my = args({ migrateCore: vi.fn(async () => notRun()) });
    my.adapter.dialect = "mysql";
    const err = await runProdMigrationsIfEnabled(my as never).catch(e => e);
    expect(err.publicMessage).not.toContain("--force-unlock");
    expect(err.publicMessage).toContain("released when that connection ends");
  });

  /**
   * `registerServices` opens the gate; this helper settles it. If the two ever
   * disagree about the conditions, a gate opened and never settled hangs every
   * consumer forever — a worse outage than the one being guarded against. So
   * the helper closes it on the early exits too, where it was never opened.
   */
  it("settles the gate even when it returns early", async () => {
    process.env.NODE_ENV = "production";
    const a = args();
    a.config.db.runMigrationsOnBoot = false;

    openBootMigrationsGate(true);
    await runProdMigrationsIfEnabled(a as never);

    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });

  it("refuses to start when the migrations did not run", async () => {
    process.env.NODE_ENV = "production";
    const a = args({
      migrateCore: vi.fn(async () => ({
        applied: 0,
        coreChanged: false,
        ran: false,
      })),
    });

    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
  });

  /**
   * The positive control for the refusal, and the boundary of it. Every OTHER
   * boot-migration failure is still swallowed so the app starts — those leave a
   * database the app can usefully serve, and `nextly migrate` fixes them. Only
   * "we do not know what we are serving" is fatal.
   */
  it("still starts when boot migrations fail for any other reason", async () => {
    process.env.NODE_ENV = "production";
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });

    await expect(
      runProdMigrationsIfEnabled(a as never)
    ).resolves.toBeUndefined();
  });

  it("skips unless NODE_ENV=production", async () => {
    process.env.NODE_ENV = "development";
    const a = args();
    await runProdMigrationsIfEnabled(a as never);
    expect(a.migrateCore).not.toHaveBeenCalled();
  });

  it("skips when runMigrationsOnBoot is false", async () => {
    const a = args({
      config: { db: { runMigrationsOnBoot: false, migrationsDir: "./m" } },
    });
    await runProdMigrationsIfEnabled(a as never);
    expect(a.migrateCore).not.toHaveBeenCalled();
  });

  it("runs migrateCore in wait mode when enabled in production", async () => {
    const a = args();
    await runProdMigrationsIfEnabled(a as never);
    expect(a.migrateCore).toHaveBeenCalledOnce();
    expect(a.migrateCore.mock.calls[0][0].lockMode).toBe("wait");
  });

  it("hands migrateCore a full logger (with .success) so runFileMigrations cannot crash on boot", async () => {
    // Regression: the boot callers (init.ts/auth-handler.ts) pass a minimal
    // logger without .success, but migrateCore -> runFileMigrations calls
    // logger.success("Applied ...") AFTER applying. Previously that threw
    // ("logger.success is not a function") and aborted remaining migrations.
    const a = args({
      migrateCore: vi.fn(async (deps: { logger: Record<string, unknown> }) => {
        // Simulate what runFileMigrations actually does.
        (deps.logger.success as (m: string) => void)("Applied x.sql");
        return { applied: 1, coreChanged: false, ran: true };
      }),
    });
    await expect(
      runProdMigrationsIfEnabled(a as never)
    ).resolves.toBeUndefined();
    // The boot logger's .error must NOT have fired (no false "failed").
    expect(a.logger.error).not.toHaveBeenCalled();
    // success was routed to the boot logger's info.
    expect(a.logger.info).toHaveBeenCalledWith("Applied x.sql");
  });

  it("tells migrateCore about a junction the Schema Builder declares", async () => {
    // Boot runs the same drift verification the CLI does, so it has to know
    // the same derived tables. A custom junction name matches no convention
    // and is in no snapshot, so a boot that resolved only the config would
    // stop with drift the CLI path does not report — on the same database.
    const projectRoot = await mkdtemp(join(tmpdir(), "nextly-prod-mig-"));
    try {
      await writeFile(
        join(projectRoot, "ui-schema.json"),
        JSON.stringify({
          collections: [{ slug: "articles", fields: [] }],
          singles: [],
          components: [],
        }),
        "utf-8"
      );
      process.chdir(projectRoot);

      const a = args({
        deferredExtends: [
          {
            target: "articles",
            owner: "plugin-tagging",
            fields: [
              {
                name: "tags",
                type: "relationship",
                options: {
                  target: "tags",
                  relationType: "manyToMany",
                  junctionTable: "articles_to_tags",
                },
              },
            ],
          },
        ],
      });
      await runProdMigrationsIfEnabled(a as never);

      const passed = a.migrateCore.mock.calls[0][0] as {
        knownJunctions: ReadonlySet<string>;
      };
      expect([...passed.knownJunctions]).toContain("articles_to_tags");
    } finally {
      process.chdir(ORIG_CWD);
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("logs and returns (does NOT throw) when migrateCore throws", async () => {
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(
      runProdMigrationsIfEnabled(a as never)
    ).resolves.toBeUndefined();
    expect(a.logger.error).toHaveBeenCalled();
  });
});

/*
 * `registerServices` builds the runtime schema registry BEFORE this path runs,
 * so a migration that registers an entity leaves the process holding a registry
 * that predates it -- the collection is addressable in metadata and drawn on a
 * dashboard card while every query against it fails.
 */
describe("the schema registry is reloaded before the gate opens", () => {
  beforeEach(() => {
    reloadDynamicTables.mockClear();
    _resetBootMigrationsGateForTest();
  });

  it("reloads after migrations ran", async () => {
    await runProdMigrationsIfEnabled(args() as never);
    expect(reloadDynamicTables).toHaveBeenCalledTimes(1);
  });

  /*
   * 🔴 The case that decides the CONDITION, and the reason it is not the
   * registration counts. On a rolling deploy a second replica waits on the
   * migrate lock, acquires it once the first has finished, and runs against a
   * settled database: `ran` is true while `applied` and the registration counts
   * are 0. Its registry is exactly as stale as the migrating replica's was.
   * Gated on "did I register anything", this replica never reloads and serves
   * entities it can see but cannot query.
   */
  it("reloads on a replica that applied and registered nothing", async () => {
    await runProdMigrationsIfEnabled(
      args({
        migrateCore: vi.fn(async () => ({
          applied: 0,
          coreChanged: false,
          ran: true,
          collectionsRegistered: 0,
          singlesRegistered: 0,
        })),
      }) as never
    );
    expect(reloadDynamicTables).toHaveBeenCalledTimes(1);
  });

  it("does NOT reload when migrations did not run", async () => {
    // `ran: false` means the lock stayed held, and this path refuses to serve
    // rather than reloading anything -- a registry refreshed for a process
    // that is about to throw is work spent on a boot nobody will use.
    await expect(
      runProdMigrationsIfEnabled(
        args({
          migrateCore: vi.fn(async () => ({
            applied: 0,
            coreChanged: false,
            ran: false,
          })),
        }) as never
      )
    ).rejects.toThrow();
    expect(reloadDynamicTables).not.toHaveBeenCalled();
  });

  /*
   * 🔴 `runFileMigrations` commits and records each migration file
   * independently before propagating a later file's error, so a batch that
   * failed part-way has already written whatever metadata its earlier files
   * carried. This path swallows that error and goes on to SERVE, so skipping
   * the reload here served exactly those entities against the pre-migration
   * registry -- the defect reached through the error branch rather than the
   * happy one.
   */
  it("reloads when a partly-applied batch fails and the app continues", async () => {
    await runProdMigrationsIfEnabled(
      args({
        migrateCore: vi.fn(async () => {
          throw new Error("0003_later.sql failed after 0002 committed");
        }),
      }) as never
    );
    expect(reloadDynamicTables).toHaveBeenCalledTimes(1);
  });

  it("does NOT reload when the process refuses to serve", async () => {
    // The control, and the distinction that makes the case above right: a
    // refusal throws and the process wants restarting, so refreshing a registry
    // nobody will read is work spent on a boot that is over.
    await expect(
      runProdMigrationsIfEnabled(
        args({
          migrateCore: vi.fn(async () => ({
            applied: 0,
            coreChanged: false,
            ran: false,
          })),
        }) as never
      )
    ).rejects.toThrow();
    expect(reloadDynamicTables).not.toHaveBeenCalled();
  });

  it("does not reload outside production", async () => {
    // The control for the three above: a rule that reloaded unconditionally
    // would satisfy the first two while doing it on every dev boot as well.
    process.env.NODE_ENV = "development";
    await runProdMigrationsIfEnabled(args() as never);
    expect(reloadDynamicTables).not.toHaveBeenCalled();
  });

  /*
   * 🔴 The reload runs BEFORE `allowBootMigrations`, so nothing waiting on that
   * gate is released onto a registry this boot already knows is behind. The
   * ordering is only safe because the reload cannot throw; asserted here so a
   * later move of either line fails rather than silently reopening the window.
   */
  it("opens the boot gate only after the reload has finished", async () => {
    // 🔴 The gate is OPENED first, because `awaitBootMigrations` resolves
    // immediately when nothing is pending -- so without this the assertion
    // below is satisfied by there being no gate at all rather than by the
    // ordering it names.
    openBootMigrationsGate(true);

    // The control for exactly that: the gate must be genuinely pending before
    // the run, or "not yet open during the reload" means nothing.
    let openedEarly = false;
    void awaitBootMigrations().then(() => {
      openedEarly = true;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(openedEarly).toBe(false);

    let gateOpenDuringReload: boolean | undefined;
    reloadDynamicTables.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      gateOpenDuringReload = openedEarly;
      return undefined;
    });

    await runProdMigrationsIfEnabled(args() as never);

    expect(gateOpenDuringReload).toBe(false);
    // And it DID open afterwards, or the assertion above would pass on a path
    // that simply never opens the gate.
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
    expect(openedEarly).toBe(true);
  });
});
