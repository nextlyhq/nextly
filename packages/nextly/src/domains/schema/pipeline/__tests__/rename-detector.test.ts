import { describe, expect, it } from "vitest";

import type {
  AddColumnOp,
  DropColumnOp,
  NextlySchemaSnapshot,
  Operation,
} from "../diff/types";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { buildDesiredTableFromFields } from "../diff/build-from-fields";
import { diffSnapshots } from "../diff/diff";
import type { SupportedDialect } from "../../services/field-column-descriptor";
import { RegexRenameDetector } from "../rename-detector";

const detector = new RegexRenameDetector();

const drop = (
  tableName: string,
  columnName: string,
  columnType: string
): DropColumnOp => ({
  type: "drop_column",
  tableName,
  columnName,
  columnType,
});

const add = (
  tableName: string,
  columnName: string,
  type: string,
  nullable = true
): AddColumnOp => ({
  type: "add_column",
  tableName,
  column: { name: columnName, type, nullable },
});

describe("RegexRenameDetector - empty / edge inputs", () => {
  it("returns [] for empty operations", () => {
    expect(detector.detect([], "postgresql")).toEqual([]);
  });

  it("returns [] when only drop_column ops (no adds to pair with)", () => {
    expect(
      detector.detect([drop("dc_posts", "title", "text")], "postgresql")
    ).toEqual([]);
  });

  it("returns [] when only add_column ops (no drops to pair with)", () => {
    expect(
      detector.detect([add("dc_posts", "name", "text")], "postgresql")
    ).toEqual([]);
  });

  it("ignores non-drop/non-add ops (rename_column, change_column_type, etc.)", () => {
    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "a",
        toColumn: "b",
        fromType: "text",
        toType: "text",
      },
      {
        type: "change_column_type",
        tableName: "dc_posts",
        columnName: "x",
        fromType: "text",
        toType: "varchar",
      },
      { type: "drop_table", tableName: "dc_old" },
      {
        type: "add_table",
        table: { name: "dc_new", columns: [] },
      },
    ];
    expect(detector.detect(ops, "postgresql")).toEqual([]);
  });
});

describe("RegexRenameDetector - spec acceptance criteria", () => {
  it("simple PG: text -> text yields 1 candidate, typesCompatible:true", () => {
    const result = detector.detect(
      [drop("dc_posts", "title", "text"), add("dc_posts", "name", "text")],
      "postgresql"
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tableName: "dc_posts",
      fromColumn: "title",
      toColumn: "name",
      fromType: "text",
      toType: "text",
      typesCompatible: true,
      defaultSuggestion: "rename",
    });
  });

  it("type incompatibility: int -> date yields typesCompatible:false, defaultSuggestion:drop_and_add", () => {
    const result = detector.detect(
      [drop("dc_posts", "age", "int4"), add("dc_posts", "dob", "date")],
      "postgresql"
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tableName: "dc_posts",
      fromColumn: "age",
      toColumn: "dob",
      fromType: "int4",
      toType: "date",
      typesCompatible: false,
      defaultSuggestion: "drop_and_add",
    });
  });

  it("multi-table: drops on table A and adds on table B do NOT cross-pair", () => {
    const result = detector.detect(
      [drop("dc_posts", "title", "text"), add("dc_users", "name", "text")],
      "postgresql"
    );
    expect(result).toEqual([]);
  });

  it("multi-rename within table: 3 drops + 3 adds yields 9 raw candidates", () => {
    const result = detector.detect(
      [
        drop("dc_posts", "a", "text"),
        drop("dc_posts", "b", "text"),
        drop("dc_posts", "c", "text"),
        add("dc_posts", "x", "text"),
        add("dc_posts", "y", "text"),
        add("dc_posts", "z", "text"),
      ],
      "postgresql"
    );
    expect(result).toHaveLength(9);
    expect(result.every(c => c.typesCompatible === true)).toBe(true);
    expect(result.every(c => c.defaultSuggestion === "rename")).toBe(true);
  });

  it("defensive: empty fromType (drop_column with type='') yields typesCompatible:false", () => {
    const result = detector.detect(
      [drop("dc_posts", "mystery", ""), add("dc_posts", "name", "text")],
      "postgresql"
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tableName: "dc_posts",
      fromColumn: "mystery",
      toColumn: "name",
      fromType: "",
      toType: "text",
      typesCompatible: false,
      defaultSuggestion: "drop_and_add",
    });
  });
});

