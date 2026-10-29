/**
 * A field made translated over a companion column already there is refused when that column
 * cannot hold every value the field allows, and takes the column as its own when it can.
 *
 * A save that MySQL refused part-way can leave a translated field's companion column in place,
 * holding the values it had moved, and the next save takes that column as the field's rather than
 * adding it twice. A column of another type, a narrower length or precision, or NOT NULL cannot
 * hold the field's values: the schema dialog refuses it before anything changes, naming the column
 * and both definitions, and never advises dropping it, since it may hold the only copy of the
 * field's values. A column at least as wide is taken as it is, and stays so.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { introspectLiveSnapshot } from "../../../schema/pipeline/diff/introspect-live";
import type { ColumnSpec } from "../../../schema/pipeline/diff/types";
import {
  buildCompanionReconcileStatements,
  type CompanionFieldLike,
} from "../reconcile-companion";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
}

type Field = Record<string, unknown> & { name: string; type: string };

const HEADING: Field = { name: "heading", type: "text" };
const CODE: Field = { name: "code", type: "text" };
const price = (precision: number, scale: number): Field => ({
  name: "price",
  type: "number",
  dbType: "decimal",
  precision,
  scale,
});

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a field made translated over a companion column already there",
  dialect => {
    let current: TestNextly;
    const q = (name: string) => quote(dialect, name);

    beforeEach(async () => {
      // The Builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function create(
      name: string,
      localized: boolean,
      fields: Field[]
    ): Promise<void> {
      const created = await (
        current.getService(
          "collectionsHandler"
        ) as unknown as CollectionsHandler
      ).createCollection({ name, label: name, localized, fields });
      expect(created.success, JSON.stringify(created)).toBe(true);
    }

    async function recordedFields(slug: string): Promise<Field[]> {
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${slug}'`
      );
      return (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as Field[];
    }

    async function schemaVersion(slug: string): Promise<number> {
      const [row] = await query<{ version: number | string | null }>(
        `SELECT ${q("schema_version")} AS version FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${slug}'`
      );
      return Number(row?.version ?? 1);
    }

    /** The schema dialog's apply, answered as the admin confirms it; the refusal, or undefined. */
    async function saveInDialog(
      slug: string,
      fields: Field[],
      localized = true
    ): Promise<unknown> {
      const version = await schemaVersion(slug);
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: slug },
        { fields, confirmed: true, localized, schemaVersion: version }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
    }

    async function columnsOf(table: string): Promise<readonly ColumnSpec[]> {
      const snapshot = await introspectLiveSnapshot(
        current.adapter.getDrizzle(),
        dialect,
        [table]
      );
      return snapshot.tables.find(t => t.name === table)?.columns ?? [];
    }

    async function columnOf(table: string, name: string): Promise<ColumnSpec> {
      const column = (await columnsOf(table)).find(c => c.name === name);
      if (!column) throw new Error(`${table} has no column ${name}`);
      return column;
    }

    /**
     * The statement the companion transition itself issues to add `field`'s companion column when
     * the field is added as translated.
     */
    function transitionAdd(slug: string, field: Field): string {
      const translatedLike = (f: Field): CompanionFieldLike =>
        ({ ...f, localized: true }) as unknown as CompanionFieldLike;
      const statements = buildCompanionReconcileStatements({
        slug,
        tableName: `dc_${slug}`,
        oldLocalized: [translatedLike(HEADING)],
        newLocalized: [translatedLike(HEADING), translatedLike(field)],
        dialect,
        status: false,
        builtBy: "collection",
        companionExists: true,
        companionHasStatus: false,
        companionHasUpdatedAt: true,
      }).filter(s => s.includes("ADD COLUMN"));
      expect(statements).toHaveLength(1);
      return statements[0];
    }

    /** Adds `field`'s companion column as an apply refused right after that statement leaves it. */
    async function addAsTheTransitionDoes(
      slug: string,
      field: Field
    ): Promise<void> {
      await query(transitionAdd(slug, field));
    }

    /** The refusal's errors, as the dialog's caller receives them. */
    function errorsOf(refusal: unknown): unknown {
      expect(refusal).toBeInstanceOf(Error);
      return (refusal as { publicData?: { errors?: unknown } }).publicData
        ?.errors;
    }

    const translated = (f: Field): Field => ({ ...f, localized: true });

    it("refuses a field over a column of another type, naming both, and changes nothing", async () => {
      await create("cdef_posts", true, [translated(HEADING)]);
      await query(
        `ALTER TABLE ${q("dc_cdef_posts_locales")} ADD COLUMN ${q("code")} INTEGER`
      );
      const before = {
        main: await columnsOf("dc_cdef_posts"),
        companion: await columnsOf("dc_cdef_posts_locales"),
      };

      const refusal = await saveInDialog("cdef_posts", [
        translated(HEADING),
        translated(CODE),
      ]);

      expect(errorsOf(refusal)).toEqual([
        expect.objectContaining({
          path: "fields.code",
          code: "COLUMN_ALREADY_EXISTS",
          message: expect.stringMatching(
            /column "code" \(.+\) that cannot hold every value code allows \(.+\)/
          ),
        }),
      ]);
      expect(JSON.stringify(errorsOf(refusal))).not.toMatch(/remove|drop/i);
      expect((await recordedFields("cdef_posts")).map(f => f.name)).toEqual([
        "heading",
      ]);
      // Refused before anything ran: neither table changed.
      expect(await columnsOf("dc_cdef_posts")).toEqual(before.main);
      expect(await columnsOf("dc_cdef_posts_locales")).toEqual(
        before.companion
      );
    });

    it("refuses a NOT NULL column of the field's own type, with another name as the way on", async () => {
      await create("cdef_posts", true, [translated(HEADING)]);
      // The field's own column, but refusing NULL, which no save makes. Only SQLite needs a
      // default to add one; MySQL refuses a default on a TEXT column.
      await query(
        `${transitionAdd("cdef_posts", CODE)} NOT NULL${dialect === "sqlite" ? " DEFAULT ''" : ""}`
      );

      const refusal = await saveInDialog("cdef_posts", [
        translated(HEADING),
        translated(CODE),
      ]);

      expect(errorsOf(refusal)).toEqual([
        expect.objectContaining({
          path: "fields.code",
          code: "COLUMN_ALREADY_EXISTS",
          message: expect.stringContaining("Give code another name"),
        }),
      ]);
      expect((await recordedFields("cdef_posts")).map(f => f.name)).toEqual([
        "heading",
      ]);
    });

    it("refuses a unique field over a column of another type with that refusal, not a database error", async () => {
      await create("cdef_posts", true, [translated(HEADING)]);
      await query(
        `ALTER TABLE ${q("dc_cdef_posts_locales")} ADD COLUMN ${q("code")} INTEGER`
      );

      const refusal = await saveInDialog("cdef_posts", [
        translated(HEADING),
        translated({ ...CODE, unique: true }),
      ]);

      expect(errorsOf(refusal)).toEqual([
        expect.objectContaining({
          path: "fields.code",
          code: "COLUMN_ALREADY_EXISTS",
        }),
      ]);
    });

    it("takes the column the transition adds as the field's", async () => {
      await create("cdef_posts", true, [translated(HEADING)]);
      await addAsTheTransitionDoes("cdef_posts", CODE);

      expect(
        await saveInDialog("cdef_posts", [
          translated(HEADING),
          translated(CODE),
        ])
      ).toBeUndefined();
      expect((await recordedFields("cdef_posts")).map(f => f.name)).toEqual([
        "heading",
        "code",
      ]);
    });

    // A text column holds any bounded string: PostgreSQL's text has no limit, MySQL's holds what any
    // varchar can, and SQLite's text is the field's own type.
    it("takes a text column for a short text field as it is", async () => {
      await create("cdef_posts", true, [translated(HEADING)]);
      await query(
        `ALTER TABLE ${q("dc_cdef_posts_locales")} ADD COLUMN ${q("code")} TEXT`
      );
      const column = await columnOf("dc_cdef_posts_locales", "code");

      expect(
        await saveInDialog("cdef_posts", [
          translated(HEADING),
          translated(CODE),
        ])
      ).toBeUndefined();

      expect((await recordedFields("cdef_posts")).map(f => f.name)).toEqual([
        "heading",
        "code",
      ]);
      expect(await columnOf("dc_cdef_posts_locales", "code")).toEqual(column);
    });

    it("refuses a decimal column narrower than the field, naming both precisions", async () => {
      await create("cdef_posts", true, [translated(HEADING)]);
      await addAsTheTransitionDoes("cdef_posts", price(8, 2));

      const refusal = await saveInDialog("cdef_posts", [
        translated(HEADING),
        translated(price(10, 2)),
      ]);

      // SQLite enforces no precision, so its narrower declaration holds the field's values.
      if (dialect === "sqlite") {
        expect(refusal).toBeUndefined();
        return;
      }
      expect(errorsOf(refusal)).toEqual([
        expect.objectContaining({
          path: "fields.price",
          code: "COLUMN_ALREADY_EXISTS",
          message: expect.stringMatching(
            /\(.*8, ?2.*\).*\(.*10, ?2.*\).*Save price with that column's type, length or precision/
          ),
        }),
      ]);
    });

    it("takes a wider decimal column as it is, and the next save leaves it so", async () => {
      await create("cdef_posts", true, [translated(HEADING)]);
      await addAsTheTransitionDoes("cdef_posts", price(12, 2));
      const wider = await columnOf("dc_cdef_posts_locales", "price");

      expect(
        await saveInDialog("cdef_posts", [
          translated(HEADING),
          translated(price(10, 2)),
        ])
      ).toBeUndefined();
      // The next save, of another change, plans nothing for the column: it is not narrowed.
      expect(
        await saveInDialog("cdef_posts", [
          translated(HEADING),
          translated(price(10, 2)),
          { name: "extra", type: "text", localized: false },
        ])
      ).toBeUndefined();

      expect((await recordedFields("cdef_posts")).map(f => f.name)).toEqual([
        "heading",
        "price",
        "extra",
      ]);
      expect(await columnOf("dc_cdef_posts_locales", "price")).toEqual(wider);
    });

    it("refuses a field over such a column as translation starts", async () => {
      // An enable refused part-way: the companion holds `code` as text, the registry still
      // records the collection untranslated, and the admin has since made `code` a number.
      await create("cdef_plain", false, [HEADING, CODE]);
      const [createCompanion] = buildCompanionReconcileStatements({
        slug: "cdef_plain",
        tableName: "dc_cdef_plain",
        oldLocalized: [],
        newLocalized: [HEADING, CODE].map(
          f => ({ ...f, localized: true }) as unknown as CompanionFieldLike
        ),
        dialect,
        status: false,
        builtBy: "collection",
        companionExists: false,
      });
      await query(createCompanion);

      const refusal = await saveInDialog(
        "cdef_plain",
        [translated(HEADING), translated({ name: "code", type: "number" })],
        true
      );

      expect(errorsOf(refusal)).toEqual([
        expect.objectContaining({
          path: "fields.code",
          code: "COLUMN_ALREADY_EXISTS",
        }),
      ]);
      expect(JSON.stringify(errorsOf(refusal))).not.toMatch(/remove|drop/i);
    });

    /** A join refused part-way: `price`'s values are on the companion and its main column is
     * gone, while the registry still records it shared. */
    async function joinMovedPartWay(): Promise<ColumnSpec> {
      await create("cdef_posts", true, [translated(HEADING), price(10, 2)]);
      await addAsTheTransitionDoes("cdef_posts", price(10, 2));
      await query(
        `ALTER TABLE ${q("dc_cdef_posts")} DROP COLUMN ${q("price")}`
      );
      return columnOf("dc_cdef_posts_locales", "price");
    }

    it("finishes a join an earlier apply moved, the field as it was", async () => {
      const moved = await joinMovedPartWay();

      expect(
        await saveInDialog("cdef_posts", [
          translated(HEADING),
          translated(price(10, 2)),
        ])
      ).toBeUndefined();

      const recorded = await recordedFields("cdef_posts");
      expect(recorded.find(f => f.name === "price")).toMatchObject({
        localized: true,
      });
      expect(await columnOf("dc_cdef_posts_locales", "price")).toEqual(moved);
      expect((await columnsOf("dc_cdef_posts")).map(c => c.name)).not.toContain(
        "price"
      );
    });

    it("refuses that retry when the change narrows the field, saying how to finish it", async () => {
      const moved = await joinMovedPartWay();

      const refusal = await saveInDialog("cdef_posts", [
        translated(HEADING),
        translated(price(8, 2)),
      ]);

      // The values stay as they are, so a narrower field would hold some against its own rules;
      // and turning translation off first, as a join's reshape is otherwise told, would add an
      // empty shared column while the values sit in the translations table.
      expect(errorsOf(refusal)).toEqual([
        expect.objectContaining({
          path: "fields.price",
          code: "RESHAPED_FIELD_JOINS_TRANSLATION",
          message: expect.stringMatching(
            /did not finish.*Save it with its earlier type, length or precision/
          ),
        }),
      ]);
      expect(JSON.stringify(errorsOf(refusal))).not.toMatch(/Turn off/);
      expect(
        (await recordedFields("cdef_posts")).find(f => f.name === "price")
      ).not.toHaveProperty("localized", true);
      expect(await columnOf("dc_cdef_posts_locales", "price")).toEqual(moved);
    });
  }
);
