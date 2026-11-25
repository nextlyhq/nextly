/**
 * The playground's plugins start together, as `pnpm dev:app` starts them: the
 * page builder and the form builder, each with every collection it brings.
 *
 * Every text field is kept per language unless it says `localized: false`.
 * A start checks each collection's declared indexes against that: an index on
 * a field kept per language names a column the main table lacks, and the
 * start refuses (`VALIDATION_ERROR`). And the plugins' own bookkeeping (keys,
 * ids, languages, paths, states, actors) is never translated, so on a fresh
 * database each such field's column is on its main table, where a lookup by
 * it finds it in every language, and not on its per-language table. Broken,
 * a plugin indexing a key it keeps per language stops every start, or a key
 * kept per language is missed by a lookup made in another language.
 */
import { formBuilder } from "@nextlyhq/plugin-form-builder";
import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

/**
 * Each plugin collection or Single holding bookkeeping, by slug, and the fields of it that are
 * keys, ids, languages, paths, states or actors: never translated.
 */
const BOOKKEEPING: Record<string, { single?: true; fields: string[] }> = {
  // The form builder's.
  "form-submissions": {
    fields: [
      "responseKey",
      "spamReason",
      "notes",
      "ipAddress",
      "userAgent",
      "page",
      "editedBy",
      "title",
    ],
  },
  "form-submission-sends": {
    fields: [
      "submission",
      "queuedId",
      "sendKey",
      "form",
      "notification",
      "notificationName",
      "state",
      "retiredBy",
      "requestedBy",
      "resend",
    ],
  },
  "form-submission-resends": {
    fields: ["submission", "notification", "requestedBy"],
  },
  "form-uploads": { fields: ["media", "form", "field", "submission"] },
  // The form's other keys (`oneResponseField`, `captchaSiteKey`) are inside its `settings`
  // group, whose one column holds them: only its own columns are named here.
  forms: { fields: ["slug"] },
  // The page builder's.
  nx_pb_address_claims: {
    fields: [
      "claimKey",
      "kind",
      "locale",
      "path",
      "holderCollection",
      "holderId",
      "space",
      "blockedBy",
    ],
  },
  nx_pb_class_usage: {
    fields: [
      "scope",
      "entity",
      "entityKey",
      "field",
      "locale",
      "variant",
      "classId",
    ],
  },
  nx_pb_component_usage: {
    fields: [
      "scope",
      "entity",
      "entityKey",
      "field",
      "locale",
      "variant",
      "kind",
      "componentId",
    ],
  },
  nx_pb_component_retired: {
    fields: ["identity", "componentId", "kind", "exposureId"],
  },
  nx_pb_usage_backfill: { fields: ["scopeKey", "generation"] },
  templates: {
    fields: [
      "collection",
      "entry",
      "entryCollection",
      "entryId",
      "forkedFrom",
      "address",
    ],
  },
  "page-builder-settings": { single: true, fields: ["defaultLayoutChangedBy"] },
  "page-builder-site-code": {
    single: true,
    fields: ["headSource", "bodySource", "changedBy"],
  },
};

const toColumn = (field: string) =>
  field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

describe.each(getConfiguredTestDialects())(
  "the playground's plugins start together (%s)",
  (dialect: TestDialect) => {
    /** The columns `table` has, as the database names them; none where it does not exist. */
    async function columnsOf(t: TestNextly, table: string): Promise<string[]> {
      const rows = await t.adapter.executeQuery<{ column_name: string }>(
        dialect === "sqlite"
          ? `SELECT name AS column_name FROM pragma_table_info('${table}')`
          : dialect === "postgresql"
            ? `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
            : `SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
      );
      return rows.map(row => String(row.column_name).toLowerCase());
    }

    /** The main table the registry records for `slug`. */
    async function tableOf(
      t: TestNextly,
      slug: string,
      single: boolean
    ): Promise<string> {
      const q = dialect === "mysql" ? "`" : '"';
      const [row] = await t.adapter.executeQuery<{ table_name: string }>(
        `SELECT ${q}table_name${q} AS table_name FROM ${q}${single ? "dynamic_singles" : "dynamic_collections"}${q} WHERE ${q}slug${q} = '${slug}'`
      );
      expect(row, `${slug} is registered`).toBeDefined();
      return String(row.table_name);
    }

    it("starts with the page builder and the form builder, their bookkeeping on its main tables", async () => {
      const t = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder({}),
          formBuilder({ redirectRelationships: { pages: "/{slug}" } }).plugin,
        ],
      });
      try {
        // Each form-builder collection the indexes are declared on is served.
        const submissions = await t.nextly.find({
          collection: "form-submissions",
        });
        expect(submissions.items).toEqual([]);

        for (const [slug, { single, fields }] of Object.entries(BOOKKEEPING)) {
          const table = await tableOf(t, slug, single === true);
          const main = await columnsOf(t, table);
          const perLanguage = await columnsOf(t, `${table}_locales`);
          for (const column of fields.map(toColumn)) {
            expect(main, `${slug}.${column} on ${table}`).toContain(column);
            expect(
              perLanguage,
              `${slug}.${column} not on ${table}_locales`
            ).not.toContain(column);
          }
        }
      } finally {
        await t.destroy();
      }
    });
  }
);
