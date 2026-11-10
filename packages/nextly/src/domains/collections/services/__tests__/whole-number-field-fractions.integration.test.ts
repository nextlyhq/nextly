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

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  number,
  text,
} from "../../../../config";
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
import type { SingleEntryService } from "../../../../domains/singles/services/single-entry-service";
import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";

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
    const SINGLE_SLUG = "wnf_single";
    const SINGLE_TABLE = `single_${SINGLE_SLUG}`;
    const CONTEXT = { overrideAccess: true };

    let handle: TestNextly | undefined;
    let collections: CollectionService;
    let singles: SingleEntryService;

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
        fieldGroups: [
          // A top-level component whose own whole-number child is judged by
          // the component write pass — the pass a publish once exempted
          // whole, letting a caller-supplied fraction reach the integer
          // column of the component's row.
          defineFieldGroup({
            slug: "wnf_dial",
            fields: [number({ name: "tally" })],
          }),
        ],
        collections: [
          defineCollection({
            slug: SLUG,
            status: true,
            // Named so the denied-child tests below may write WITHOUT
            // overrideAccess: the collection lets any caller update, while
            // the `locked` group's rating child denies the write by its own
            // field rule. The trusted tests above bypass both anyway.
            access: { read: () => true, update: () => true },
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
              group({
                name: "meta",
                fields: [number({ name: "rating" })],
              }),
              fieldGroup({ name: "dial", component: "wnf_dial" }),
              group({
                name: "locked",
                fields: [
                  text({ name: "label" }),
                  number({
                    name: "rating",
                    // Readable by anyone, writable by none: the update
                    // below edits the sibling and omits this child, so the
                    // restore puts the stored value back for the write.
                    access: { read: () => true, update: () => false },
                  }),
                ],
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: SINGLE_SLUG,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" }), number({ name: "quantity" })],
          }),
        ],
      });
      collections = handle.getService("collectionService") as CollectionService;
      singles = handle.getService("singleEntryService") as SingleEntryService;

      // A beforeChange hook that transforms whole values into fractions —
      // the case the gate before the hooks cannot see. It fires only for the
      // titles the hook tests below use, so no other case meets it; a title
      // on the allow-list gets a whole value instead, the pass-through leg.
      // Each transform is its own function below, so the hook itself stays a
      // straight dispatch and each risk it poses stands small on its own.
      getHookRegistry().register("beforeChange", SLUG, context => {
        const data = context.data as Record<string, unknown>;
        fractionTheTopLevelValue(data);
        fractionTheNestedGroupValue(data);
        fractionTheRestoredDeniedValue(data);
        return data;
      });

      // Singles hook: mirrors the collection hook above, exercising the
      // Single post-hook whole-number check.
      getHookRegistry().register(
        "beforeChange",
        `single:${SINGLE_SLUG}`,
        context => {
          const data = context.data as Record<string, unknown>;
          if (
            typeof data.title === "string" &&
            data.title.startsWith("hookfrac")
          ) {
            if (data.quantity === 2) {
              data.quantity = 2.5;
            }
          }
          return data;
        }
      );
    });

    afterAll(async () => {
      await handle?.destroy();
    });

    /**
     * The hook's top-level transform: a `hookfrac` title turns a whole 2
     * into a fraction, while the allow-listed `hookfrac-whole` title gets a
     * whole 3 instead — the pass-through leg.
     */
    function fractionTheTopLevelValue(data: Record<string, unknown>): void {
      if (
        typeof data.title !== "string" ||
        !data.title.startsWith("hookfrac")
      ) {
        return;
      }
      if (data.title === "hookfrac-whole") {
        data.quantity = 3;
        return;
      }
      if (data.quantity === 2) {
        data.quantity = 2.5;
      }
    }

    /**
     * The hook's nested transform, where the hook runner recurses: a field
     * hook on a group's child mutates that child's row in place, which the
     * parent's reference does not show.
     */
    function fractionTheNestedGroupValue(data: Record<string, unknown>): void {
      if (
        typeof data.title !== "string" ||
        !data.title.startsWith("hookfrac")
      ) {
        return;
      }
      const meta = data.meta as Record<string, unknown> | undefined;
      if (meta && meta.rating === 2) {
        meta.rating = 2.5;
      }
    }

    /**
     * The hook's transform of a restored denied value: the restore has
     * already put the row's own 2.5 back under `locked` when the hooks run;
     * the hook overwrites it. What the hook leaves there is this write's
     * production, judged like any caller's value.
     */
    function fractionTheRestoredDeniedValue(
      data: Record<string, unknown>
    ): void {
      if (data.title !== "hookrestored-1") {
        return;
      }
      const locked = data.locked as Record<string, unknown> | undefined;
      if (locked && locked.rating === 2.5) {
        locked.rating = 3.5;
      }
    }

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
          // Main now refuses an update that says neither its version nor to
          // overwrite; these scenarios test the floor, not concurrency.
          { quantity: 2.5, _overwrite: true },
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
        [{ id: entry.id as string, data: { quantity: 2.5, _overwrite: true } }],
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
      // transforming hook, before any row is written. The hook transforms a
      // top-level value AND a number nested in a group row (which it mutates
      // in place, where the parent's reference does not move): both are
      // judged, each path naming its own value.
      const error = await refusalOf(
        collections.createEntry(
          SLUG,
          { title: "hookfrac-create", quantity: 2, meta: { rating: 2 } },
          CONTEXT
        )
      );
      expectFractionRefusal(error, "quantity");
      // The nested path names the value; the message uses the child field's
      // own label, as the first gate's nested issues do.
      expectFractionRefusal(error, "meta.rating", "rating");

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
          { title: "hookfrac-update", quantity: 2, _overwrite: true },
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
        { status: "published", _overwrite: true },
        CONTEXT
      )) as unknown as Record<string, unknown>;
      expect(published.status).toBe("published");
      expect(published.quantity).toBe(storedLegacyCount);
      expect((await readEntry("legacy-frac-1")).quantity).toBe(
        storedLegacyCount
      );
    });

    it("a bulk publish that supplies a top-level component judges its fraction", async () => {
      // The component values a transactional publish carries — the bulk
      // update's path — were once exempted whole, as the assembled
      // document's own: a caller-supplied 2.5 in a component reached the
      // integer column of the component's row, and the database decided.
      // The exemption now bounds itself to what the caller did not name,
      // so the caller's own value is judged like any write's — while the
      // row's own, a publish that names no component, still rides.
      const entry = (await collections.createEntry(
        SLUG,
        { title: "publish-component", dial: { tally: 2 } },
        CONTEXT
      )) as unknown as Record<string, unknown>;

      const result = await collections.updateMany(
        SLUG,
        [
          {
            id: entry.id as string,
            data: {
              status: "published",
              dial: { tally: 2.5 },
              _overwrite: true,
            },
          },
        ],
        CONTEXT
      );
      expect(result.failed).toBe(1);
      // Named as the component's own pass reports it, inside the instance.
      expect(result.errors[0]?.error).toContain("tally must be a whole number");

      // The stored instance keeps the value this write was refused over.
      const stored = await readEntry(entry.id as string);
      expect((stored.dial as Record<string, unknown>).tally).toBe(2);
    });

    it("a Single's beforeChange hook that turns a whole value into a fraction is refused", async () => {
      // The single-mutation-service runs hookChangedWholeNumberIssues after
      // beforeChange hooks run, so a hook that turns a whole value into a
      // fraction on a Single is refused with a 400 naming the field before
      // any row is written.
      const result = await singles.update(
        SINGLE_SLUG,
        { title: "hookfrac-single", quantity: 2, _overwrite: true },
        CONTEXT
      );
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      const hit = result.errors?.find(e => e.field === "quantity");
      expect(
        hit,
        `no issue names the field: ${JSON.stringify(result.errors)}`
      ).toBeDefined();
      expect(hit?.message).toBe("quantity must be a whole number.");
    });

    it("a Single's promoted draft holding a stored fraction publishes unchanged", async () => {
      // Initialize the Single live.
      await singles.update(
        SINGLE_SLUG,
        {
          title: "single-live",
          quantity: 2,
          status: "published",
          _overwrite: true,
        },
        CONTEXT
      );

      // A legacy stored fraction in the database table (survives on SQLite as 2.5,
      // column-rounded on MySQL / PostgreSQL to 3).
      if (dialect === "sqlite") {
        await handle!.adapter.executeQuery(
          `UPDATE ${SINGLE_TABLE} SET quantity = 2.5`
        );
      }
      const storedCount = dialect === "sqlite" ? 2.5 : 2;

      // An edit while published holds a working draft carrying the stored fraction.
      const held = await singles.update(
        SINGLE_SLUG,
        { title: "single-draft", _overwrite: true },
        CONTEXT
      );
      expect(held.success).toBe(true);

      // Publishing promotes the draft through validateSinglePromotion. Because
      // assembledFromStorage is true, the stored fraction is not refused.
      const published = await singles.update(
        SINGLE_SLUG,
        { status: "published", _overwrite: true },
        CONTEXT
      );
      expect(published.success).toBe(true);
      expect((published.data as Record<string, unknown>).quantity).toBe(
        storedCount
      );
    });

    it("a sibling edit passes while a denied child keeps its legacy stored fraction", async () => {
      // `locked` holds a whole-number child no caller may write. A row
      // seeded straight into the table carries a fraction under it — the
      // group's JSON column keeps what a pre-floor write stored, on every
      // dialect. The update names the group and edits the ALLOWED sibling,
      // omitting the denied child: the restore puts the stored child back
      // so the whole-written group does not clear it, and the floor leaves
      // the row's own value to the row instead of refusing the edit for a
      // fraction nobody sent.
      const timestamp =
        dialect === "sqlite" ? String(Math.floor(Date.now() / 1000)) : "NOW()";
      await handle!.adapter.executeQuery(
        `INSERT INTO ${TABLE} (id, title, slug, status, locked, created_at, updated_at)
         VALUES ('denied-frac-1', 'denied legacy', 'denied-legacy', 'draft', '{"label":"kept","rating":2.5}', ${timestamp}, ${timestamp})`
      );

      // A real signed-in editor holds read and update on the collection —
      // the write's own read is judged for this caller — while the
      // `locked` group's rating child denies the WRITE by its field rule.
      await userWhoMay(handle!, "sibling-editor", "read", [SLUG]);
      await grantTo(handle!, "sibling-editor", "update", [SLUG]);

      const edited = (await collections.updateEntry(
        SLUG,
        "denied-frac-1",
        { locked: { label: "sibling edit" }, _overwrite: true },
        {
          overrideAccess: false,
          // The rules this write meets read only who the caller is; the role
          // rows userWhoMay inserted answer for the grants.
          user: {
            id: "sibling-editor",
            email: "sibling-editor@example.test",
            role: "",
            permissions: [],
          },
        }
      )) as unknown as Record<string, unknown>;
      expect(edited.title).toBe("denied legacy");
      expect((edited.locked as Record<string, unknown>).label).toBe(
        "sibling edit"
      );
      expect((edited.locked as Record<string, unknown>).rating).toBe(2.5);
    });

    it("a fraction the caller sends at an allowed path is still refused beside a denied child", async () => {
      // The skip is bounded by the denied paths: a fractional value the
      // caller carries at a field they may write is refused as ever, on the
      // same write that leaves the denied child alone.
      const refusal = await refusalOf(
        collections.updateEntry(
          SLUG,
          "denied-frac-1",
          { quantity: 2.5, _overwrite: true },
          {
            overrideAccess: false,
            // The rules this write meets read only who the caller is; the role
            // rows userWhoMay inserted answer for the grants.
            user: {
              id: "sibling-editor",
              email: "sibling-editor@example.test",
              role: "",
              permissions: [],
            },
          }
        )
      );
      expectFractionRefusal(refusal, "quantity");
    });

    it("a hook that changes a restored denied value is judged like a caller's", async () => {
      // The update names the group, so the restore puts the row's own 2.5
      // back under the denied child; the hook then overwrites it with 3.5.
      // The floor skips the row's own value — unchanged, it rides — but the
      // hook's 3.5 is this write's production, refused with the field named
      // before any row is written.
      const refusal = await refusalOf(
        collections.updateEntry(
          SLUG,
          "denied-frac-1",
          {
            title: "hookrestored-1",
            quantity: 4,
            locked: { label: "kept" },
            _overwrite: true,
          },
          {
            overrideAccess: false,
            user: {
              id: "sibling-editor",
              email: "sibling-editor@example.test",
              role: "",
              permissions: [],
            },
          }
        )
      );
      expect(NextlyError.is(refusal)).toBe(true);
      expect(refusal.code).toBe("VALIDATION_ERROR");
      const issues =
        (refusal.publicData as { errors: ValidationIssueShape[] })?.errors ??
        [];
      const hit = issues.find(issue => issue.path === "locked.rating");
      expect(
        hit,
        `no issue names the field: ${JSON.stringify(issues)}`
      ).toBeDefined();
      expect(hit?.message).toBe("rating must be a whole number.");
    });
  }
);
