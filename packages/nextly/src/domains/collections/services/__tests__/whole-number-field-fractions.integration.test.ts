/**
 * Proof that a whole-number field refuses a fractional value the same way on
 * every dialect.
 *
 * A `number` field stores an integer column unless it opts into decimals —
 * `dbType: "decimal"` or the UI's float format (`options.format: "float"`),
 * per `classifyFieldKind` — but nothing on the write path refused a
 * fractional value, so the database decided what 2.5 meant: PostgreSQL
 * refused the write as a 500, MySQL silently rounded it to 3 (the fraction
 * lost with no error), SQLite stored 2.5 as written. One write, three
 * outcomes, one of them silent data loss.
 *
 * The fix judges the value at the entry write validation every verb funnels
 * through (`assertEntryValid` → `validateEntryData`), refusing with a
 * validation error that names the field before any row is written. A
 * `hasMany` number stores a JSON list, but the rule follows the field's
 * whole-number semantics, not the physical column, so a fractional list
 * element is refused the same way. Decimal-declaring fields keep accepting
 * fractions. A legacy fractional row — SQLite holds 2.5 where it was
 * written, MySQL's column already rounded it — reads and publishes
 * unchanged: the refusal binds values a caller writes, not stored values.
 *
 * RED before the fix: create/update/bulk with 2.5 fail here on MySQL (silent
 * 3), SQLite (2.5 stored), and PostgreSQL (a 500 instead of a 400); the
 * hasMany case fails on every dialect (the JSON list accepted the fraction).
 *
 * The suite drives `collectionService` — the same facade the Direct API, the
 * REST surface, plugin services and bulk funnel through — so the exact
 * product path is exercised. Each dialect seeds a collection carrying the
 * scalar number shapes (plain integer, decimal, float format) through the
 * Builder, whose raw FieldDefinitions are the only way to reach the UI's
 * float format; the hasMany shape runs on a second, code-first collection,
 * whose table the runtime creates as the JSON column the descriptor
 * declares.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../../database/factory";
import { defineCollection, number, text } from "../../../../config";
import { clearServices } from "../../../../di/register";
import { NextlyError } from "../../../../errors";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../collection-service";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

/** Distinct slug per dialect: the server-backed dialects share a database. */
const SLUG_SUFFIX: Record<TestDialect, string> = {
  sqlite: "",
  postgresql: "pg",
  mysql: "my",
};

interface ValidationIssueShape {
  path: string;
  code: string;
  message: string;
}

