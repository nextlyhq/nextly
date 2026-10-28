/**
 * A translated field added over a companion column of the same name is refused when that column's
 * definition is not the one the field would have.
 *
 * A save that MySQL refused part-way can leave an added translated field's companion column in
 * place, and the next save takes that column as the field's rather than adding it twice. A column
 * of the same name with another type or a NOT NULL constraint is not one a save left: taken as the
 * field's, it would record the field over storage that cannot hold its values. The schema dialog
 * refuses it before anything changes, naming the column, and takes a column of the field's own
 * definition as before.
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
import { ddlType } from "../ddl-types";
import { fieldToLocalizedColumnSpec } from "../field-to-column-spec";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
}

const HEADING = { name: "heading", type: "text" };
const CODE = { name: "code", type: "text" };

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a translated field added over a companion column already there",
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
      const created = await (
        current.getService(
          "collectionsHandler"
        ) as unknown as CollectionsHandler
      ).createCollection({
        name: "cdef_posts",
        label: "Post",
        localized: true,
        fields: [HEADING],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
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

    async function recordedFieldNames(): Promise<string[]> {
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'cdef_posts'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return fields.map(f => f.name);
    }

    async function schemaVersion(): Promise<number> {
      const [row] = await query<{ version: number | string | null }>(
        `SELECT ${q("schema_version")} AS version FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'cdef_posts'`
      );
      return Number(row?.version ?? 1);
    }

    function addCodeInDialog(): Promise<unknown> {
      return schemaVersion().then(version =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "cdef_posts" },
          {
            fields: [HEADING, CODE],
            confirmed: true,
            localized: true,
            schemaVersion: version,
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        )
      );
    }

    /** The companion column `code` as the field would have it. */
    const codeColumnType = () => {
      const spec = fieldToLocalizedColumnSpec(CODE, dialect, "collection");
      if (!spec) throw new Error("the field has no companion column");
      return ddlType(spec, dialect);
    };

    it("refuses the field over a column of another type, naming it, and changes nothing", async () => {
      await query(
        `ALTER TABLE ${q("dc_cdef_posts_locales")} ADD COLUMN ${q("code")} INTEGER`
      );

      const refusal = await addCodeInDialog();

      expect(refusal).toBeInstanceOf(Error);
      expect(
        JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)
      ).toMatch(/COLUMN_ALREADY_EXISTS.*code|code.*COLUMN_ALREADY_EXISTS/);
      expect(await recordedFieldNames()).toEqual(["heading"]);
    });

    it("takes a column of the field's own definition as the field's", async () => {
      await query(
        `ALTER TABLE ${q("dc_cdef_posts_locales")} ADD COLUMN ${q("code")} ${codeColumnType()}`
      );

      expect(await addCodeInDialog()).toBeUndefined();
      expect(await recordedFieldNames()).toEqual(["heading", "code"]);
    });
  }
);
