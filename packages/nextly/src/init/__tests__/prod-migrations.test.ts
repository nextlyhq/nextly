import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { CliError } from "../../cli/errors";
import { NextlyError } from "../../errors";
import {
  _resetBootMigrationsGateForTest,
  awaitBootMigrations,
  openBootMigrationsGate,
} from "../boot-migrations-gate";

/*
 * The registry reload is observed through its OWN module rather than through
 * the container, so a reload this path no longer asks for is seen if it comes
 * back: the container would let a reload look the same as one that found
 * nothing to do.
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
      // No ledger and no registry: nothing for the reads before the run (the
      // old Builder marks, the registry as it stood) to find.
      tableExists: async () => false,
      executeQuery: async () => undefined,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    migrateCore: vi.fn(async () => ({
      applied: 1,
      coreChanged: false,
      ran: true,
    })),
    served: {},
    afterMigrations: vi.fn(async () => {}),
    ...over,
  };
}

describe("runProdMigrationsIfEnabled", () => {
  beforeEach(() => {
    // Process-global by design — the refusal must outlive a request — so it has
    // to be cleared between cases or the first refusal fails every test after.
    _resetBootMigrationsGateForTest();
  });

  /**
   * The lock timing out tells this process nothing about whether the holder
   * migrated. Serving anyway is the case that put a replica on an unmigrated
   * schema while logging `complete (0 applied)` — `applied` is 0 here and 0 on
   * an up-to-date database, so the count cannot distinguish them.
   */
  /**
   * The refusal has to outlive the request that raised it: a later boot
   * attempt in the same process must refuse too rather than migrate afresh.
   * Releasing what the refused boot acquired is `registerServices`'s job and
   * is tested there (di/__tests__/boot-refusal-releases.test.ts).
   *
   * Second call passes a migrateCore that would SUCCEED, so this cannot pass by
   * the failure simply repeating.
   */
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
  it("starts an older build that lacks a migration the database records applied, warning", async () => {
    // The stop comes before the run writes anything, so the newer build's
    // state is as it left it; the start goes on and serves it (D8).
    process.env.NODE_ENV = "production";
    const missing = new NextlyError({
      code: "MIGRATION_MISSING",
      publicMessage:
        "The ledger records 1 applied migration this build's migrations folder lacks (`20261102_000002_added.sql`).",
      logContext: { files: ["20261102_000002_added.sql"], unresolved: [] },
    });
    const warnings: string[] = [];
    const a = args({
      migrateCore: vi.fn(async () => {
        throw missing;
      }),
    });
    a.logger.warn = (m: string) => {
      warnings.push(m);
    };

    await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
    expect(warnings.join("\n")).toContain("`20261102_000002_added.sql`");
    expect(a.logger.error).not.toHaveBeenCalled();
    // Nothing of `nextly migrate`'s work after the migrations: none applied.
    expect(a.afterMigrations).not.toHaveBeenCalled();
    // Serving is allowed, and no refusal stands for a later start.
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
    await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
  });

  it("still refuses a missing migration with an unresolved attempt: the database may hold part of it", async () => {
    process.env.NODE_ENV = "production";
    const partly = new NextlyError({
      code: "MIGRATION_MISSING",
      publicMessage:
        "1 migration this build's folder lacks has an unresolved attempt (`20261102_000002_added.sql`).",
      logContext: { files: [], unresolved: ["20261102_000002_added.sql"] },
    });
    const a = args({
      migrateCore: vi.fn(async () => {
        throw partly;
      }),
    });

    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toBe(partly);
    // The refusal stands for every later start in this process.
    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toMatchObject({
      code: "MIGRATION_MISSING",
    });
  });

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
   * The schema lock is a row on every dialect, renewed by its holder, so the
   * recovery is the same everywhere: a holder that stopped lets it lapse, and
   * `--force-unlock` clears it at once. Advice that differed by dialect would
   * now be wrong on one of them.
   */
  it("gives the same recovery guidance on every dialect", async () => {
    process.env.NODE_ENV = "production";
    const notRun = () => ({ applied: 0, coreChanged: false, ran: false });

    const pg = args({ migrateCore: vi.fn(async () => notRun()) });
    const pgErr = await runProdMigrationsIfEnabled(pg as never).catch(e => e);

    _resetBootMigrationsGateForTest();

    const my = args({ migrateCore: vi.fn(async () => notRun()) });
    my.adapter.dialect = "mysql";
    const myErr = await runProdMigrationsIfEnabled(my as never).catch(e => e);

    expect(pgErr.publicMessage).toContain("--force-unlock");
    expect(pgErr.publicMessage).toContain("lapse on its own");
    expect(myErr.publicMessage).toBe(pgErr.publicMessage);
  });

  /**
   * The helper opens the gate for the run it performs and settles it when the
   * run ends. A consumer arriving mid-run waits for it; one arriving after is
   * released. Opened anywhere else, the gate either misses the run — nothing
   * held — or outlives it, which is the pending promise nothing settled.
   */
  it("holds the gate while its run is in flight and releases it after", async () => {
    let heldDuringRun = false;
    const a = args({
      migrateCore: vi.fn(async () => {
        // Raced against a macrotask: a gate that is not pending resolves first.
        heldDuringRun = await Promise.race([
          awaitBootMigrations().then(() => false),
          new Promise<boolean>(resolve => setTimeout(() => resolve(true), 0)),
        ]);
        return { applied: 0, coreChanged: false, ran: true };
      }),
    });

    await runProdMigrationsIfEnabled(a as never);

    expect(heldDuringRun).toBe(true);
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });

  /**
   * This helper opens the gate and settles it. A gate some other path left
   * pending would hang every consumer forever — a worse outage than the one
   * being guarded against — so the early exits settle it too.
   */
  it("settles the gate even when it returns early", async () => {
    process.env.NODE_ENV = "production";
    const a = args();
    a.config.db.runMigrationsOnBoot = false;

    openBootMigrationsGate();
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
  it("refuses to start when a busy table outlasted its tries, as for a held schema lock", async () => {
    process.env.NODE_ENV = "production";
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new NextlyError({
          code: "NEXTLY_TABLE_BUSY",
          publicMessage: "`0007_x.sql` stopped: table busy, nothing changed.",
          logContext: { reason: "table busy" },
        });
      }),
    });

    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
    });
  });

  it("hands the core the busy-table bounds the environment sets", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXTLY_LOCK_TIMEOUT = "2";
    process.env.NEXTLY_LOCK_TIMEOUT_TOTAL = "30";
    try {
      const a = args();
      await runProdMigrationsIfEnabled(a as never);
      expect(a.migrateCore).toHaveBeenCalledWith(
        expect.objectContaining({
          busyTable: expect.objectContaining({
            bounds: { tryMs: 2_000, totalMs: 30_000 },
          }),
        })
      );
    } finally {
      delete process.env.NEXTLY_LOCK_TIMEOUT;
      delete process.env.NEXTLY_LOCK_TIMEOUT_TOTAL;
    }
  });

  it("refuses to start, running nothing, when a busy-table bound is out of its range", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXTLY_LOCK_TIMEOUT = "0";
    try {
      const a = args();
      await expect(
        runProdMigrationsIfEnabled(a as never)
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(a.migrateCore).not.toHaveBeenCalled();
    } finally {
      delete process.env.NEXTLY_LOCK_TIMEOUT;
    }
  });

  it("still starts when boot migrations fail for any other reason", async () => {
    process.env.NODE_ENV = "production";
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });

    await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
  });

  it.each(["data-loss-needs-consent", "data-loss-not-covered"])(
    "still starts when the consent refuses a migration (%s), handing the start the refusal",
    async reason => {
      const refused: unknown[] = [];
      const a = args({
        migrateCore: vi.fn(async () => {
          throw NextlyError.invalidInput({
            message:
              "This would delete:\n  plugin:seo/002_drop_summary:\n    - column seo_pages.summary\nNothing was changed. To consent: --accept-data-loss=seo_pages.summary (or NEXTLY_ACCEPT_DATA_LOSS=seo_pages.summary).",
            logContext: { files: ["plugin:seo/002_drop_summary"], reason },
          });
        }),
        onDataLossRefusal: (refusal: unknown) => {
          refused.push(refusal);
        },
      });

      await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
      // In a start's words: the variable a start reads, then the command's flag.
      expect(refused).toEqual([
        {
          message:
            'This would delete:\n  plugin:seo/002_drop_summary:\n    - column seo_pages.summary\nNothing was changed. To consent: start with NEXTLY_ACCEPT_DATA_LOSS=seo_pages.summary, or run "nextly migrate --accept-data-loss=seo_pages.summary".',
        },
      ]);
    }
  );

  it("hands the start no consent refusal for a migration that failed any other way", async () => {
    const onDataLossRefusal = vi.fn();
    const failures = [
      new Error("connection reset"),
      NextlyError.invalidInput({
        message: "Not a consent refusal.",
        logContext: { reason: "something-else" },
      }),
    ];
    for (const failure of failures) {
      _resetBootMigrationsGateForTest();
      const a = args({
        migrateCore: vi.fn(async () => {
          throw failure;
        }),
        onDataLossRefusal,
      });
      await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
    }
    expect(onDataLossRefusal).not.toHaveBeenCalled();
  });

  it("still starts when an applied file was edited, logging the refusal", async () => {
    // The refusal `nextly migrate` exits 2 on: at boot it stops the
    // migrations, not the site, as any failed migration does.
    process.env.NODE_ENV = "production";
    const errors: string[] = [];
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new CliError("MIGRATION_TAMPERED", {
          what: "`20261102_000001_add_posts.sql` has changed since it was applied, so `nextly migrate` ran nothing.",
          why: "edited",
          next: "restore it",
        });
      }),
    });
    a.logger.error = (m: string) => {
      errors.push(m);
    };

    await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
    expect(errors.join("\n")).toContain(
      "20261102_000001_add_posts.sql` has changed since it was applied"
    );
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

  it("refuses a Builder-named file it cannot recognise, as nextly migrate does", async () => {
    // The boot applies the same pending files the CLI does, so it asks for the
    // same refusal: off, a production boot would run a file the command refuses.
    const a = args();
    await runProdMigrationsIfEnabled(a as never);
    expect(a.migrateCore.mock.calls[0][0].refuseUnrecognisedBuilderFiles).toBe(
      true
    );
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
    await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(true);
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

  it("hands migrateCore a configured plugin's modules AND names it as having some", async () => {
    // `migrateCore` rejects every active plugin table whose plugin is missing
    // from `pluginsWithMigrations` BEFORE its plugin phase applies anything,
    // so the modules alone are not enough: a boot passing the sets without
    // the names refused the very tables those sets create.
    const module = { name: "001_notes" };
    const a = args();
    a.config = {
      ...a.config,
      plugins: [
        {
          name: "fx",
          version: "1.0.0",
          contributes: { schema: { migrations: [module] } },
        },
        // The control: a plugin with no modules is named in neither.
        { name: "plain", version: "1.0.0" },
      ],
    } as never;
    await runProdMigrationsIfEnabled(a as never);

    const passed = (a.migrateCore.mock.calls[0] as unknown[])[0] as {
      pluginMigrationSets?: readonly {
        pluginName: string;
        migrations: readonly unknown[];
      }[];
      pluginsWithMigrations?: ReadonlySet<string>;
    };
    expect(passed.pluginMigrationSets).toEqual([
      expect.objectContaining({ pluginName: "fx", migrations: [module] }),
    ]);
    expect(passed.pluginsWithMigrations).toBeInstanceOf(Set);
    expect([...(passed.pluginsWithMigrations ?? [])]).toEqual(["fx"]);
  });

  it("logs and returns (does NOT throw) when migrateCore throws", async () => {
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
    expect(a.logger.error).toHaveBeenCalled();
  });
});

