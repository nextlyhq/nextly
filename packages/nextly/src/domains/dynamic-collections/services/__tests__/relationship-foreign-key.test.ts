/**
 * The key a Builder relationship's column carries, as `relationshipForeignKey`
 * describes it for the CREATE and for the push pipeline's desired schema.
 *
 * Its name is bounded as every derived identifier is: an unbounded
 * `fk_<table>_<column>` past 64 characters is refused by MySQL, so a long
 * collection with a long relationship could neither be created nor have the
 * relationship added. And its actions are judged only when asked: a caller
 * reading a relationship that already exists must not be refused over a
 * combination an older save accepted.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { foreignKeyNameForColumns } from "../../../schema/services/index-name";
import { builderKeyTables, type CollectionTables } from "../collection-tables";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

const builder = (dialect: "postgresql" | "mysql" | "sqlite" = "mysql") =>
  new DynamicCollectionSchemaService(undefined, dialect);

const relationship = (
  name: string,
  options: Record<string, unknown> = {},
  required = false
) =>
  ({
    name,
    type: "relationship",
    required,
    options: { target: "authors", relationType: "manyToOne", ...options },
  }) as unknown as FieldDefinition;

describe("relationshipForeignKey", () => {
  it("keys the column to the target's id, named fk_<table>_<column>", () => {
    expect(
      builder().relationshipForeignKey(
        "dc_posts",
        relationship("leadAuthor", { onDelete: "cascade" })
      )
    ).toEqual({
      name: "fk_dc_posts_lead_author",
      columns: ["lead_author"],
      referencesTable: "dc_authors",
      referencesColumns: ["id"],
      onDelete: "cascade",
      onUpdate: "no action",
    });
  });

  it("bounds a long name, and the CREATE writes the same name", () => {
    const table = `dc_${"a_rather_long_collection_name_".repeat(2)}x`;
    const field = relationship("theAuthorWhoWroteTheFirstDraftOfThisPost");
    const fk = builder().relationshipForeignKey(table, field);

    // The raw spelling really is too long, so the bound is what is tested.
    expect(
      `fk_${table}_the_author_who_wrote_the_first_draft_of_this_post`.length
    ).toBeGreaterThan(64);
    expect(fk?.name.length).toBeLessThanOrEqual(63);
    expect(fk?.name).toBe(foreignKeyNameForColumns(table, fk?.columns ?? []));
    expect(builder().generateMigrationSQL(table, [field])).toContain(
      `CONSTRAINT \`${fk?.name}\` FOREIGN KEY`
    );
  });

  it("refuses an impossible pair by default, and reads it when asked not to judge", () => {
    // Required, so it cannot be emptied when its author goes.
    const legacy = relationship("author", { onDelete: "set null" }, true);

    let refused: unknown;
    try {
      builder().relationshipForeignKey("dc_posts", legacy);
    } catch (error) {
      refused = error;
    }
    expect(NextlyError.isValidation(refused)).toBe(true);

    expect(
      builder().relationshipForeignKey("dc_posts", legacy, false)?.onDelete
    ).toBe("set null");
  });

  it("describes no key for a many-to-many, which lives in a junction table", () => {
    expect(
      builder().relationshipForeignKey(
        "dc_posts",
        relationship("tags", { relationType: "manyToMany" })
      )
    ).toBeNull();
  });
});

/**
 * A relationship's target table is the one the target collection was created under: a hyphen in
 * its address is written as an underscore, as every create names the table. Before hyphenated
 * addresses were accepted in the Builder, the target was spliced in as written, so a relationship
 * to `team-updates` referenced a `dc_team-updates` that no create makes. A junction table's NAME is
 * a stored spelling and stays as it was.
 */
