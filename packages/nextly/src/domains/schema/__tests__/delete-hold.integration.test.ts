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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { consoleLogger } from "../../../shared/types";
import { holdEntityForWrite } from "../../collections/services/entry-write-hold";
import {
  asCreatedBefore,
  withNoHistory,
} from "../builder-save/__tests__/helpers/older-table";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { namedCollectionLockNames } from "../../dynamic-collections/services/dynamic-collection-registry-service";
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
vi.mock("../migrate/split-sql", async importOriginal => {
  const real = await importOriginal<typeof import("../migrate/split-sql")>();
  return {
    ...real,
    splitSqlStatements: (
      ...args: Parameters<typeof real.splitSqlStatements>
    ) => {
      const statements = real.splitSqlStatements(...args);
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
  // A save a failed case left at a gate goes on, so its transaction ends before the app does.
  fileStart.letGo?.();
  afterCount.letGo?.();
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

    async function boot(): Promise<TestNextly> {
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
          fields: NOTED,
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
    }, 60_000);

    // The push road holds the collection on MySQL from its count until the push has ended, on a
    // connection of the save's own, and an entry write waits at its named locks. PostgreSQL holds
    // nothing on the push road (a stated limit), so there the same write lands at once: the
    // control that this case tells a held road from one that is not. SQLite's suite runs in
    // memory, on one connection, where nothing else writes while the save runs.
    it.skipIf(dialect === "sqlite")(
      "keeps an entry write sent between the count and the push waiting on MySQL, then writes it to the new shape",
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
        // hold an entry write takes first (`holdEntityForWrite`, the collection's share side on
        // MySQL, nothing elsewhere), then the row.
        let landed = false;
        const registry = new DynamicCollectionService(t.adapter, consoleLogger);
        const writing = t.adapter
          .transaction(async tx => {
            await holdEntityForWrite(tx, SLUG, registry, dialect);
            await tx.execute(insertStatement(null));
          })
          .then(() => {
            landed = true;
          });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        expect(landed).toBe(dialect !== "mysql");

        release();
        expect(await applying).toBe("applied");
        // The push road's hold, on MySQL alone.
        expect(releaseFails.holds).toBe(dialect === "mysql" ? 1 : 0);
        await writing;
        expect(landed).toBe(true);
        expect(await hasNoteColumn(t)).toBe(false);
      },
      60_000
    );

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
          await holdEntityForWrite(tx, SLUG, registry, dialect);
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
        expect(outcome).toMatchObject({
          code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.note",
                code: "DELETION_COUNT_CHANGED",
              }),
            ],
          },
        });
        expect(
          (outcome as { publicMessage?: string }).publicMessage ?? ""
        ).toContain("The database now holds part of this change");
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

    // MySQL commits a schema statement as it runs, so no transaction holds the table from the
    // count to the drop: the save holds the collection on the try's connection, as a collection
    // delete does, and an entry write takes the collection's hold before it writes.
    it.runIf(dialect === "mysql")(
      "keeps an entry write waiting from the count until the save is over, then writes it to the new shape",
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
  }
);