/*
 * The migrations at start run before `registerServices` reads anything of the
 * registry, so the start registers what they wrote: nothing is reloaded. What
 * `nextly migrate` does once its migrations have applied (the translation
 * tables, the user fields) is done here instead, before the gate opens.
 */
describe("after the migrations, what nextly migrate does, before the gate opens", () => {
  beforeEach(() => {
    reloadDynamicTables.mockClear();
    _resetBootMigrationsGateForTest();
  });

  it("does it after migrations ran, and reloads nothing", async () => {
    const a = args();
    await runProdMigrationsIfEnabled(a as never);
    expect(a.afterMigrations).toHaveBeenCalledTimes(1);
    expect(reloadDynamicTables).not.toHaveBeenCalled();
  });

  /*
   * On a rolling deploy a second replica waits on the migrate lock, acquires
   * it once the first has finished, and runs against a settled database:
   * `ran` is true while `applied` is 0. `nextly migrate` run then still
   * provisions, so this does too.
   */
  it("does it on a replica that applied nothing", async () => {
    const a = args({
      migrateCore: vi.fn(async () => ({
        applied: 0,
        coreChanged: false,
        ran: true,
      })),
    });
    await runProdMigrationsIfEnabled(a as never);
    expect(a.afterMigrations).toHaveBeenCalledTimes(1);
  });

  it("does not do it when the process refuses to serve", async () => {
    const a = args({
      migrateCore: vi.fn(async () => ({
        applied: 0,
        coreChanged: false,
        ran: false,
      })),
    });
    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toThrow();
    expect(a.afterMigrations).not.toHaveBeenCalled();
  });

  /*
   * A batch that failed part-way stops `nextly migrate` before this work, and
   * the start registers what the committed files left when it reads the
   * registry after this step, so nothing is reloaded on this path either.
   */
  it("does not do it, and reloads nothing, when a batch fails and the app continues", async () => {
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new Error("0003_later.sql failed after 0002 committed");
      }),
    });
    await expect(runProdMigrationsIfEnabled(a as never)).resolves.toBe(false);
    expect(a.afterMigrations).not.toHaveBeenCalled();
    expect(reloadDynamicTables).not.toHaveBeenCalled();
  });

  it("does not do it outside production", async () => {
    process.env.NODE_ENV = "development";
    const a = args();
    await runProdMigrationsIfEnabled(a as never);
    expect(a.afterMigrations).not.toHaveBeenCalled();
  });

  /*
   * 🔴 It runs BEFORE `allowBootMigrations`, so nothing waiting on that gate
   * is released onto a database whose translation tables and user fields are
   * not there yet.
   */
  it("opens the boot gate only after it has finished", async () => {
    // 🔴 The gate is OPENED first, because `awaitBootMigrations` resolves
    // immediately when nothing is pending -- so without this the assertion
    // below is satisfied by there being no gate at all rather than by the
    // ordering it names.
    openBootMigrationsGate();

    // The control for exactly that: the gate must be genuinely pending before
    // the run, or "not yet open during the work" means nothing.
    let openedEarly = false;
    void awaitBootMigrations().then(() => {
      openedEarly = true;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(openedEarly).toBe(false);

    let gateOpenDuringWork: boolean | undefined;
    const a = args({
      afterMigrations: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        gateOpenDuringWork = openedEarly;
      }),
    });

    await runProdMigrationsIfEnabled(a as never);

    expect(gateOpenDuringWork).toBe(false);
    // And it DID open afterwards, or the assertion above would pass on a path
    // that simply never opens the gate.
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
    expect(openedEarly).toBe(true);
  });
});
