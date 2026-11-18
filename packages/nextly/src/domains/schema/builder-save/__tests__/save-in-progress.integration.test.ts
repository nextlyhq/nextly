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
 * describe the save. A save that ends, written or refused, leaves neither.
 *
 * The kill is released once the case has looked, so the instance's connections can close.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
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

/** Where the save is stopped, and how to let it go. Shared with the module mocks below. */
const kill = vi.hoisted(() => ({
  /** Whether the write just made is the one to stop after. */
  at: undefined as undefined | ((point: string) => boolean),
  /** Called once the save has stopped there. */
  reached: undefined as undefined | (() => void),
  /** Ends the stop, so the save unwinds and the instance can close. */
  release: undefined as undefined | (() => void),
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
    await real.rename(from, to);
    await stopHere(`file:${String(to)}`);
  };
  return { ...real, rename, default: { ...real, rename } };
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
 * Offer every statement, once it has run on the adapter or a transaction, as a kill point named
 * `statement:<its text>`.
 */
function stopAtStatement(t: TestNextly): void {
  const adapter = t.adapter;
  const executeQuery = adapter.executeQuery.bind(adapter);
  vi.spyOn(adapter, "executeQuery").mockImplementation(
    async (statement, params) => {
      const result = await executeQuery(statement, params);
      await stopHere(`statement:${statement}`);
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
                  const result = await target.execute(statement, params);
                  await stopHere(`statement:${statement}`);
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

/** Stop once the ledger has recorded a file of the save applied. */
function stopAtLedger(): void {
  const markApplied = SchemaEventsRepository.prototype.markApplied;
  vi.spyOn(SchemaEventsRepository.prototype, "markApplied").mockImplementation(
    async function (this: SchemaEventsRepository, ...args) {
      const marked = await markApplied.apply(this, args);
      await stopHere("ledger");
      return marked;
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

/** The record's marker in the project's `.nextly/` folder, or undefined without one. */
function recordMarker(path: SavePath): Record<string, unknown> | undefined {
  const marker = join(
    basePath,
    ".nextly",
    "save-in-progress",
    `${path.kind}-${path.slug}.json`
  );
  if (!existsSync(marker)) return undefined;
  return JSON.parse(readFileSync(marker, "utf-8")) as Record<string, unknown>;
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
      return point => /^statement:.*ADD (COLUMN )?["`]alpha["`]/s.test(point);
    },
  },
  {
    name: "the ledger's record of the file",
    arm: () => {
      stopAtLedger();
      return point => point === "ledger";
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
          // The database by a hash of where it is, never the URL that reaches it.
          expect(row?.database).toMatch(/^[0-9a-f]{16,64}$/);
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
      }, 300_000);

      it("a save refused part-way through its run leaves neither the row nor the marker", async () => {
        const t = await boot();
        await path.create([text("heading")]);
        const adapter = t.adapter;
        const transaction = adapter.transaction.bind(adapter);
        const executeQuery = adapter.executeQuery.bind(adapter);
        let refused = 0;
        const refuse = (statement: string) => {
          if (refused > 0 || !/ADD (COLUMN )?["`]alpha["`]/.test(statement))
            return;
          refused += 1;
          throw new Error(`injected failure: ${statement}`);
        };
        vi.spyOn(adapter, "executeQuery").mockImplementation(
          async (statement, params) => {
            refuse(statement);
            return executeQuery(statement, params);
          }
        );
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
                        refuse(statement);
                        return target.execute(statement, params);
                      };
                    }
                    const value: unknown = Reflect.get(target, key);
                    return typeof value === "function"
                      ? value.bind(target)
                      : value;
                  },
                })
              ),
            options
          )
        );

        const answer = await path
          .save(t, [text("heading"), text("alpha")])
          .catch((error: unknown) => error);
        expect(refused, "no statement adding `alpha` was met").toBe(1);
        expect(
          answer instanceof Response ? answer.ok : !(answer instanceof Error),
          "the save was not refused"
        ).toBe(false);
        expect(await recordRow(t, path)).toBeUndefined();
        expect(recordMarker(path)).toBeUndefined();
      }, 300_000);
    });
  }
);