describe.each(getConfiguredTestDialects())(
  "a whole-number field refuses a fraction (%s)",
  (dialect: TestDialect) => {
    const SLUG = `wnf${SLUG_SUFFIX[dialect]}`;
    const TABLE = `dc_${SLUG}`;
    /**
     * The hasMany case runs on its own collection, declared code-first: the
     * runtime auto-sync creates its physical table from the descriptor, whose
     * hasMany number is a JSON column. The builder-seeded collection below
     * cannot carry it — the Builder's generator still emits the legacy scalar
     * column for a hasMany number (a recorded disagreement with the
     * descriptor), so a list write would fail on PostgreSQL and MySQL before
     * any whole-number question even arose.
     */
    const LIST_SLUG = `wnflist${SLUG_SUFFIX[dialect]}`;
    const LIST_TABLE = `dc_${LIST_SLUG}`;
    const CONTEXT = { overrideAccess: true };

    let handle: TestNextly | undefined;
    let collections: CollectionService;
    let bootAdapter: TestAdapter | undefined;
    let cleanupAdapter: TestAdapter | undefined;

    /**
     * Best-effort fixture cleanup so reruns against the shared test database
     * are idempotent (server-backed dialects only — SQLite boots in memory).
     */
    async function dropFixtures(): Promise<void> {
      if (!cleanupAdapter) return;
      for (const stmt of [
        `DROP TABLE IF EXISTS ${TABLE}`,
        `DROP TABLE IF EXISTS ${LIST_TABLE}`,
        `DELETE FROM dynamic_collections WHERE slug IN ('${SLUG}', '${LIST_SLUG}')`,
      ]) {
        try {
          await cleanupAdapter.executeQuery(stmt);
        } catch {
          // best-effort — a fresh database has no fixtures to drop.
        }
      }
    }

    beforeAll(async () => {
      if (dialect !== "sqlite") {
        const url =
          dialect === "postgresql"
            ? process.env.TEST_POSTGRES_URL!
            : process.env.TEST_MYSQL_URL!;
        // env.ts validates DATABASE_URL against DB_DIALECT on first read, and
        // createAdapter's pool-defaults layering reads env unconditionally —
        // both must be set on process.env or the validation throws regardless
        // of the url passed to createAdapter (same recipe as the m2m gates).
        process.env.DB_DIALECT = dialect;
        process.env.DATABASE_URL = url;
        // A dedicated connection for cleanup, kept open across the file: the
        // boot connection below is disconnected by handle.destroy().
        cleanupAdapter = await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0]);
        await cleanupAdapter.executeQuery("SELECT 1");
        await dropFixtures();
        bootAdapter = await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0]);
        handle = await createTestNextly({
          adapter: bootAdapter,
          collections: [
            defineCollection({
              slug: LIST_SLUG,
              fields: [
                text({ name: "title" }),
                number({ name: "scores", hasMany: true }),
              ],
            }),
          ],
        });
      } else {
        handle = await createTestNextly({
          collections: [
            defineCollection({
              slug: LIST_SLUG,
              fields: [
                text({ name: "title" }),
                number({ name: "scores", hasMany: true }),
              ],
            }),
          ],
        });
      }

      const adapter = handle.adapter;
      await seedBuilderCollection(adapter, {
        slug: SLUG,
        status: true,
        fields: [
          { name: "title", type: "text" },
          { name: "count", type: "number" },
          {
            name: "price",
            type: "number",
            dbType: "decimal",
            precision: 10,
            scale: 2,
          },
          { name: "measure", type: "number", options: { format: "float" } },
        ],
      });

      // Reset DI without disconnecting, then reboot on the SAME adapter so
      // collectionService resolves the just-seeded collection.
      clearServices();
      handle = await createTestNextly({ adapter });
      collections = handle.getService("collectionService") as CollectionService;
    });

    afterAll(async () => {
      await dropFixtures();
      await handle?.destroy();
      await cleanupAdapter?.disconnect();
    });

    /** The error a refused write produced, or a failure naming the verb. */
    async function refusalOf(promise: Promise<unknown>): Promise<NextlyError> {
      return promise.then(
        () => {
          throw new Error(
            "expected the write to be refused with a validation error; it was accepted"
          );
        },
        error => error as NextlyError
      );
    }

    /**
     * The write was refused as a 400 validation error naming the field. The
     * issue's path names the value ("count", "scores[1]"); the message names
     * the field's label without the element index, as min/max already do.
     */
    function expectFractionRefusal(
      error: NextlyError,
      path: string,
      label = path
    ): void {
      expect(NextlyError.is(error)).toBe(true);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      const issues =
        (error.publicData as { errors: ValidationIssueShape[] })?.errors ?? [];
      const hit = issues.find(issue => issue.path === path);
      expect(
        hit,
        `no issue names the field: ${JSON.stringify(issues)}`
      ).toBeDefined();
      expect(hit?.message).toBe(`${label} must be a whole number.`);
    }

    async function readEntry(
      entryId: string
    ): Promise<Record<string, unknown>> {
      return (await collections.findEntryById(
        SLUG,
        entryId,
        CONTEXT
      )) as unknown as Record<string, unknown>;
    }

    it("create refuses 2.5 with a 400 naming the field, and writes nothing", async () => {
      const error = await refusalOf(
        collections.createEntry(
          SLUG,
          { title: "frac-create", count: 2.5 },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "count");

      const listed = await collections.listEntries(SLUG, {}, CONTEXT);
      expect(
        listed.data.filter(entry => entry.title === "frac-create")
      ).toEqual([]);
    });

    it("create accepts 2, unchanged", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "whole-create", count: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(entry.count).toBe(2);
      expect((await readEntry(entry.id as string)).count).toBe(2);
    });

    it("update refuses 2.5 and leaves the stored value", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "update-target", count: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;

      const error = await refusalOf(
        collections.updateEntry(
          SLUG,
          entry.id as string,
          { count: 2.5 },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "count");
      expect((await readEntry(entry.id as string)).count).toBe(2);
    });

    it("bulk create refuses 2.5 with the field named, and writes nothing", async () => {
      const result = await collections.createMany(
        SLUG,
        [{ title: "frac-bulk", count: 2.5 }],
        CONTEXT
      );
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]?.index).toBe(0);
      expect(result.errors[0]?.error).toContain("count must be a whole number");

      const listed = await collections.listEntries(SLUG, {}, CONTEXT);
      expect(listed.data.filter(entry => entry.title === "frac-bulk")).toEqual(
        []
      );
    });

    it("bulk update refuses 2.5 and leaves the stored value", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "bulk-update-target", count: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;

      const result = await collections.updateMany(
        SLUG,
        [{ id: entry.id as string, data: { count: 2.5 } }],
        CONTEXT
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0]?.index).toBe(0);
      expect(result.errors[0]?.error).toContain("count must be a whole number");
      expect((await readEntry(entry.id as string)).count).toBe(2);
    });

    it("a fractional hasMany element is refused with the field named", async () => {
      const error = await refusalOf(
        collections.createEntry(
          LIST_SLUG,
          { title: "list-frac", scores: [1, 2.5] },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "scores[1]", "scores");

      const whole = (await collections.createEntry(
        LIST_SLUG,
        { title: "list-whole", scores: [1, 2] },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(whole.scores).toEqual([1, 2]);
    });

    it("a dbType decimal field keeps accepting 2.5", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "decimal-ok", price: 2.5 },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(Number(entry.price)).toBe(2.5);
    });

    it("a float-format field keeps accepting 2.5", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "float-ok", measure: 2.5 },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(Number(entry.measure)).toBe(2.5);
    });

    it("a legacy fractional row reads and publishes unchanged", async () => {
      // The raw insert goes through the column the descriptor created, and
      // what that column holds is the dialect's decision — exactly the
      // legacy state a pre-fix caller could be sitting on. A fraction as
      // WRITTEN survives only on SQLite (2.5); on MySQL and PostgreSQL the
      // integer column rounds the numeric literal at insert (3) — MySQL by
      // its own rounding, PostgreSQL by the numeric→integer assignment
      // cast. (The runtime write differed pre-fix — PostgreSQL bound the
      // fraction as a parameter and answered 22P02 as a 500 — which the
      // refusal tests above pin.)
      const timestamp =
        dialect === "sqlite" ? String(Math.floor(Date.now() / 1000)) : "NOW()";
      await handle!.adapter.executeQuery(
        `INSERT INTO ${TABLE} (id, title, slug, status, count, created_at, updated_at)
         VALUES ('legacy-frac-1', 'legacy fraction', 'legacy-frac', 'draft', 2.5, ${timestamp}, ${timestamp})`
      );

      // The stored state, whatever the column made of it.
      const storedLegacyCount = dialect === "sqlite" ? 2.5 : 3;
      expect((await readEntry("legacy-frac-1")).count).toBe(storedLegacyCount);

      // Publishing the entry carries no number field in the patch, so the
      // stored value rides through unchanged.
      const published = (await collections.updateEntry(
        SLUG,
        "legacy-frac-1",
        { status: "published" },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(published.status).toBe("published");
      expect(published.count).toBe(storedLegacyCount);
      expect((await readEntry("legacy-frac-1")).count).toBe(storedLegacyCount);
    });
  }
);
