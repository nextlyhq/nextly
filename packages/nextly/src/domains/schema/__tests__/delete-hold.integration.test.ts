/**
 * A Builder save that removes a field holding values, given the count the person confirmed in the
 * review (`confirmedDeletions`), deletes only that count, on SQLite, PostgreSQL and MySQL.
 *
 * The save counts the field's values again in the transaction of the migration file that drops
 * it, before the drop, with the table held against other writes on PostgreSQL and SQLite, and
 * deletes only where the count still equals the confirmed one. Otherwise nothing changes, and the
 * refusal names the field and its new count, for the review to show and the person to confirm.
 *
 * What separates the right count from plausible wrong ones:
 * - a save that compares nothing deletes 4 values against 3 confirmed and reports success: the
 *   case of a write after the review;
 * - one that compares a count taken before its file runs misses a write made during the save, before
 *   the drop: the case of a write at the file's start;
 * - one that counts without holding the table lets a write through between the count and the
 *   drop: on PostgreSQL a write sent once the count is taken waits until the save has committed;
 * - one that compares only in the migration file deletes 4 values against 3 confirmed on a
 *   translated collection, whose save the push applies in development;
 * - a review that lists only the top-level fields shows no count for a field removed from a group
 *   with no name, and a save that compares the row's fields then refuses every such removal.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { childLayoutArgs } from "../../../__tests__/storage-layout";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { verifyPassword } from "../../../auth/password";
import { createAdapter } from "../../../database/factory";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { ServiceContainer } from "../../../services";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { _resetEnvCache } from "../../../shared/lib/env";
import { registerFieldFunctions } from "../../../shared/lib/field-level-registry";
import { consoleLogger } from "../../../shared/types";
import { CollectionAccessService } from "../../collections/services/collection-access-service";
import { CollectionMutationService } from "../../collections/services/collection-mutation-service";
import { holdEntityForWrite } from "../../collections/services/entry-write-hold";
import {
  asCreatedBefore,
  withNoHistory,
} from "../builder-save/__tests__/helpers/older-table";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { namedCollectionLockNames } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { withStopPoints } from "../migrate/stop-points";
import { DynamicCollectionService } from "../../dynamic-collections/services/dynamic-collection-service";

// A gate before each migration file's first statement on the file road (`runWritten` asks the
// required-column refusal before any statement of the file), outside the file's transaction.
const fileStart = vi.hoisted(() => ({
  armed: false,
  paused: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
  letGo: undefined as undefined | (() => void),
}));
vi.mock("../migrate/required-column-guard", async importOriginal => {
  const real =
    await importOriginal<typeof import("../migrate/required-column-guard")>();
  return {
    ...real,
    refuseRequiredColumnsOverNulls: async (
      ...args: Parameters<typeof real.refuseRequiredColumnsOverNulls>
    ) => {
      if (fileStart.armed) {
        fileStart.paused?.();
        await fileStart.release;
      }
      return real.refuseRequiredColumnsOverNulls(...args);
    },
  };
});

// A switch that makes the migration try's handle refuse to let the collection's hold go, without
// running the release: set after the count, on the handle the count ran on, which the hold's
// release then runs on too. `refused` counts the releases refused.
const tryRelease = vi.hoisted(() => ({ fails: false, refused: 0 }));

// A switch that puts two statements before each migration file's own: `first`, a schema statement
// that commits on MySQL, then a write to a row the case holds, which the first try waits at and
// ends on. The next try resumes past `first`, with the delete ahead. `first` changes the
// collection's own table, or makes a table beside it and leaves the collection's as it was.
const resumable = vi.hoisted(() => ({
  on: false,
  first: "collection" as "collection" | "beside",
}));
// The statements of the file split last: what a stop point's number stands for.
const lastSplit = vi.hoisted(() => ({ statements: [] as readonly string[] }));
vi.mock("../migrate/split-sql", async importOriginal => {
  const real = await importOriginal<typeof import("../migrate/split-sql")>();
  return {
    ...real,
    splitSqlStatements: (
      ...args: Parameters<typeof real.splitSqlStatements>
    ) => {
      const statements = real.splitSqlStatements(...args);
      lastSplit.statements = statements;
      return resumable.on
        ? [
            resumable.first === "collection"
              ? "ALTER TABLE `dc_dh_notes` ADD COLUMN `resumed_past` integer"
              : "CREATE TABLE IF NOT EXISTS `dh_resumed_past` (`id` integer)",
            "UPDATE `dh_waited_at` SET `n` = `n` + 1 WHERE `id` = 1",
            ...statements,
          ]
        : statements;
    },
  };
});

// What a resumed try's recount (`DeletionHold.standingIn`) finds on the handle it runs on: whether
// that connection holds every one of the collection's named locks, recorded while `watching`.
const resumedRecount = vi.hoisted(() => ({
  watching: false,
  holdsLocks: [] as boolean[],
}));

// A gate just after the save's count, inside the file's transaction, with the table held.
const afterCount = vi.hoisted(() => ({
  armed: false,
  paused: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
  letGo: undefined as undefined | (() => void),
}));
vi.mock("../builder-save/deletion-counts", async importOriginal => {
  const real =
    await importOriginal<typeof import("../builder-save/deletion-counts")>();
  return {
    ...real,
    deletionHoldOf: (...args: Parameters<typeof real.deletionHoldOf>) => {
      const hold = real.deletionHoldOf(...args);
      if (hold === undefined) return hold;
      // Each count the save takes, whole, for one file's tables, or before a push, pauses at the
      // gate after it.
      const gatedAfter =
        (check: (db: unknown) => Promise<void>) => async (db: unknown) => {
          await check(db);
          if (tryRelease.fails) await refuseReleaseOn(db);
          if (afterCount.armed) {
            afterCount.paused?.();
            await afterCount.release;
          }
        };
      return {
        ...hold,
        // The push road compares just before the push; the gate follows that count too.
        compare: gatedAfter(hold.compare),
        check: gatedAfter(hold.check),
        standingIn(changed?: readonly string[]) {
          const standing = hold.standingIn(changed);
          return async (db: unknown) => {
            if (resumedRecount.watching) {
              resumedRecount.holdsLocks.push(await holdsCollectionLocks(db));
            }
            await standing(db);
          };
        },
        checkIn(changed: readonly string[]) {
          const check = hold.checkIn(changed);
          return check === undefined ? undefined : gatedAfter(check);
        },
      };
    },
  };
});

// A switch that sends a collection's save down the push road (`pushCarriesValues`), which the push
// applies rather than the save's file, whatever the change.
const pushRoad = vi.hoisted(() => ({ forced: false }));
vi.mock("../builder-save/push-carries-values", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../builder-save/push-carries-values")
    >();
  return {
    ...real,
    pushCarriesValues: async (
      ...args: Parameters<typeof real.pushCarriesValues>
    ) => pushRoad.forced || real.pushCarriesValues(...args),
  };
});

// A pause before each registry write a save makes once its change applied (`writeRegistryRows`), while
// `ms` is set: the span a hold let go before the registry write would leave a write to land in.
const slowRegistry = vi.hoisted(() => ({ ms: 0 }));
// A switch that refuses each such registry write, and how many were refused.
const refusedRegistry = vi.hoisted(() => ({ on: false, refused: 0 }));
// A gate before the next such registry write, while armed: the save waits there, its change made
// and its row not yet written, until the case lets it go.
const registryWrite = vi.hoisted(() => ({
  armed: false,
  paused: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
  letGo: undefined as undefined | (() => void),
}));
vi.mock("../schema-version", async importOriginal => {
  const real = await importOriginal<typeof import("../schema-version")>();
  return {
    ...real,
    writeRegistryRows: async (
      ...args: Parameters<typeof real.writeRegistryRows>
    ) => {
      if (slowRegistry.ms > 0) {
        await new Promise(resolve => setTimeout(resolve, slowRegistry.ms));
      }
      if (registryWrite.armed) {
        registryWrite.armed = false;
        registryWrite.paused?.();
        await registryWrite.release;
      }
      if (refusedRegistry.on) {
        refusedRegistry.refused += 1;
        throw new Error("the registry write was refused");
      }
      return real.writeRegistryRows(...args);
    },
  };
});

// A switch that fails the step bringing a collection's translations table in step, after the save's
// file has committed and before that step changes anything.
const translationsStep = vi.hoisted(() => ({ fails: false, failed: false }));
vi.mock("../../i18n/migration/held-leaving-drops", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../../i18n/migration/held-leaving-drops")
    >();
  return {
    ...real,
    applyCompanionTransition: async (
      ...args: Parameters<typeof real.applyCompanionTransition>
    ) => {
      if (translationsStep.fails) {
        translationsStep.failed = true;
        throw new Error("the translations step was refused");
      }
      return real.applyCompanionTransition(...args);
    },
  };
});

// How often the translations step's plan was made.
const plans = vi.hoisted(() => ({ made: 0 }));
vi.mock("../../i18n/migration/reconcile-companion", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../../i18n/migration/reconcile-companion")
    >();
  return {
    ...real,
    buildCompanionTransitionStatements: (
      ...args: Parameters<typeof real.buildCompanionTransitionStatements>
    ) => {
      plans.made += 1;
      return real.buildCompanionTransitionStatements(...args);
    },
  };
});

// What the last dialog save's change does on the file road, for a case that asks it directly.
const lastRoad = vi.hoisted(() => ({
  inFile: undefined as
    | undefined
    | (() => Promise<(() => Promise<void>) | undefined>),
}));
vi.mock("../services/collection-schema-apply", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../services/collection-schema-apply")
    >();
  return {
    ...real,
    collectionFileRoad: (
      ...args: Parameters<typeof real.collectionFileRoad>
    ) => {
      const road = real.collectionFileRoad(...args);
      lastRoad.inFile = road.inFile;
      return road;
    },
  };
});

// The push road's hold runs on a session of its own (`withSession`): what each case counts of it,
// and a switch that refuses its release once the release has really run (`sessionsOf`).
const releaseFails = { on: false, holds: 0, refused: 0 };

/** `db`, a MySQL handle the runner gives, made to refuse each statement that lets a named lock go. */
async function refuseReleaseOn(db: unknown): Promise<void> {
  const { MySqlDialect } = await import("drizzle-orm/mysql-core");
  const dialect = new MySqlDialect();
  const handle = db as { execute(query: unknown): Promise<unknown> };
  const execute = handle.execute.bind(handle);
  handle.execute = async (query: unknown) => {
    const text = dialect.sqlToQuery(
      query as Parameters<typeof dialect.sqlToQuery>[0]
    ).sql;
    if (text.includes("RELEASE_LOCK")) {
      tryRelease.refused += 1;
      throw new Error("the release was refused");
    }
    return execute(query);
  };
}

/**
 * Whether the MySQL connection behind `db` holds every one of the collection's named locks
 * (`namedCollectionLockNames`): the hold a resumed try takes again before it counts.
 */
async function holdsCollectionLocks(db: unknown): Promise<boolean> {
  const { sql: query } = await import("drizzle-orm");
  const { namedCollectionLockNames: lockNames } = await import(
    "../../dynamic-collections/services/dynamic-collection-registry-service"
  );
  const execute = async (statement: unknown) =>
    (
      (await (db as { execute(statement: unknown): Promise<unknown> }).execute(
        statement
      )) as [Array<Record<string, unknown>>]
    )[0];
  const [database] = await execute(query`SELECT DATABASE() AS name`);
  for (const name of lockNames(String(database?.name), [SLUG])) {
    const [row] = await execute(
      query`SELECT IS_USED_LOCK(${name}) = CONNECTION_ID() AS mine`
    );
    if (Number(row?.mine) !== 1) return false;
  }
  return true;
}