describe("RegexRenameDetector - deterministic ordering", () => {
  it("sorts output by (tableName, fromColumn, toColumn)", () => {
    const result = detector.detect(
      [
        drop("dc_posts", "z", "text"),
        drop("dc_posts", "a", "text"),
        add("dc_posts", "y", "text"),
        add("dc_posts", "b", "text"),
      ],
      "postgresql"
    );
    expect(result.map(r => [r.fromColumn, r.toColumn])).toEqual([
      ["a", "b"],
      ["a", "y"],
      ["z", "b"],
      ["z", "y"],
    ]);
  });
});

describe("RegexRenameDetector - plan-v3 Appendix D worked example (10-field rename)", () => {
  it("produces 49 raw candidates with correct type-compatibility flags", () => {
    // Before: name(text), phone(text), email(text), age(int4),
    //         state(text), country(text), zip(text)
    // After:  mobile_number(text), full_name(text), email_address(text),
    //         dob(date), state_initials(text), zip_code(text), country_code(text)
    const ops: Operation[] = [
      drop("dc_user", "name", "text"),
      drop("dc_user", "phone", "text"),
      drop("dc_user", "email", "text"),
      drop("dc_user", "age", "int4"),
      drop("dc_user", "state", "text"),
      drop("dc_user", "country", "text"),
      drop("dc_user", "zip", "text"),
      add("dc_user", "mobile_number", "text"),
      add("dc_user", "full_name", "text"),
      add("dc_user", "email_address", "text"),
      add("dc_user", "dob", "date"),
      add("dc_user", "state_initials", "text"),
      add("dc_user", "zip_code", "text"),
      add("dc_user", "country_code", "text"),
    ];
    const result = detector.detect(ops, "postgresql");

    // Cartesian: 7 drops × 7 adds = 49 raw candidates.
    expect(result).toHaveLength(49);

    // 6 text-source × 6 text-target = 36 compat. age (int4) → none compat.
    // 6 text-source × 1 dob (date) = 6 incompat. age × 7 = 7 incompat.
    // Total compat = 36; incompat = 49 - 36 = 13.
    const compatCount = result.filter(c => c.typesCompatible).length;
    const incompatCount = result.filter(c => !c.typesCompatible).length;
    expect(compatCount).toBe(36);
    expect(incompatCount).toBe(13);

    const nameToFullName = result.find(
      c => c.fromColumn === "name" && c.toColumn === "full_name"
    );
    expect(nameToFullName?.typesCompatible).toBe(true);

    const ageToMobile = result.find(
      c => c.fromColumn === "age" && c.toColumn === "mobile_number"
    );
    expect(ageToMobile?.typesCompatible).toBe(false);

    const ageToDob = result.find(
      c => c.fromColumn === "age" && c.toColumn === "dob"
    );
    expect(ageToDob?.typesCompatible).toBe(false);
  });
});

