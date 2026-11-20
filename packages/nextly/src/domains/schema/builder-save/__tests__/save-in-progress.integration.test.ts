/**
 * A Builder save records that it has started before its first write, and clears the record once
 * it has ended, so a save the process never finished is known to the next start and to the
 * migration commands. The record is a `nextly_meta` row, for the readers with a database, and a
 * marker file in the project's `.nextly/` folder, for the commands that connect to none.
 *
 * A kill is made by letting the step at the kill point run and then never return: no `catch` or
 * `finally` of the save runs, as none would in a process that was killed there. Each write point
 * of the save in turn, in the order the save writes them: a migration file, its snapshot, the
 * definition file, a statement of the file run, the ledger's record of it and the registry row.
 * After each, the row and the marker are there and describe the save, and the definition is as it
 * was until the save's own write of it: a save stopped before then leaves it untouched. A save
 * that ends, written, withdrawn whole or stopped part-way and settled to what applied (MySQL),
 * leaves neither; one that ends with part of it kept and nothing recording what (a MySQL stop
 * whose settle failed) keeps both. A record already standing, from a process that stopped, stays
 * as it was through a later save.
 *
 * The kill is released once the case has looked, so the instance's connections can close.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { consoleLogger } from "../../../../shared/types";
import { MetaService } from "../../../meta/services/meta-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import {
  acquireWriterHold,
  setWriterHoldBounds,
  WRITER_LOCK_FILE,
} from "../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  refuseWhileSaveInProgress,
  refuseWhileSaveLeftPartWay,
} from "../save-in-progress";

/** Where the save is stopped, and how to let it go. Shared with the module mocks below. */
const kill = vi.hoisted(() => ({
  /** Whether the write just made is the one to stop after. */
  at: undefined as undefined | ((point: string) => boolean),
  /** Called once the save has stopped there. */
  reached: undefined as undefined | (() => void),
  /** Ends the stop, so the save unwinds and the instance can close. */
  release: undefined as undefined | (() => void),
  /** Whether a rename about to be made is one to refuse, as a full disk would. */
  refuse: undefined as undefined | ((point: string) => boolean),
  /** Whether a removal about to be made is one to refuse, as a file the process may not touch. */
  refuseRemoving: undefined as undefined | ((path: string) => boolean),
  /** Whether the next registry write is refused before it commits, as a lost connection would. */
  failRegistry: false,
  /** Whether a rename that has just been made reports a failure all the same. */
  failAfter: undefined as undefined | ((point: string) => boolean),
  /** Whether a folder about to be listed is one to refuse, as one the process may not read. */
  refuseReading: undefined as undefined | ((path: string) => boolean),
  /**
   * Run once a file has been written in full under its temporary name (its path), or put in place
   * (`renamed:` and its path), or before one is read (`read:` and its path), as a stalled process
   * would.
   */
  stall: undefined as undefined | ((path: string) => Promise<void>),
}));

/**
 * After a write, stop there for good where it is the kill point: the promise settles only when the
 * case releases it, after it has looked.
 */
const stopHere = vi.hoisted(() => async (point: string): Promise<void> => {
  if (kill.at === undefined || !kill.at(point)) return;
  kill.at = undefined;
  await new Promise<void>((_, reject) => {
    kill.release = () =>
      reject(new Error(`the process was killed after ${point}`));
    kill.reached?.();
  });
});

// The definition and every migration file and snapshot are put in place by a rename.
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const rename: typeof real.rename = async (from, to) => {
    if (kill.refuse?.(`file:${String(to)}`) === true) {
      throw Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      });
    }
    await real.rename(from, to);
    if (kill.failAfter?.(`file:${String(to)}`) === true) {
      kill.failAfter = undefined;
      throw Object.assign(new Error("input/output error"), { code: "EIO" });
    }
    await stopHere(`file:${String(to)}`);
    await kill.stall?.(`renamed:${String(to)}`);
  };
  const rm: typeof real.rm = async (path, options) => {
    if (kill.refuseRemoving?.(String(path)) === true) {
      throw Object.assign(new Error("operation not permitted"), {
        code: "EPERM",
      });
    }
    await real.rm(path, options);
  };
  const readdir = ((
    path: Parameters<typeof real.readdir>[0],
    ...rest: unknown[]
  ) => {
    if (kill.refuseReading?.(String(path)) === true) {
      return Promise.reject(
        Object.assign(new Error("permission denied"), { code: "EACCES" })
      );
    }
    return (real.readdir as (...args: unknown[]) => Promise<unknown>)(
      path,
      ...rest
    );
  }) as typeof real.readdir;
  const writeFile = (async (
    ...args: Parameters<typeof real.writeFile>
  ): Promise<void> => {
    await real.writeFile(...args);
    await kill.stall?.(String(args[0]));
  }) as typeof real.writeFile;
  const readFile = (async (...args: Parameters<typeof real.readFile>) => {
    await kill.stall?.(`read:${String(args[0])}`);
    return real.readFile(...args);
  }) as typeof real.readFile;
  return {
    ...real,
    rename,
    rm,
    readdir,
    writeFile,
    readFile,
    default: { ...real, rename, rm, readdir, writeFile, readFile },
  };
});

// Every registry write of a save goes through these.
vi.mock("../../schema-version", async importOriginal => {
  const real = await importOriginal<typeof import("../../schema-version")>();
  return {
    ...real,
    writeRegistryRows: (async (
      ...args: Parameters<typeof real.writeRegistryRows>
    ) => {
      if (kill.failRegistry) {
        kill.failRegistry = false;
        throw new Error("the registry write was refused");
      }
      const written = await real.writeRegistryRows(...args);
      await stopHere("registry");
      return written;
    }) as typeof real.writeRegistryRows,
    writeRegistryRowsWith: (async (
      ...args: Parameters<typeof real.writeRegistryRowsWith>
    ) => {
      const written = await real.writeRegistryRowsWith(...args);
      await stopHere("registry");
      return written;
    }) as typeof real.writeRegistryRowsWith,
  };
});

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";
const RECORD_KEY_PREFIX = "builder-save-in-progress:";

let current: TestNextly | undefined;
let basePath: string;
/** The save a case stopped, settled (as a failure) once the kill is released. */
let stopped: Promise<unknown> | undefined;

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-save-in-progress-"));
});

afterEach(async () => {
  kill.at = undefined;
  kill.reached = undefined;
  kill.release?.();
  kill.release = undefined;
  kill.refuse = undefined;
  kill.refuseRemoving = undefined;
  kill.failRegistry = false;
  kill.failAfter = undefined;
  kill.refuseReading = undefined;
  kill.stall = undefined;
  await stopped;
  stopped = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
  rmSync(basePath, { recursive: true, force: true });
});

/** A field as the Builder sends it. */
type BuilderField = Record<string, unknown>;
const text = (name: string): BuilderField => ({ name, type: "text" });

