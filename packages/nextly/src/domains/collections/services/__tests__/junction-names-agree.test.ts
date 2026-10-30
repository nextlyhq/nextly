/**
 * A many-to-many junction is created by the DDL generator, named from the
 * source collection's TABLE, and then read and written by the relationship
 * service, which names it from the source collection's SLUG. The two must
 * land on the same table and the same link columns for every collection
 * shape, or every link read and write misses the table the DDL created.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { resolveCollectionTableName } from "../../../schema/utils/resolve-table-name";
import {
  CollectionRelationshipService,
  junctionLinkColumns,
} from "../collection-relationship-service";
import { getTableName } from "../collection-utils";

function m2mField(target: string): FieldDefinition {
  return {
    name: "tags",
    type: "relationship",
    options: { target, relationType: "manyToMany" },
  } as FieldDefinition;
}

// The DDL side: what the generator creates for this source table.
function ddlNames(sourceTable: string, target: string) {
  const shape = new DynamicCollectionSchemaService(
    undefined,
    "postgresql"
  ).junctionShape(sourceTable, m2mField(target));
  return {
    table: shape.table,
    sourceColumn: shape.sourceColumn,
    targetColumn: shape.targetColumn,
  };
}

// The runtime side: what the relationship service queries for this source
// slug. Built from the prototype, since the names depend on no injected
// collaborator and the constructor wants a live adapter.
function runtimeNames(sourceSlug: string, target: string) {
  const service = Object.create(
    CollectionRelationshipService.prototype
  ) as CollectionRelationshipService;
  return {
    table: service.getJunctionTableName(sourceSlug, target, m2mField(target)),
    ...junctionLinkColumns(sourceSlug, target),
  };
}

interface Shape {
  label: string;
  slug: string;
  table: string;
}

const shapes: Shape[] = [
  {
    label: "hyphen-free Builder source",
    slug: "posts",
    table: getTableName("posts"),
  },
  {
    label: "hyphen-free code-first source",
    slug: "articles",
    table: resolveCollectionTableName("articles"),
  },
  {
    label: "dc_-prefixed Builder slug",
    slug: "dc_posts",
    table: getTableName("dc_posts"),
  },
  {
    label: "hyphenated Builder source",
    slug: "my-posts",
    table: getTableName("my-posts"),
  },
  {
    label: "hyphenated code-first source",
    slug: "team-updates",
    table: resolveCollectionTableName("team-updates"),
  },
];

describe("many-to-many junction names: runtime agrees with the DDL", () => {
  it("resolves the source tables the shapes describe", () => {
    expect(shapes.map(s => s.table)).toEqual([
      "dc_posts",
      "dc_articles",
      "dc_dc_posts",
      "dc_my_posts",
      "dc_team_updates",
    ]);
  });

  for (const target of ["tags", "team-tags"]) {
    for (const shape of shapes) {
      it(`${shape.label} (${shape.slug}) -> target ${target}`, () => {
        expect(runtimeNames(shape.slug, target)).toEqual(
          ddlNames(shape.table, target)
        );
      });
    }
  }

  // Names that already work must not move: a stored junction keeps its name.
  it.each([
    ["posts", "dc_posts", "dc_posts_dc_tags_tags", "posts_id"],
    ["articles", "dc_articles", "dc_articles_dc_tags_tags", "articles_id"],
    ["dc_posts", "dc_dc_posts", "dc_dc_posts_dc_tags_tags", "dc_posts_id"],
  ])(
    "keeps the literal names for %s",
    (slug, table, junction, sourceColumn) => {
      const expected = {
        table: junction,
        sourceColumn,
        targetColumn: "tags_id",
      };
      expect(runtimeNames(slug, "tags")).toEqual(expected);
      expect(ddlNames(table, "tags")).toEqual(expected);
    }
  );

  it("names the hyphenated source's junction from its table", () => {
    expect(runtimeNames("my-posts", "tags")).toEqual({
      table: "dc_my_posts_dc_tags_tags",
      sourceColumn: "my_posts_id",
      targetColumn: "tags_id",
    });
  });

  // Known limit: a code-first collection with its own table name (`dbName`).
  // The DDL names the junction from that table, while the runtime has only
  // the slug, so the two differ. Pinned here so a change to either side shows.
  it("differs for a code-first source with its own dbName (known limit)", () => {
    const table = resolveCollectionTableName("articles", "blog_articles");
    expect(table).toBe("dc_blog_articles");
    expect(ddlNames(table, "tags")).toEqual({
      table: "dc_blog_articles_dc_tags_tags",
      sourceColumn: "blog_articles_id",
      targetColumn: "tags_id",
    });
    expect(runtimeNames("articles", "tags")).toEqual({
      table: "dc_articles_dc_tags_tags",
      sourceColumn: "articles_id",
      targetColumn: "tags_id",
    });
  });
});