describe("a relationship's target table", () => {
  const toTeamUpdates = (relationType: string, options = {}) =>
    relationship("update", {
      target: "team-updates",
      relationType,
      ...options,
    });

  it("is the table the target was created under, for each target address", () => {
    for (const [target, table] of [
      ["team-updates", "dc_team_updates"],
      ["dc_posts", "dc_dc_posts"],
      ["authors", "dc_authors"],
    ] as const) {
      expect(
        builder().relationshipForeignKey(
          "dc_notes",
          relationship("update", { target })
        )?.referencesTable,
        target
      ).toBe(table);
    }
  });

  it.each(["postgresql", "mysql"] as const)(
    "references it when a relationship is added or its actions change (%s)",
    dialect => {
      const added = builder(dialect).generateAlterTableMigration(
        "dc_notes",
        [],
        [toTeamUpdates("manyToOne")]
      );
      const changed = builder(dialect).generateAlterTableMigration(
        "dc_notes",
        [toTeamUpdates("manyToOne", { onDelete: "cascade" })],
        [toTeamUpdates("manyToOne", { onDelete: "restrict" })]
      );
      for (const sql of [added, changed]) {
        expect(sql).toContain("dc_team_updates");
        expect(sql).not.toContain("dc_team-updates");
      }
    }
  );

  it("points a junction at it, and keeps the junction's own name", () => {
    const service = builder("postgresql");
    const field = toTeamUpdates("manyToMany");
    const shape = service.junctionShape("dc_notes", field);

    expect(shape.targetTable).toBe("dc_team_updates");
    expect(shape.table).toBe(
      service.generateJunctionTableName("dc_notes", "dc_team-updates", "update")
    );
  });
});

/**
 * Which relationships carry a key is one rule, read by the CREATE, by a column an edit adds, by the
 * keys a create is predicted to install and by the key the push pipeline expects. A Builder
 * collection's own keys read the admin's `relationTo`; every other reader keys `options.target`
 * alone. A relationship stored as JSON, or whose target has no table, gets a key from none of them.
 */
describe("which relationships carry a key", () => {
  const builderTables = builderKeyTables([
    ["authors", "writers"],
    ["posts", "dc_posts"],
  ]);
  const adminShape = {
    name: "writer",
    type: "relationship",
    relationTo: "authors",
  } as unknown as FieldDefinition;
  const toUsers = {
    name: "owner",
    type: "relationship",
    relationTo: "users",
  } as unknown as FieldDefinition;
  const multiValue = {
    name: "authors",
    type: "relationship",
    hasMany: true,
    relationTo: "authors",
  } as unknown as FieldDefinition;
  const several = {
    name: "subject",
    type: "relationship",
    relationTo: ["authors", "posts"],
  } as unknown as FieldDefinition;

  /** Every place a key is described, created or predicted, for one field on `dc_notes`. */
  function keysFor(field: FieldDefinition, targetTables?: CollectionTables) {
    const service = builder("postgresql");
    const described = service.relationshipForeignKey(
      "dc_notes",
      field,
      true,
      targetTables
    );
    const created = service.generateMigrationSQL("dc_notes", [field], {
      targetTables,
    });
    const added = service.generateAlterTableMigration("dc_notes", [], [field], {
      targetTables,
    });
    const planned = service.plannedAttachments(
      "dc_notes",
      [field],
      targetTables
    );
    return [
      ...(described ? [`described ${described.referencesTable}`] : []),
      ...(/FOREIGN KEY/.test(created) ? ["created"] : []),
      ...(/FOREIGN KEY/.test(added) ? ["added"] : []),
      ...(planned.foreignKeysByColumn.size > 0 ? ["planned"] : []),
    ];
  }

  it("keys the admin's relationTo everywhere, to the registry's table, for a Builder collection", () => {
    expect(keysFor(adminShape, builderTables)).toEqual([
      "described writers",
      "created",
      "added",
      "planned",
    ]);
    expect(
      builder("postgresql").generateMigrationSQL("dc_notes", [adminShape], {
        targetTables: builderTables,
      })
    ).toContain(`REFERENCES "writers"`);
  });

  it("keys the admin's relationTo nowhere for any other reader", () => {
    expect(keysFor(adminShape, new Map([["authors", "writers"]]))).toEqual([]);
    expect(keysFor(adminShape)).toEqual([]);
  });

  it("keys a relationTo to a target the registry does not hold nowhere", () => {
    expect(keysFor(toUsers, builderTables)).toEqual([]);
  });

  it("keys a relationship holding a list, or naming several targets, nowhere", () => {
    expect(keysFor(multiValue, builderTables)).toEqual([]);
    expect(keysFor(several, builderTables)).toEqual([]);
  });

  it("keys an options.target relationship everywhere, as before", () => {
    expect(keysFor(relationship("author"))).toEqual([
      "described dc_authors",
      "created",
      "added",
      "planned",
    ]);
  });
});
