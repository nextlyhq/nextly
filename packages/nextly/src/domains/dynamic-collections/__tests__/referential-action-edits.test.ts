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
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
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

/**
 * What one chunk of this migration reaches a driver as.
 *
 * `splitStatements` rather than a splitter written here: it IS the policy the
 * apply paths run — split on `--> statement-breakpoint`, never on `;`, because
 * a lexical `;` split corrupts string literals — and a copy of it in a test
 * can agree with a test while disagreeing with the runner.
 */
const chunks = (sql: string): string[] => splitStatements([sql]);

/** How many statements a single chunk carries. */
const statementsIn = (chunk: string): number =>
  chunk
    .split(";")
    .map(part => part.trim())
    .filter(part => part.length > 0).length;

const indexOf = (sql: string, needle: string): number => {
  const at = sql.indexOf(needle);
  expect(at, `expected the migration to contain ${needle}`).toBeGreaterThan(-1);
  return at;
};

const relationRequired = (required: boolean): FieldDefinition =>
  ({ ...manyToOne(), required }) as FieldDefinition;

/** Run something expected to refuse, and hand back what it threw. */
const captureRefusal = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    return error;
  }
  throw new Error("expected a refusal");
};

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

describe.each(["postgresql", "mysql"] as const)(
  "what these statements meet between here and %s",
  dialect => {
    const relax =
      dialect === "mysql"
        ? "MODIFY COLUMN `author` varchar(36) NULL"
        : 'ALTER COLUMN "author" DROP NOT NULL';
    const tighten =
      dialect === "mysql"
        ? "MODIFY COLUMN `author` varchar(36) NOT NULL"
        : 'ALTER COLUMN "author" SET NOT NULL';

    it("hands the runner one statement per chunk, never two", () => {
      // The runner splits on `--> statement-breakpoint` and hands each chunk
      // to the driver whole. The MySQL adapter sets `multipleStatements =
      // false`, so a chunk carrying a semicolon-joined DROP and ADD is
      // rejected rather than applied — which made this edit a no-op on MySQL
      // while reading as a success everywhere it was tested.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })]
      );
      const parts = chunks(sql);
      expect(parts.length).toBeGreaterThan(0);
      for (const chunk of parts) expect(statementsIn(chunk)).toBe(1);
    });

    it("does the same for both of a junction's keys", () => {
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToMany({ onDelete: "cascade" })],
        [manyToMany({ onDelete: "restrict" })]
      );
      const parts = chunks(sql);
      // Four: a drop and an add for each end of the junction.
      expect(
        parts.filter(chunk => chunk.includes("FOREIGN KEY")).length
      ).toBeGreaterThanOrEqual(2);
      for (const chunk of parts) expect(statementsIn(chunk)).toBe(1);
    });

    it("relaxes the column before installing SET NULL", () => {
      // A link turned optional resolves to `ON DELETE SET NULL`, which no
      // database will accept against a NOT NULL column. MySQL refuses it and
      // its DDL auto-commits, so the drop that ran first stays applied and the
      // migration stops with the table carrying no key at all; PostgreSQL
      // accepts the pairing and fails on the first delete instead, in
      // production.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [relationRequired(true)],
        [relationRequired(false)]
      );
      expect(indexOf(sql, relax)).toBeLessThan(
        indexOf(sql, "ON DELETE SET NULL")
      );
    });

    it("replaces the key before tightening the column", () => {
      // The opposite direction, and the opposite order: the key must stop
      // saying SET NULL before the column stops accepting nulls.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [relationRequired(false)],
        [relationRequired(true)]
      );
      expect(indexOf(sql, "ON DELETE RESTRICT")).toBeLessThan(
        indexOf(sql, tighten)
      );
    });

    it("moves the column's nullability at all when required changes", () => {
      // The step this whole ordering rests on, asserted on its own because it
      // was the one that did not happen. `getColumnDescriptor` calls a
      // relationship nullable whatever its `required` says, so the column pass
      // — gated on the descriptors differing — never ran for this edit and the
      // column kept the nullability CREATE gave it.
      const relaxed = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [relationRequired(true)],
        [relationRequired(false)]
      );
      expect(relaxed).toContain(relax);
      const tightened = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [relationRequired(false)],
        [relationRequired(true)]
      );
      expect(tightened).toContain(tighten);
    });

    it("leaves the column alone when only the action moved", () => {
      // The control for the case above: widening the gate to requiredness must
      // not make an action-only edit restate the column, which on MySQL would
      // rewrite its type from a mapping that no longer agrees with it.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })]
      );
      expect(sql).not.toContain("MODIFY COLUMN");
      expect(sql).not.toContain("ALTER COLUMN");
    });

    it("drops the key the live table actually carries", () => {
      // The name is read, not derived. `fk_<table>_<column>` is only what THIS
      // service creates; a key installed under another name is still the key
      // in the way, and dropping a name that is not there aborts the migration
      // before the add.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })],
        {
          foreignKeysByColumn: new Map([["author", ["posts_author_fkey"]]]),
        }
      );
      expect(sql).toContain(q(dialect, "posts_author_fkey"));
      expect(sql).not.toContain(
        `${dialect === "mysql" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT"} ${q(dialect, "fk_dc_posts_author")}`
      );
      // It is still installed under the name this service creates.
      expect(sql).toContain(
        `ADD CONSTRAINT ${q(dialect, "fk_dc_posts_author")}`
      );
    });

    it("installs the key without a drop when the table carries none", () => {
      // Reachable by editing a scalar field into a relationship: that path
      // alters the column and installs no constraint, so the next action edit
      // met a constraint that was never there.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })],
        { foreignKeysByColumn: new Map() }
      );
      expect(sql).toContain(
        `ADD CONSTRAINT ${q(dialect, "fk_dc_posts_author")}`
      );
      expect(sql).not.toContain("DROP CONSTRAINT");
      expect(sql).not.toContain("DROP FOREIGN KEY");
    });

    it("falls back to the generated name when the caller did not look", () => {
      // An absent map and an empty one are different answers: one is "I did
      // not ask", which leaves this as it behaved before anything was
      // measured, and the other is "I asked and there is none".
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })]
      );
      expect(sql).toContain(
        `${dialect === "mysql" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT"} ${q(dialect, "fk_dc_posts_author")}`
      );
    });
  }
);