describe("RegexRenameDetector - a column left under a legacy spelling", () => {
  // An earlier field-name conversion emitted a leading underscore for any name beginning with a
  // capital, so a field named `PublishedAt` reached the database as `_published_at` while the
  // runtime schema and the diff address `published_at`. Tables created under that conversion still
  // carry the underscored column; the current conversion produces the canonical name.
  //
  // Recovering such a table needs no dedicated migration. The live column is absent from the
  // desired state and the desired column is absent from the table, which is a drop/add pair on one
  // table — already a rename candidate, suggested as `rename`, the resolution that moves the data
  // rather than dropping the column and recreating it empty.
  //
  // These cases exist so that stays true. The detector pairs any drop with any add on a table, so
  // it covers this shape without having been written for it, and narrowing it would remove the only
  // path by which such a table is recovered with its contents.
  it("offers to rename the legacy column onto its canonical name", () => {
    const candidates = detector.detect(
      [
        drop("single_settings", "_published_at", "timestamp"),
        add("single_settings", "published_at", "timestamp"),
      ] as Operation[],
      "postgresql"
    );

    expect(candidates).toEqual([
      {
        tableName: "single_settings",
        fromColumn: "_published_at",
        toColumn: "published_at",
        fromType: "timestamp",
        toType: "timestamp",
        typesCompatible: true,
        defaultSuggestion: "rename",
      },
    ]);
  });

  it("offers the rename only while the legacy column type still matches", () => {
    // The underscore is not the only thing that can differ. The builder's own type map and the
    // canonical descriptor disagree for some field types, so a table created under the old
    // conversion can carry both a legacy NAME and a legacy TYPE. Where the types are compatible the
    // pair resolves as a rename and the values move; where they are not, the detector suggests
    // dropping and re-adding, and the column comes back empty.
    //
    // The pairs below are not hand-chosen: the legacy type is read from the builder's own map and
    // the desired type from the descriptor, so a fixture cannot quietly assume they agree.
    const legacyType = (fieldType: string, dialect: SupportedDialect): string =>
      new DynamicCollectionSchemaService(undefined, dialect).mapFieldTypeToSQL(
        fieldType
      );

    const desiredType = (
      fieldType: string,
      dialect: SupportedDialect
    ): string | undefined =>
      buildDesiredTableFromFields(
        "dc_posts",
        [{ name: "PublishedItems", type: fieldType }] as Parameters<
          typeof buildDesiredTableFromFields
        >[1],
        dialect,
        { builtBy: "collection", hasStatus: false }
      ).columns.find(c => c.name === "published_items")?.type;

    const outcomes: Record<string, string> = {};
    for (const dialect of ["postgresql", "mysql"] as SupportedDialect[]) {
      for (const fieldType of ["text", "date", "number", "repeater", "group"]) {
        const from = legacyType(fieldType, dialect);
        const to = desiredType(fieldType, dialect);
        if (!to) continue;
        const candidates = detector.detect(
          [
            drop("dc_posts", "_published_items", from),
            add("dc_posts", "published_items", to),
          ] as Operation[],
          dialect
        );
        outcomes[`${dialect}.${fieldType}`] =
          candidates[0]?.defaultSuggestion ?? "(none)";
      }
    }

    // `repeater` and `group` were never in the builder's type map, so their legacy column is `text`
    // where the descriptor asks for JSON. That is a change of family and still keeps every value:
    // a structured value held in a text column is already its own JSON serialization, so the
    // database can reinterpret it where it lies. All five therefore offer the resolution that moves
    // the data, and none offers the one that recreates the column empty.
    expect(outcomes).toEqual({
      "postgresql.text": "rename",
      "postgresql.date": "rename",
      "postgresql.number": "rename",
      "postgresql.repeater": "rename",
      "postgresql.group": "rename",
      "mysql.text": "rename",
      "mysql.date": "rename",
      "mysql.number": "rename",
      "mysql.repeater": "rename",
      "mysql.group": "rename",
    });
  });

  // The rename is only half the recovery: it moves the column, it does not change what the column
  // is. Stated here because the detector's answer above is what makes the pair reach the executor
  // at all, and a reader who stops at "rename" would reasonably assume the type followed.
  it("does not treat an unrelated family change as recoverable", () => {
    const candidates = detector.detect(
      [
        drop("dc_posts", "_count", "text"),
        add("dc_posts", "count", "integer"),
      ] as Operation[],
      "postgresql"
    );

    expect(candidates[0]?.defaultSuggestion).toBe("drop_and_add");
  });
});