let instance: TestNextly | undefined;
afterEach(async () => {
  pushRoad.forced = false;
  slowRegistry.ms = 0;
  refusedRegistry.on = false;
  refusedRegistry.refused = 0;
  lastRoad.inFile = undefined;
  releaseFails.on = false;
  tryRelease.fails = false;
  tryRelease.refused = 0;
  resumable.on = false;
  resumable.first = "collection";
  resumedRecount.watching = false;
  resumedRecount.holdsLocks = [];
  releaseFails.holds = 0;
  releaseFails.refused = 0;
  fileStart.armed = false;
  afterCount.armed = false;
  registryWrite.armed = false;
  translationsStep.fails = false;
  translationsStep.failed = false;
  // A save a failed case left at a gate goes on, so its transaction ends before the app does.
  fileStart.letGo?.();
  afterCount.letGo?.();
  registryWrite.letGo?.();
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

const SLUG = "dh_notes";
const TABLE = "dc_dh_notes";
const REMAINING: unknown[] = [{ name: "label", type: "text" }];
const NOTED: unknown[] = [
  { name: "label", type: "text" },
  { name: "note", type: "text" },
];
/** A write sent while a save holds the collection, and the hook that runs before it. */
const HOOKED_WRITES = [
  {
    op: "update",
    phase: "beforeUpdate",
    write: (t: TestNextly, id: string) =>
      t.nextly.update({
        collection: SLUG,
        id,
        data: { label: "sent", _overwrite: true },
      } as never),
  },
  {
    op: "create",
    phase: "beforeCreate",
    write: (t: TestNextly) =>
      t.nextly.create({
        collection: SLUG,
        data: { title: "made", slug: "made", label: "sent" },
      }),
  },
] as const;
/**
 * `fields` with `note` laid out in a group with no name, whose fields are stored on the row: a
 * shape only the definition file holds at the top level, which the API takes no part of.
 */
function boxed(fields: readonly Record<string, unknown>[]): unknown[] {
  return fields.map(field =>
    field.name === "note"
      ? { type: "group", label: "Box", fields: [field] }
      : field
  );
}

/**
 * One entry written on `tx`, a transaction the caller opened, as a plugin writes in a transaction
 * of its own: `"created"`, or what its item was refused with.
 */
const TX_WRITER = "dh-tx-writer";
async function createInCallersTransaction(
  t: TestNextly,
  tx: TransactionContext,
  data: Record<string, unknown>
): Promise<unknown> {
  const entries = (
    t.getService("collectionsHandler") as unknown as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
  const result = await entries.createEntriesInTransaction(
    tx,
    { collectionName: SLUG, user: { id: TX_WRITER } },
    [data]
  );
  return result.successful === 1 ? "created" : result.errors[0];
}

/**
 * A stop just after the statement that drops `note`'s column, whichever of its file's it is; the
 * statement, once stopped there, in `stopped.after`.
 */
function stopAfterTheDelete(stopped: { after: string }) {
  return (point: string) => {
    const at = /: after statement (\d+)$/.exec(point)?.[1];
    const statement = lastSplit.statements[Number(at ?? 0) - 1] ?? "";
    if (/\bDROP COLUMN\b/i.test(statement) && /\bnote\b/.test(statement)) {
      stopped.after = statement;
      throw new Error("stopped after the delete");
    }
  };
}

/** What a write ended with, as a failed assertion names it: the code, its log line, and its cause. */
function told(outcome: unknown): string {
  const error = outcome as {
    code?: unknown;
    logMessage?: unknown;
    logContext?: unknown;
    cause?: { message?: unknown };
  };
  return JSON.stringify({
    code: error?.code,
    logMessage: error?.logMessage,
    logContext: error?.logContext,
    cause: error?.cause?.message,
  });
}

/** A gate's pause, its release, and whether the save reached it before it ended. */
function gated(gate: typeof fileStart) {
  let release: () => void = () => undefined;
  gate.release = new Promise<void>(resolve => {
    release = resolve;
  });
  const paused = new Promise<void>(resolve => {
    gate.paused = resolve;
  });
  gate.armed = true;
  gate.letGo = release;
  return { paused, release };
}

describe.each(getConfiguredTestDialects())(
  "a save that removes a field deletes the count confirmed (%s)",
  dialect => {
    const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);

    async function boot(fields: unknown[] = NOTED): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Note",
          fields,
        }
      );
      return t;
    }

    async function sql<T>(t: TestNextly, text: string): Promise<T[]> {
      return (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(text);
    }

    let next = 0;
    /** An entry written as another session writes it, straight to the table. */
    async function insert(t: TestNextly, note: string | null) {
      await sql(t, insertStatement(note));
    }

    /** The statement that writes a new entry, its `note` set or left out. */
    function insertStatement(note: string | null): string {
      next += 1;
      const id = `r${String(next)}`;
      const cols = [
        "id",
        "title",
        "slug",
        "label",
        "created_at",
        "updated_at",
        "_revision",
      ];
      const values = [
        `'${id}'`,
        `'${id}'`,
        `'${id}'`,
        `'${id}'`,
        "'2026-11-19 00:00:00'",
        "'2026-11-19 00:00:00'",
        "1",
      ];
      if (note !== null) {
        cols.push("note");
        values.push(`'${note}'`);
      }
      return `INSERT INTO ${q(TABLE)} (${cols.map(q).join(", ")}) VALUES (${values.join(", ")})`;
    }

    async function notesHeld(t: TestNextly): Promise<number> {
      const [row] = await sql<{ n: number | string }>(
        t,
        `SELECT COUNT(*) AS n FROM ${q(TABLE)} WHERE ${q("note")} IS NOT NULL`
      );
      return Number(row?.n);
    }

    async function hasNoteColumn(t: TestNextly): Promise<boolean> {
      try {
        await sql(t, `SELECT ${q("note")} FROM ${q(TABLE)} WHERE 1 = 0`);
        return true;
      } catch {
        return false;
      }
    }

    async function schemaVersion(t: TestNextly): Promise<number> {
      const [row] = await sql<{ v: number | string | null }>(
        t,
        `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
      );
      return Number(row?.v ?? 1);
    }

    /** The count the review shows for the removed field. */
    async function reviewed(
      remaining: unknown[] = REMAINING
    ): Promise<number | undefined> {
      const body = (await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: SLUG },
        { fields: remaining }
      )) as Response | Record<string, unknown>;
      const json = (
        body instanceof Response ? await body.json() : body
      ) as Record<string, unknown>;
      const data = (json.data ?? json) as {
        changes?: { removed?: Array<{ name: string; rowCount?: number }> };
      };
      return data.changes?.removed?.find(field => field.name === "note")
        ?.rowCount;
    }

    async function apply(
      t: TestNextly,
      confirmed: number | undefined,
      remaining: unknown[] = REMAINING,
      /** The dialog's confirmation by field name of a drop, as the admin sends it. */
      resolutions?: Record<string, { action: "confirm_drop" }>
    ): Promise<unknown> {
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: remaining,
          confirmed: true,
          schemaVersion: await schemaVersion(t),
          ...(confirmed === undefined
            ? {}
            : { confirmedDeletions: [{ field: "note", count: confirmed }] }),
          ...(resolutions === undefined ? {} : { resolutions }),
        }
      );
    }

    /** The first entry's id. */
    async function firstEntry(t: TestNextly): Promise<string> {
      const [first] = await sql<{ id: unknown }>(
        t,
        `SELECT ${q("id")} AS id FROM ${q(TABLE)} ORDER BY ${q("id")}`
      );
      return String(first?.id);
    }

    /**
     * Sends `write` while a save that removes `note` (to `remaining`) holds the collection, after
     * its count, and lets the save finish: whether the write was held back until then, and what
     * came of it once the save was applied.
     */
    async function whileSaving(
      t: TestNextly,
      write: () => Promise<unknown>,
      remaining: unknown[] = REMAINING
    ): Promise<{ heldBack: boolean; outcome: unknown }> {
      const { paused, release } = gated(afterCount);
      const applying = apply(t, 3, remaining).then(
        () => "applied",
        (error: unknown) => error
      );
      const reached = await Promise.race([
        paused.then(() => true),
        applying.then(() => false),
      ]);
      expect(reached || (await applying)).toBe(true);
      let settled = false;
      const writing = write()
        .then(
          () => "written",
          (error: unknown) => error
        )
        .finally(() => {
          settled = true;
        });
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const heldBack = !settled;
      release();
      expect(await applying).toBe("applied");
      return { heldBack, outcome: await writing };
    }

    /**
     * `t`'s sessions watched: each statement taking a named lock counted as a hold, and with
     * `releaseFails.on` each that lets one go refused after it ran.
     */
    function sessionsOf(t: TestNextly): void {
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const real = adapter.withSession.bind(adapter);
      vi.spyOn(adapter, "withSession").mockImplementation((work, options) =>
        real(
          session =>
            work({
              execute: async (statement, params) => {
                if (statement.includes("GET_LOCK")) releaseFails.holds += 1;
                const rows = await session.execute(statement, params);
                if (releaseFails.on && statement.includes("RELEASE_LOCK")) {
                  releaseFails.refused += 1;
                  throw new Error("the release was refused");
                }
                return rows;
              },
            } as typeof session),
          options
        )
      );
    }

    // The history's files, none where the folder is not there yet (a history forgotten whole).
    const historyFiles = (t: TestNextly) => {
      const dir = join(t.basePath, "database", "history");
      return existsSync(dir) ? readdirSync(dir).sort() : [];
    };

    // What a client shows for a failed save, read as the admin reads it: the issues the error's data
    // carries at its top, where it carries any, in place of its message.
    const shownOf = (outcome: unknown): string => {
      const { publicMessage, publicData } = outcome as {
        publicMessage?: string;
        publicData?: { errors?: readonly { message?: unknown }[] };
      };
      const issues = (publicData?.errors ?? []).flatMap(issue =>
        typeof issue.message === "string" ? [issue.message] : []
      );
      return issues.length > 0 ? issues.join(" ") : (publicMessage ?? "");
    };

    const refusedWith = (count: number) => ({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.note",
            code: "DELETION_COUNT_CHANGED",
            message: expect.stringContaining(
              `now holds ${String(count)} value`
            ),
          }),
        ],
      },
    });

    it("deletes the field when its count is still the one confirmed", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      expect(await reviewed()).toBe(3);

      await expect(apply(t, 3)).resolves.toBeDefined();

      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    // A group with no name only lays its fields out: a field inside it is the row's own, listed
    // and counted by the review as one beside it, and deleted when its count is still the one
    // confirmed.
    it("deletes a field removed from a group with no name when its count is still the one confirmed", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      await layOutNoteInAGroup(t);

      // The Builder sends the row's named fields; the group, and the field in it, are gone.
      expect(await reviewed(REMAINING)).toBe(3);
      await expect(apply(t, 3, REMAINING)).resolves.toBeDefined();

      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    /**
     * The collection's `note` laid out in a group with no name, where the definition file and the
     * registry record the collection, as an edit of the file leaves them: its column stays where it
     * is, on the row.
     */
    async function layOutNoteInAGroup(t: TestNextly): Promise<void> {
      const file = join(t.basePath, "schema", "builder.json");
      const definition = JSON.parse(readFileSync(file, "utf8")) as {
        collections?: Array<{
          slug: string;
          fields: Record<string, unknown>[];
        }>;
      };
      const entity = definition.collections?.find(
        collection => collection.slug === SLUG
      );
      if (entity === undefined) throw new Error(`${SLUG} is not in ${file}`);
      entity.fields = boxed(entity.fields) as Record<string, unknown>[];
      writeFileSync(file, JSON.stringify(definition, null, 2));

      const [row] = await sql<{ fields: unknown }>(
        t,
        `SELECT ${q("fields")} AS ${q("fields")} FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
      );
      const stored = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as Record<string, unknown>[];
      const laidOut = JSON.stringify(boxed(stored)).replaceAll("'", "''");
      await sql(
        t,
        `UPDATE ${q("dynamic_collections")} SET ${q("fields")} = '${laidOut}' WHERE ${q("slug")} = '${SLUG}'`
      );
      clearRegistryRowCache();
    }

    it("deletes nothing and names the new count when an entry changed after the review", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      expect(await reviewed()).toBe(3);
      const filesBefore = historyFiles(t);
      // Another session writes a value between the review and the confirmation.
      await insert(t, "written after the review");

      await expect(apply(t, 3)).rejects.toMatchObject(refusedWith(4));

      // Nothing changed: the column and its values, and the save's files withdrawn.
      expect(await hasNoteColumn(t)).toBe(true);
      expect(await notesHeld(t)).toBe(4);
      expect(historyFiles(t)).toEqual(filesBefore);

      // The new count, confirmed, is deleted.
      await expect(apply(t, 4)).resolves.toBeDefined();
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    it("counts a write made during the save, before its file runs", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const { paused, release } = gated(fileStart);
      const applying = apply(t, 3).then(
        () => "applied",
        (error: unknown) => error
      );
      const reached = await Promise.race([
        paused.then(() => true),
        applying.then(() => false),
      ]);
      expect(reached).toBe(true);

      // A write while the save is under way, before the file that drops the column opens.
      await insert(t, "written during the save");
      release();

      expect(await applying).toMatchObject(refusedWith(4));
      expect(await hasNoteColumn(t)).toBe(true);
    }, 60_000);

    it("deletes as before when the save carries no confirmed count", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      await insert(t, "written after the review");

      // Its drop confirmed by name, as the admin's dialog confirms each removed field.
      await expect(
        apply(t, undefined, REMAINING, { note: { action: "confirm_drop" } })
      ).resolves.toBeDefined();
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    // A translated collection's save is applied by the push in development, not by its file: the
    // counts are compared there too, just before the push.
    const shared = (name: string) => ({ name, type: "text", localized: false });

    async function bootTranslated(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      instance = t;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Note",
          localized: true,
          fields: [shared("label"), shared("note")],
        }
      );
      return t;
    }

    /** The translated collection's save, with the drop confirmed as the admin confirms it. */
    async function applyTranslated(
      t: TestNextly,
      confirmed: number
    ): Promise<unknown> {
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: [shared("label")],
          confirmed: true,
          schemaVersion: await schemaVersion(t),
          localized: true,
          eventResolutions: [],
          resolutions: { note: { action: "confirm_drop" } },
          confirmedDeletions: [{ field: "note", count: confirmed }],
        }
      );
    }

    it("deletes the field on a save the push applies when its count is still the one confirmed", async () => {
      const t = await bootTranslated();
      for (const note of ["a", "b", "c"]) await insert(t, note);

      await expect(applyTranslated(t, 3)).resolves.toBeDefined();
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    it("deletes nothing and names the new count on a save the push applies", async () => {
      const t = await bootTranslated();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      // Another session writes a value between the review and the confirmation.
      await insert(t, "written after the review");

      await expect(applyTranslated(t, 3)).rejects.toMatchObject(refusedWith(4));
      expect(await hasNoteColumn(t)).toBe(true);
      expect(await notesHeld(t)).toBe(4);

      // The new count, confirmed, is deleted.
      await expect(applyTranslated(t, 4)).resolves.toBeDefined();
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    // The push road holds the collection from its count until the save has written its registry
    // row, on a connection of the save's own: on MySQL an entry write waits at the collection's
    // named locks, on PostgreSQL at its advisory lock. A write on a transaction already open is
    // refused rather than held on SQLite, whose suite has the next case for its writes.
    it.skipIf(dialect === "sqlite")(
      "keeps an entry write sent between the count and the push waiting, then writes it to the new shape",
      async () => {
        const t = await boot();
        sessionsOf(t);
        for (const note of ["a", "b", "c"]) await insert(t, note);
        // The save the other cases make, sent down the push road.
        pushRoad.forced = true;
        const { paused, release } = gated(afterCount);
        const applying = apply(t, 3, REMAINING, {
          note: { action: "confirm_drop" },
        }).then(
          () => "applied",
          (error: unknown) => error
        );
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        // Where the save ended before its count, what it ended with says why.
        expect(reached || (await applying)).toBe(true);

        // An entry write sent after the count, before the push, on a connection of its own: the
        // hold an entry write takes first (`holdEntityForWrite`, the collection's share side),
        // then the row.
        let landed = false;
        const registry = new DynamicCollectionService(t.adapter, consoleLogger);
        const writing = t.adapter
          .transaction(async tx => {
            await holdEntityForWrite(
              tx,
              { kind: "collection", slug: SLUG },
              registry,
              t.adapter as unknown as DrizzleAdapter
            );
            await tx.execute(insertStatement(null));
          })
          .then(() => {
            landed = true;
          });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        expect(landed).toBe(false);

        release();
        expect(await applying).toBe("applied");
        // The push road's hold on MySQL, which takes the named locks once.
        expect(releaseFails.holds).toBe(dialect === "mysql" ? 1 : 0);
        await writing;
        expect(landed).toBe(true);
        expect(await hasNoteColumn(t)).toBe(false);
      },
      60_000
    );

    // An entry write sent between a push road's count and its push, setting the field the save
    // removes, made for the definition that still has it. On every database it waits while the
    // save holds the collection, through the save's registry write, then is refused naming the
    // field: never written into the field just before the push drops it uncounted, nor sent to a
    // table the field has left.
    it("keeps an entry write sent between a push road's count and its push waiting until the save is recorded, then refuses its value for the removed field", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      pushRoad.forced = true;
      const { paused, release } = gated(afterCount);
      const applying = apply(t, 3, REMAINING, {
        note: { action: "confirm_drop" },
      }).then(
        () => "applied",
        (error: unknown) => error
      );
      const reached = await Promise.race([
        paused.then(() => true),
        applying.then(() => false),
      ]);
      expect(reached || (await applying)).toBe(true);

      // Another writer's create through the Direct API, setting `note`.
      let settled = false;
      const writing = t.nextly
        .create({
          collection: SLUG,
          data: { label: "between", note: "written after the count" },
        })
        .then(
          () => "created",
          (error: unknown) => error
        )
        .finally(() => {
          settled = true;
        });
      await new Promise(resolve => setTimeout(resolve, 1_000));
      expect(settled).toBe(false);

      // The save's registry write made slow: the write still waits through it, never landing
      // between the push and the row that records the save.
      slowRegistry.ms = 1_500;
      release();
      expect(await applying).toBe("applied");
      // Refused by the hold's own check, naming the field: not a database error a write into the
      // dropped column would end with.
      expect(await writing).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.note",
              code: "FIELD_REMOVED",
            }),
          ],
        },
      });
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    // An entry write holds the collection's registry row for share until it commits. One that
    // read the row and wrote before a save the push applies counted, and has not committed, is
    // waited for and counted: the push road's hold reads the row for update, which waits for the
    // write's share of it, on a connection outside any transaction as inside one.
    it.runIf(dialect === "mysql")(
      "counts an entry write under way when a save the push applies counts",
      async () => {
        const t = await boot();
        sessionsOf(t);
        for (const note of ["a", "b", "c"]) await insert(t, note);
        expect(await reviewed()).toBe(3);
        clearRegistryRowCache();

        // Another session's entry write: its hold taken (`holdEntityForWrite`), a value written
        // to the field, not yet committed.
        let commit: () => void = () => undefined;
        const committed = new Promise<void>(resolve => {
          commit = resolve;
        });
        let wrote: () => void = () => undefined;
        const hasWritten = new Promise<void>(resolve => {
          wrote = resolve;
        });
        const registry = new DynamicCollectionService(t.adapter, consoleLogger);
        const writer = t.adapter.transaction(async tx => {
          await holdEntityForWrite(
            tx,
            { kind: "collection", slug: SLUG },
            registry,
            t.adapter as unknown as DrizzleAdapter
          );
          await tx.execute(insertStatement("in flight"));
          wrote();
          await committed;
        });
        await hasWritten;
        pushRoad.forced = true;
        const applying = apply(t, 3, REMAINING, {
          note: { action: "confirm_drop" },
        }).then(
          () => "applied",
          (error: unknown) => error
        );
        // The write commits while the save waits for it.
        await new Promise(resolve => setTimeout(resolve, 500));
        commit();
        await writer;

        expect(await applying).toMatchObject(refusedWith(4));
        // Counted under the push road's hold.
        expect(releaseFails.holds).toBe(1);
        expect(await hasNoteColumn(t)).toBe(true);
        expect(await notesHeld(t)).toBe(4);
      },
      60_000
    );

    // A release that fails once the push applied the change changes nothing of what it did: the
    // save is applied, its files are kept and recorded, and its registry row is written.
    it.runIf(dialect === "mysql")(
      "reports a save the push applied as applied when its hold cannot be let go",
      async () => {
        const t = await boot();
        sessionsOf(t);
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const filesBefore = historyFiles(t);
        const appliedFiles = async () =>
          Number(
            (
              await sql<{ n: number | string }>(
                t,
                `SELECT COUNT(*) AS n FROM ${q("nextly_schema_events")} WHERE ${q("event_type")} = 'file_apply' AND ${q("status")} = 'applied'`
              )
            )[0]?.n
          );
        const recordedBefore = await appliedFiles();
        pushRoad.forced = true;
        releaseFails.on = true;

        await expect(
          apply(t, 3, REMAINING, { note: { action: "confirm_drop" } })
        ).resolves.toBeDefined();

        // The push road's hold was taken, and its release refused.
        expect(releaseFails.refused).toBe(1);
        expect(await hasNoteColumn(t)).toBe(false);
        // Its files kept, and recorded applied.
        expect(historyFiles(t).length).toBeGreaterThan(filesBefore.length);
        expect(await appliedFiles()).toBeGreaterThan(recordedBefore);
        // Its registry row written: the field is gone from it.
        const [row] = await sql<{ fields: unknown }>(
          t,
          `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
        );
        const stored = (
          typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
        ) as Array<{ name: string }>;
        expect(stored.map(field => field.name)).toEqual(["label"]);
      },
      60_000
    );

    // On the file road a release that fails on the migration's connection changes nothing of the
    // save, which is applied; the connection is closed once its transaction is over, so it does
    // not go back to the pool holding the collection, and the next write does not wait.
    it.runIf(dialect === "mysql")(
      "reports a save its file applied as applied when its hold cannot be let go, and leaves the collection free",
      async () => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        tryRelease.fails = true;

        await expect(apply(t, 3)).resolves.toBeDefined();

        expect(tryRelease.refused).toBe(1);
        expect(await hasNoteColumn(t)).toBe(false);
        // No connection holds the collection's named locks.
        const [database] = await sql<{ name: string }>(
          t,
          "SELECT DATABASE() AS name"
        );
        for (const name of namedCollectionLockNames(database?.name ?? null, [
          SLUG,
        ])) {
          const [row] = await sql<{ holder: unknown }>(
            t,
            `SELECT IS_USED_LOCK('${name}') AS holder`
          );
          expect(row?.holder ?? null).toBeNull();
        }
        // So an entry write goes ahead at once.
        tryRelease.fails = false;
        await expect(
          t.nextly.create({ collection: SLUG, data: { label: "after" } })
        ).resolves.toBeDefined();
      },
      60_000
    );

    /**
     * The save that removes `note`, confirmed at 3, run so its first try commits `first` and ends
     * waiting, and an entry write writing a fourth value goes in between the tries; the outcome,
     * and the history files the save found.
     */
    async function resumedPastWithWriteBetween(
      t: TestNextly,
      first: "collection" | "beside"
    ): Promise<{ outcome: unknown; filesBefore: string[] }> {
      for (const note of ["a", "b", "c"]) await insert(t, note);
      // One try waits a second: `first` commits, the write to the held row waits past it.
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "30");
      // A row the case holds, which the first try's write to it waits at.
      await sql(
        t,
        "CREATE TABLE `dh_waited_at` (`id` integer PRIMARY KEY, `n` integer NOT NULL)"
      );
      await sql(t, "INSERT INTO `dh_waited_at` (`id`, `n`) VALUES (1, 0)");
      let letGo: () => void = () => undefined;
      const goes = new Promise<void>(resolve => {
        letGo = resolve;
      });
      let holding: () => void = () => undefined;
      const isHolding = new Promise<void>(resolve => {
        holding = resolve;
      });
      const holder = t.adapter.transaction(async tx => {
        await tx.execute(
          "SELECT `n` FROM `dh_waited_at` WHERE `id` = 1 FOR UPDATE"
        );
        holding();
        await goes;
      });
      await isHolding;
      resumable.on = true;
      resumable.first = first;
      resumedRecount.watching = true;
      const filesBefore = historyFiles(t);
      const { paused, release } = gated(afterCount);
      const applying = apply(t, 3).then(
        () => "applied",
        (error: unknown) => error
      );
      try {
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached || (await applying)).toBe(true);

        // An entry write, sent while the first try holds the collection: it goes ahead once that
        // try has let go, between the tries.
        const between = t.nextly.create({
          collection: SLUG,
          data: { label: "between", note: "written between the tries" },
        });
        release();
        await between;
      } finally {
        // The gate and the held row let go however the case ended, so the save and the holding
        // session end before the app does.
        release();
        letGo();
        await holder;
      }
      return { outcome: await applying, filesBefore };
    }

    // A MySQL try that ends waiting after a statement that committed resumes past it, its hold let
    // go with the try that ended. The resumed try takes the hold again and counts again before the
    // statement that deletes, so a write made between the tries is counted, not dropped.
    it.runIf(dialect === "mysql")(
      "counts again on a try resumed past a statement that committed, and refuses a write made between the tries",
      async () => {
        const t = await boot();
        const { outcome, filesBefore } = await resumedPastWithWriteBetween(
          t,
          "collection"
        );
        // The resumed try counted under the collection's hold, taken again on its own connection.
        expect(resumedRecount.holdsLocks).toEqual([true]);
        expect(JSON.stringify(outcome)).toContain("DELETION_COUNT_CHANGED");
        expect(await hasNoteColumn(t)).toBe(true);
        expect(await notesHeld(t)).toBe(4);
        // The file's first statement stayed applied, so the save is told as part held and its file
        // kept, for the operator to finish, rather than withdrawn as if nothing of it ran.
        expect(JSON.stringify(outcome)).toContain(
          "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
        );
        expect(historyFiles(t).length).toBeGreaterThan(filesBefore.length);
        // What the person is shown says the save stopped part way, why, and how to settle it.
        const shown = shownOf(outcome);
        expect(shown).toContain("The save stopped part way");
        expect(shown).toContain(
          "note now holds 4 value(s), not the 3 confirmed"
        );
        expect(shown).toContain("nextly migrate:resolve");
      },
      60_000
    );

    // The same refusal on a resumed try whose earlier try committed a statement that left the
    // collection's own table as it was: it is still told as part held, never as a refusal that
    // changed nothing.
    it.runIf(dialect === "mysql")(
      "tells a refusal on a resumed try as part held, whatever the statement that committed changed",
      async () => {
        const t = await boot();
        const { outcome } = await resumedPastWithWriteBetween(t, "beside");
        expect(JSON.stringify(outcome)).toContain("DELETION_COUNT_CHANGED");
        expect(JSON.stringify(outcome)).toContain(
          "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
        );
        expect(await notesHeld(t)).toBe(4);
      },
      60_000
    );

    // On MySQL a save's files run one by one. A collection's first save of a table an earlier
    // version made converts its columns in a file of its own, before the file that deletes the
    // removed field's values; a count refused in that later file, after the conversion applied,
    // leaves the save told as part held, never as a refusal that changed nothing.
    it.runIf(dialect === "mysql")(
      "tells a count refused in a later file, after the first file applied, as part held",
      async () => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        // The table as an earlier version made it, with no history: the next save converts it.
        await asCreatedBefore(t, dialect, TABLE, ["label", "note"]);
        await withNoHistory(t, dialect, "./database/history");
        // Written after the review counted three.
        await insert(t, "written after the review");
        const body = async (extra: Record<string, unknown>) => ({
          fields: REMAINING,
          confirmed: true,
          schemaVersion: await schemaVersion(t),
          resolutions: { note: { action: "confirm_drop" } },
          confirmedDeletions: [{ field: "note", count: 3 }],
          ...extra,
        });
        // The conversions the save makes, named by its refusal to make them unconfirmed.
        const unconfirmed = await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: SLUG },
          await body({})
        ).then(
          () => undefined,
          (error: unknown) =>
            error as { code?: string; logContext?: { columns?: string[] } }
        );
        expect(unconfirmed?.code).toBe("NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED");
        const filesBefore = historyFiles(t);

        const outcome = await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: SLUG },
          await body({
            acknowledgedConversions: unconfirmed?.logContext?.columns ?? [],
          })
        ).then(
          () => "applied",
          (error: unknown) => error
        );

        // The save wrote more than one file, and the first of them applied.
        const written = historyFiles(t).filter(
          name => !filesBefore.includes(name)
        );
        expect(written.length, written.join(", ")).toBeGreaterThan(1);
        // The refusal travels in the data, under `refused`, not as issues at its top, which a
        // client shows in the message's place.
        expect(outcome).toMatchObject({
          code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
          publicData: {
            refused: {
              code: "VALIDATION_ERROR",
              errors: [
                expect.objectContaining({
                  path: "fields.note",
                  code: "DELETION_COUNT_CHANGED",
                }),
              ],
            },
          },
        });
        // What the person is shown says the save stopped part way, why, and how to settle it,
        // never to save again as a refusal that changed nothing would.
        const shown = shownOf(outcome);
        expect(shown).toContain("The save stopped part way");
        expect(shown).toContain(
          "note now holds 4 value(s), not the 3 confirmed"
        );
        expect(shown).toContain("The database now holds part of this change");
        expect(shown).toContain("nextly migrate:resolve");
        expect(shown).not.toContain("save again");
        expect(await hasNoteColumn(t)).toBe(true);
        expect(await notesHeld(t)).toBe(4);
      },
      60_000
    );

    // PostgreSQL holds the table against writes from the count to the commit. SQLite's suite runs
    // in memory, on one connection. MySQL holds the collection instead (below).
    it.runIf(dialect === "postgresql")(
      "keeps another session's write waiting from the count until the save has committed",
      async () => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const { paused, release } = gated(afterCount);
        const applying = apply(t, 3).then(
          () => "applied",
          (error: unknown) => error
        );
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached).toBe(true);

        // Sent while the save holds the table, between its count and its drop: it waits.
        let landed = false;
        const writing = insert(t, null).then(() => {
          landed = true;
        });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        expect(landed).toBe(false);

        release();
        expect(await applying).toBe("applied");
        // Once the save committed, the write goes on, onto the table without the field.
        await writing;
        expect(landed).toBe(true);
        expect(await hasNoteColumn(t)).toBe(false);
      },
      60_000
    );

    // An entry write takes the collection's hold before it writes, which the save holds from its
    // count until its registry row records the new definition: on MySQL, whose schema statements
    // commit as they run, on the try's connection, as a collection delete holds it.
    it("keeps an entry write waiting from the count until the save is over, then writes it to the new shape", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const { paused, release } = gated(afterCount);
      const applying = apply(t, 3).then(
        () => "applied",
        (error: unknown) => error
      );
      const reached = await Promise.race([
        paused.then(() => true),
        applying.then(() => false),
      ]);
      expect(reached).toBe(true);

      // An entry write sent between the count and the drop: it waits for the collection.
      let landed = false;
      const writing = t.nextly
        .create({ collection: SLUG, data: { label: "during" } })
        .then(() => {
          landed = true;
        });
      await new Promise(resolve => setTimeout(resolve, 1_000));
      expect(landed).toBe(false);

      release();
      expect(await applying).toBe("applied");
      // Once the save let go, the write goes on, onto the table without the field.
      await writing;
      expect(landed).toBe(true);
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    // MySQL commits each deleting statement as it runs, and the hold belongs to the save, not to
    // either: a write sent after the first statement has ended waits until the second has.
    it.runIf(dialect === "mysql")(
      "keeps an entry write sent between two deleting statements waiting until the second has ended, then applies it",
      async () => {
        const t = await boot([...NOTED, { name: "memo", type: "text" }]);
        for (const note of ["a", "b", "c"]) await insert(t, note);
        await sql(t, `UPDATE ${q(TABLE)} SET ${q("memo")} = ${q("note")}`);
        const version = await schemaVersion(t);

        let atSecond: () => void = () => undefined;
        const between = new Promise<void>(resolve => {
          atSecond = resolve;
        });
        let goOn: () => void = () => undefined;
        const go = new Promise<void>(resolve => {
          goOn = resolve;
        });
        const applying = withStopPoints(
          async point => {
            if (/: before statement 2$/.test(point)) {
              atSecond();
              await go;
            }
          },
          () =>
            dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: SLUG },
              {
                fields: REMAINING,
                confirmed: true,
                schemaVersion: version,
                resolutions: {
                  note: { action: "confirm_drop" },
                  memo: { action: "confirm_drop" },
                },
                confirmedDeletions: [
                  { field: "note", count: 3 },
                  { field: "memo", count: 3 },
                ],
              }
            ).then(
              () => "applied",
              (error: unknown) => error
            )
        );
        await between;

        let settled = false;
        const writing = t.nextly
          .create({ collection: SLUG, data: { label: "between" } } as never)
          .then(
            () => "created",
            (error: unknown) => error
          )
          .finally(() => {
            settled = true;
          });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        const heldBack = !settled;
        goOn();
        expect(heldBack).toBe(true);
        expect(await applying).toBe("applied");
        const outcome = await writing;
        expect(outcome, told(outcome)).toBe("created");
        expect(await hasNoteColumn(t)).toBe(false);
        const [gone] = await sql<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${TABLE}' AND column_name = 'memo'`
        );
        expect(Number(gone?.n)).toBe(0);
      },
      60_000
    );

    // An update sent between the count and the drop, setting only a field the save keeps, was made
    // from the definition with the removed field, which its read of the entry as it stands names.
    // It waits for the collection, and once the save let go it is made again from the definition
    // the save left, and applied: never refused for what it does not set, nor failed by the
    // database on the removed column.
    it("keeps an update of a kept field waiting from the count until the save is over, then applies it", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const id = await firstEntry(t);
      const { heldBack, outcome } = await whileSaving(t, () =>
        t.nextly.update({
          collection: SLUG,
          id,
          // Written over whatever the entry holds now, as an editor saving over it does.
          data: { label: "changed", _overwrite: true },
        } as never)
      );
      expect(heldBack).toBe(true);
      expect(outcome, told(outcome)).toBe("written");
      const [row] = await sql<{ label: unknown }>(
        t,
        `SELECT ${q("label")} AS label FROM ${q(TABLE)} WHERE ${q("id")} = '${id}'`
      );
      expect(row?.label).toBe("changed");
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    // A write reads its entry through the collection's table, then asks whether the caller may make
    // it. A save that lands whole there leaves the write the table as it was: compared by a registry
    // row read only now, as the save left it, the write is found to stand, and its statements name
    // the column that is gone. The row it is compared by has to be read before the table.
    it.each([
      {
        op: "update",
        // Asked between the read of the entry and what comes after it.
        asked: [CollectionAccessService.prototype, "checkCollectionWrite"],
        write: (t: TestNextly, id: string) =>
          t.nextly.update({
            collection: SLUG,
            id,
            data: { label: "changed", _overwrite: true },
          } as never),
      },
      {
        op: "delete",
        asked: [CollectionMutationService.prototype, "deleteGateOf"],
        write: (t: TestNextly, id: string) =>
          t.nextly.delete({ collection: SLUG, id }),
      },
    ])(
      "applies the $op of an entry it read before a save that lands while its access is asked",
      async ({ asked: [service, question], write }) => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const id = await firstEntry(t);
        let saved = false;
        const asks = service as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        const real = asks[String(question)];
        const spy = vi
          .spyOn(asks, String(question))
          .mockImplementation(async function (this: unknown, ...args) {
            // The write's own first asking: the save lands whole before it goes on.
            if (!saved) {
              saved = true;
              expect(await apply(t, 3)).toBeInstanceOf(Response);
            }
            return real.apply(this, args);
          });
        try {
          const outcome = await write(t, id).then(
            () => "written",
            (error: unknown) => error
          );
          expect(saved).toBe(true);
          expect(outcome, told(outcome)).toBe("written");
        } finally {
          spy.mockRestore();
        }
        expect(await hasNoteColumn(t)).toBe(false);
      },
      60_000
    );

    // On SQLite a write waits for the database as long as its busy timeout, which the site may set:
    // past it, a write still held is refused as the database being busy, with nothing of it written,
    // as one that finds the file held past the timeout is. Waited for longer, or refused as the
    // collection being changed, it would answer a busy database two ways.
    it.runIf(dialect === "sqlite").each([
      {
        op: "update",
        write: (t: TestNextly, id: string) =>
          t.nextly.update({
            collection: SLUG,
            id,
            data: { label: "late", _overwrite: true },
          } as never),
      },
      {
        op: "create",
        write: (t: TestNextly) =>
          t.nextly.create({
            collection: SLUG,
            data: { title: "late", slug: "late", label: "late" },
          }),
      },
    ])(
      "refuses a held $op as the database being busy once its busy timeout ends, with nothing of it written",
      async ({ write }) => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const id = await firstEntry(t);
        // Well under the second the save is kept holding for, and no other wait's default.
        await t.adapter.executeQuery("PRAGMA busy_timeout = 400");
        const began = Date.now();
        let ended = 0;
        const { heldBack, outcome } = await whileSaving(t, () =>
          write(t, id).finally(() => {
            ended = Date.now() - began;
          })
        );
        expect(heldBack).toBe(false);
        expect(outcome, told(outcome)).toMatchObject({
          code: "DATABASE_BUSY",
          statusCode: 503,
        });
        // It waited for the timeout, rather than being refused at once.
        expect(ended).toBeGreaterThanOrEqual(350);
        const [late] = await sql<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM ${q(TABLE)} WHERE ${q("label")} = 'late'`
        );
        expect(Number(late?.n)).toBe(0);
        // The same write, sent again as the refusal says, is applied.
        await write(t, id);
        const [again] = await sql<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM ${q(TABLE)} WHERE ${q("label")} = 'late'`
        );
        expect(Number(again?.n)).toBe(1);
      },
      60_000
    );

    // A delete sets nothing, and reads the entry first: made again as an update is, its hooks run
    // once.
    it("keeps a delete waiting until the save is over, then deletes the entry, its before hook run once", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const id = await firstEntry(t);
      let runs = 0;
      t.hooks.register("beforeDelete", SLUG, () => {
        runs += 1;
      });
      const { heldBack, outcome } = await whileSaving(t, () =>
        t.nextly.delete({ collection: SLUG, id })
      );
      expect(heldBack).toBe(true);
      expect(outcome, told(outcome)).toBe("written");
      expect(runs).toBe(1);
      const [left] = await sql<{ n: number | string }>(
        t,
        `SELECT COUNT(*) AS n FROM ${q(TABLE)}`
      );
      expect(Number(left?.n)).toBe(2);
    }, 60_000);

    // A create's own defaults are part of what it writes, and nobody set them: a removed field's is
    // left out of the entry made again, rather than refusing a create that never named the field, or
    // failing it on the column that is gone.
    it("applies a held create whose only value for the removed field is its default", async () => {
      const t = await boot([
        { name: "label", type: "text" },
        { name: "note", type: "text", defaultValue: "by default" },
      ]);
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const { heldBack, outcome } = await whileSaving(t, () =>
        t.nextly.create({
          collection: SLUG,
          data: { title: "made", slug: "made", label: "sent" },
        })
      );
      expect(heldBack).toBe(true);
      expect(outcome, told(outcome)).toBe("written");
      const made = await sql<{ label: unknown }>(
        t,
        `SELECT ${q("label")} AS label FROM ${q(TABLE)} WHERE ${q("slug")} = 'made'`
      );
      expect(made.map(row => row.label)).toEqual(["sent"]);
    }, 60_000);

    // A write is shaped for its columns in place, and a password is hashed there. Made again from
    // what its first try shaped, the hash would be hashed, and the person could not sign in with
    // what they set: the stored hash is the password's own only where the copy the second try is
    // made from was taken before.
    it("hashes a password once for a held update made again", async () => {
      const withPassword = [
        { name: "label", type: "text" },
        { name: "secret", type: "password" },
      ];
      const t = await boot([...withPassword, { name: "note", type: "text" }]);
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const id = await firstEntry(t);
      const { heldBack, outcome } = await whileSaving(
        t,
        () =>
          t.nextly.update({
            collection: SLUG,
            id,
            data: { secret: "correct horse", _overwrite: true },
          } as never),
        withPassword
      );
      expect(heldBack).toBe(true);
      expect(outcome, told(outcome)).toBe("written");
      const [row] = await sql<{ secret: unknown }>(
        t,
        `SELECT ${q("secret")} AS secret FROM ${q(TABLE)} WHERE ${q("id")} = '${id}'`
      );
      expect(await verifyPassword("correct horse", String(row?.secret))).toBe(
        true
      );
    }, 60_000);

    // The definition's rules judge the value as it stood before the last hooks, as they judge any
    // write's: what a `beforeChange` hook makes of it is a write the rules never saw. Judged on the
    // final value, a write its first try let through would be refused by its second.
    it("judges a held update made again on the value the rules judged first", async () => {
      const label = { name: "label", type: "text", required: true };
      const t = await boot([label, { name: "note", type: "text" }]);
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const id = await firstEntry(t);
      let runs = 0;
      t.hooks.register("beforeChange", SLUG, context => {
        runs += 1;
        // Blank, which the rule on a required field refuses in what it judges.
        return { ...(context.data as Record<string, unknown>), label: "" };
      });
      const { heldBack, outcome } = await whileSaving(
        t,
        () =>
          t.nextly.update({
            collection: SLUG,
            id,
            data: { label: "sent", _overwrite: true },
          } as never),
        [label]
      );
      expect(heldBack).toBe(true);
      expect(outcome, told(outcome)).toBe("written");
      expect(runs).toBe(1);
      const [row] = await sql<{ label: unknown }>(
        t,
        `SELECT ${q("label")} AS label FROM ${q(TABLE)} WHERE ${q("id")} = '${id}'`
      );
      expect(row?.label).toBe("");
    }, 60_000);

    // A write made again is stored in the definition the save left, so it is judged by that: by a
    // rule the save put on a field, though the write met every rule of the definition it was first
    // made from. Judged only at first, the entry would hold what its own definition refuses.
    it.each([
      {
        rule: "required flag",
        now: { name: "label", type: "text", required: true },
        sent: "",
        code: "REQUIRED",
      },
      {
        rule: "max length",
        now: { name: "label", type: "text", validation: { maxLength: 8 } },
        sent: "longer than that",
        code: "TOO_LONG",
      },
    ])(
      "refuses a held update made again by the $rule the save put on its field",
      async ({ now, sent, code }) => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const id = await firstEntry(t);
        const { heldBack, outcome } = await whileSaving(
          t,
          () =>
            t.nextly.update({
              collection: SLUG,
              id,
              data: { label: sent, _overwrite: true },
            } as never),
          [now]
        );
        expect(heldBack).toBe(true);
        expect(outcome, told(outcome)).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: { errors: [expect.objectContaining({ code })] },
        });
        const [row] = await sql<{ label: unknown }>(
          t,
          `SELECT ${q("label")} AS label FROM ${q(TABLE)} WHERE ${q("id")} = '${id}'`
        );
        expect(row?.label).toBe(id);
      },
      60_000
    );

    // A field's own validator judges the data as the definition's rules do, so it is asked in every
    // try, and what it answers of the collection as the save left it stands. Asked at first alone,
    // a write it would now refuse is stored.
    it.each([
      { answers: "lets through again", second: true as const, stored: "sent" },
      {
        answers: "then refuses",
        second: "Not in the collection as it is.",
        stored: undefined,
      },
    ])(
      "asks a field's own validator again for a held update made again, which it $answers",
      async ({ second, stored }) => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const id = await firstEntry(t);
        let asked = 0;
        registerFieldFunctions("collection", SLUG, [
          {
            name: "label",
            type: "text",
            validate: () => {
              asked += 1;
              return asked === 1 ? true : second;
            },
          },
        ]);
        let outcome: unknown;
        try {
          const ended = await whileSaving(t, () =>
            t.nextly.update({
              collection: SLUG,
              id,
              data: { label: "sent", _overwrite: true },
            } as never)
          );
          expect(ended.heldBack).toBe(true);
          outcome = ended.outcome;
        } finally {
          registerFieldFunctions("collection", SLUG, []);
        }
        expect(asked).toBe(2);
        if (second === true) expect(outcome, told(outcome)).toBe("written");
        else {
          expect(outcome, told(outcome)).toMatchObject({
            code: "VALIDATION_ERROR",
            publicData: {
              errors: [expect.objectContaining({ code: "CUSTOM" })],
            },
          });
        }
        const [row] = await sql<{ label: unknown }>(
          t,
          `SELECT ${q("label")} AS label FROM ${q(TABLE)} WHERE ${q("id")} = '${id}'`
        );
        expect(row?.label).toBe(stored ?? id);
      },
      60_000
    );

    // A before hook is the site's own code: it may send mail, call another service or count. A write
    // made again after the save it waited for is made from what its hooks left the first time, so
    // each hook runs once however often the write is made. The count separates that from making the
    // whole write again, which stores the same value and runs the hook twice; the value stored
    // separates it from making the write from what the caller sent, which loses the hook's part.
    it.each(HOOKED_WRITES)(
      "runs a before hook once for a held $op made again from the definition the save left, and stores what the hook set",
      async ({ phase, write }) => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const id = await firstEntry(t);
        let runs = 0;
        t.hooks.register(phase, SLUG, context => {
          runs += 1;
          return {
            ...(context.data as Record<string, unknown>),
            label: `set by run ${String(runs)}`,
          };
        });
        // Held with its hook already run, so the definition changes under what the hook left.
        const { heldBack, outcome } = await whileSaving(t, () => write(t, id));
        expect(heldBack).toBe(true);
        expect(outcome, told(outcome)).toBe("written");
        expect(runs).toBe(1);
        const stored = await sql<{ label: unknown }>(
          t,
          `SELECT ${q("label")} AS label FROM ${q(TABLE)} WHERE ${q("label")} LIKE 'set by%'`
        );
        expect(stored.map(row => row.label)).toEqual(["set by run 1"]);
        expect(await hasNoteColumn(t)).toBe(false);
      },
      60_000
    );

    // What a hook sets is the write's data as much as what the caller sent, so a field only the hook
    // set is named too, rather than left out of the write or sent to a column that is gone.
    it.each(HOOKED_WRITES)(
      "refuses a held $op naming the removed field only its before hook set, the hook run once",
      async ({ phase, write }) => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const id = await firstEntry(t);
        let runs = 0;
        t.hooks.register(phase, SLUG, context => {
          runs += 1;
          return {
            ...(context.data as Record<string, unknown>),
            note: "set by the hook",
          };
        });
        const { heldBack, outcome } = await whileSaving(t, () => write(t, id));
        expect(heldBack).toBe(true);
        expect(outcome, told(outcome)).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.note",
                code: "FIELD_REMOVED",
              }),
            ],
          },
        });
        expect(runs).toBe(1);
        const [after] = await sql<{ rows: number | string; sent: unknown }>(
          t,
          `SELECT COUNT(*) AS ${q("rows")}, SUM(CASE WHEN ${q("label")} = 'sent' THEN 1 ELSE 0 END) AS ${q("sent")} FROM ${q(TABLE)}`
        );
        expect(Number(after?.rows)).toBe(3);
        expect(Number(after?.sent ?? 0)).toBe(0);
      },
      60_000
    );

    // MySQL's default isolation answers a transaction's plain reads from the snapshot its first read
    // fixed. A transaction the caller opened that read anything before the save has the collection's
    // definition as it was, and a write in it is made from that: the hold's own read is of the latest
    // commit, and the write is compared with it, refused naming a field it sets that the save
    // removed.
    it.runIf(dialect === "mysql")(
      "refuses a write on a transaction whose snapshot predates the save, naming the field it sets",
      async () => {
        const t = await boot();
        await superAdminUser(t, TX_WRITER);
        for (const note of ["a", "b", "c"]) await insert(t, note);

        let snapshotTaken: () => void = () => undefined;
        const taken = new Promise<void>(resolve => {
          snapshotTaken = resolve;
        });
        let saved: () => void = () => undefined;
        const afterSave = new Promise<void>(resolve => {
          saved = resolve;
        });
        const writing = t.adapter.transaction(async tx => {
          // The read that fixes the snapshot, of the collection's row among others.
          await tx.selectOne("dynamic_collections", {
            columns: ["id"],
            where: { and: [{ column: "slug", op: "=", value: SLUG }] },
          });
          snapshotTaken();
          await afterSave;
          const setsNote = await createInCallersTransaction(t, tx, {
            label: "set",
            note: "late",
          });
          const keepsNote = await createInCallersTransaction(t, tx, {
            label: "kept",
          });
          return { setsNote, keepsNote };
        });
        await taken;
        // Saved on connections of its own, the caller's transaction still open.
        expect(
          await apply(t, 3, REMAINING, {
            note: { action: "confirm_drop" },
          }).then(
            () => "applied",
            (error: unknown) => error
          )
        ).toBe("applied");
        saved();

        const { setsNote, keepsNote } = await writing;
        // A batch tells an item's refusal by its code and message, which names the field.
        expect(setsNote).toMatchObject({
          code: "VALIDATION_ERROR",
          error: expect.stringContaining(
            "note was removed from this collection"
          ) as string,
        });
        // One that sets only what the save keeps ends on a rule of MySQL itself: a
        // snapshot older than the table's change can't read the table, so the create can't read
        // back what it wrote. Neither write leaves anything.
        expect(keepsNote).not.toBe("created");
        const [rows] = await sql<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM ${q(TABLE)}`
        );
        expect(Number(rows?.n)).toBe(3);
      },
      60_000
    );

    // A write on a transaction its caller opened cannot be given up and opened again: where the pool
    // can spare a connection, it waits in place until the save lets go, then goes on.
    it.runIf(dialect === "postgresql")(
      "keeps a write on a transaction the caller opened waiting until the save is over, where the pool can spare a connection",
      async () => {
        const t = await boot();
        await superAdminUser(t, TX_WRITER);
        for (const note of ["a", "b", "c"]) await insert(t, note);
        pushRoad.forced = true;
        const { paused, release } = gated(afterCount);
        const applying = apply(t, 3, REMAINING, {
          note: { action: "confirm_drop" },
        }).then(
          () => "applied",
          (error: unknown) => error
        );
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached || (await applying)).toBe(true);

        let settled = false;
        const writing = t.adapter
          .transaction(tx =>
            createInCallersTransaction(t, tx, { label: "in flow" })
          )
          .finally(() => {
            settled = true;
          });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        const heldBack = !settled;
        release();
        expect(heldBack).toBe(true);
        expect(await applying).toBe("applied");
        const outcome = await writing;
        expect(outcome, told(outcome)).toBe("created");
        expect(await hasNoteColumn(t)).toBe(false);
      },
      60_000
    );

    // An entry write holds the collection's registry row for share until it commits. One that
    // read the row before the save held the collection, and has not committed, is counted: the
    // save's hold waits for it.
    it.runIf(dialect === "mysql")(
      "counts an entry write that read the collection before the save held it",
      async () => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        expect(await reviewed()).toBe(3);
        clearRegistryRowCache();

        // Another session's entry write, under way: the registry row read for share, a value
        // written to the field, not yet committed.
        let commit: () => void = () => undefined;
        const committed = new Promise<void>(resolve => {
          commit = resolve;
        });
        let wrote: () => void = () => undefined;
        const hasWritten = new Promise<void>(resolve => {
          wrote = resolve;
        });
        const writer = t.adapter.transaction(async tx => {
          await tx.execute(
            `SELECT ${q("id")} FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}' FOR SHARE`
          );
          await tx.execute(
            `INSERT INTO ${q(TABLE)} (${["id", "title", "slug", "label", "note", "created_at", "updated_at", "_revision"].map(q).join(", ")}) VALUES ('w1', 'w1', 'w1', 'w1', 'in flight', '2026-11-20 00:00:00', '2026-11-20 00:00:00', 1)`
          );
          wrote();
          await committed;
        });
        await hasWritten;
        const applying = apply(t, 3).then(
          () => "applied",
          (error: unknown) => error
        );
        // The write commits while the save waits for it.
        await new Promise(resolve => setTimeout(resolve, 500));
        commit();
        await writer;

        expect(await applying).toMatchObject(refusedWith(4));
        expect(await hasNoteColumn(t)).toBe(true);
        expect(await notesHeld(t)).toBe(4);
      },
      60_000
    );

    /** Whether `work` ends within `ms`. */
    const endsWithin = (work: Promise<unknown>, ms: number) =>
      Promise.race([
        work.then(
          () => true,
          () => true
        ),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms)),
      ]);

    // The save holds the table against writes from its count until it commits, never against
    // reads: on PostgreSQL its lock (`SHARE ROW EXCLUSIVE`) and the advisory lock leave another
    // connection reading; on SQLite the one connection reads outside the save's transaction turn.
    it.runIf(dialect !== "mysql")(
      "lets a reader read the table from the save's count until it commits",
      async () => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const { paused, release } = gated(afterCount);
        const applying = apply(t, 3, REMAINING, {
          note: { action: "confirm_drop" },
        }).then(
          () => "applied",
          (error: unknown) => error
        );
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached || (await applying)).toBe(true);
        try {
          expect(await endsWithin(notesHeld(t), 1_000)).toBe(true);
        } finally {
          release();
        }
        expect(await applying).toBe("applied");
      },
      60_000
    );

    // A save whose table another session keeps busy past its tries stops as a busy table does,
    // with nothing deleted and the count as it was. On SQLite's one connection in memory nothing
    // else holds the table.
    it.runIf(dialect !== "sqlite")(
      "stops a save whose table stays busy past its tries, deleting nothing",
      async () => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
        vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");
        // Another session's write to the table, not yet committed, which the save's statements wait
        // behind.
        let letGo: () => void = () => undefined;
        const goes = new Promise<void>(resolve => {
          letGo = resolve;
        });
        let holding: () => void = () => undefined;
        const isHolding = new Promise<void>(resolve => {
          holding = resolve;
        });
        const holder = t.adapter.transaction(async tx => {
          await tx.execute(insertStatement(null));
          holding();
          await goes;
        });
        await isHolding;
        try {
          expect(
            await apply(t, 3, REMAINING, {
              note: { action: "confirm_drop" },
            }).then(
              () => "applied",
              (error: unknown) => error
            )
          ).toMatchObject({ code: "NEXTLY_TABLE_BUSY" });
        } finally {
          letGo();
          await holder;
        }
        expect(await hasNoteColumn(t)).toBe(true);
        expect(await notesHeld(t)).toBe(3);
      },
      60_000
    );

    // A failure between the count and the save's first statement, at the runner's stop point there,
    // deletes nothing and lets the collection go: a write after it lands at once.
    it("deletes nothing when the save fails between its count and its first statement, and lets the collection go", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const outcome = await withStopPoints(
        point => {
          if (/: before statement 1$/.test(point)) {
            throw new Error("stopped between the count and the delete");
          }
        },
        () =>
          apply(t, 3, REMAINING, { note: { action: "confirm_drop" } }).then(
            () => "applied",
            (error: unknown) => error
          )
      );
      expect(outcome).not.toBe("applied");
      expect(await hasNoteColumn(t)).toBe(true);
      expect(await notesHeld(t)).toBe(3);
      expect(
        await endsWithin(
          t.nextly.create({
            collection: SLUG,
            data: { label: "after", note: "written after the stop" },
          }),
          5_000
        )
      ).toBe(true);
      expect(await notesHeld(t)).toBe(4);
    }, 60_000);

    // A failure just after the statement that deletes: on PostgreSQL and SQLite the file's
    // transaction takes the delete back, every value there as it was and the save's files withdrawn;
    // MySQL commits the statement as it runs, so the save is told it applied part way, its file kept
    // to be settled. Either way the collection is let go: a write after it lands at once.
    it("takes its delete back, or says it stayed, when the save fails just after it, and lets the collection go", async () => {
      const t = await boot();
      for (const note of ["a", "b", "c"]) await insert(t, note);
      const filesBefore = historyFiles(t);
      const stopped = { after: "" };
      const outcome = await withStopPoints(stopAfterTheDelete(stopped), () =>
        apply(t, 3, REMAINING, { note: { action: "confirm_drop" } }).then(
          () => "applied",
          (error: unknown) => error
        )
      );
      expect(stopped.after).toContain("note");
      expect(outcome).not.toBe("applied");
      const undone = dialect !== "mysql";
      expect(await hasNoteColumn(t)).toBe(undone);
      if (undone) {
        expect(await notesHeld(t)).toBe(3);
        expect(historyFiles(t)).toEqual(filesBefore);
      } else {
        expect(JSON.stringify(outcome)).toContain(
          "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
        );
        expect(historyFiles(t).length).toBeGreaterThan(filesBefore.length);
      }
      expect(
        await endsWithin(
          t.nextly.create({ collection: SLUG, data: { label: "after" } }),
          5_000
        )
      ).toBe(true);
      if (!undone) return;
      // Counted again, whole, and deleted.
      expect(
        await apply(t, 3, REMAINING, {
          note: { action: "confirm_drop" },
        }).then(() => "applied")
      ).toBe("applied");
      expect(await hasNoteColumn(t)).toBe(false);
    }, 60_000);

    // The save's connection killed between its count and its delete (MySQL): its named locks end
    // with it, so an entry write goes ahead, and the save is told it stopped, with nothing deleted.
    it.runIf(dialect === "mysql")(
      "lets the collection go when the save's connection is killed between its count and its delete",
      async () => {
        const t = await boot();
        for (const note of ["a", "b", "c"]) await insert(t, note);
        const { paused, release } = gated(afterCount);
        const applying = apply(t, 3, REMAINING, {
          note: { action: "confirm_drop" },
        }).then(
          () => "applied",
          (error: unknown) => error
        );
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached || (await applying)).toBe(true);
        // The connection holding the collection's named locks, killed from another.
        const [database] = await sql<{ name: string }>(
          t,
          "SELECT DATABASE() AS name"
        );
        const [name] = namedCollectionLockNames(String(database?.name), [SLUG]);
        const [holder] = await sql<{ id: number | string | null }>(
          t,
          `SELECT IS_USED_LOCK('${String(name)}') AS id`
        );
        expect(holder?.id).not.toBeNull();
        await sql(t, `KILL ${String(holder?.id)}`);
        try {
          expect(
            await endsWithin(
              t.nextly.create({
                collection: SLUG,
                data: { label: "after", note: "written after the kill" },
              }),
              5_000
            )
          ).toBe(true);
        } finally {
          release();
        }
        expect(await applying).not.toBe("applied");
        expect(await hasNoteColumn(t)).toBe(true);
        expect(await notesHeld(t)).toBe(4);
      },
      60_000
    );

    // MySQL commits each schema statement as it runs: a save stopped between two statements that
    // delete is told it applied part way, its file kept, and the values the later statement would
    // have dropped are still there.
    it.runIf(dialect === "mysql")(
      "keeps the values a later deleting statement would drop when the save stops between them",
      async () => {
        const t = await boot([...NOTED, { name: "memo", type: "text" }]);
        for (const note of ["a", "b", "c"]) await insert(t, note);
        // `memo` holds the same values as `note`.
        await sql(t, `UPDATE ${q(TABLE)} SET ${q("memo")} = ${q("note")}`);
        const filesBefore = historyFiles(t);
        const version = await schemaVersion(t);
        const outcome = await withStopPoints(
          point => {
            if (/: before statement 2$/.test(point)) {
              throw new Error("stopped between the deleting statements");
            }
          },
          () =>
            dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: SLUG },
              {
                fields: REMAINING,
                confirmed: true,
                schemaVersion: version,
                resolutions: {
                  note: { action: "confirm_drop" },
                  memo: { action: "confirm_drop" },
                },
                confirmedDeletions: [
                  { field: "note", count: 3 },
                  { field: "memo", count: 3 },
                ],
              }
            ).then(
              () => "applied",
              (error: unknown) => error
            )
        );
        expect(JSON.stringify(outcome)).toContain(
          "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
        );
        expect(historyFiles(t).length).toBeGreaterThan(filesBefore.length);
        const [kept] = await sql<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM ${q(TABLE)} WHERE ${q("memo")} IS NOT NULL`
        ).catch(() => [{ n: -1 }]);
        const [left] = await sql<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM ${q(TABLE)} WHERE ${q("note")} IS NOT NULL`
        ).catch(() => [{ n: -1 }]);
        // One of the two went with the first statement; the other is still there, all three.
        expect([Number(kept?.n), Number(left?.n)].sort()).toEqual([-1, 3]);
      },
      60_000
    );

    // The save's connection killed between two statements that delete (MySQL): its named locks end
    // with it, so a write may land from then on, and the second statement must not run: what it would
    // drop was counted under a hold that is gone. The statements run on the connection that holds.
    it.runIf(dialect === "mysql")(
      "runs no later deleting statement once the connection holding the collection is gone",
      async () => {
        const t = await boot([...NOTED, { name: "memo", type: "text" }]);
        for (const note of ["a", "b", "c"]) await insert(t, note);
        // `memo` holds the same values as `note`.
        await sql(t, `UPDATE ${q(TABLE)} SET ${q("memo")} = ${q("note")}`);
        const version = await schemaVersion(t);
        const [database] = await sql<{ name: string }>(
          t,
          "SELECT DATABASE() AS name"
        );
        const [name] = namedCollectionLockNames(String(database?.name), [SLUG]);
        // Paused before the second statement, and killed from here: outside the save's own flow.
        let between: () => void = () => undefined;
        const reachedBetween = new Promise<void>(resolve => {
          between = resolve;
        });
        let letGo: () => void = () => undefined;
        const goes = new Promise<void>(resolve => {
          letGo = resolve;
        });
        const saving = withStopPoints(
          async point => {
            if (!/: before statement 2$/.test(point)) return;
            between();
            await goes;
          },
          () =>
            dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: SLUG },
              {
                fields: REMAINING,
                confirmed: true,
                schemaVersion: version,
                resolutions: {
                  note: { action: "confirm_drop" },
                  memo: { action: "confirm_drop" },
                },
                confirmedDeletions: [
                  { field: "note", count: 3 },
                  { field: "memo", count: 3 },
                ],
              }
            ).then(
              () => "applied",
              (error: unknown) => error
            )
        );
        let killed: unknown = null;
        try {
          const reached = await Promise.race([
            reachedBetween.then(() => true),
            saving.then(() => false),
          ]);
          expect(reached).toBe(true);
          const [holder] = await sql<{ id: number | string | null }>(
            t,
            `SELECT IS_USED_LOCK('${String(name)}') AS id`
          );
          killed = holder?.id ?? null;
          await sql(t, `KILL ${String(killed)}`);
        } finally {
          letGo();
        }
        const outcome = await saving;
        expect(killed).not.toBeNull();
        expect(outcome).not.toBe("applied");
        const left = async (column: string) =>
          Number(
            (
              await sql<{ n: number | string }>(
                t,
                `SELECT COUNT(*) AS n FROM ${q(TABLE)} WHERE ${q(column)} IS NOT NULL`
              ).catch(() => [{ n: -1 }])
            )[0]?.n
          );
        // One of the two went with the first statement; the other is still there, all three.
        expect([await left("memo"), await left("note")].sort()).toEqual([
          -1, 3,
        ]);
      },
      60_000
    );

    // On SQLite another connection of the file (another process is one) may hold it when the save's
    // file starts: past the tries the save stops, with nothing deleted.
    it.runIf(dialect === "sqlite")(
      "stops a save whose file another connection holds past its tries, deleting nothing",
      async () => {
        const shared = await bootShared();
        const other = await createAdapter({
          type: dialect,
          url: shared.url,
        } as Parameters<typeof createAdapter>[0]);
        try {
          vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
          vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");
          // What the save's other statements wait for the file, short of the default.
          await shared.t.adapter.executeQuery("PRAGMA busy_timeout = 500");
          const { paused, release } = gated(fileStart);
          const applying = apply(shared.t, 3, REMAINING, {
            note: { action: "confirm_drop" },
          }).then(
            () => "applied",
            (error: unknown) => error
          );
          const reached = await Promise.race([
            paused.then(() => true),
            applying.then(() => false),
          ]);
          expect(reached || (await applying)).toBe(true);
          // The other connection's write, not yet committed, which the save's file waits behind.
          let letGo: () => void = () => undefined;
          const goes = new Promise<void>(resolve => {
            letGo = resolve;
          });
          let holding: () => void = () => undefined;
          const isHolding = new Promise<void>(resolve => {
            holding = resolve;
          });
          const holder = other.transaction(async tx => {
            await tx.execute(insertStatement(null));
            holding();
            await goes;
          });
          await isHolding;
          try {
            release();
            expect(await applying).not.toBe("applied");
          } finally {
            letGo();
            await holder;
          }
          expect(await hasNoteColumn(shared.t)).toBe(true);
          expect(await notesHeld(shared.t)).toBe(3);
        } finally {
          await other.disconnect();
          await instance?.destroy();
          instance = undefined;
          await shared.drop();
          _resetEnvCache();
        }
      },
      120_000
    );

    /**
     * The app on a database another process can open (a file on SQLite, a scratch database
     * elsewhere), with its collection, three notes, and an editor signed in for the REST API. With
     * `perLanguage`, on the per-language layout, which the other copy then runs on too
     * (`childLayoutArgs`).
     */
    async function bootShared(
      options: { perLanguage?: boolean } = {}
    ): Promise<{
      t: TestNextly;
      url: string;
      cookie: string;
      drop: () => Promise<void>;
    }> {
      vi.stubEnv("NODE_ENV", "development");
      let url: string;
      let drop: () => Promise<void>;
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-delete-hold-race-"));
        url = `file:${join(dir, "site.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_dh_race");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      const t = await createTestNextly({
        adapter: (await createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0])) as never,
        ...(options.perLanguage === true ? { perLanguageStorage: true } : {}),
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Note", fields: NOTED }
      );
      for (const note of ["a", "b", "c"]) {
        // Per language, the translatable values go to the translations table, as a person writes them.
        if (options.perLanguage === true) {
          await t.nextly.create({
            collection: SLUG,
            data: { label: "l", note },
          } as never);
        } else {
          await insert(t, note);
        }
      }
      const editor = "dh-race-editor";
      await superAdminUser(t, editor);
      const cookie = `nextly_session=${await signAccessToken(
        buildClaims({
          userId: editor,
          email: `${editor}@example.test`,
          name: editor,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      )}`;
      return { t, url, cookie, drop };
    }

    /**
     * Another copy of the site, as its own process, ready to write one entry setting `note`
     * through `way` once told to (`go`), and what the write ended with (`outcome`).
     */
    async function otherCopy(
      shared: { t: TestNextly; url: string; cookie: string },
      way: "direct" | "rest",
      /** What the write sets, once it is let go. */
      data: Record<string, unknown> = {
        label: "from the other copy",
        note: "raced",
      }
    ): Promise<{
      go: () => void;
      outcome: Promise<Record<string, unknown>>;
      settled: () => boolean;
    }> {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          ...childLayoutArgs(),
          join(__dirname, "helpers", "entry-writer-copy.ts"),
          dialect,
          shared.url,
          shared.t.basePath,
          SLUG,
          way,
          JSON.stringify(data),
          // Sets only the field the save keeps, so the notes it counts stay three.
          JSON.stringify({ label: "warming up" }),
        ],
        {
          cwd: join(__dirname, "..", "..", "..", ".."),
          env: {
            ...process.env,
            NODE_ENV: "development",
            DB_DIALECT: dialect,
            DATABASE_URL: shared.url,
            NEXTLY_TEST_COOKIE: shared.cookie,
          },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      const lines: string[] = [];
      let wake: () => void = () => undefined;
      // The copy's own lines, apart from what its app logs.
      let pending = "";
      child.stdout.on("data", (chunk: Buffer) => {
        const text = pending + chunk.toString();
        const parts = text.split("\n");
        pending = parts.pop() ?? "";
        for (const line of parts) {
          if (line.startsWith("@writer ")) lines.push(line.slice(8));
        }
        wake();
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const lineAfter = (index: number): Promise<string> =>
        new Promise((resolve, reject) => {
          const look = () => {
            if (lines.length > index) resolve(String(lines[index]));
          };
          wake = look;
          child.once("exit", () => {
            look();
            reject(new Error(`the other copy ended early: ${stderr}`));
          });
          look();
        });
      expect(await lineAfter(0)).toBe("ready");
      let done = false;
      const outcome = lineAfter(1).then(line => {
        done = true;
        return JSON.parse(line) as Record<string, unknown>;
      });
      return {
        go: () => {
          child.stdin.write("go\n");
        },
        outcome,
        settled: () => done,
      };
    }

    // An entry write from another copy of the site, as its own process, through either door, sent
    // while the save holds the collection after its count: it waits for the save, held across
    // processes, and is then refused naming the field it set, never written into the field just
    // before the save drops it. On SQLite a save the push applies holds the collection in its own
    // process alone, a stated limit, so only its file road is raced from another process.
    for (const way of ["direct", "rest"] as const) {
      for (const road of ["file", "push"] as const) {
        it.skipIf(road === "push" && dialect === "sqlite")(
          `holds a write from another copy through the ${way === "direct" ? "Direct API" : "REST API"} until the save on the ${road} road is recorded, then refuses its value for the removed field`,
          async () => {
            const shared = await bootShared();
            try {
              const writer = await otherCopy(shared, way);
              pushRoad.forced = road === "push";
              const { paused, release } = gated(afterCount);
              const applying = apply(shared.t, 3, REMAINING, {
                note: { action: "confirm_drop" },
              }).then(
                () => "applied",
                (error: unknown) => error
              );
              const reached = await Promise.race([
                paused.then(() => true),
                applying.then(() => false),
              ]);
              expect(reached || (await applying)).toBe(true);

              writer.go();
              await new Promise(resolve => setTimeout(resolve, 1_500));
              const heldBack = !writer.settled();
              release();
              expect(heldBack).toBe(true);
              expect(await applying).toBe("applied");
              const outcome = await writer.outcome;
              // Never written: refused, and no row added beside the three.
              expect(outcome.ok, JSON.stringify(outcome)).toBeUndefined();
              const [rows] = await sql<{ n: number | string }>(
                shared.t,
                `SELECT COUNT(*) AS n FROM ${q(TABLE)}`
              );
              expect(Number(rows?.n)).toBe(3);
              expect(await hasNoteColumn(shared.t)).toBe(false);
              // Refused naming the field it set. A REST write from another process on SQLite can
              // reach the database once the save is over, and is refused there instead, still
              // with nothing written.
              if (!(dialect === "sqlite" && way === "rest")) {
                expect(outcome, JSON.stringify(outcome)).toMatchObject({
                  code: "VALIDATION_ERROR",
                  errors: [
                    expect.objectContaining({
                      path: "fields.note",
                      code: "FIELD_REMOVED",
                    }),
                  ],
                });
              }
            } finally {
              await instance?.destroy();
              instance = undefined;
              await shared.drop();
              _resetEnvCache();
            }
          },
          120_000
        );
      }
    }

    // A write from another copy that sets only a field the save keeps waits while the save holds the
    // collection, then is applied as it would have been before the hold: the rows it writes are the
    // ones the save left, and the field the save removed is not there to set.
    for (const way of ["direct", "rest"] as const) {
      for (const road of ["file", "push"] as const) {
        it.skipIf(road === "push" && dialect === "sqlite")(
          `applies a write of a kept field from another copy through the ${way === "direct" ? "Direct API" : "REST API"}, once the save on the ${road} road has let it go`,
          async () => {
            const shared = await bootShared();
            try {
              const writer = await otherCopy(shared, way, { label: "kept" });
              pushRoad.forced = road === "push";
              const { paused, release } = gated(afterCount);
              const applying = apply(shared.t, 3, REMAINING, {
                note: { action: "confirm_drop" },
              }).then(
                () => "applied",
                (error: unknown) => error
              );
              const reached = await Promise.race([
                paused.then(() => true),
                applying.then(() => false),
              ]);
              expect(reached || (await applying)).toBe(true);

              writer.go();
              await new Promise(resolve => setTimeout(resolve, 1_500));
              const heldBack = !writer.settled();
              release();
              expect(heldBack).toBe(true);
              expect(await applying).toBe("applied");
              const outcome = await writer.outcome;
              expect(outcome, JSON.stringify(outcome)).toEqual({ ok: true });
              // Applied: one entry beside the three, none of it lost, the removed field gone.
              const [rows] = await sql<{ n: number | string }>(
                shared.t,
                `SELECT COUNT(*) AS n FROM ${q(TABLE)}`
              );
              expect(Number(rows?.n)).toBe(4);
              expect(await hasNoteColumn(shared.t)).toBe(false);
            } finally {
              await instance?.destroy();
              instance = undefined;
              await shared.drop();
              _resetEnvCache();
            }
          },
          120_000
        );
      }
    }

    // On per-language storage the collection's translatable values are in its translations table,
    // and the registry row is written after the file, once that table is brought in step: a write
    // from another copy, sent after the count, waits until that row is written, never landing
    // between the file and the row. Raced across processes, since a write there waits at the
    // database's own hold. On SQLite the save holds the collection in its own process alone after
    // the file's transaction, a stated limit.
    it.skipIf(dialect === "sqlite")(
      "holds a write from another copy until a per-language save on the file road is recorded, then refuses its value for the removed field",
      async () => {
        const shared = await bootShared({ perLanguage: true });
        try {
          const writer = await otherCopy(shared, "direct");
          const { paused, release } = gated(afterCount);
          const applying = apply(shared.t, 3, REMAINING, {
            note: { action: "confirm_drop" },
          }).then(
            () => "applied",
            (error: unknown) => error
          );
          const reached = await Promise.race([
            paused.then(() => true),
            applying.then(() => false),
          ]);
          expect(reached || (await applying)).toBe(true);

          writer.go();
          await new Promise(resolve => setTimeout(resolve, 1_500));
          const heldBack = !writer.settled();
          // The span between the file and the registry row, made long enough to land in.
          slowRegistry.ms = 1_500;
          release();
          expect(heldBack).toBe(true);
          expect(await applying).toBe("applied");
          const outcome = await writer.outcome;
          expect(outcome, JSON.stringify(outcome)).toMatchObject({
            code: "VALIDATION_ERROR",
            errors: [
              expect.objectContaining({
                path: "fields.note",
                code: "FIELD_REMOVED",
              }),
            ],
          });
          const [rows] = await sql<{ n: number | string }>(
            shared.t,
            `SELECT COUNT(*) AS n FROM ${q(TABLE)}`
          );
          expect(Number(rows?.n)).toBe(3);
        } finally {
          await instance?.destroy();
          instance = undefined;
          await shared.drop();
          _resetEnvCache();
        }
      },
      120_000
    );
  }
);

// The same counts and holds on the storage layout every installation runs: translatable fields
// kept per language. A Builder collection's text field is translatable, so the removed field's
// values are in the collection's translations table, where the review counts them, the save
// counts them again before it deletes them, and an entry write writes them.
describe.each(getConfiguredTestDialects())(
  "a save that removes a field deletes the count confirmed, on per-language storage (%s)",
  dialect => {
    const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);
    const VALUES_TABLE = `${TABLE}${STORAGE_FORMAT.companionSuffix}`;

    async function bootPerLanguage(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Note", fields: NOTED }
      );
      return t;
    }

    const query = <T>(t: TestNextly, text: string): Promise<T[]> =>
      (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(text);

    /** An entry with `note` set, written as a person writes it. */
    const write = (t: TestNextly, note: string) =>
      t.nextly.create({
        collection: SLUG,
        data: { label: "l", note },
      } as never);

    /** The `note` values the translations table holds, or `"gone"` once its column is. */
    async function translatedNotes(t: TestNextly): Promise<number | "gone"> {
      try {
        const [row] = await query<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM ${q(VALUES_TABLE)} WHERE ${q("note")} IS NOT NULL`
        );
        return Number(row?.n);
      } catch {
        return "gone";
      }
    }

    async function save(t: TestNextly, confirmed: number): Promise<unknown> {
      const [row] = await query<{ v: number | string | null }>(
        t,
        `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: REMAINING,
          confirmed: true,
          schemaVersion: Number(row?.v ?? 1),
          resolutions: { note: { action: "confirm_drop" } },
          confirmedDeletions: [{ field: "note", count: confirmed }],
        }
      ).then(
        () => "applied",
        (error: unknown) => error
      );
    }

    it("counts the removed field's values in the translations table, and deletes them when the count is still the one confirmed", async () => {
      const t = await bootPerLanguage();
      for (const note of ["a", "b", "c"]) await write(t, note);
      expect(await translatedNotes(t)).toBe(3);

      expect(await save(t, 3)).toBe("applied");
      expect(await translatedNotes(t)).toBe("gone");
    }, 60_000);

    it("deletes nothing and names the new count when a value was written to the translations table after the review", async () => {
      const t = await bootPerLanguage();
      for (const note of ["a", "b", "c"]) await write(t, note);
      await write(t, "written after the review");

      expect(await save(t, 3)).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.note",
              code: "DELETION_COUNT_CHANGED",
            }),
          ],
        },
      });
      expect(await translatedNotes(t)).toBe(4);

      // The new count, confirmed, is deleted.
      expect(await save(t, 4)).toBe("applied");
      expect(await translatedNotes(t)).toBe("gone");
    }, 60_000);

    // The span between the save's file and its registry row, held open: the row is written after
    // the file here, once the translations table is in step. A write sent in that span, setting the
    // removed field, waits until the row is written, on every database, and nothing of it lands. On
    // MySQL the file's own try lets the collection go with the file, so the save holds it beside the
    // file until the row is written. This process's own definition already lacks the field once the
    // file has run, so the write cannot name it as a field of its collection: it fails on the
    // column instead, with nothing written. A write from another process, made from the definition
    // it loaded, is refused naming it (below).
    it("keeps an entry write sent between the file and its registry row waiting, and lets nothing of it land", async () => {
      const t = await bootPerLanguage();
      for (const note of ["a", "b", "c"]) await write(t, note);
      const { paused, release } = gated(registryWrite);
      const applying = save(t, 3);
      const reached = await Promise.race([
        paused.then(() => true),
        applying.then(() => false),
      ]);
      expect(reached || (await applying)).toBe(true);

      let settled = false;
      const writing = write(t, "written between the file and the row")
        .then(
          () => "created",
          (error: unknown) => error
        )
        .finally(() => {
          settled = true;
        });
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const heldBack = !settled;
      release();
      expect(heldBack).toBe(true);
      expect(await applying).toBe("applied");
      const outcome = await writing;
      expect(outcome, told(outcome)).not.toBe("created");
      expect(await translatedNotes(t)).toBe("gone");
      const [rows] = await query<{ n: number | string }>(
        t,
        `SELECT COUNT(*) AS n FROM ${q(TABLE)}`
      );
      expect(Number(rows?.n)).toBe(3);
    }, 60_000);

    // An entry write sent after the save's count, setting the removed field: on either road it
    // waits while the save holds the collection, through the registry write, and is then refused
    // naming the field, never written into the translations table just before the save drops it.
    for (const road of ["file", "push"] as const) {
      it(`keeps an entry write sent after the count waiting until the save on the ${road} road is recorded, then refuses its value for the removed field`, async () => {
        const t = await bootPerLanguage();
        for (const note of ["a", "b", "c"]) await write(t, note);
        pushRoad.forced = road === "push";
        const { paused, release } = gated(afterCount);
        const applying = save(t, 3);
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached || (await applying)).toBe(true);

        let settled = false;
        const writing = write(t, "written after the count")
          .then(
            () => "created",
            (error: unknown) => error
          )
          .finally(() => {
            settled = true;
          });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        const heldBack = !settled;
        slowRegistry.ms = 1_500;
        release();
        expect(heldBack).toBe(true);
        expect(await applying).toBe("applied");
        // Refused by the hold's own check, naming the field: not a database error a write into the
        // dropped column would end with, which a hold let go before the registry write leaves.
        expect(await writing).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.note",
                code: "FIELD_REMOVED",
              }),
            ],
          },
        });
        expect(await translatedNotes(t)).toBe("gone");
      }, 60_000);
    }

    /** The collection's fields as its registry row has them, and that row's version. */
    async function recorded(
      t: TestNextly
    ): Promise<{ fields: string[]; version: number }> {
      const [row] = await query<{ f: unknown; v: number | string }>(
        t,
        `SELECT ${q("fields")} AS f, ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
      );
      const fields = (
        typeof row?.f === "string" ? JSON.parse(row.f) : row?.f
      ) as { name: string }[];
      return {
        fields: fields.map(field => field.name),
        version: Number(row?.v),
      };
    }

    /** The values `column` holds in the translations table, or `"gone"` once it is. */
    const valuesIn = async (
      t: TestNextly,
      column: string
    ): Promise<number | "gone"> =>
      query<{ n: number | string }>(
        t,
        `SELECT COUNT(*) AS n FROM ${q(VALUES_TABLE)} WHERE ${q(column)} IS NOT NULL`
      ).then(
        ([row]) => Number(row?.n),
        () => "gone" as const
      );

    /** A view on `column`, which PostgreSQL and SQLite refuse to drop the column under. */
    const viewOn = (t: TestNextly, column: string) =>
      query(
        t,
        `CREATE VIEW ${q("dh_reads_it")} AS SELECT ${q(column)} FROM ${q(VALUES_TABLE)}`
      );
    const dropView = (t: TestNextly) =>
      query(t, `DROP VIEW ${q("dh_reads_it")}`);

    /** A save to `fields` that removes `removed`, each of three values. */
    async function saveRemoving(
      t: TestNextly,
      fields: readonly Record<string, unknown>[],
      removed: readonly string[]
    ): Promise<unknown> {
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields,
          confirmed: true,
          schemaVersion: (await recorded(t)).version,
          resolutions: Object.fromEntries(
            removed.map(field => [field, { action: "confirm_drop" }])
          ),
          confirmedDeletions: removed.map(field => ({ field, count: 3 })),
        }
      ).then(
        () => "applied",
        (error: unknown) => error
      );
    }

    /** Three entries, each with a label, a note and a memo, on a collection with the three fields. */
    async function bootWithMemo(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Note",
          fields: [...NOTED, { name: "memo", type: "text" }],
        }
      );
      for (const note of ["a", "b", "c"]) {
        await t.nextly.create({
          collection: SLUG,
          data: { label: "l", note, memo: note },
        } as never);
      }
      return t;
    }

    // A save stopped between its file and the translations table's delete leaves the field out of the
    // registry with its column and values still stored, and its row's version where it was: the
    // version moves in the write after that step. (Such a save does more to translations than remove
    // fields, or runs on MySQL.) A write that waited, made from the earlier
    // definition and setting the field, is refused naming it. Compared by the version alone it finds
    // nothing changed, and its value is stored in a column the collection no longer has.
    it.each([
      {
        op: "create",
        send: (t: TestNextly) => write(t, "sent while the save held"),
      },
      {
        op: "update",
        send: (t: TestNextly, id: string) =>
          t.nextly.update({
            collection: SLUG,
            id,
            data: { note: "sent while the save held", _overwrite: true },
          } as never),
      },
    ])(
      "refuses a held $op setting the removed field after a save stopped before the translations table's delete",
      async ({ send }) => {
        const t = await bootWithMemo();
        const id = await firstId(t);
        translationsStep.fails = true;
        const { paused, release } = gated(afterCount);
        // On MySQL the unique index is a file of its own, run after the one that records the new
        // definition: a write sent at the count would be made from that one. The removal alone
        // drops after its file there.
        const memo =
          dialect === "mysql"
            ? { name: "memo", type: "text" }
            : { name: "memo", type: "text", unique: true };
        const applying = saveRemoving(
          t,
          [{ name: "label", type: "text" }, memo],
          ["note"]
        );
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached || (await applying)).toBe(true);
        let settled = false;
        const writing = send(t, id)
          .then(
            () => "written",
            (error: unknown) => error
          )
          .finally(() => {
            settled = true;
          });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        const heldBack = !settled;
        release();
        expect(heldBack).toBe(true);
        expect(await applying).not.toBe("applied");
        expect(translationsStep.failed).toBe(true);
        const outcome = await writing;
        expect(outcome, told(outcome)).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.note",
                code: "FIELD_REMOVED",
              }),
            ],
          },
        });
        // The values counted are there still, and nothing beside them.
        expect(await translatedNotes(t)).toBe(3);
        const [sent] = await query<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM ${q(VALUES_TABLE)} WHERE ${q("note")} = 'sent while the save held'`
        );
        expect(Number(sent?.n)).toBe(0);
      },
      60_000
    );

    // On PostgreSQL and SQLite the whole of a save that only removes translated fields is one
    // transaction: a drop the database refuses leaves the registry, every value and the files as
    // they were, whichever of the fields it was, and the same save applies once nothing refuses it.
    // Dropped after the file, the fields are out of the registry with a column still stored, or one
    // of them is gone and the other not.
    it.skipIf(dialect === "mysql").each([
      { removed: ["note"], refused: "note" },
      { removed: ["note", "memo"], refused: "note" },
      { removed: ["note", "memo"], refused: "memo" },
    ])(
      "changes nothing when the database refuses the drop of $refused in a save removing $removed",
      async ({ removed, refused }) => {
        const t = await bootWithMemo();
        const kept = [
          { name: "label", type: "text" },
          { name: "note", type: "text" },
          { name: "memo", type: "text" },
        ].filter(field => !removed.includes(field.name));
        const before = await recorded(t);
        const dir = join(t.basePath, "database", "history");
        const filesBefore = readdirSync(dir).sort();
        await viewOn(t, refused);

        expect(await saveRemoving(t, kept, removed)).not.toBe("applied");

        expect(await recorded(t)).toEqual(before);
        expect(await valuesIn(t, "note")).toBe(3);
        expect(await valuesIn(t, "memo")).toBe(3);
        expect(readdirSync(dir).sort()).toEqual(filesBefore);
        // The collection is as it was: a write setting the field lands.
        await write(t, "after the refusal");
        expect(await valuesIn(t, "note")).toBe(4);
        await query(
          t,
          `DELETE FROM ${q(VALUES_TABLE)} WHERE ${q("note")} = 'after the refusal'`
        );

        await dropView(t);
        expect(await saveRemoving(t, kept, removed)).toBe("applied");
        for (const field of removed) {
          expect(await valuesIn(t, field)).toBe("gone");
        }
        expect((await recorded(t)).fields).toEqual(
          kept.map(field => field.name)
        );
        expect((await recorded(t)).version).toBeGreaterThan(before.version);
      },
      60_000
    );

    // The drops join the file's transaction: the registry row refused after them takes them back,
    // with the file. Run in a transaction of their own they would be gone by then.
    it.skipIf(dialect === "mysql")(
      "drops nothing when its registry row is refused after the drops",
      async () => {
        const t = await bootWithMemo();
        const before = await recorded(t);
        const dir = join(t.basePath, "database", "history");
        const filesBefore = readdirSync(dir).sort();
        refusedRegistry.on = true;
        expect(
          await saveRemoving(
            t,
            [{ name: "label", type: "text" }],
            ["note", "memo"]
          )
        ).not.toBe("applied");
        expect(refusedRegistry.refused).toBe(1);
        refusedRegistry.on = false;
        expect(await recorded(t)).toEqual(before);
        expect(await valuesIn(t, "note")).toBe(3);
        expect(await valuesIn(t, "memo")).toBe(3);
        expect(readdirSync(dir).sort()).toEqual(filesBefore);
      },
      60_000
    );

    // With no transaction open to join, the drops refuse to run, rather than commit on their own
    // while the file and the registry row may not land.
    it.skipIf(dialect === "mysql")(
      "refuses to drop outside the file's transaction, dropping nothing",
      async () => {
        const t = await bootWithMemo();
        // A save refused before it changes anything leaves what its file would have dropped to ask.
        refusedRegistry.on = true;
        await saveRemoving(
          t,
          [
            { name: "label", type: "text" },
            { name: "memo", type: "text" },
          ],
          ["note"]
        );
        refusedRegistry.on = false;
        const drops = await lastRoad.inFile?.();
        expect(drops).toBeTypeOf("function");
        await expect(drops?.()).rejects.toMatchObject({
          code: "INTERNAL_ERROR",
        });
        expect(await valuesIn(t, "note")).toBe(3);
      },
      60_000
    );

    // Only the file's transaction runs the drops, so only a save whose file runs asks what they are:
    // not one the push applies, and not one outside development, which changes nothing here.
    it.skipIf(dialect === "mysql")(
      "asks what its file would drop only where its file runs",
      async () => {
        const t = await bootWithMemo();
        const fields = [
          { name: "label", type: "text" },
          { name: "memo", type: "text" },
        ];
        const { paused, release } = gated(afterCount);
        pushRoad.forced = true;
        plans.made = 0;
        const pushing = saveRemoving(t, fields, ["note"]);
        const reached = await Promise.race([
          paused.then(() => true),
          pushing.then(() => false),
        ]);
        const beforeThePush = plans.made;
        const { version } = await recorded(t);
        release();
        expect(reached).toBe(true);
        expect(beforeThePush).toBe(0);
        // The push's own step drops the field, and its row is written once, after it.
        expect(await pushing).toBe("applied");
        expect(await recorded(t)).toEqual({
          fields: ["label", "memo"],
          version: version + 1,
        });
        expect(await valuesIn(t, "note")).toBe("gone");

        pushRoad.forced = false;
        vi.stubEnv("NODE_ENV", "production");
        plans.made = 0;
        expect(
          await saveRemoving(t, [{ name: "label", type: "text" }], ["memo"])
        ).toBe("applied");
        expect(plans.made).toBe(0);
        expect(await valuesIn(t, "memo")).toBe(3);
      },
      60_000
    );

    // A save that does more to translations than remove fields (here it makes one unique in each
    // language too) brings the translations table in step after its file, as every such save does:
    // the file has committed when the drop is refused.
    it.skipIf(dialect === "mysql")(
      "drops after its file, as before, in a save that also makes a translated field unique",
      async () => {
        const t = await bootWithMemo();
        await viewOn(t, "note");
        const fields = [
          { name: "label", type: "text" },
          { name: "memo", type: "text", unique: true },
        ];
        expect(await saveRemoving(t, fields, ["note"])).not.toBe("applied");
        expect((await recorded(t)).fields).toEqual(["label", "memo"]);
        expect(await valuesIn(t, "note")).toBe(3);
      },
      60_000
    );

    // The translations table held by a reader when the save drops its column: PostgreSQL keeps the
    // drop waiting, and past the tries the save stops as a busy table does, with nothing changed.
    it.runIf(dialect === "postgresql")(
      "changes nothing when the translations table stays busy past the drop's tries",
      async () => {
        const t = await bootWithMemo();
        const before = await recorded(t);
        vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
        vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");
        let letGo: () => void = () => undefined;
        const goes = new Promise<void>(resolve => {
          letGo = resolve;
        });
        let reading: () => void = () => undefined;
        const isReading = new Promise<void>(resolve => {
          reading = resolve;
        });
        // Another session's read, its transaction left open: no write waits for it, and the drop does.
        const reader = t.adapter.transaction(async tx => {
          await tx.execute(`SELECT COUNT(*) FROM ${q(VALUES_TABLE)}`);
          reading();
          await goes;
        });
        await isReading;
        try {
          expect(
            await saveRemoving(
              t,
              [
                { name: "label", type: "text" },
                { name: "memo", type: "text" },
              ],
              ["note"]
            )
          ).toMatchObject({ code: "NEXTLY_TABLE_BUSY" });
        } finally {
          letGo();
          await reader;
        }
        expect(await recorded(t)).toEqual(before);
        expect(await valuesIn(t, "note")).toBe(3);
      },
      60_000
    );

    /** What came of `send`, sent while the save on `road` holds the collection after its count. */
    async function heldBySave(
      t: TestNextly,
      road: "file" | "push",
      send: () => Promise<unknown>
    ): Promise<unknown> {
      pushRoad.forced = road === "push";
      const { paused, release } = gated(afterCount);
      const applying = save(t, 3);
      const reached = await Promise.race([
        paused.then(() => true),
        applying.then(() => false),
      ]);
      expect(reached || (await applying)).toBe(true);
      let settled = false;
      const writing = send()
        .then(
          () => "written",
          (error: unknown) => error
        )
        .finally(() => {
          settled = true;
        });
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const heldBack = !settled;
      release();
      expect(heldBack).toBe(true);
      expect(await applying).toBe("applied");
      return writing;
    }

    /** The first entry's id. */
    async function firstId(t: TestNextly): Promise<string> {
      const [first] = await query<{ id: unknown }>(
        t,
        `SELECT ${q("id")} AS id FROM ${q(TABLE)} ORDER BY ${q("id")}`
      );
      return String(first?.id);
    }

    // A held write that sets only what the save keeps is made again here too: its values are read
    // from and written to the translations table as the save left it, without the removed column,
    // and its before hook runs once. Made again through the tables of before the save, it fails on
    // that column; made whole again, its hook runs twice.
    for (const road of ["file", "push"] as const) {
      it.each(HOOKED_WRITES)(
        `runs a before hook once for a held $op made again after a save on the ${road} road, and stores what the hook set in the translations table`,
        async ({ phase, write: send }) => {
          const t = await bootPerLanguage();
          for (const note of ["a", "b", "c"]) await write(t, note);
          const id = await firstId(t);
          let runs = 0;
          t.hooks.register(phase, SLUG, context => {
            runs += 1;
            return {
              ...(context.data as Record<string, unknown>),
              label: `set by run ${String(runs)}`,
            };
          });
          const outcome = await heldBySave(t, road, () => send(t, id));
          expect(outcome, told(outcome)).toBe("written");
          expect(runs).toBe(1);
          const stored = await query<{ label: unknown }>(
            t,
            `SELECT ${q("label")} AS label FROM ${q(VALUES_TABLE)} WHERE ${q("label")} LIKE 'set by%'`
          );
          expect(stored.map(row => row.label)).toEqual(["set by run 1"]);
          expect(await translatedNotes(t)).toBe("gone");
        },
        60_000
      );

      it(`deletes the entry of a held delete made again after a save on the ${road} road, its before hook run once`, async () => {
        const t = await bootPerLanguage();
        for (const note of ["a", "b", "c"]) await write(t, note);
        const id = await firstId(t);
        let runs = 0;
        t.hooks.register("beforeDelete", SLUG, () => {
          runs += 1;
        });
        const outcome = await heldBySave(t, road, () =>
          t.nextly.delete({ collection: SLUG, id })
        );
        expect(outcome, told(outcome)).toBe("written");
        expect(runs).toBe(1);
        for (const table of [TABLE, VALUES_TABLE]) {
          const [rows] = await query<{ n: number | string }>(
            t,
            `SELECT COUNT(*) AS n FROM ${q(table)}`
          );
          expect(Number(rows?.n)).toBe(2);
        }
      }, 60_000);
    }
  }
);

// A PostgreSQL app whose pool keeps one connection, as a serverless deploy often configures it. The
// save's hold is kept on a connection for as long as the save holds the collection, so it is opened
// beside the pool: kept on the pool's one connection, the save's count and statements would wait
// for a second one that never comes.
describe.runIf(getConfiguredTestDialects().includes("postgresql"))(
  "a save that removes a field, on a PostgreSQL pool of one connection",
  () => {
    let drop: (() => Promise<void>) | undefined;
    afterEach(async () => {
      await instance?.destroy();
      instance = undefined;
      await drop?.();
      drop = undefined;
    });

    async function bootOnPoolOfOne(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      const scratch = await createScratchDatabase(
        "postgresql",
        "nextly_dh_pool1"
      );
      drop = scratch.drop;
      vi.stubEnv("DB_DIALECT", "postgresql");
      vi.stubEnv("DATABASE_URL", scratch.url);
      _resetEnvCache();
      const t = await createTestNextly({
        adapter: (await createAdapter({
          type: "postgresql",
          url: scratch.url,
          // A wait for a connection the pool cannot give ends here, rather than the case's own
          // time limit.
          pool: { max: 1, connectionTimeoutMs: 10_000 },
        } as Parameters<typeof createAdapter>[0])) as never,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Note", fields: NOTED }
      );
      for (const note of ["a", "b"]) {
        await t.nextly.create({
          collection: SLUG,
          data: { label: "l", note },
        } as never);
      }
      return t;
    }

    const query = <T>(t: TestNextly, text: string): Promise<T[]> =>
      (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(text);

    /** The `note` values the table holds, or `"gone"` once its column is. */
    async function notes(t: TestNextly): Promise<number | "gone"> {
      try {
        const [row] = await query<{ n: number | string }>(
          t,
          `SELECT COUNT(*) AS n FROM "${TABLE}" WHERE "note" IS NOT NULL`
        );
        return Number(row?.n);
      } catch {
        return "gone";
      }
    }

    /** A save removing `note`, its two values confirmed, as the admin sends it. */
    async function save(t: TestNextly): Promise<unknown> {
      const [row] = await query<{ v: number | string | null }>(
        t,
        `SELECT "schema_version" AS v FROM "dynamic_collections" WHERE "slug" = '${SLUG}'`
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: REMAINING,
          confirmed: true,
          schemaVersion: Number(row?.v ?? 1),
          resolutions: { note: { action: "confirm_drop" } },
          confirmedDeletions: [{ field: "note", count: 2 }],
        }
      ).then(
        () => "applied",
        (error: unknown) => error
      );
    }

    /** What `work` ends with, or "still waiting" where it has not ended `ms` later. */
    const within = <T>(work: Promise<T>, ms: number) =>
      Promise.race([
        work,
        new Promise<"still waiting">(resolve =>
          setTimeout(() => resolve("still waiting"), ms)
        ),
      ]);

    for (const road of ["file", "push"] as const) {
      it(`applies a save on the ${road} road that deletes the count confirmed`, async () => {
        const t = await bootOnPoolOfOne();
        expect(await notes(t)).toBe(2);
        pushRoad.forced = road === "push";

        expect(await save(t)).toBe("applied");
        expect(await notes(t)).toBe("gone");
      }, 60_000);

      // A write sent while the save holds the collection waits without keeping the pool's one
      // connection, which the save needs for the rest of its work: it ends when the save does, not
      // when the write gives up.
      it(`finishes a save on the ${road} road while a write sent during it waits`, async () => {
        const t = await bootOnPoolOfOne();
        pushRoad.forced = road === "push";
        const { paused, release } = gated(afterCount);
        const applying = save(t);
        const reached = await Promise.race([
          paused.then(() => true),
          applying.then(() => false),
        ]);
        expect(reached || (await applying)).toBe(true);

        let settled = false;
        // On the file road the write cannot open its transaction until the file's, which keeps the
        // pool's one connection, has ended: it is made from the definition the save left, so it
        // sets only what that keeps. On the push road nothing of the save's keeps the connection, so
        // the write is made from the earlier definition, and its value for the removed field is
        // refused.
        const writing = t.nextly
          .create({
            collection: SLUG,
            data:
              road === "push"
                ? { label: "during", note: "late" }
                : { label: "during" },
          } as never)
          .then(
            () => "created",
            (error: unknown) => error
          )
          .finally(() => {
            settled = true;
          });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        const heldBack = !settled;
        release();
        expect(await within(applying, 15_000)).toBe("applied");
        expect(heldBack).toBe(true);
        const outcome = await writing;
        if (road === "file") {
          expect(outcome, told(outcome)).toBe("created");
          return;
        }
        expect(outcome, told(outcome)).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.note",
                code: "FIELD_REMOVED",
              }),
            ],
          },
        });
      }, 60_000);
    }

    // A write on a transaction its caller opened cannot be given up and opened again, and on a pool
    // of one it keeps the connection the save needs: it is refused at once, with nothing written.
    it("refuses at once a write on a transaction the caller opened while the save holds the collection", async () => {
      const t = await bootOnPoolOfOne();
      await superAdminUser(t, TX_WRITER);
      pushRoad.forced = true;
      const { paused, release } = gated(afterCount);
      const applying = save(t);
      const reached = await Promise.race([
        paused.then(() => true),
        applying.then(() => false),
      ]);
      expect(reached || (await applying)).toBe(true);

      const outcome = await within(
        t.adapter.transaction(tx =>
          createInCallersTransaction(t, tx, { label: "in flow" })
        ),
        5_000
      );
      release();
      expect(JSON.stringify(outcome)).toContain("being changed elsewhere");
      expect(await within(applying, 15_000)).toBe("applied");
    }, 60_000);
  }
);
