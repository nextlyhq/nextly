import { describe, expect, it } from "vitest";

import type { AddColumnOp, DropColumnOp, Operation } from "../diff/types";
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

describe("RegexRenameDetector - the pre-#507 leading-underscore column", () => {
  // Before #507 the Schema Builder's DDL generator named user columns with a copy of the
  // field-name conversion that had lost its final step, so a field named `PublishedAt` was created
  // as `_published_at` while the runtime schema and the diff both address `published_at`. Such a
  // table was never readable, and #507 corrects only newly created ones.
  //
  // Repairing the existing ones needs no new machinery: the drop/add pair this produces is already
  // a rename candidate, and the suggestion is `rename`, which moves the data rather than discarding
  // it. This test exists so that stays true — narrowing the detector would silently remove the only
  // path by which an affected table can be recovered with its contents.
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

  it("offers the rename for every shape the drifted mapper could produce", () => {
    // The old mapper prefixed an underscore whenever the name began with a capital, so the legacy
    // spelling is always the canonical one with `_` in front — whatever the column's type.
    const legacy = (canonical: string) => `_${canonical}`;
    const cases: Array<[string, string]> = [
      ["published_at", "timestamp"],
      ["body_text", "text"],
      ["title", "varchar(255)"],
    ];

    for (const [canonical, type] of cases) {
      const candidates = detector.detect(
        [
          drop("dc_posts", legacy(canonical), type),
          add("dc_posts", canonical, type),
        ] as Operation[],
        "postgresql"
      );

      expect({
        [canonical]: candidates.map(c => [
          c.fromColumn,
          c.toColumn,
          c.defaultSuggestion,
        ]),
      }).toEqual({
        [canonical]: [[legacy(canonical), canonical, "rename"]],
      });
    }
  });
});
