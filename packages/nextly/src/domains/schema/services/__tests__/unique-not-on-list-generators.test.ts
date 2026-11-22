/**
 * A list relationship marked unique is refused by the generators themselves, wherever it is
 * declared: at the top level, inside a named group, or translated. The generators are reached
 * without a Builder save in front of them (the root-exported services, a plugin's
 * `ctx.services`, the development server), so a list must not pass through them as a table
 * quietly built without the uniqueness its definition records.
 */
import { describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

/** A relationship holding a list, marked unique. */
const TAGS = {
  name: "tags",
  type: "relationship",
  relationTo: "tags",
  options: { target: "tags", relationType: "manyToOne" },
  hasMany: true,
  unique: true,
};

/** A relationship to one entry, marked unique: kept unique. */
const AUTHOR = {
  name: "author",
  type: "relationship",
  relationTo: "users",
  options: { target: "users", relationType: "manyToOne" },
  unique: true,
};

const inGroup = (field: Record<string, unknown>) => ({
  name: "meta",
  type: "group",
  fields: [field],
});

const REFUSED = expect.objectContaining({
  publicData: {
    errors: [
      expect.objectContaining({
        path: "fields.tags",
        code: "UNIQUE_NOT_ON_LIST",
      }),
    ],
  },
});

// The generators take their own field shapes; these tests hand them the Builder's.
type Fields = never[];

for (const dialect of DIALECTS) {
  describe(`a collection's create refuses a list marked unique — ${dialect}`, () => {
    const create = (
      fields: Record<string, unknown>[],
      options: { localized?: boolean } = {}
    ) =>
      new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateMigrationSQL("dc_posts", fields as unknown as Fields, options);

    it("at the top level", () => {
      expect(() => create([TAGS])).toThrow(REFUSED);
    });

    it("inside a named group", () => {
      expect(() => create([inGroup(TAGS)])).toThrow(REFUSED);
    });

    it("translated", () => {
      expect(() =>
        create([{ ...TAGS, localized: true }], { localized: true })
      ).toThrow(REFUSED);
    });

    it("keeps a single link inside a named group unique", () => {
      expect(() => create([inGroup(AUTHOR)])).not.toThrow();
    });
  });

  describe(`a collection's change refuses a list marked unique — ${dialect}`, () => {
    it("added inside a named group", () => {
      expect(() =>
        new DynamicCollectionSchemaService(
          undefined,
          dialect
        ).generateAlterTableMigration(
          "dc_posts",
          [] as unknown as Fields,
          [inGroup(TAGS)] as unknown as Fields
        )
      ).toThrow(REFUSED);
    });
  });

  // An earlier release made a list marked unique unique, with `uq_<table>_<column>` on
  // PostgreSQL and SQLite (MySQL refused the create). Turning the mark off must still drop that
  // index: no list is unique now, but the one the earlier release made is still there.
  describe(`turning Unique off on a list an earlier release made unique — ${dialect}`, () => {
    const { unique: _marked, ...TAGS_UNMARKED } = TAGS;
    const change = (options?: { indexNames?: ReadonlySet<string> }) =>
      new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateAlterTableMigration(
        "dc_posts",
        [TAGS] as unknown as Fields,
        [TAGS_UNMARKED] as unknown as Fields,
        options as never
      );

    if (dialect === "mysql") {
      it("drops nothing where none was made", () => {
        expect(change()).not.toContain("uq_dc_posts_tags");
      });

      it("drops one the live table holds", () => {
        expect(change({ indexNames: new Set(["uq_dc_posts_tags"]) })).toMatch(
          /DROP INDEX `uq_dc_posts_tags` ON `dc_posts`/
        );
      });
    } else {
      it("drops its index", () => {
        expect(change()).toMatch(/DROP INDEX IF EXISTS "uq_dc_posts_tags"/);
      });
    }
  });

  describe(`a field group's create refuses a list marked unique — ${dialect}`, () => {
    const create = (
      fields: Record<string, unknown>[],
      options: { localized?: boolean } = {}
    ) =>
      new FieldGroupSchemaService(dialect).generateMigrationSQL(
        "comp_seo",
        fields as unknown as Fields,
        options
      );

    it("inside a named group", () => {
      expect(() => create([inGroup(TAGS)])).toThrow(REFUSED);
    });

    it("translated", () => {
      expect(() =>
        create([{ ...TAGS, localized: true }], { localized: true })
      ).toThrow(REFUSED);
    });
  });
}