describe.each(["postgresql", "mysql"] as const)(
  "an action edit paired the way the other passes pair it, on %s",
  dialect => {
    const dropVerb =
      dialect === "mysql" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";

    it("carries the edit through a rename of the same field", () => {
      // A renamed field is the SAME field. Matching the old list by the NEW
      // name finds nothing, so this pass skipped the pair entirely and the
      // save emitted the column rename alone — registry recording `restrict`
      // over a key still cascading, which is the defect this PR exists to fix,
      // reached through a second door.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [
          {
            ...manyToOne({ onDelete: "restrict" }),
            name: "writer",
          } as FieldDefinition,
        ]
      );
      expect(sql).toContain(
        `RENAME COLUMN ${q(dialect, "author")} TO ${q(dialect, "writer")}`
      );
      // Dropped under the name the LIVE table carries — derived from the
      // column as it was before this save — and installed under the new one.
      expect(sql).toContain(`${dropVerb} ${q(dialect, "fk_dc_posts_author")}`);
      expect(sql).toContain(
        `ADD CONSTRAINT ${q(dialect, "fk_dc_posts_writer")}`
      );
      expect(sql).toContain("ON DELETE RESTRICT");
    });

    it("reads the live key by the column's name BEFORE the save", () => {
      // The map was read from the database, so it is keyed on the old column;
      // keying the lookup on the new one finds nothing and emits an ADD beside
      // a key that is still there.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [
          {
            ...manyToOne({ onDelete: "restrict" }),
            name: "writer",
          } as FieldDefinition,
        ],
        { foreignKeysByColumn: new Map([["author", ["posts_author_fkey"]]]) }
      );
      expect(sql).toContain(`${dropVerb} ${q(dialect, "posts_author_fkey")}`);
      expect(sql).toContain(
        `ADD CONSTRAINT ${q(dialect, "fk_dc_posts_writer")}`
      );
    });

    it("leaves the key to the add path when the storage class moved", () => {
      // A field moving from a junction to its own column is CREATED by the add
      // path, which writes the column and its key together with the actions
      // this save asks for. Emitting here as well is a second ADD CONSTRAINT
      // under one name: the migration aborts, and on MySQL the column and the
      // first key have already auto-committed.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [
          {
            name: "author",
            type: "relationship",
            options: {
              relationType: "manyToMany",
              target: "authors",
              onDelete: "cascade",
            },
          } as unknown as FieldDefinition,
        ],
        [manyToOne({ onDelete: "restrict" })]
      );
      const adds = sql.split(
        `ADD CONSTRAINT ${q(dialect, "fk_dc_posts_author")}`
      ).length;
      // `split` yields occurrences + 1, so exactly one ADD means 2 parts.
      expect(adds).toBe(2);
      expect(sql).toContain("ON DELETE RESTRICT");
    });

    it("emits a moved junction's keys once, not twice", () => {
      // The carry path already redeclares both keys with the new actions when
      // a junction's table moves. The action pass must leave those alone or
      // the second drop meets a constraint the first already replaced.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToMany({ onDelete: "cascade" })],
        [
          {
            ...manyToMany({ onDelete: "restrict" }),
            name: "labels",
          } as FieldDefinition,
        ]
      );
      // The carry path drops the key under its OLD name and adds it under the
      // new one. A second emitter here would drop the NEW name — a constraint
      // that does not exist until the carry's own ADD creates it — so that is
      // the string to rule out. Counting the old name cannot see it, because
      // both emitters would leave that count at one.
      expect(sql).toContain(
        `${dropVerb} ${q(dialect, "fk_dc_posts_dc_tags_tags_posts")}`
      );
      expect(sql).not.toContain(
        `${dropVerb} ${q(dialect, "fk_dc_posts_dc_tags_labels_posts")}`
      );
    });
  }
);

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "an action the column cannot perform is refused on %s",
  dialect => {
    const refusal = (run: () => unknown): string => {
      try {
        run();
      } catch (error) {
        expect(NextlyError.is(error)).toBe(true);
        return JSON.stringify(error);
      }
      throw new Error("expected a refusal");
    };

    it("refuses `onUpdate: set null` on a required relationship", () => {
      // The identical impossible pair `onDelete` has always refused, reachable
      // through the other half. Requiredness is unchanged by this save, so
      // nothing relaxes the column: MySQL rejects the key after the drop has
      // auto-committed, and PostgreSQL accepts it and fails on the first
      // update of a referenced id, in production.
      const required = (options: Record<string, unknown>) =>
        ({ ...manyToOne(options), required: true }) as FieldDefinition;
      expect(
        refusal(() =>
          service(dialect).generateAlterTableMigration(
            "dc_posts",
            [required({ onUpdate: "no action" })],
            [required({ onUpdate: "set null" })]
          )
        )
      ).toContain("REQUIRED_RELATION_CANNOT_SET_NULL");
    });

    it("refuses it at creation too, not only on an edit", () => {
      const required = (options: Record<string, unknown>) =>
        ({ ...manyToOne(options), required: true }) as FieldDefinition;
      expect(
        refusal(() =>
          service(dialect).generateMigrationSQL("dc_posts", [
            required({ onUpdate: "set null" }),
          ])
        )
      ).toContain("REQUIRED_RELATION_CANNOT_SET_NULL");
    });

    it("refuses `set null` on a many-to-many, whose columns are NOT NULL", () => {
      // Both link columns are created NOT NULL — a link naming nothing on one
      // side is not a link — so SET NULL can never hold on either key, on any
      // dialect. Refused before the dialect question, because no dialect can
      // do it.
      expect(
        refusal(() =>
          service(dialect).generateAlterTableMigration(
            "dc_posts",
            [manyToMany({ onDelete: "cascade" })],
            [manyToMany({ onDelete: "set null" })]
          )
        )
      ).toContain("JUNCTION_CANNOT_SET_NULL");
    });

    it("refuses a junction created with it, which could never enforce it", () => {
      expect(
        refusal(() =>
          service(dialect).generateJunctionTable(
            "dc_posts",
            manyToMany({ onDelete: "set null" })
          )
        )
      ).toContain("JUNCTION_CANNOT_SET_NULL");
    });

    it("still allows the actions a junction CAN perform", () => {
      // The control: the refusal is about `set null`, not about junction
      // action edits in general — which remain refused on SQLite by name and
      // emitted on the other two.
      const run = () =>
        service(dialect).generateJunctionTable(
          "dc_posts",
          manyToMany({ onDelete: "cascade" })
        );
      expect(run).not.toThrow();
    });
  }
);

