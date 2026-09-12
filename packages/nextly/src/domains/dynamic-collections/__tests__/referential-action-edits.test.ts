/**
 * Editing what a relationship does when the row it points at is deleted.
 *
 * The action a foreign key carries was written only by the statement that
 * CREATED it. Changing `onDelete` on an existing field emitted nothing: the
 * save reported success and the registry recorded the new action while the
 * database went on enforcing the old one — so an author who moved
 * `posts.author` from cascade to restrict still lost every post when the
 * author was deleted.
 *
 * The action is deliberately not part of the column comparison. That question
 * is whether the COLUMN changed, and its answer drives a type rewrite; an
 * action lives on the constraint, so folding it in would rebuild storage for
 * an edit that never touched any.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";
const DIALECTS: Dialect[] = ["postgresql", "mysql", "sqlite"];

const q = (dialect: Dialect, name: string): string =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

const relation = (
  relationType: string,
  options: Record<string, unknown> = {}
): FieldDefinition =>
  ({
    name: "author",
    type: "relationship",
    required: false,
    options: { relationType, target: "authors", ...options },
  }) as unknown as FieldDefinition;

const manyToOne = (options: Record<string, unknown> = {}) =>
  relation("manyToOne", options);

const manyToMany = (options: Record<string, unknown> = {}): FieldDefinition =>
  ({
    name: "tags",
    type: "relationship",
    options: { relationType: "manyToMany", target: "tags", ...options },
  }) as unknown as FieldDefinition;

const service = (dialect: Dialect) =>
  new DynamicCollectionSchemaService(undefined, dialect);

describe.each(["postgresql", "mysql"] as const)(
  "a relationship's referential actions on %s",
  dialect => {
    const dropVerb =
      dialect === "mysql" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";

    it("rebuilds the constraint when onDelete changes", () => {
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })]
      );
      const fk = q(dialect, "fk_dc_posts_author");
      expect(sql).toContain(
        `ALTER TABLE ${q(dialect, "dc_posts")} ${dropVerb} ${fk};`
      );
      expect(sql).toContain("ON DELETE RESTRICT");
      // The column itself never moved, so nothing may rewrite its storage.
      expect(sql).not.toContain("ALTER COLUMN");
      expect(sql).not.toContain("MODIFY COLUMN");
    });

    it("rebuilds it when onUpdate changes on its own", () => {
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade", onUpdate: "no action" })],
        [manyToOne({ onDelete: "cascade", onUpdate: "cascade" })]
      );
      expect(sql).toContain("ON UPDATE CASCADE");
    });

    it("emits nothing when neither action moved", () => {
      // The control. Without it, a path that rebuilt the constraint on every
      // save would satisfy every assertion above.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "cascade" })]
      );
      expect(sql).not.toContain("FOREIGN KEY");
    });

    it("sees an action that moved because `required` did", () => {
      // An undeclared `onDelete` is derived from `required`: optional means
      // `set null`, required means `restrict`. So making a field required
      // changes its delete behaviour without either definition mentioning
      // `onDelete` at all, and comparing the DECLARED values would miss it.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne()],
        [{ ...manyToOne(), required: true } as FieldDefinition]
      );
      expect(sql).toContain("ON DELETE RESTRICT");
    });

    it("rebuilds both ends of a many-to-many's junction", () => {
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToMany({ onDelete: "cascade" })],
        [manyToMany({ onDelete: "restrict" })]
      );
      const joined = sql;
      // Both foreign keys: a link row is only meaningful while both sides
      // exist, so the edit applies to each.
      expect(joined).toContain(q(dialect, "fk_dc_posts_dc_tags_tags_posts"));
      expect(joined).toContain(q(dialect, "fk_dc_posts_dc_tags_tags_tags"));
      expect(joined).toContain("ON DELETE RESTRICT");
      // The table is NOT rebuilt: that would destroy every link it holds for
      // a change that never needed to touch one.
      expect(joined).not.toContain("DROP TABLE");
      expect(joined).not.toContain("CREATE TABLE");
    });
  }
);

describe("a relationship's referential actions on sqlite", () => {
  it("refuses a plain relationship's action edit by name", () => {
    // SQLite cannot alter a constraint. The only way through is the 12-step
    // table rebuild, which has caused real data loss in three independent
    // tools that automated it — so this refuses, as a foreign-key drop and an
    // unenforceable unique constraint already do on this dialect.
    expect(() =>
      service("sqlite").generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })]
      )
    ).toThrow(NextlyError);
    try {
      service("sqlite").generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })]
      );
      throw new Error("expected a refusal");
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
      expect(JSON.stringify(error)).toContain("FOREIGN_KEY_ACTION_UNSUPPORTED");
    }
  });

  it("refuses a junction's action edit by name", () => {
    expect(() =>
      service("sqlite").generateAlterTableMigration(
        "dc_posts",
        [manyToMany({ onDelete: "cascade" })],
        [manyToMany({ onDelete: "restrict" })]
      )
    ).toThrow(NextlyError);
  });

  it("still allows a save that leaves the actions alone", () => {
    // The control: the refusal is about the edit, not about the dialect
    // having relationships at all.
    expect(() =>
      service("sqlite").generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "cascade" })]
      )
    ).not.toThrow();
  });
});
