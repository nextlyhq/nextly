/**
 * A Builder save records that it has started before its first write, and clears the record once
 * it has ended, so a save the process never finished is known to the next start and to the
 * migration commands. The record is a `nextly_meta` row, for the readers with a database, and a
 * marker file in the project's `.nextly/` folder, for the commands that connect to none.
 *
 * A kill is made by letting the step at the kill point run and then never return: no `catch` or
 * `finally` of the save runs, as none would in a process that was killed there. Each write point
 * of the save in turn: the definition file, a migration file, a statement of the file run, the
 * ledger's record of it and the registry row. After each, the row and the marker are there and
 * describe the save. A save that ends, written or withdrawn whole, leaves neither; one that ends
 * with part of it kept and nothing recording what (a MySQL save stopped part-way) keeps both. A
 * record already standing, from a process that stopped, stays as it was through a later save.
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
    await stopHere(`file:${String(to)}`);
  };
  const rm: typeof real.rm = async (path, options) => {
    if (kill.refuseRemoving?.(String(path)) === true) {
      throw Object.assign(new Error("operation not permitted"), {
        code: "EPERM",
      });
    }
    await real.rm(path, options);
  };
  return { ...real, rename, rm, default: { ...real, rename, rm } };
});

// Every registry write of a save goes through these.
vi.mock("../../schema-version", async importOriginal => {
  const real = await importOriginal<typeof import("../../schema-version")>();
  return {
    ...real,
    writeRegistryRows: (async (
      ...args: Parameters<typeof real.writeRegistryRows>
    ) => {
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
  create(fields: BuilderField[]): Promise<unknown>;
  save(t: TestNextly, fields: BuilderField[]): Promise<unknown>;
}

const PATHS: readonly SavePath[] = [
  {
    name: "a collection's Builder apply",
    kind: "collection",
    slug: "sip_posts",
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
): Promise<Record<string, unknown> | undefined> {
  const entry = await new MetaService(t.adapter, consoleLogger).getEntry<
    Record<string, unknown>
  >(`${RECORD_KEY_PREFIX}${path.kind}:${path.slug}`);
  return entry.present ? (entry.value ?? undefined) : undefined;
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

/** The definition file's text, or null where there is none yet. */
function definitionText(): string | null {
  const file = join(basePath, DEFINITION);
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
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

/** The kill points, each naming the write it stops after. */
const KILL_POINTS: ReadonlyArray<{
  name: string;
  arm(t: TestNextly): (point: string) => boolean;
}> = [
  {
    name: "the definition file",
    arm: () => point => point === `file:${join(basePath, DEFINITION)}`,
  },
  {
    name: "a migration file",
    arm: () => point =>
      point.startsWith(`file:${join(basePath, HISTORY)}`) &&
      point.endsWith(".sql"),
  },
  {
    name: "a statement of the file run",
    arm: t => {
      stopAtStatement(t);
      return point =>
        point.startsWith("statement:") && adding("alpha").test(point);
    },
  },
  {
    name: "the ledger's record of the file",
    arm: () => {
      stopAtLedger();
      return point => point === "ledger:markApplied";
    },
  },
  {
    name: "the registry row",
    arm: () => point => point === "registry",
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
        async ({ arm }) => {
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
            await within(reached, 120_000),
            "the save never reached the kill point"
          ).toBe(true);

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

        const answer = await path.save(t, [text("heading"), text("alpha")]);
        expect(answer instanceof Response ? answer.ok : true).toBe(true);
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
        expect(await recordRow(t, path)).toBeUndefined();
        expect(recordMarker(path)).toBeUndefined();
      }, 300_000);

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

      // MySQL commits each statement as it runs, so a save refused at its second addition keeps
      // the first, and its files are kept recorded applied nowhere: nothing records what committed,
      // so the record stays for the next start to settle.
      it.runIf(dialect === "mysql")(
        "a save stopped part-way on MySQL, its files kept unrecorded, keeps the row and the marker",
        async () => {
          const t = await boot();
          await path.create([text("heading")]);
          const definitionBefore = definitionText();
          const refused = refuseAdding(t, "beta");

          const answer = await path
            .save(t, [text("heading"), text("alpha"), text("beta")])
            .catch((error: unknown) => error);
          expect(refused(), "no statement adding `beta` was met").toBe(1);
          expect(
            answer instanceof Response ? answer.ok : !(answer instanceof Error),
            "the save was not refused"
          ).toBe(false);

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
            await within(reached, 120_000),
            "the save never recorded its failure in the ledger"
          ).toBe(true);
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
          await within(reached, 120_000),
          "the save never reached the kill point"
        ).toBe(true);

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