/** The registry row's schema version, which a Builder apply sends back. */
async function versionOf(
  t: TestNextly,
  registry: string,
  slug: string
): Promise<number> {
  const [row] = await t.adapter.select<{ schemaVersion: unknown }>(registry, {
    where: { and: [{ column: "slug", op: "=", value: slug }] },
  });
  return Number(row?.schemaVersion ?? 1);
}

interface SavePath {
  name: string;
  /** The kind the record names. */
  kind: "collection" | "single";
  slug: string;
  /** The entity's table. */
  table: string;
  create(fields: BuilderField[]): Promise<unknown>;
  save(t: TestNextly, fields: BuilderField[]): Promise<unknown>;
}

const PATHS: readonly SavePath[] = [
  {
    name: "a collection's Builder apply",
    kind: "collection",
    slug: "sip_posts",
    table: "dc_sip_posts",
    create: fields =>
      dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "sip_posts", label: "sip_posts", fields }
      ),
    save: async (t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "sip_posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_collections", "sip_posts"),
        }
      ),
  },
  {
    name: "a Single's Builder apply",
    kind: "single",
    slug: "sip_hero",
    table: "single_sip_hero",
    create: fields =>
      dispatchSingles(
        "createSingle",
        {},
        { slug: "sip_hero", label: "sip_hero", fields }
      ),
    save: async (t, fields) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "sip_hero" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_singles", "sip_hero"),
        }
      ),
  },
];

/**
 * Watch every statement run on the adapter or a transaction: `before` may throw to refuse it,
 * `after` runs once it has run.
 */
