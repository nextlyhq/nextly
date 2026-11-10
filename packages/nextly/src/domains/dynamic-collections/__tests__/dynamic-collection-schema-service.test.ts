// Phase D Option 2 (2026-05-01): unit tests for the structural rename
// detection in DynamicCollectionSchemaService.generateAlterTableMigration.
//
// Pre-Phase-D, this method diffed by name only — renaming a field from
// "salary" to "compensation" emitted DROP COLUMN salary + ADD COLUMN
// compensation, destroying every value in the salary column. These
// tests pin down the new behavior:
//   - Unambiguous rename (1 removed + 1 added, compatible types) →
//     emits ALTER TABLE RENAME COLUMN, no DROP/ADD
//   - Ambiguous case (≥2 removed or ≥2 added) → falls back to DROP/ADD
//     and warns; user must rename one field at a time
//   - Type mismatch → falls back to DROP/ADD; data-loss warning
//   - manyToMany relations → falls back to DROP/ADD (junction-table
//     rename has its own handling we don't auto-do)
//
// Reference: findings/issue-3-rename-fix-plans.md (Option 2 detail).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

describe("DynamicCollectionSchemaService — index naming (snake_case)", () => {
  it("names a relationship FK index by the snake_case column, not camelCase", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const sql = service.generateMigrationSQL("dc_books", [
      { name: "authorProfile", type: "relationship" } as FieldDefinition,
    ]);
    expect(sql).toContain("idx_dc_books_author_profile");
    expect(sql).toContain('("author_profile")');
    expect(sql).not.toContain("authorProfile");
  });

  it("names a user index by the snake_case column", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const sql = service.generateMigrationSQL("dc_books", [
      { name: "pageCount", type: "number", index: true } as FieldDefinition,
    ]);
    expect(sql).toContain("idx_dc_books_page_count");
    expect(sql).not.toContain("pageCount");
  });
});

describe("DynamicCollectionSchemaService: component fields are column-less", () => {
  it("emits no parent column and no index for a component field", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const sql = service.generateMigrationSQL("dc_pages", [
      { name: "hero", type: "component", index: true } as FieldDefinition,
    ]);
    expect(sql).not.toContain('"hero"');
    expect(sql).not.toContain("idx_dc_pages_hero");
  });

  it("keeps the system title column when a component field is named 'title'", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const sql = service.generateMigrationSQL("dc_pages", [
      { name: "title", type: "component" } as FieldDefinition,
    ]);
    expect(sql).toContain('"title" text NOT NULL');
  });
});

