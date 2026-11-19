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
 *   translated collection, whose save the push applies in development.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

// A gate before each migration file's first statement on the file road (`runWritten` asks the
// required-column refusal before any statement of the file), outside the file's transaction.
const fileStart = vi.hoisted(() => ({
  armed: false,
  paused: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
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

// A gate just after the save's count, inside the file's transaction, with the table held.
const afterCount = vi.hoisted(() => ({
  armed: false,
  paused: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
}));
vi.mock("../builder-save/deletion-counts", async importOriginal => {
  const real =
    await importOriginal<typeof import("../builder-save/deletion-counts")>();
  return {
    ...real,
    deletionHoldOf: (...args: Parameters<typeof real.deletionHoldOf>) => {
      const hold = real.deletionHoldOf(...args);
      if (hold === undefined) return hold;
      return {
        ...hold,
        async check(db: unknown) {
          await hold.check(db);
          if (afterCount.armed) {
            afterCount.paused?.();
            await afterCount.release;
          }
        },
      };
    },
  };
});

let instance: TestNextly | undefined;
afterEach(async () => {
  fileStart.armed = false;
  afterCount.armed = false;
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

const SLUG = "dh_notes";
const TABLE = "dc_dh_notes";
const REMAINING = [{ name: "label", type: "text" }];

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
          fields: [
            { name: "label", type: "text" },
            { name: "note", type: "text" },
          ],
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
      await sql(
        t,
        `INSERT INTO ${q(TABLE)} (${cols.map(q).join(", ")}) VALUES (${values.join(", ")})`
      );
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
    async function reviewed(): Promise<number | undefined> {
      const body = (await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: SLUG },
        { fields: REMAINING }
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
      confirmed: number | undefined
    ): Promise<unknown> {
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: REMAINING,
          confirmed: true,
          schemaVersion: await schemaVersion(t),
          ...(confirmed === undefined
            ? {}
            : { confirmedDeletions: [{ field: "note", count: confirmed }] }),
        }
      );
    }

    const historyFiles = (t: TestNextly) =>
      readdirSync(join(t.basePath, "database", "history")).sort();

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

      await expect(apply(t, undefined)).resolves.toBeDefined();
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

    // PostgreSQL holds the table against writes from the count to the commit. SQLite's suite runs
    // in memory, on one connection, and MySQL holds no table across its schema statements.
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
  }
);