function watchStatements(
  t: TestNextly,
  watch: {
    before?(statement: string): void;
    after?(statement: string): Promise<void>;
  }
): void {
  const adapter = t.adapter;
  const executeQuery = adapter.executeQuery.bind(adapter);
  vi.spyOn(adapter, "executeQuery").mockImplementation(
    async (statement, params) => {
      watch.before?.(statement);
      const result = await executeQuery(statement, params);
      await watch.after?.(statement);
      return result;
    }
  );
  const transaction = adapter.transaction.bind(adapter);
  vi.spyOn(adapter, "transaction").mockImplementation((work, options) =>
    transaction(
      tx =>
        work(
          new Proxy(tx, {
            get(target, key) {
              if (key === "execute") {
                return async (
                  statement: string,
                  params?: Parameters<TransactionContext["execute"]>[1]
                ) => {
                  watch.before?.(statement);
                  const result = await target.execute(statement, params);
                  await watch.after?.(statement);
                  return result;
                };
              }
              const value: unknown = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          })
        ),
      options
    )
  );
}

/** Offer every statement, once it has run, as a kill point named `statement:<its text>`. */
function stopAtStatement(t: TestNextly): void {
  watchStatements(t, {
    after: statement => stopHere(`statement:${statement}`),
  });
}

/** A statement adding `column`, in any dialect's quoting. */
const adding = (column: string) =>
  new RegExp(`ADD (COLUMN )?["\`]${column}["\`]`);

/** Refuse the first statement adding `column`, before it runs. Returns how many it refused. */
function refuseAdding(t: TestNextly, column: string): () => number {
  let refused = 0;
  watchStatements(t, {
    before: statement => {
      if (refused > 0 || !adding(column).test(statement)) return;
      refused += 1;
      throw new Error(`injected failure: ${statement}`);
    },
  });
  return () => refused;
}

/** Stop once the ledger has recorded a file of the save applied, or (`markFailed`) failed. */
function stopAtLedger(
  method: "markApplied" | "markFailed" = "markApplied"
): void {
  const real = SchemaEventsRepository.prototype[method] as (
    this: SchemaEventsRepository,
    ...args: unknown[]
  ) => Promise<unknown>;
  vi.spyOn(SchemaEventsRepository.prototype, method).mockImplementation(
    async function (this: SchemaEventsRepository, ...args: unknown[]) {
      const marked = await real.apply(this, args);
      await stopHere(`ledger:${method}`);
      return marked as never;
    }
  );
}

/** The record's row, decoded as `nextly_meta` is read everywhere, or undefined without one. */
async function recordRow(
  t: TestNextly,
  path: SavePath
): Promise<Record<string, unknown> | null | undefined> {
  const entry = await new MetaService(t.adapter, consoleLogger).getEntry<
    Record<string, unknown>
  >(`${RECORD_KEY_PREFIX}${path.kind}:${path.slug}`);
  // A present row holding null is not a missing one: it answers null, which no case takes for none.
  return entry.present ? (entry.value ?? null) : undefined;
}

const MARKERS = () => join(basePath, ".nextly", "save-in-progress");

/**
 * Every marker of the entity in the project's `.nextly/` folder, one file per record: the `.json`
 * files, as the commands read them, not a temporary copy beside one.
 */
function entityMarkers(path: SavePath): Array<Record<string, unknown>> {
  if (!existsSync(MARKERS())) return [];
  return readdirSync(MARKERS())
    .filter(
      name =>
        name.startsWith(`${path.kind}-${path.slug}-`) && name.endsWith(".json")
    )
    .map(
      name =>
        JSON.parse(readFileSync(join(MARKERS(), name), "utf-8")) as Record<
          string,
          unknown
        >
    );
}

/** The entity's one marker, or undefined without one; two fail the case. */
function recordMarker(path: SavePath): Record<string, unknown> | undefined {
  const markers = entityMarkers(path);
  expect(markers.length, "markers of the entity").toBeLessThanOrEqual(1);
  return markers[0];
}

/** A record as a process stopped on `host` would have left it. */
function stoppedRecord(path: SavePath, host: string): Record<string, unknown> {
  return {
    id: `stopped-on-${host}`,
    kind: path.kind,
    slug: path.slug,
    startedAt: "2026-01-01T00:00:00.000Z",
    host,
    database: "0".repeat(32),
    definitionFile: "schema/builder.json",
    definitionBefore: `the definition as the save on ${host} found it`,
  };
}

/** Put `record` in place as one of the entity's markers. */
function writeMarker(path: SavePath, record: Record<string, unknown>): void {
  mkdirSync(MARKERS(), { recursive: true });
  writeFileSync(
    join(MARKERS(), `${path.kind}-${path.slug}-${String(record.id)}.json`),
    JSON.stringify(record)
  );
}

/** The code `check` refused with, or "none" where it passed. */
async function refusal(check: Promise<void>): Promise<string> {
  try {
    await check;
    return "none";
  } catch (error) {
    return NextlyError.is(error) ? error.code : String(error);
  }
}

/** The marker check the commands with no database make, over this project. */
function markersRefuse(notices: string[] = []): Promise<void> {
  return refuseWhileSaveLeftPartWay({
    projectRoot: basePath,
    notice: line => notices.push(line),
  });
}

/** Every file below `dir`, relative to it. */
function filesBelow(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string, prefix: string) => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory())
        walk(join(at, entry.name), `${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, "");
  return found.sort();
}

/** The columns `table` has in the database `t` runs on. */
async function liveColumns(t: TestNextly, table: string): Promise<string[]> {
  const live = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect,
    [table]
  );
  return (live.tables.find(each => each.name === table)?.columns ?? [])
    .map(column => column.name)
    .sort();
}

/** The definition file's text, or null where there is none yet. */
function definitionText(): string | null {
  const file = join(basePath, DEFINITION);
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
}

/**
 * Whether the stopped save reached its kill point: "reached", or how it ended first, or a time out.
 * A save that ends before its kill point is reported at once, with what it answered.
 */
async function reachedKill(reached: Promise<void>): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>(resolve => {
    timer = setTimeout(() => resolve("timed out"), 120_000);
  });
  try {
    return await Promise.race([
      reached.then(() => "reached"),
      (stopped ?? new Promise<never>(() => undefined)).then(
        answer => `the save ended first: ${String(answer)}`
      ),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether `promise` settles within `ms`. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The kill points, each naming the write it stops after, in the order the save writes them, and
 * whether the definition is still as it was there: the save writes it once its migration files
 * and snapshots are in place.
 */
const KILL_POINTS: ReadonlyArray<{
  name: string;
  arm(t: TestNextly): (point: string) => boolean;
  definitionKept: boolean;
}> = [
  {
    name: "a migration file",
    arm: () => point =>
      point.startsWith(`file:${join(basePath, HISTORY)}`) &&
      point.endsWith(".sql"),
    definitionKept: true,
  },
  {
    name: "a migration file's snapshot",
    arm: () => point =>
      point.startsWith(`file:${join(basePath, HISTORY)}`) &&
      point.endsWith(".snapshot.json"),
    definitionKept: true,
  },
  {
    name: "the definition file",
    arm: () => point => point === `file:${join(basePath, DEFINITION)}`,
    definitionKept: false,
  },
  {
    name: "a statement of the file run",
    arm: t => {
      stopAtStatement(t);
      return point =>
        point.startsWith("statement:") && adding("alpha").test(point);
    },
    definitionKept: false,
  },
  {
    name: "the ledger's record of the file",
    arm: () => {
      stopAtLedger();
      return point => point === "ledger:markApplied";
    },
    definitionKept: false,
  },
  {
    name: "the registry row",
    arm: () => point => point === "registry",
    definitionKept: false,
  },
];

describe.each(getConfiguredTestDialects())(
  "a Builder save's record that it is in progress (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
      });
      return current;
    }

    describe.each(PATHS)("$name", path => {
      it.each(KILL_POINTS)(
        "a kill after $name leaves the row and the marker, both naming the save",
        async ({ arm, definitionKept }) => {
          const t = await boot();
          await path.create([text("heading")]);
          const definitionBefore = definitionText();

          const reached = new Promise<void>(resolve => {
            kill.reached = resolve;
          });
          kill.at = arm(t);
          stopped = path
            .save(t, [text("heading"), text("alpha")])
            .catch((error: unknown) => error);

          expect(
            await reachedKill(reached),
            "the save never reached the kill point"
          ).toBe("reached");

          // The definition is replaced only once the migration files and snapshots are in place.
          if (definitionKept) {
            expect(
              definitionText(),
              "the definition, before the save's write of it"
            ).toBe(definitionBefore);
          } else {
            expect(
              definitionText(),
              "the definition, after the save's write of it"
            ).toContain('"alpha"');
          }

          const row = await recordRow(t, path);
          const marker = recordMarker(path);
          expect(row, "the record's row").toBeDefined();
          expect(marker, "the record's marker").toBeDefined();
          // The two are one record, which names the save, where it ran and what it started from.
          expect(marker).toEqual(row);
          expect(row).toMatchObject({
            kind: path.kind,
            slug: path.slug,
            host: hostname(),
            definitionBefore,
          });
          // The harness hands its adapter in, so where the database is cannot be told: the
          // record says so, never a URL, and the marker check takes it as this database's.
          expect(row?.database).toBe("unknown");

          // Both readers refuse: `nextly migrate` by the row, the commands with no database by
          // the marker, which this host and this database wrote.
          expect(await refusal(refuseWhileSaveInProgress(t.adapter))).toBe(
            "CONFLICT"
          );
          expect(await refusal(markersRefuse())).toBe("CONFLICT");
        },
        300_000
      );

      it("a save that ends leaves neither the row nor the marker", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        expect(await recordRow(t, path), "after the create").toBeUndefined();
        expect(recordMarker(path), "after the create").toBeUndefined();

        expect(definitionText(), "alpha before the save").not.toContain(
          '"alpha"'
        );
        const answer = await path.save(t, [text("heading"), text("alpha")]);
        expect(answer instanceof Response ? answer.ok : true).toBe(true);
        // The save did what it was asked: its definition names the new field, and its table has it.
        expect(definitionText(), "alpha after the save").toContain('"alpha"');
        expect(await liveColumns(t, path.table)).toContain("alpha");
        expect(await recordRow(t, path)).toBeUndefined();
        expect(recordMarker(path)).toBeUndefined();
        expect(await refusal(refuseWhileSaveInProgress(t.adapter))).toBe(
          "none"
        );
        expect(await refusal(markersRefuse())).toBe("none");
      }, 300_000);

      it("a save refused at its statement, withdrawn whole, leaves neither the row nor the marker", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const refused = refuseAdding(t, "alpha");

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        expect(refused(), "no statement adding `alpha` was met").toBe(1);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(await recordRow(t, path)).toBeUndefined();
        expect(recordMarker(path)).toBeUndefined();
      }, 300_000);

      // A definition that cannot be replaced stays whole, and nothing else of the save is written
      // yet: there is nothing to settle, so the record goes with the save's failure.
      it("a save whose definition cannot be written leaves neither the row nor the marker", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const definitionBefore = definitionText();
        const folderBefore = filesBelow(join(basePath, HISTORY));
        let refused = 0;
        kill.refuse = point => {
          if (point !== `file:${join(basePath, DEFINITION)}`) return false;
          refused += 1;
          return true;
        };

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        kill.refuse = undefined;
        expect(refused, "the definition's write was never made").toBe(1);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(definitionText()).toBe(definitionBefore);
        // The migration files and snapshots written before it are taken back with it: nothing of
        // the save is left for a later `nextly migrate` or `migrate:create`.
        expect(filesBelow(join(basePath, HISTORY))).toEqual(folderBefore);
        expect(await recordRow(t, path)).toBeUndefined();
        expect(recordMarker(path)).toBeUndefined();
      }, 300_000);

      // A definition rename the file system made and then reported failed: the new definition is
      // in place, so the withdrawal puts the old one back, with the save's files taken back too.
      it("a save whose definition rename reports a failure after it was made puts the definition back", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const definitionBefore = definitionText();
        const folderBefore = filesBelow(join(basePath, HISTORY));
        let failed = 0;
        kill.failAfter = point => {
          if (point !== `file:${join(basePath, DEFINITION)}`) return false;
          failed += 1;
          return true;
        };

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        expect(failed, "the definition's rename was never made").toBe(1);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(definitionText(), "the definition").toBe(definitionBefore);
        expect(
          filesBelow(join(basePath, HISTORY)).filter(f => !f.endsWith(".lock")),
          "the migration folder"
        ).toEqual(folderBefore.filter(f => !f.endsWith(".lock")));
        expect(await recordRow(t, path), "the record's row").toBeUndefined();
        expect(recordMarker(path), "the record's marker").toBeUndefined();
      }, 300_000);

      // MySQL keeps the statements before a failing one, and the save settles to what applied: its
      // stopped file is replaced by one for the applied changes, then the definition is brought to
      // that shape. Killed between the two, the record stands, with the definition the save
      // started from, so the stop is settled again from the live tables.
      it.runIf(dialect === "mysql")(
        "a settle killed after its replacement file, before its definition, keeps the record",
        async () => {
          const t = await boot();
          await path.create([text("heading")]);
          const definitionBefore = definitionText();
          const refused = refuseAdding(t, "beta");
          let placed = 0;
          const reached = new Promise<void>(resolve => {
            kill.reached = resolve;
          });
          // The save's own file is the first migration file put in place; the settle's
          // replacement, the second.
          kill.at = point => {
            if (
              !point.startsWith(`file:${join(basePath, HISTORY)}`) ||
              !point.endsWith(".sql")
            ) {
              return false;
            }
            placed += 1;
            return placed === 2;
          };
          stopped = path
            .save(t, [text("heading"), text("alpha"), text("beta")])
            .catch((error: unknown) => error);

          expect(
            await reachedKill(reached),
            "the settle never put its replacement in place"
          ).toBe("reached");
          expect(refused(), "no statement adding `beta` was met").toBe(1);
          const row = await recordRow(t, path);
          expect(row, "the record's row").toBeDefined();
          expect(recordMarker(path), "the record's marker").toEqual(row);
          expect(row).toMatchObject({
            kind: path.kind,
            slug: path.slug,
            definitionBefore,
          });
        },
        300_000
      );

      // A marker linked in place whose temporary copy then cannot be removed: the placing failed,
      // so the marker goes again with the row, and nothing of the save stands.
      it("a marker whose temporary copy cannot be removed is taken back with its row", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const definitionBefore = definitionText();
        let refused = 0;
        kill.refuseRemoving = target => {
          if (!target.startsWith(MARKERS()) || !target.endsWith(".tmp"))
            return false;
          refused += 1;
          return true;
        };

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        kill.refuseRemoving = undefined;
        expect(refused, "no temporary marker copy was removed").toBeGreaterThan(
          0
        );
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(definitionText()).toBe(definitionBefore);
        expect(await recordRow(t, path)).toBeUndefined();
        expect(entityMarkers(path)).toEqual([]);
      }, 300_000);

      // A row of a stopped save whose process stopped before its marker: the next save puts the
      // marker back before it goes on, so the commands with no database see the part-way save.
      it("a standing record without its marker gets it back before a later save goes on", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        // Left on this host, by an app handed its adapter as this one is: the marker refuses here.
        const left = {
          ...stoppedRecord(path, "a-stopped-host"),
          host: hostname(),
          database: "unknown",
        };
        await new MetaService(t.adapter, consoleLogger).set(
          `${RECORD_KEY_PREFIX}${path.kind}:${path.slug}`,
          left
        );
        expect(entityMarkers(path), "a marker before the save").toEqual([]);

        const answer = await path.save(t, [text("heading"), text("alpha")]);
        expect(answer instanceof Response ? answer.ok : true, "the save").toBe(
          true
        );
        expect(await recordRow(t, path)).toEqual(left);
        expect(entityMarkers(path)).toEqual([left]);
        expect(await refusal(markersRefuse())).toBe("CONFLICT");
      }, 300_000);

      // A row that is not a save's record still stands for one: both readers refuse, and a save of
      // the entity is refused rather than written over a state no one can tell.
      it("a standing record that cannot be read refuses the database check and a later save", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        await new MetaService(t.adapter, consoleLogger).set(
          `${RECORD_KEY_PREFIX}${path.kind}:${path.slug}`,
          null
        );

        expect(await refusal(refuseWhileSaveInProgress(t.adapter))).toBe(
          "CONFLICT"
        );
        const definitionBefore = definitionText();
        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(definitionText()).toBe(definitionBefore);
      }, 300_000);

      // A save stalled past its lease once its files are written, with another writer taking the
      // folder meanwhile, no longer owns it: its definition is not written, and its files stay,
      // since a migration file in the folder may already be applied.
      it("a save overtaken before its definition leaves its files and the definition as they were", async () => {
        const restoreBounds = setWriterHoldBounds({
          waitMs: 30_000,
          leaseSeconds: 1,
          // Never inside the case: the stalled save is not renewing.
          renewMs: 600_000,
        });
        try {
          const t = await boot();
          await path.create([text("heading")]);
          const definitionBefore = definitionText();
          const sqlBefore = filesBelow(join(basePath, HISTORY)).filter(f =>
            f.endsWith(".sql")
          );
          let overtaken = false;
          kill.stall = async written => {
            if (overtaken || !written.startsWith(join(basePath, DEFINITION))) {
              return;
            }
            overtaken = true;
            await new Promise(resolve => setTimeout(resolve, 1_200));
            const other = await acquireWriterHold({
              migrationsDir: join(basePath, HISTORY),
              command: "migrate:create",
              whenHeld: "wait",
            });
            await other.release();
          };

          const answer = await path
            .save(t, [text("heading"), text("alpha")])
            .catch((error: unknown) => error);
          kill.stall = undefined;
          expect(
            overtaken,
            "the save never stalled before its definition"
          ).toBe(true);
          expect(
            answer instanceof Response ? answer.ok : !(answer instanceof Error),
            "the save was not refused"
          ).toBe(false);
          expect(definitionText(), "the definition").toBe(definitionBefore);
          const left = filesBelow(join(basePath, HISTORY)).filter(
            f => f.endsWith(".sql") && !sqlBefore.includes(f)
          );
          expect(left, "the save's migration file, left in place").toHaveLength(
            1
          );
          expect(await recordRow(t, path), "the record's row").toBeDefined();
        } finally {
          restoreBounds();
        }
      }, 300_000);

      /**
       * Stall the save past its 1 s lease where `at` first matches a stall point, and take the
       * migration folder as another writer meanwhile. Answers whether it stalled.
       */
      function overtakeAt(at: (point: string) => boolean): () => boolean {
        let overtaken = false;
        kill.stall = async point => {
          if (overtaken || !at(point)) return;
          overtaken = true;
          await new Promise(resolve => setTimeout(resolve, 1_200));
          const other = await acquireWriterHold({
            migrationsDir: join(basePath, HISTORY),
            command: "migrate:create",
            whenHeld: "wait",
          });
          await other.release();
        };
        return () => overtaken;
      }

      // Its generation published the migration file and was then refused as overtaken, before
      // naming the file to the save: the file is in the folder, so the record stays with it.
      it("a save overtaken once its migration file was put in place keeps its record, the file left", async () => {
        const restoreBounds = setWriterHoldBounds({
          waitMs: 30_000,
          leaseSeconds: 1,
          renewMs: 600_000,
        });
        try {
          const t = await boot();
          await path.create([text("heading")]);
          const definitionBefore = definitionText();
          const sqlBefore = filesBelow(join(basePath, HISTORY)).filter(f =>
            f.endsWith(".sql")
          );
          // The save's migration file, just put in place.
          const stalled = overtakeAt(
            point =>
              point.startsWith(`renamed:${join(basePath, HISTORY)}`) &&
              point.endsWith(".sql")
          );

          const answer = await path
            .save(t, [text("heading"), text("alpha")])
            .catch((error: unknown) => error);
          kill.stall = undefined;
          expect(
            stalled(),
            "the save never stalled on its migration file"
          ).toBe(true);
          expect(
            answer instanceof Response ? answer.ok : !(answer instanceof Error),
            "the save was not refused"
          ).toBe(false);
          expect(definitionText(), "the definition").toBe(definitionBefore);
          expect(
            filesBelow(join(basePath, HISTORY)).filter(
              f => f.endsWith(".sql") && !sqlBefore.includes(f)
            ),
            "the save's migration file, left in place"
          ).toHaveLength(1);
          expect(await recordRow(t, path), "the record's row").toBeDefined();
          expect(recordMarker(path), "the record's marker").toBeDefined();
        } finally {
          restoreBounds();
        }
      }, 300_000);

      // On MySQL a save that stops part way is settled to what applied: its stopped file is
      // replaced by one for the applied changes. A settle overtaken once that replacement was put
      // in place, before its generation named it, leaves the replacement and does not write the
      // stopped file back beside it: the folder holds one migration of the save, not two.
      it.runIf(dialect === "mysql")(
        "a settle overtaken once its replacement was put in place does not put the stopped file back beside it",
        async () => {
          const restoreBounds = setWriterHoldBounds({
            waitMs: 30_000,
            leaseSeconds: 1,
            renewMs: 600_000,
          });
          try {
            const t = await boot();
            await path.create([text("heading")]);
            const sqlBefore = filesBelow(join(basePath, HISTORY)).filter(f =>
              f.endsWith(".sql")
            );
            const refused = refuseAdding(t, "beta");
            // The save's own file is the first migration file put in place; the settle's
            // replacement, the second.
            let placed = 0;
            const stalled = overtakeAt(point => {
              if (
                !point.startsWith(`renamed:${join(basePath, HISTORY)}`) ||
                !point.endsWith(".sql")
              ) {
                return false;
              }
              placed += 1;
              return placed === 2;
            });

            const answer = await path
              .save(t, [text("heading"), text("alpha"), text("beta")])
              .catch((error: unknown) => error);
            kill.stall = undefined;
            expect(refused(), "no statement adding `beta` was met").toBe(1);
            expect(
              stalled(),
              "the settle never stalled on its replacement"
            ).toBe(true);
            expect(
              answer instanceof Response
                ? answer.ok
                : !(answer instanceof Error),
              "the save was not refused"
            ).toBe(false);
            expect(
              filesBelow(join(basePath, HISTORY)).filter(
                f => f.endsWith(".sql") && !sqlBefore.includes(f)
              ),
              "the save's migration files"
            ).toHaveLength(1);
            expect(await recordRow(t, path), "the record's row").toBeDefined();
          } finally {
            restoreBounds();
          }
        },
        300_000
      );

      // A settle overtaken while it generates its replacement, by a writer whose own migration
      // happens to share the replacement's name: nothing tells the two apart, so the stopped file is
      // kept, set aside, never deleted, and the record stays for the stop to be settled again.
      it.runIf(dialect === "mysql")(
        "a settle overtaken by a writer of a same-named migration keeps the stopped file",
        async () => {
          const restoreBounds = setWriterHoldBounds({
            waitMs: 30_000,
            leaseSeconds: 1,
            renewMs: 600_000,
          });
          try {
            const t = await boot();
            await path.create([text("heading")]);
            const refused = refuseAdding(t, "beta");
            const history = join(basePath, HISTORY);
            // The save's own file, the first migration file put in place.
            let stoppedFile: string | undefined;
            let overtaken = false;
            kill.stall = async point => {
              if (
                stoppedFile === undefined &&
                point.startsWith(`renamed:${history}`) &&
                point.endsWith(".sql")
              ) {
                stoppedFile = point.slice(`renamed:${history}/`.length);
                return;
              }
              // The settle's generation writing its replacement in full, once the save's own file
              // has stopped at its statement: stalled past the lease while another writer takes
              // the folder and writes a migration of the same name.
              if (
                stoppedFile === undefined ||
                refused() === 0 ||
                overtaken ||
                !point.startsWith(history) ||
                !point.endsWith(".tmp")
              ) {
                return;
              }
              overtaken = true;
              await new Promise(resolve => setTimeout(resolve, 1_200));
              const other = await acquireWriterHold({
                migrationsDir: history,
                command: "migrate:create",
                whenHeld: "wait",
              });
              writeFileSync(
                join(history, `29991231_235959_999_${path.slug}_update.sql`),
                "-- UP\n-- DOWN\n"
              );
              await other.release();
            };

            const answer = await path
              .save(t, [text("heading"), text("alpha"), text("beta")])
              .catch((error: unknown) => error);
            kill.stall = undefined;
            expect(refused(), "no statement adding `beta` was met").toBe(1);
            expect(overtaken, "the settle was never overtaken").toBe(true);
            expect(
              answer instanceof Response
                ? answer.ok
                : !(answer instanceof Error),
              "the save was not refused"
            ).toBe(false);
            // The stopped file is in the folder, put back or set aside, never deleted.
            const files = filesBelow(history);
            expect(
              files.some(
                f => f === stoppedFile || f.startsWith(`${stoppedFile}.`)
              ),
              `the stopped file ${stoppedFile}, among ${files.join(", ")}`
            ).toBe(true);
            expect(await recordRow(t, path), "the record's row").toBeDefined();
          } finally {
            restoreBounds();
          }
        },
        300_000
      );

      // A settle stalled past its lease while it judges the stop, with another writer holding the
      // folder by the time it would set the stopped file aside: it no longer owns the folder, so it
      // renames nothing in it, and the stop stays as the save left it with its record.
      it.runIf(dialect === "mysql")(
        "a settle overtaken before it sets the stopped file aside moves nothing in the folder",
        async () => {
          const restoreBounds = setWriterHoldBounds({
            waitMs: 30_000,
            leaseSeconds: 1,
            renewMs: 600_000,
          });
          const history = join(basePath, HISTORY);
          let other: Awaited<ReturnType<typeof acquireWriterHold>> | undefined;
          try {
            const t = await boot();
            await path.create([text("heading")]);
            const refused = refuseAdding(t, "beta");
            const definition = join(basePath, DEFINITION);
            // Every migration file and snapshot put in place while the other writer holds it. The
            // hold's own file is left out: the save giving up its hold moves it aside to judge it,
            // and puts it back as the other writer's.
            const movedUnderOther: string[] = [];
            kill.stall = async point => {
              if (other !== undefined) {
                if (
                  point.startsWith(`renamed:${history}`) &&
                  !point.includes(WRITER_LOCK_FILE)
                ) {
                  movedUnderOther.push(
                    point.slice(`renamed:${history}/`.length)
                  );
                }
                return;
              }
              // The settle reading the definition, once the save has stopped at its statement:
              // stalled past the lease, and the folder taken and held by another writer.
              if (refused() === 0 || point !== `read:${definition}`) return;
              await new Promise(resolve => setTimeout(resolve, 1_200));
              other = await acquireWriterHold({
                migrationsDir: history,
                command: "migrate:create",
                whenHeld: "wait",
              });
            };
            const sqlBefore = filesBelow(history).filter(f =>
              f.endsWith(".sql")
            );

            const answer = await path
              .save(t, [text("heading"), text("alpha"), text("beta")])
              .catch((error: unknown) => error);
            kill.stall = undefined;
            expect(refused(), "no statement adding `beta` was met").toBe(1);
            expect(other, "the settle was never overtaken").toBeDefined();
            expect(
              answer instanceof Response
                ? answer.ok
                : !(answer instanceof Error),
              "the save was not refused"
            ).toBe(false);
            expect(
              movedUnderOther,
              "files moved under the other writer"
            ).toEqual([]);
            // The save's own file, under its own name.
            expect(
              filesBelow(history).filter(
                f => !sqlBefore.includes(f) && f.includes(".sql")
              ),
              "the save's migration files"
            ).toEqual([expect.stringMatching(/\.sql$/)]);
            expect(await recordRow(t, path), "the record's row").toBeDefined();
          } finally {
            kill.stall = undefined;
            await other?.release();
            restoreBounds();
          }
        },
        300_000
      );

      it("a save overtaken before it put any file in place withdraws its record, with nothing written", async () => {
        const restoreBounds = setWriterHoldBounds({
          waitMs: 30_000,
          leaseSeconds: 1,
          renewMs: 600_000,
        });
        try {
          const t = await boot();
          await path.create([text("heading")]);
          const definitionBefore = definitionText();
          const before = filesBelow(join(basePath, HISTORY));
          // The first file the save writes in full, before it puts any in place.
          const stalled = overtakeAt(
            point =>
              point.startsWith(join(basePath, HISTORY)) &&
              point.endsWith(".tmp")
          );

          const answer = await path
            .save(t, [text("heading"), text("alpha")])
            .catch((error: unknown) => error);
          kill.stall = undefined;
          expect(stalled(), "the save never stalled on its first file").toBe(
            true
          );
          expect(
            answer instanceof Response ? answer.ok : !(answer instanceof Error),
            "the save was not refused"
          ).toBe(false);
          expect(definitionText(), "the definition").toBe(definitionBefore);
          expect(
            filesBelow(join(basePath, HISTORY)).filter(
              f => !f.endsWith(".lock")
            ),
            "the migration folder"
          ).toEqual(before.filter(f => !f.endsWith(".lock")));
          // Nothing to settle: the record goes with the refusal.
          expect(await recordRow(t, path), "the record's row").toBeUndefined();
          expect(recordMarker(path), "the record's marker").toBeUndefined();
        } finally {
          restoreBounds();
        }
      }, 300_000);

      it("a save overtaken as it puts its definition in place is refused, with its files and definition left", async () => {
        const restoreBounds = setWriterHoldBounds({
          waitMs: 30_000,
          leaseSeconds: 1,
          renewMs: 600_000,
        });
        try {
          const t = await boot();
          await path.create([text("heading")]);
          const sqlBefore = filesBelow(join(basePath, HISTORY)).filter(f =>
            f.endsWith(".sql")
          );
          const stalled = overtakeAt(
            point => point === `renamed:${join(basePath, DEFINITION)}`
          );

          const answer = await path
            .save(t, [text("heading"), text("alpha")])
            .catch((error: unknown) => error);
          kill.stall = undefined;
          expect(stalled(), "the save never stalled on its definition").toBe(
            true
          );
          // Found out after the rename, and refused rather than taken for a whole save.
          expect(
            answer instanceof Response ? answer.ok : !(answer instanceof Error),
            "the save was not refused"
          ).toBe(false);
          expect(definitionText(), "the definition it wrote").toContain(
            '"alpha"'
          );
          expect(
            filesBelow(join(basePath, HISTORY)).filter(
              f => f.endsWith(".sql") && !sqlBefore.includes(f)
            ),
            "the save's migration file, left in place"
          ).toHaveLength(1);
          expect(await recordRow(t, path), "the record's row").toBeDefined();
        } finally {
          restoreBounds();
        }
      }, 300_000);

      // A migration file put in place whose writing then fails, which its generation takes back
      // no further, is in the folder though the save never named it: the record stays.
      it("a failed write that leaves a migration file behind keeps the record", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const sqlBefore = filesBelow(join(basePath, HISTORY)).filter(f =>
          f.endsWith(".sql")
        );
        let failed = 0;
        kill.failAfter = point => {
          if (
            !point.startsWith(`file:${join(basePath, HISTORY)}`) ||
            !point.endsWith(".sql")
          )
            return false;
          failed += 1;
          return true;
        };
        // And taking it back fails too, as a file the process may not remove: it stays in place.
        kill.refuseRemoving = target =>
          target.startsWith(join(basePath, HISTORY)) && target.endsWith(".sql");

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        expect(failed, "no migration file was put in place").toBe(1);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        const left = filesBelow(join(basePath, HISTORY)).filter(
          f => f.endsWith(".sql") && !sqlBefore.includes(f)
        );
        expect(left, "the file left in the folder").toHaveLength(1);

        expect(await refusal(refuseWhileSaveInProgress(t.adapter))).toBe(
          "CONFLICT"
        );
        expect(recordMarker(path), "the record's marker").toBeDefined();
      }, 300_000);

      // The migrations folder is read for what is there before the save, right after its record:
      // a read that fails then has written nothing, so the definition stays as it was and the
      // record goes with the save's failure.
      it("a save whose migrations folder cannot be read leaves the definition as it was", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const definitionBefore = definitionText();
        let refused = 0;
        // Refused once the save has made its record, so the read refused is the save's own.
        kill.refuseReading = target => {
          if (
            target !== join(basePath, HISTORY) ||
            entityMarkers(path).length === 0
          )
            return false;
          refused += 1;
          return true;
        };

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        kill.refuseReading = undefined;
        expect(
          refused,
          "the folder was never read after the record"
        ).toBeGreaterThan(0);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(definitionText()).toBe(definitionBefore);
        expect(await recordRow(t, path)).toBeUndefined();
        expect(entityMarkers(path)).toEqual([]);
      }, 300_000);

      // MySQL commits each statement as it runs, so a save refused at its second addition keeps
      // the first. The save settles to what applied, its outcome recorded, so its record clears.
      it.runIf(dialect === "mysql")(
        "a save stopped part-way on MySQL and settled to what applied clears the row and the marker",
        async () => {
          const t = await boot();
          await path.create([text("heading")]);
          const refused = refuseAdding(t, "beta");

          const answer = await path
            .save(t, [text("heading"), text("alpha"), text("beta")])
            .catch((error: unknown) => error);
          expect(refused(), "no statement adding `beta` was met").toBe(1);
          expect(
            answer instanceof Response ? answer.ok : !(answer instanceof Error),
            "the save was not refused"
          ).toBe(false);
          const live = await liveColumns(t, path.table);
          expect(live, "alpha committed before beta failed").toContain("alpha");
          expect(live, "beta never added").not.toContain("beta");

          expect(await recordRow(t, path), "the record's row").toBeUndefined();
          expect(entityMarkers(path), "the record's marker").toEqual([]);
        },
        300_000
      );

      // Where recording what applied fails too, nothing records what committed: the record stays
      // for the next start to settle.
      it.runIf(dialect === "mysql")(
        "a save stopped part-way on MySQL whose settle fails keeps the row and the marker",
        async () => {
          const t = await boot();
          await path.create([text("heading")]);
          const definitionBefore = definitionText();
          const refused = refuseAdding(t, "beta");
          // Once the save's own statement failed, the ledger refuses the settle's record.
          const markApplied = SchemaEventsRepository.prototype.markApplied;
          vi.spyOn(
            SchemaEventsRepository.prototype,
            "markApplied"
          ).mockImplementation(async function (
            this: SchemaEventsRepository,
            ...args: Parameters<typeof markApplied>
          ) {
            if (refused() > 0) throw new Error("injected ledger failure");
            return markApplied.apply(this, args);
          });

          const answer = await path
            .save(t, [text("heading"), text("alpha"), text("beta")])
            .catch((error: unknown) => error);
          expect(refused(), "no statement adding `beta` was met").toBe(1);
          expect(
            answer instanceof Response ? answer.ok : !(answer instanceof Error),
            "the save was not refused"
          ).toBe(false);

          // The stop came after a committed change: alpha is in the table, beta is not.
          const live = await liveColumns(t, path.table);
          expect(live, "alpha committed before beta failed").toContain("alpha");
          expect(live, "beta never added").not.toContain("beta");

          const row = await recordRow(t, path);
          expect(row, "the record's row").toBeDefined();
          expect(recordMarker(path), "the record's marker").toEqual(row);
          expect(row).toMatchObject({
            kind: path.kind,
            slug: path.slug,
            definitionBefore,
          });
        },
        300_000
      );

      it.runIf(dialect === "mysql")(
        "a kill in the ledger's record of a part-way stop on MySQL leaves the row and the marker",
        async () => {
          const t = await boot();
          await path.create([text("heading")]);
          const refused = refuseAdding(t, "beta");
          stopAtLedger("markFailed");
          const reached = new Promise<void>(resolve => {
            kill.reached = resolve;
          });
          kill.at = point => point === "ledger:markFailed";
          stopped = path
            .save(t, [text("heading"), text("alpha"), text("beta")])
            .catch((error: unknown) => error);

          expect(
            await reachedKill(reached),
            "the save never recorded its failure in the ledger"
          ).toBe("reached");
          expect(refused(), "no statement adding `beta` was met").toBe(1);
          const row = await recordRow(t, path);
          expect(row, "the record's row").toBeDefined();
          expect(recordMarker(path), "the record's marker").toEqual(row);
        },
        300_000
      );

      // Nothing settles a record yet, so a later save leaves one it finds as it was: the stopped
      // save's record, its definition text included, is what settling it reads.
      it("a record left by a stopped process stays as it was through a later save", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const left = stoppedRecord(path, "a-stopped-host");
        await new MetaService(t.adapter, consoleLogger).set(
          `${RECORD_KEY_PREFIX}${path.kind}:${path.slug}`,
          left
        );
        writeMarker(path, left);

        const answer = await path.save(t, [text("heading"), text("alpha")]);
        expect(answer instanceof Response ? answer.ok : true, "the save").toBe(
          true
        );
        expect(await recordRow(t, path)).toEqual(left);
        expect(recordMarker(path)).toEqual(left);
      }, 300_000);

      // A project that commits `.nextly/` carries markers from other machines, whose records are
      // in their own databases: a save here leaves such a marker as it was.
      it("a marker from another machine, with no row here, stays as it was through a later save", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const theirs = stoppedRecord(path, "another-machine");
        writeMarker(path, theirs);

        const answer = await path.save(t, [text("heading"), text("alpha")]);
        expect(answer instanceof Response ? answer.ok : true, "the save").toBe(
          true
        );
        expect(recordMarker(path)).toEqual(theirs);
        expect(await recordRow(t, path)).toBeUndefined();
        // Another machine's save is a line of notice here, never a refusal.
        const notices: string[] = [];
        expect(await refusal(markersRefuse(notices))).toBe("none");
        expect(notices).toEqual([expect.stringContaining("another-machine")]);
      }, 300_000);

      // Another machine's marker takes no place this save needs: killed, the save leaves its own
      // marker beside it, and the commands with no database refuse for this database.
      it("a kill beside another machine's marker leaves this save's marker, which refuses", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const theirs = stoppedRecord(path, "another-machine");
        writeMarker(path, theirs);

        const reached = new Promise<void>(resolve => {
          kill.reached = resolve;
        });
        kill.at = point => point === `file:${join(basePath, DEFINITION)}`;
        stopped = path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        expect(
          await reachedKill(reached),
          "the save never reached the kill point"
        ).toBe("reached");

        const row = await recordRow(t, path);
        expect(row, "the record's row").toBeDefined();
        const markers = entityMarkers(path);
        expect(markers).toHaveLength(2);
        expect(markers).toEqual(expect.arrayContaining([theirs, row]));
        const notices: string[] = [];
        expect(await refusal(markersRefuse(notices))).toBe("CONFLICT");
        expect(notices).toEqual([expect.stringContaining("another-machine")]);
      }, 300_000);

      // The marker is written before anything of the save: where it cannot be, the row goes too
      // and the save is refused, so no row stands for a save the commands with no database miss.
      it("a marker that cannot be placed takes its row with it, and the save writes nothing", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const definitionBefore = definitionText();
        // A file where the folder goes (the create's own record made the folder, so it goes
        // first): the marker's folder cannot be made.
        rmSync(join(basePath, ".nextly"), { recursive: true, force: true });
        writeFileSync(join(basePath, ".nextly"), "");

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(await recordRow(t, path)).toBeUndefined();
        expect(definitionText()).toBe(definitionBefore);

        // With the folder possible again, the next save makes and clears its record as ever.
        rmSync(join(basePath, ".nextly"));
        const again = await path.save(t, [text("heading"), text("alpha")]);
        expect(
          again instanceof Response ? again.ok : true,
          "the next save"
        ).toBe(true);
        expect(await recordRow(t, path)).toBeUndefined();
        expect(recordMarker(path)).toBeUndefined();
      }, 300_000);
    });
  }
);

/** Whether a dispatcher's answer says the operation succeeded: a Response's status, else no error. */
function succeeded(answer: unknown): boolean {
  if (answer instanceof Response) return answer.ok;
  if (answer instanceof Error) return false;
  // A service result answers its own outcome.
  return (answer as { success?: unknown } | null)?.success !== false;
}

/** One Builder save or delete that succeeds, after `setup` made its entity. */
interface SucceedingPath {
  name: string;
  setup(): Promise<unknown>;
  run(t: TestNextly): Promise<unknown>;
}

const heading = [text("heading")];
const headingAndAlpha = [text("heading"), text("alpha")];

const createPosts = () =>
  dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    {
      name: "sip_all_posts",
      label: "sip_all_posts",
      fields: heading,
    }
  );
const createHero = () =>
  dispatchSingles(
    "createSingle",
    {},
    {
      slug: "sip_all_hero",
      label: "sip_all_hero",
      fields: heading,
    }
  );
const createCard = () =>
  dispatchComponents(
    "createComponent",
    {},
    {
      slug: "sip_all_card",
      label: "sip_all_card",
      fields: heading,
    }
  );

/**
 * Every Builder save and delete of a collection, a Single and a field group, as the admin and the
 * REST routes reach them: the create, the dialog's apply, the push or schema save with a field
 * added, the save of settings alone, and the delete.
 */
const SUCCEEDING: readonly SucceedingPath[] = [
  {
    name: "a collection's create",
    setup: () => Promise.resolve(),
    run: createPosts,
  },
  {
    name: "a collection's dialog apply",
    setup: createPosts,
    run: async t =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "sip_all_posts" },
        {
          fields: headingAndAlpha,
          confirmed: true,
          schemaVersion: await versionOf(
            t,
            "dynamic_collections",
            "sip_all_posts"
          ),
        }
      ),
  },
  {
    name: "a collection's update with a field added (the push)",
    setup: createPosts,
    run: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "sip_all_posts" },
        { fields: headingAndAlpha }
      ),
  },
  {
    name: "a collection's update of its settings alone",
    setup: createPosts,
    run: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "sip_all_posts" },
        { label: "Posts renamed" }
      ),
  },
  {
    name: "a collection's delete",
    setup: createPosts,
    run: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "deleteCollection",
        { collectionName: "sip_all_posts" },
        {}
      ),
  },
  {
    name: "a Single's create",
    setup: () => Promise.resolve(),
    run: createHero,
  },
  {
    name: "a Single's dialog apply",
    setup: createHero,
    run: async t =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "sip_all_hero" },
        {
          fields: headingAndAlpha,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_singles", "sip_all_hero"),
        }
      ),
  },
  {
    name: "a Single's schema save with a field added",
    setup: createHero,
    run: () =>
      dispatchSingles(
        "updateSingleSchema",
        { slug: "sip_all_hero" },
        { fields: headingAndAlpha }
      ),
  },
  {
    name: "a Single's schema save of its settings alone",
    setup: createHero,
    run: () =>
      dispatchSingles(
        "updateSingleSchema",
        { slug: "sip_all_hero" },
        { label: "Hero renamed" }
      ),
  },
  {
    name: "a Single's delete",
    setup: createHero,
    run: () => dispatchSingles("deleteSingle", { slug: "sip_all_hero" }, {}),
  },
  {
    name: "a field group's create",
    setup: () => Promise.resolve(),
    run: createCard,
  },
  {
    name: "a field group's dialog apply",
    setup: createCard,
    run: async t =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "sip_all_card" },
        {
          fields: headingAndAlpha,
          confirmed: true,
          schemaVersion: await versionOf(
            t,
            "dynamic_field_groups",
            "sip_all_card"
          ),
        }
      ),
  },
  // A field group's field changes that need a statement go through the dialog's apply; its update
  // takes the ones that need none.
  {
    name: "a field group's update of a field that needs no statement",
    setup: createCard,
    run: () =>
      dispatchComponents(
        "updateComponent",
        { slug: "sip_all_card" },
        { fields: [{ name: "heading", type: "text", label: "Heading shown" }] }
      ),
  },
  {
    name: "a field group's update of its settings alone",
    setup: createCard,
    run: () =>
      dispatchComponents(
        "updateComponent",
        { slug: "sip_all_card" },
        { label: "Card renamed" }
      ),
  },
  {
    name: "a field group's delete",
    setup: createCard,
    run: () =>
      dispatchComponents("deleteComponent", { slug: "sip_all_card" }, {}),
  },
];

/** Every marker file in the project, of any entity. */
function anyMarkers(): string[] {
  if (!existsSync(MARKERS())) return [];
  return readdirSync(MARKERS()).filter(name => name.endsWith(".json"));
}

/**
 * A record clears only once the save's outcome is recorded: a record left by a save that succeeded
 * would refuse the commands later for nothing. Each path that succeeds leaves neither a row nor a
 * marker; a path that writes no registry row clears its record explicitly.
 */
describe.each(getConfiguredTestDialects())(
  "every Builder save and delete that succeeds leaves no record (%s)",
  (dialect: TestDialect) => {
    async function boot(development = true): Promise<TestNextly> {
      if (development) vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
      });
      return current;
    }

    it.each(SUCCEEDING)(
      "$name",
      async path => {
        const t = await boot();
        expect(succeeded(await path.setup()), "the setup").toBe(true);

        const answer = await path.run(t).catch((error: unknown) => error);
        expect(succeeded(answer), `the save: ${String(answer)}`).toBe(true);
        expect(await refusal(refuseWhileSaveInProgress(t.adapter))).toBe(
          "none"
        );
        expect(anyMarkers()).toEqual([]);
      },
      300_000
    );

    // Outside development a collection's create writes its definition and files for the deploy's
    // `nextly migrate`, then its registry row, and answers a failed registry write as its result:
    // nothing records what was written, so the record stays. (In development the file's own run
    // writes the registry row first, so the failed write after it leaves nothing part-way.)
    it("a create whose registry write fails, answered as its result, keeps the record", async () => {
      const t = await boot(false);
      kill.failRegistry = true;
      const answer = await createPosts().catch((error: unknown) => error);
      expect(kill.failRegistry, "the registry write was never made").toBe(
        false
      );
      expect(succeeded(answer), "the create succeeded").toBe(false);

      expect(await refusal(refuseWhileSaveInProgress(t.adapter))).toBe(
        "CONFLICT"
      );
      expect(anyMarkers()).toHaveLength(1);
    }, 300_000);
  }
);