describe.each(["postgresql", "mysql"] as const)(
  "the column's live state, not its metadata, on %s",
  dialect => {
    const relax =
      dialect === "mysql"
        ? "MODIFY COLUMN `author` varchar(36) NULL"
        : 'ALTER COLUMN "author" DROP NOT NULL';

    it("states that the column accepts nulls when installing SET NULL", () => {
      // Both definitions are optional, so requiredness has not moved and the
      // column pass emits nothing — yet the live column may still be NOT NULL,
      // because a database migrated before a requiredness toggle relaxed
      // anything carries whatever CREATE gave it. Metadata cannot see that, so
      // the nullability is STATED rather than inferred.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "set null" })]
      );
      expect(indexOf(sql, relax)).toBeLessThan(
        indexOf(sql, "ON DELETE SET NULL")
      );
    });

    it("states it once, not twice, when requiredness moved as well", () => {
      // The control for the case above: where the column pass already relaxes
      // the column, this must not relax it a second time.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [{ ...manyToOne(), required: true } as FieldDefinition],
        [{ ...manyToOne(), required: false } as FieldDefinition]
      );
      expect(sql.split(relax).length).toBe(2);
    });

    it("says nothing about nullability when no SET NULL is installed", () => {
      // The other control: an action edit that installs RESTRICT has no reason
      // to touch the column, and touching it on MySQL would restate its type.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [manyToOne({ onDelete: "cascade" })],
        [manyToOne({ onDelete: "restrict" })]
      );
      expect(sql).not.toContain(relax);
    });
  }
);

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "making a column required over rows that left it empty, on %s",
  dialect => {
    // `onDelete` is DECLARED on both sides so the resolved action does not move
    // with requiredness. Leaving it undefined makes this edit an action change
    // too — `restrict` derived from required, `set null` from optional — which
    // SQLite refuses on its own, and the refusal under test would then be
    // indistinguishable from that one.
    const optional = manyToOne({ onDelete: "cascade" });
    const required = {
      ...manyToOne({ onDelete: "cascade" }),
      required: true,
    } as FieldDefinition;
    const alter = (options?: Record<string, unknown>) =>
      service(dialect).generateAlterTableMigration(
        "dc_posts",
        [optional],
        [required],
        options as never
      );

    it("refuses before a single statement is written", () => {
      // A precondition. The server rejects the tightening, and by then the
      // statements ahead of it have run — on MySQL auto-committed, including
      // the foreign-key replacement this tightening is deliberately ordered
      // behind, which would leave the table carrying no key at all.
      try {
        alter({ columnsContainingNull: new Set(["author"]) });
        throw new Error("expected a refusal");
      } catch (error) {
        expect(NextlyError.is(error)).toBe(true);
        expect(JSON.stringify(error)).toContain("REQUIRED_COLUMN_HAS_NULLS");
      }
    });

    it("allows it when the caller looked and found no nulls", () => {
      // The control that matters most: an empty set is a real answer, and
      // refusing on it would block every legitimate tightening.
      expect(() =>
        alter({ columnsContainingNull: new Set<string>() })
      ).not.toThrow();
    });

    it("allows it when the nulls are in a DIFFERENT column", () => {
      expect(() =>
        alter({ columnsContainingNull: new Set(["headline"]) })
      ).not.toThrow();
    });

    it("leaves the edit alone when the caller did not look", () => {
      // Undefined is "I did not ask", which keeps the behaviour this had
      // before anything was measured rather than guessing either way.
      expect(() => alter()).not.toThrow();
    });

    it("says nothing about a field that was ALREADY required", () => {
      // Not a transition: the column is already NOT NULL, so it cannot be
      // holding the null the set claims — and refusing here would make an
      // unrelated edit to a required field impossible.
      expect(() =>
        service(dialect).generateAlterTableMigration(
          "dc_posts",
          [required],
          [{ ...required, index: true } as FieldDefinition],
          { columnsContainingNull: new Set(["author"]) } as never
        )
      ).not.toThrow();
    });
  }
);

