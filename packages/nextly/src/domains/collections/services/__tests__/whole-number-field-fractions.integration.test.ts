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
 * product path is exercised. Each dialect boots ONE code-first collection
 * carrying all four number shapes (plain integer, hasMany, decimal, float
 * format) on the harness's own throwaway database — a random name per boot,
 * dropped at teardown, with the server environment snapshot restored — so
 * no run shares tables, rows or process state with another.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, number, text } from "../../../../config";
import type { NumberFieldConfig } from "../../../../collections/fields/types/number";
import { NextlyError } from "../../../../errors";
import { getHookRegistry } from "../../../../hooks/hook-registry";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../collection-service";

interface ValidationIssueShape {
  path: string;
  code: string;
  message: string;
}

describe.each(getConfiguredTestDialects())(
  "a whole-number field refuses a fraction (%s)",
  (dialect: TestDialect) => {
    const SLUG = "wnf";
    const TABLE = `dc_${SLUG}`;
    const CONTEXT = { overrideAccess: true };

    let handle: TestNextly | undefined;
    let collections: CollectionService;

    beforeAll(async () => {
      // One boot on the harness's own throwaway database: a random name this
      // boot creates and destroy() drops, so no two runs — of this suite or
      // any other — ever share tables, rows or environment state. The
      // harness snapshots and restores the server environment itself.
      //
      // All four number shapes are declared code-first in one collection,
      // and the runtime auto-sync creates every column from the same
      // descriptor the validator reads: the hasMany list is a JSON column,
      // and the float format reaches the declaration through the storage
      // options the descriptor reads — the 2.5 acceptance case below is its
      // own proof the column took the declaration.
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: SLUG,
            status: true,
            fields: [
              text({ name: "title" }),
              number({ name: "quantity" }),
              number({ name: "scores", hasMany: true }),
              number({
                name: "price",
                dbType: "decimal",
                precision: 10,
                scale: 2,
              }),
              number({
                name: "measure",
                options: { format: "float" },
              } as Omit<NumberFieldConfig, "type">),
            ],
          }),
        ],
      });
      collections = handle.getService("collectionService") as CollectionService;

      // A beforeChange hook that transforms a whole value into a fraction —
      // the case the gate before the hooks cannot see. It fires only for the
      // titles the hook tests below use, so no other case meets it; a title
      // on the allow-list gets a whole value instead, the pass-through leg.
      getHookRegistry().register("beforeChange", SLUG, context => {
        const data = context.data as Record<string, unknown>;
        if (
          typeof data.title === "string" &&
          data.title.startsWith("hookfrac")
        ) {
          if (data.title === "hookfrac-whole") {
            data.quantity = 3;
          } else if (data.quantity === 2) {
            data.quantity = 2.5;
          }
        }
        return data;
      });
    });

    afterAll(async () => {
      await handle?.destroy();
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
     * issue's path names the value ("quantity", "scores[1]"); the message names
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
          { title: "frac-create", quantity: 2.5 },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "quantity");

      const listed = await collections.listEntries(SLUG, {}, CONTEXT);
      expect(
        listed.data.filter(entry => entry.title === "frac-create")
      ).toEqual([]);
    });

    it("create accepts 2, unchanged", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "whole-create", quantity: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(entry.quantity).toBe(2);
      expect((await readEntry(entry.id as string)).quantity).toBe(2);
    });

    it("update refuses 2.5 and leaves the stored value", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "update-target", quantity: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;

      const error = await refusalOf(
        collections.updateEntry(
          SLUG,
          entry.id as string,
          { quantity: 2.5 },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "quantity");
      expect((await readEntry(entry.id as string)).quantity).toBe(2);
    });

    it("bulk create refuses 2.5 with the field named, and writes nothing", async () => {
      const result = await collections.createMany(
        SLUG,
        [{ title: "frac-bulk", quantity: 2.5 }],
        CONTEXT
      );
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]?.index).toBe(0);
      expect(result.errors[0]?.error).toContain(
        "quantity must be a whole number"
      );

      const listed = await collections.listEntries(SLUG, {}, CONTEXT);
      expect(listed.data.filter(entry => entry.title === "frac-bulk")).toEqual(
        []
      );
    });

    it("bulk update refuses 2.5 and leaves the stored value", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "bulk-update-target", quantity: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;

      const result = await collections.updateMany(
        SLUG,
        [{ id: entry.id as string, data: { quantity: 2.5 } }],
        CONTEXT
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0]?.index).toBe(0);
      expect(result.errors[0]?.error).toContain(
        "quantity must be a whole number"
      );
      expect((await readEntry(entry.id as string)).quantity).toBe(2);
    });

    it("a fractional hasMany element is refused with the field named", async () => {
      const error = await refusalOf(
        collections.createEntry(
          SLUG,
          { title: "list-frac", scores: [1, 2.5] },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "scores[1]", "scores");

      const whole = (await collections.createEntry(
        SLUG,
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

    it("a beforeChange hook that turns a whole value into a fraction is refused", async () => {
      // The hooks run after the validation gate, so the fraction they leave
      // behind is a write the gate never saw — judged after the last
      // transforming hook, before any row is written.
      const error = await refusalOf(
        collections.createEntry(
          SLUG,
          { title: "hookfrac-create", quantity: 2 },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "quantity");

      const listed = await collections.listEntries(SLUG, {}, CONTEXT);
      expect(
        listed.data.filter(entry => entry.title === "hookfrac-create")
      ).toEqual([]);
    });

    it("a beforeChange hook that turns an update's whole value into a fraction is refused", async () => {
      // Created under a title the hook ignores, so the fixture itself is
      // whole; the hook's transform happens on the update below.
      const entry = (await collections.createEntry(
        SLUG,
        { title: "update-target", quantity: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;

      const error = await refusalOf(
        collections.updateEntry(
          SLUG,
          entry.id as string,
          { title: "hookfrac-update", quantity: 2 },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "quantity");
      expect((await readEntry(entry.id as string)).quantity).toBe(2);
    });

    it("a beforeChange hook that sets a whole value passes", async () => {
      const entry = (await collections.createEntry(
        SLUG,
        { title: "hookfrac-whole", quantity: 2 },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(entry.quantity).toBe(3);
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
        `INSERT INTO ${TABLE} (id, title, slug, status, quantity, created_at, updated_at)
         VALUES ('legacy-frac-1', 'legacy fraction', 'legacy-frac', 'draft', 2.5, ${timestamp}, ${timestamp})`
      );

      // The stored state, whatever the column made of it.
      const storedLegacyCount = dialect === "sqlite" ? 2.5 : 3;
      expect((await readEntry("legacy-frac-1")).quantity).toBe(
        storedLegacyCount
      );

      // Publishing the entry carries no number field in the patch, so the
      // stored value rides through unchanged.
      const published = (await collections.updateEntry(
        SLUG,
        "legacy-frac-1",
        { status: "published" },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(published.status).toBe("published");
      expect(published.quantity).toBe(storedLegacyCount);
      expect((await readEntry("legacy-frac-1")).quantity).toBe(
        storedLegacyCount
      );
    });
  }
);
