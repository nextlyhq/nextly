/**
 * A group with no name only lays fields out: the fields it holds are stored where it sits, as
 * columns of the collection's or Single's own row. Every builder of that row's columns reads them
 * the same way, so this asks each of them for the same fields on every dialect and requires one
 * answer: the SQL that creates the table, the ALTER that adds the group to an existing one, the
 * runtime table every read and write goes through, and the desired table a Builder save diffs its
 * migration from.
 *
 * Each read the group itself before, and stopped on its missing name. A builder that skipped the
 * group instead of reading through it would stop failing and still disagree with the others: the
 * desired table would then plan dropping columns that hold values. So the columns are compared,
 * not only the absence of a throw.
 */
import { getTableColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import {
  parseAddColumns,
  parseCreateTable,
} from "../../__tests__/helpers/parse-generated-ddl";
import { buildDesiredTableFromFields } from "../../pipeline/diff/build-from-fields";
import {
  getSystemColumnDescriptors,
  type SupportedDialect,
} from "../field-column-descriptor";
import { generateRuntimeSchema } from "../runtime-schema-generator";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** A group with no name, nested in another, holding fields of three kinds. */
const LAID_OUT = {
  type: "group",
  label: "Byline",
  fields: [
    { name: "subtitle", type: "text" },
    {
      type: "group",
      label: "Inner",
      fields: [
        { name: "rank", type: "number" },
        { name: "featured", type: "checkbox" },
      ],
    },
  ],
} as unknown as FieldDefinition;

/** A named group beside it, whose fields are stored inside its own value: one column. */
const NAMED = {
  name: "seo",
  type: "group",
  fields: [{ name: "metaTitle", type: "text" }],
} as unknown as FieldDefinition;

const FIELDS = [
  { name: "heading", type: "text" } as FieldDefinition,
  LAID_OUT,
  NAMED,
];

/** The columns the row holds for its fields, without the system columns every table has. */
const USER_COLUMNS = ["featured", "heading", "rank", "seo", "subtitle"];

/** Every system column a collection's table may carry, on any dialect. */
function systemColumns(dialect: SupportedDialect): Set<string> {
  return new Set(
    getSystemColumnDescriptors(dialect, {
      hasStatus: true,
      hasTitleField: false,
      hasSlugField: false,
    }).map(column => column.name)
  );
}

describe.each(DIALECTS)(
  "a collection's row holds the fields of a group with no name (%s)",
  dialect => {
    const system = systemColumns(dialect);
    const own = (names: Iterable<string>) =>
      [...names].filter(name => !system.has(name)).sort();
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      dialect
    );

    it("in the SQL that creates the table", () => {
      const sql = schemaService.generateMigrationSQL("dc_posts", FIELDS);
      expect(own(parseCreateTable(sql).keys())).toEqual(USER_COLUMNS);
    });

    it("in the ALTER that adds the group to a table that already exists", () => {
      const sql = schemaService.generateAlterTableMigration(
        "dc_posts",
        [FIELDS[0]!],
        FIELDS
      );
      expect(own(parseAddColumns(sql).keys())).toEqual(
        USER_COLUMNS.filter(name => name !== "heading")
      );
    });

    it("in the runtime table", () => {
      const { table } = generateRuntimeSchema("dc_posts", FIELDS, dialect, {
        builtBy: "collection",
      });
      expect(
        own(Object.values(getTableColumns(table as Table)).map(c => c.name))
      ).toEqual(USER_COLUMNS);
    });

    it("in the desired table a Builder save diffs its migration from", () => {
      const desired = buildDesiredTableFromFields("dc_posts", FIELDS, dialect, {
        builtBy: "collection",
      });
      expect(own(desired.columns.map(column => column.name))).toEqual(
        USER_COLUMNS
      );
    });
  }
);