describe.each(["postgresql", "mysql"] as const)(
  "one pairing serves every pass, on %s",
  dialect => {
    const relaxWriter =
      dialect === "mysql"
        ? "MODIFY COLUMN `writer` varchar(36) NULL"
        : 'ALTER COLUMN "writer" DROP NOT NULL';

    it("relaxes a RENAMED field's column as well as moving its key", () => {
      // The action pass carried the rename and the column pass did not, so the
      // key moved to SET NULL while the column stayed NOT NULL — the two
      // halves of one edit disagreeing because each answered "what was this
      // field before?" for itself.
      const sql = service(dialect).generateAlterTableMigration(
        "dc_posts",
        [{ ...manyToOne(), required: true } as FieldDefinition],
        [{ ...manyToOne(), name: "writer", required: false } as FieldDefinition]
      );
      expect(sql).toContain(
        `RENAME COLUMN ${q(dialect, "author")} TO ${q(dialect, "writer")}`
      );
      // Named for the column AFTER the rename, and ahead of the key that needs it.
      expect(indexOf(sql, relaxWriter)).toBeLessThan(
        indexOf(sql, "ON DELETE SET NULL")
      );
    });
  }
);

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "a definition already stored is read, not judged, on %s",
  dialect => {
    // What the OLD creation path accepted and the new one refuses: required,
    // with an `onUpdate` that empties the column it forbids emptying.
    const legacy = {
      ...manyToOne({ onUpdate: "set null" }),
      required: true,
    } as FieldDefinition;

    it("lets the collection be repaired rather than freezing it", () => {
      // Refusing to READ the stored definition makes the repair impossible:
      // the repair IS an edit, and this pass visits every retained
      // relationship on every save.
      const repair = () =>
        service(dialect).generateAlterTableMigration(
          "dc_posts",
          [legacy],
          [
            {
              ...manyToOne({ onUpdate: "cascade" }),
              required: true,
            } as FieldDefinition,
          ]
        );
      if (dialect === "sqlite") {
        // Still refused HERE, but for the dialect's own reason — it cannot
        // alter a constraint — rather than because the stored definition was
        // unreadable. The distinction is the point: one is fixable by moving
        // to another dialect, the other was fixable nowhere.
        expect(JSON.stringify(captureRefusal(repair))).toContain(
          "FOREIGN_KEY_ACTION_UNSUPPORTED"
        );
        return;
      }
      expect(repair).not.toThrow();
    });

    it("does not let a legacy field block edits to its neighbours", () => {
      // The same save touching a DIFFERENT field. The legacy relationship is
      // carried through unchanged and must not refuse on the way past.
      expect(() =>
        service(dialect).generateAlterTableMigration(
          "dc_posts",
          [legacy, { name: "headline", type: "text" } as FieldDefinition],
          [
            legacy,
            { name: "headline", type: "text", index: true } as FieldDefinition,
          ]
        )
      ).not.toThrow();
    });

    it("still refuses a save that ASKS for the impossible pair", () => {
      // The control, and the whole point of the split: reading is permitted,
      // writing it is not.
      try {
        service(dialect).generateAlterTableMigration(
          "dc_posts",
          [
            {
              ...manyToOne({ onUpdate: "cascade" }),
              required: true,
            } as FieldDefinition,
          ],
          [legacy]
        );
        throw new Error("expected a refusal");
      } catch (error) {
        expect(NextlyError.is(error)).toBe(true);
        expect(JSON.stringify(error)).toContain(
          "REQUIRED_RELATION_CANNOT_SET_NULL"
        );
      }
    });
  }
);