describe("DynamicCollectionSchemaService.generateAlterTableMigration — Phase D rename detection", () => {
  let service: DynamicCollectionSchemaService;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new DynamicCollectionSchemaService(undefined, "sqlite");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("emits ALTER TABLE RENAME COLUMN for an unambiguous rename (one removed + one added, same type)", () => {
    // Old: { salary: text }, New: { compensation: text }
    // Single rename, compatible types → safe heuristic fires.
    const oldFields: FieldDefinition[] = [
      { name: "salary", type: "text" },
      { name: "title", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "text" },
      { name: "title", type: "text" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).toContain('RENAME COLUMN "salary" TO "compensation"');
    // No DROP COLUMN salary, no ADD COLUMN compensation — column data
    // is preserved on the same physical column under the new name.
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+"salary"/);
    expect(sql).not.toMatch(/ADD\s+COLUMN\s+"compensation"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("snake_cases camelCase field names in the rename SQL", () => {
    // Old field name "yearlyPay" → SQL column "yearly_pay".
    // toSnakeCase is the same conversion ADD/DROP already use.
    const oldFields: FieldDefinition[] = [
      { name: "yearlyPay", type: "number" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "annualCompensation", type: "number" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).toContain(
      'RENAME COLUMN "yearly_pay" TO "annual_compensation"'
    );
  });

  it("falls back to DROP+ADD when more than one field is removed or added (ambiguity)", () => {
    // Old: [salary, role]; New: [compensation, position].
    // Two renames in one save — heuristic can't disambiguate which old
    // pairs with which new. Bail out, warn, do DROP+ADD.
    const oldFields: FieldDefinition[] = [
      { name: "salary", type: "text" },
      { name: "role", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "text" },
      { name: "position", type: "text" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/DROP\s+COLUMN\s+"salary"/);
    expect(sql).toMatch(/DROP\s+COLUMN\s+"role"/);
    expect(sql).toMatch(/ADD\s+COLUMN\s+"compensation"/);
    expect(sql).toMatch(/ADD\s+COLUMN\s+"position"/);
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = (warnSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(warnMessage).toContain("ambiguous");
  });

  it("falls back to DROP+ADD when the removed and added field types do not match", () => {
    // Old: { salary: text }, New: { compensation: number }.
    // Types differ → would lose data even with rename (varchar vs int).
    // Bail out and warn; let user do an explicit two-step migration.
    const oldFields: FieldDefinition[] = [{ name: "salary", type: "text" }];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "number" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/DROP\s+COLUMN\s+"salary"/);
    expect(sql).toMatch(/ADD\s+COLUMN\s+"compensation"/);
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = (warnSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(warnMessage).toContain("not compatible");
  });

  it("renames a manyToMany relation's junction table, keeping its links, instead of dropping and recreating it", () => {
    // A many-to-many has no column to rename: its links live in a junction
    // table whose generated name embeds the field name. The rename is carried
    // as a table rename, so the links travel with it, and neither loop touches
    // the pair — no fresh empty junction, no orphaned full one.
    const oldFields: FieldDefinition[] = [
      {
        name: "tags",
        type: "relationship",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ];
    const newFields: FieldDefinition[] = [
      {
        name: "categories",
        type: "relationship",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).toContain(
      'ALTER TABLE "dc_posts_dc_tags_tags" RENAME TO "dc_posts_dc_tags_categories";'
    );
    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).not.toContain("CREATE TABLE");
    expect(sql).not.toContain("DROP TABLE");
    // Not a data loss, so nothing to warn about.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("auto-renames non-manyToMany relations when target + relationType match", () => {
    // Old: author (manyToOne -> users), New: editor (manyToOne -> users).
    // Same target collection, same relation kind → safe rename.
    const oldFields: FieldDefinition[] = [
      {
        name: "author",
        type: "relationship",
        options: { relationType: "manyToOne", target: "users" },
      },
    ];
    const newFields: FieldDefinition[] = [
      {
        name: "editor",
        type: "relationship",
        options: { relationType: "manyToOne", target: "users" },
      },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).toContain('RENAME COLUMN "author" TO "editor"');
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+"author"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not auto-rename relations when their target collection differs", () => {
    // author -> users, editor -> staff. Different target collections
    // means the FK semantics change. Bail out — user must do this in
    // two steps (rename, then change target).
    const oldFields: FieldDefinition[] = [
      {
        name: "author",
        type: "relationship",
        options: { relationType: "manyToOne", target: "users" },
      },
    ];
    const newFields: FieldDefinition[] = [
      {
        name: "editor",
        type: "relationship",
        options: { relationType: "manyToOne", target: "staff" },
      },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("pure add (only added fields, no removed) does not trigger rename detection", () => {
    const oldFields: FieldDefinition[] = [{ name: "title", type: "text" }];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text" },
      { name: "summary", type: "text" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/ADD\s+COLUMN\s+"summary"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("pure drop (only removed fields, no added) does not trigger rename detection", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text" },
      { name: "summary", type: "text" },
    ];
    const newFields: FieldDefinition[] = [{ name: "title", type: "text" }];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/DROP\s+COLUMN\s+"summary"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("DynamicCollectionSchemaService.detectFieldRename — direct unit", () => {
  it("returns null when nothing was added or removed", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const fields: FieldDefinition[] = [{ name: "title", type: "text" }];
    expect(service.detectFieldRename(fields, fields)).toBeNull();
  });

  it("returns the from→to pair for a single compatible rename", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const oldFields: FieldDefinition[] = [{ name: "salary", type: "number" }];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "number" },
    ];
    const result = service.detectFieldRename(oldFields, newFields);
    expect(result).not.toBeNull();
    expect(result?.from.name).toBe("salary");
    expect(result?.to.name).toBe("compensation");
  });
});

describe("DynamicCollectionSchemaService.generateMigrationSQL — empty fields", () => {
  it.each(["postgresql", "sqlite", "mysql"] as const)(
    "produces valid SQL with no dangling comma when fields=[] (%s)",
    dialect => {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const sql = service.generateMigrationSQL("dc_ww", []);

      // Must not contain the ,, pattern that triggers a SQL syntax error.
      expect(sql).not.toMatch(/,\s*,/);

      // Must contain id, title, slug, created_at, updated_at — no extras.
      expect(sql).toContain("id");
      expect(sql).toContain("title");
      expect(sql).toContain("slug");
      expect(sql).toContain("created_at");
      expect(sql).toContain("updated_at");
    }
  );
});

describe("DynamicCollectionSchemaService — a relationship holding a list gets no key", () => {
  // The create gives a relationship holding a list (hasMany, or several targets) a JSON column and
  // no foreign key. Adding one to an existing table, and predicting what a create installed, must
  // answer the same: a key from a JSON column to one row is refused by the database, and a
  // predicted key a later edit drops was never there.
  const single = {
    name: "author",
    type: "relationship",
    options: { target: "authors", relationType: "manyToOne" },
  } as FieldDefinition;
  const many = {
    name: "writers",
    type: "relationship",
    hasMany: true,
    options: { target: "authors", relationType: "manyToOne" },
  } as FieldDefinition;
  const several = {
    name: "subject",
    type: "relationship",
    relationTo: ["authors", "tags"],
    options: { target: "authors", relationType: "manyToOne" },
  } as FieldDefinition;
  const title = { name: "title", type: "text" } as FieldDefinition;

  for (const dialect of ["postgresql", "mysql"] as const) {
    it(`adds the column without a key on ${dialect}, and keys a single relationship`, () => {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const sql = service.generateAlterTableMigration(
        "dc_posts",
        [title],
        [title, single, many, several]
      );
      expect(sql).toMatch(/FOREIGN KEY \([`"]author[`"]\)/);
      expect(sql).not.toMatch(/FOREIGN KEY \([`"]writers[`"]\)/);
      expect(sql).not.toMatch(/FOREIGN KEY \([`"]subject[`"]\)/);
    });

    it(`predicts a key only for the single relationship on ${dialect}`, () => {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const { foreignKeysByColumn } = service.plannedAttachments("dc_posts", [
        title,
        single,
        many,
        several,
      ]);
      expect([...foreignKeysByColumn.keys()]).toEqual(["author"]);
    });
  }
});

describe("DynamicCollectionSchemaService — a required relation added over rows", () => {
  // The rows already there are given the empty a relation holding a list accepts, an empty list.
  // Nothing else is such an empty: a relation to several collections holds one `{ relationTo, value
  // }` reference, and a list that must hold some entries (`minRows`) holds none in `[]`. Those
  // keep the refusal every required relation without a backfill gets.
  const title = { name: "title", type: "text" } as FieldDefinition;
  const add = (field: Record<string, unknown>) =>
    new DynamicCollectionSchemaService(
      undefined,
      "postgresql"
    ).generateAlterTableMigration(
      "dc_posts",
      [title],
      [
        title,
        {
          name: "writers",
          type: "relationship",
          required: true,
          ...field,
        } as FieldDefinition,
      ]
    );

  it("fills a list each row can hold empty with an empty list", () => {
    expect(add({ relationTo: "authors", hasMany: true })).toMatch(
      /ADD COLUMN "writers" jsonb NOT NULL DEFAULT '\[\]'/
    );
  });

  it("refuses a relation to several collections, whose value is one reference", () => {
    expect(() => add({ relationTo: ["authors", "tags"] })).toThrow();
  });

  it("refuses a list that must hold entries", () => {
    expect(() =>
      add({ relationTo: "authors", hasMany: true, minRows: 1 })
    ).toThrow();
  });

  // The value an apply binds follows the same decision as the literal above: a column the
  // preflight accepts is one the apply can fill, and one it refuses gets no fill.
  it.each([
    ["sqlite", { relationTo: "authors", hasMany: true }, "[]"],
    ["postgresql", { relationTo: "authors", hasMany: true }, "[]"],
    ["mysql", { relationTo: "authors", hasMany: true }, "[]"],
    ["postgresql", { relationTo: ["authors", "tags"] }, undefined],
    [
      "postgresql",
      { relationTo: "authors", hasMany: true, minRows: 1 },
      undefined,
    ],
  ] as const)(
    "binds the fill the literal states on %s for %j",
    (dialect, field, fill) => {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const writers = {
        name: "writers",
        type: "relationship",
        required: true,
        ...field,
      } as FieldDefinition;
      expect(service.addedColumnFillValue(writers, new Date(0))).toBe(fill);
      expect(service.addedColumnBackfill(writers) !== null).toBe(
        fill !== undefined
      );
    }
  );
});