describe("RegexRenameDetector - the legacy column reached through the diff", () => {
  // The cases above hand-build the drop/add pair, which pins the detector and nothing before it.
  // The recovery actually depends on the desired state and the diff producing that pair in the
  // first place, so this drives both with the real implementations: only the live snapshot is
  // written by hand, because that is what introspection returns for a table already in the
  // database.
  //
  // What remains uncovered is the apply step — turning the chosen resolution into DDL — which
  // needs a live database and is exercised by the pipeline integration suites.
  const LEGACY_COLUMN = "_published_at";
  const CANONICAL_COLUMN = "published_at";

  function liveSnapshotWithLegacyColumn(
    desired: NextlySchemaSnapshot
  ): NextlySchemaSnapshot {
    // The table as an older release created it: identical in every respect except that the one
    // field's column carries the leading underscore the previous conversion produced.
    return {
      tables: desired.tables.map(table => ({
        ...table,
        columns: table.columns.map(column =>
          column.name === CANONICAL_COLUMN
            ? { ...column, name: LEGACY_COLUMN }
            : column
        ),
      })),
    };
  }

  it("produces a rename candidate from the real desired state and diff", () => {
    const desired: NextlySchemaSnapshot = {
      tables: [
        buildDesiredTableFromFields(
          "dc_posts",
          [{ name: "PublishedAt", type: "date" }] as Parameters<
            typeof buildDesiredTableFromFields
          >[1],
          "postgresql",
          { builtBy: "collection", hasStatus: false }
        ),
      ],
    };

    // The desired state has to carry the canonical column, or the rest of this proves nothing.
    expect(desired.tables[0].columns.map(c => c.name)).toContain(
      CANONICAL_COLUMN
    );

    const operations = diffSnapshots(
      liveSnapshotWithLegacyColumn(desired),
      desired
    );
    const candidates = new RegexRenameDetector().detect(
      operations,
      "postgresql"
    );

    expect(
      candidates.map(c => [c.fromColumn, c.toColumn, c.defaultSuggestion])
    ).toEqual([[LEGACY_COLUMN, CANONICAL_COLUMN, "rename"]]);
  });

  it("proposes exactly one drop and one add for this shape", () => {
    // The detector pairs every drop with every add on a table and marks each type-compatible pair
    // as a rename, so it offers no protection against ambiguity — the suite above covers a table
    // that yields 49 candidates. What keeps THIS recovery unambiguous is the diff: a column that
    // only changed spelling produces one drop and one add and nothing else, so there is a single
    // pair to resolve. That is a property of this shape, asserted here, not a guard in the
    // detector.
    const desired: NextlySchemaSnapshot = {
      tables: [
        buildDesiredTableFromFields(
          "dc_posts",
          [
            { name: "PublishedAt", type: "date" },
            { name: "headline", type: "text" },
          ] as Parameters<typeof buildDesiredTableFromFields>[1],
          "postgresql",
          { builtBy: "collection", hasStatus: false }
        ),
      ],
    };

    const operations = diffSnapshots(
      liveSnapshotWithLegacyColumn(desired),
      desired
    );

    expect({
      drops: operations.filter(op => op.type === "drop_column").length,
      adds: operations.filter(op => op.type === "add_column").length,
      others: operations.filter(
        op => op.type !== "drop_column" && op.type !== "add_column"
      ).length,
    }).toEqual({ drops: 1, adds: 1, others: 0 });
  });
});

describe("the text-to-JSON exception is scoped to the shape it repairs", () => {
  const detector = new RegexRenameDetector();

  it("offers the rename for the legacy underscore column", () => {
    // The positive control, and the only shape the conversion has evidence for: a table built before
    // the column-name fix holds `_body` where everything else addresses `body`, and the old builder
    // is what wrote the JSON into it.
    const candidates = detector.detect(
      [
        drop("dc_posts", "_body", "text"),
        add("dc_posts", "body", "jsonb"),
      ] as Operation[],
      "postgresql"
    );

    expect(candidates[0]?.defaultSuggestion).toBe("rename");
  });

  it("does not offer it for two columns that merely share a table", () => {
    // 🔴 The same two TYPES, and the answer has to differ. Nothing says this column holds serialized
    // JSON — its text is whatever a user typed. Defaulting the operator into a conversion here fails
    // on the first row of ordinary prose, and on MySQL the rename has already auto-committed by
    // then, leaving a half-changed schema no transaction can take back.
    const candidates = detector.detect(
      [
        drop("dc_posts", "summary", "text"),
        add("dc_posts", "metadata", "jsonb"),
      ] as Operation[],
      "postgresql"
    );

    expect(candidates[0]?.defaultSuggestion).toBe("drop_and_add");
  });

  it("does not offer it when only the prefix is missing", () => {
    // `body` -> `body_json` is not `_body` -> `body`. A rule keyed on "one name contains the other"
    // would accept this; the rule is the exact underscore shape.
    const candidates = detector.detect(
      [
        drop("dc_posts", "body", "text"),
        add("dc_posts", "body_json", "jsonb"),
      ] as Operation[],
      "postgresql"
    );

    expect(candidates[0]?.defaultSuggestion).toBe("drop_and_add");
  });
});
