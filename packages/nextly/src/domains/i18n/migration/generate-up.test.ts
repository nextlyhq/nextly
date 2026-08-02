import { describe, it, expect } from "vitest";

import {
  buildCompanionCreateOnlySql,
  buildLocalizationUpSql,
  buildLocalizationUpStatements,
} from "./generate-up";
import type { CompanionMigrationSpec } from "./types";

const spec = (
  dialect: CompanionMigrationSpec["dialect"]
): CompanionMigrationSpec => ({
  dialect,
  collection: "pages",
  mainTable: "dc_pages",
  companionTable: "dc_pages_locales",
  defaultLocale: "en",
  parentIdType: "TEXT",
  columns: [
    { name: "title", kind: "text" },
    { name: "body", kind: "longText" },
  ],
});

describe("buildLocalizationUpSql", () => {
  it("creates the companion table with composite PK and FK", () => {
    const sql = buildLocalizationUpSql(spec("sqlite"));
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "dc_pages_locales"`);
    expect(sql).toContain(`PRIMARY KEY ("_parent", "_locale")`);
    expect(sql).toContain(`REFERENCES "dc_pages" ("id") ON DELETE CASCADE`);
  });

  it("seeds existing rows into the default locale via INSERT...SELECT", () => {
    const sql = buildLocalizationUpSql(spec("sqlite"));
    expect(sql).toContain(
      `INSERT INTO "dc_pages_locales" ("_parent", "_locale", "title", "body") ` +
        `SELECT "id", 'en', "title", "body" FROM "dc_pages"`
    );
  });

  it("drops the relocated columns from the main table", () => {
    const sql = buildLocalizationUpSql(spec("sqlite"));
    expect(sql).toContain(`ALTER TABLE "dc_pages" DROP COLUMN "title"`);
    expect(sql).toContain(`ALTER TABLE "dc_pages" DROP COLUMN "body"`);
  });

  it("uses backticks and JSON/type mapping on mysql", () => {
    const sql = buildLocalizationUpSql({
      ...spec("mysql"),
      columns: [{ name: "meta", kind: "json" }],
    });
    expect(sql).toContain("`dc_pages_locales`");
    expect(sql).toContain("`meta` JSON");
  });
});

describe("buildCompanionCreateOnlySql", () => {
  it("emits only the CREATE (no seed, no drop) for a fresh collection", () => {
    const sql = buildCompanionCreateOnlySql(spec("sqlite"), {
      emittedToFile: true,
    });
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "dc_pages_locales"`);
    expect(sql).toContain(`PRIMARY KEY ("_parent", "_locale")`);
    expect(sql).toContain(`REFERENCES "dc_pages" ("id") ON DELETE CASCADE`);
    expect(sql).not.toContain("INSERT INTO");
    expect(sql).not.toContain("DROP COLUMN");
    expect(sql.trimEnd().endsWith(");")).toBe(true);
  });
});

describe("per-locale _status column (i18n M6)", () => {
  it("omits _status when the collection has no Draft/Published", () => {
    expect(buildCompanionCreateOnlySql(spec("sqlite"))).not.toContain(
      "_status"
    );
  });

  it("emits a per-locale _status column when status is enabled", () => {
    const sql = buildCompanionCreateOnlySql({
      ...spec("sqlite"),
      status: true,
    });
    expect(sql).toContain(`"_status" VARCHAR(20) NOT NULL DEFAULT 'draft'`);
  });

  it("carries the main row's status into the seed on an enable transition", () => {
    const sql = buildLocalizationUpSql({ ...spec("sqlite"), status: true });
    // both the target _status and the source status column appear in INSERT...SELECT
    expect(sql).toContain(`"_parent", "_locale", "_status", "title", "body"`);
    expect(sql).toContain(`SELECT "id", 'en', "status", "title", "body"`);
  });
});

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "buildLocalizationUpStatements without the drop on %s",
  dialect => {
    it("still copies the existing values into the companion", () => {
      // Unattended provisioning is additive-only, but the copy is the entire point: without it
      // the companion is empty and every localized field reads null over content still on disk.
      const statements = buildLocalizationUpStatements(spec(dialect), {
        dropSeededColumns: false,
      });

      expect(statements.some(s => s.startsWith("INSERT INTO"))).toBe(true);
    });

    it("leaves the main table's columns in place", () => {
      // A dropped column is not something the next boot can put back, so unattended paths must
      // not drop. The redundant copies on main are inert once reads resolve through the companion.
      const statements = buildLocalizationUpStatements(spec(dialect), {
        dropSeededColumns: false,
      });

      expect(statements.some(s => s.includes("DROP COLUMN"))).toBe(false);
    });

    it("drops by default, so the Builder toggle and migration files are unchanged", () => {
      // Both existing callers relocate the data deliberately; leaving the originals would give a
      // field two homes and let the stale one be read after an edit.
      const statements = buildLocalizationUpStatements(spec(dialect));

      expect(statements.filter(s => s.includes("DROP COLUMN")).length).toBe(2);
    });
  }
);

describe("retained columns that were required", () => {
  // A field that was required before localization leaves a NOT NULL column on main. Once the
  // companion exists the value is written there instead, so the main insert omits it — and the
  // constraint then fails every create. Retaining is a safety measure; a retained column that
  // breaks writes is not the safe option.
  const options = { dropSeededColumns: false, relaxColumns: ["title"] };

  it("relaxes the constraint on postgres", () => {
    const statements = buildLocalizationUpStatements(
      spec("postgresql"),
      options
    );

    expect(statements).toContain(
      `ALTER TABLE "dc_pages" ALTER COLUMN "title" DROP NOT NULL`
    );
  });

  it("restates the column to relax it on mysql, which has no direct form", () => {
    const statements = buildLocalizationUpStatements(spec("mysql"), options);

    expect(
      statements.some(
        s => s.includes("MODIFY COLUMN `title`") && s.endsWith("NULL")
      )
    ).toBe(true);
  });

  it("drops it on sqlite, which cannot change nullability at all", () => {
    // The schema pipeline refuses `change_column_nullable` for SQLite and the only alternative is
    // rebuilding the table. The value has just been copied into the companion, so dropping loses
    // nothing — whereas retaining it fails every create from here on.
    const statements = buildLocalizationUpStatements(spec("sqlite"), options);

    expect(statements).toContain(`ALTER TABLE "dc_pages" DROP COLUMN "title"`);
  });

  it("leaves an already-nullable retained column alone", () => {
    const statements = buildLocalizationUpStatements(spec("postgresql"), {
      dropSeededColumns: false,
    });

    expect(statements.some(s => s.includes("DROP NOT NULL"))).toBe(false);
    expect(statements.some(s => s.includes("DROP COLUMN"))).toBe(false);
  });
});

describe("guarding the create, and only where it is safe", () => {
  // 🔴 A migration FILE reaches a database that has usually provisioned the companion already, and
  // is applied verbatim with no enclosing transaction — so an unguarded create kills the run after
  // committing the files before it.
  it.each(["sqlite", "postgresql", "mysql"] as const)(
    "guards the create in an emitted file on %s",
    dialect => {
      for (const sql of [
        buildLocalizationUpSql(spec(dialect)),
        buildCompanionCreateOnlySql(spec(dialect), { emittedToFile: true }),
      ]) {
        expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
        // Asserted as an absence too: a bare CREATE anywhere in the file is the failure, and a
        // substring check for the guarded form alone would pass with both present.
        expect(/CREATE TABLE(?! IF NOT EXISTS)/.test(sql)).toBe(false);
      }
    }
  );

  // 🔴 The RUNTIME must keep the bare form. `ensureCompanionTable` detects a lost create race by
  // the statement failing, and uses that to tell a process that lost before claiming the transition
  // from one that lost after — which must abandon its apply rather than settle over a companion it
  // may not have seeded. `IF NOT EXISTS` would silence that signal for both.
  it.each(["sqlite", "postgresql", "mysql"] as const)(
    "leaves the runtime create unguarded on %s",
    dialect => {
      const statements = buildLocalizationUpStatements(spec(dialect));
      const create = statements.find(s => s.startsWith("CREATE TABLE"));
      expect(create).toBeDefined();
      expect(create).not.toContain("IF NOT EXISTS");
      // The create-only helper defaults to the runtime form for the same reason.
      expect(buildCompanionCreateOnlySql(spec(dialect))).not.toContain(
        "IF NOT EXISTS"
      );
    }
  );
});

describe("guarding the seed, and only where a transition record exists", () => {
  // 🔴 An emitted file must NOT guard its seed. Two states leave default-locale rows behind and
  // need opposite handling: an interrupted copy (keep them) and a companion that outlived a disable
  // (they are stale, and main is authoritative). Only the transition record tells them apart, and a
  // static file has none — so a guard there would silently revert edits made while localization was
  // off. Unguarded it collides on the primary key instead: loud, and nothing lost.
  it.each(["sqlite", "postgresql", "mysql"] as const)(
    "leaves an emitted file's seed unguarded on %s",
    dialect => {
      expect(buildLocalizationUpSql(spec(dialect))).not.toContain(
        "WHERE NOT EXISTS"
      );
    }
  );

  // The runtime resume asks for it, having read that record.
  it.each(["sqlite", "postgresql", "mysql"] as const)(
    "guards the seed row by row when the caller asks on %s",
    dialect => {
      const sql = buildLocalizationUpStatements(spec(dialect), {
        guardSeed: true,
      }).join("\n");
      const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);
      expect(sql).toContain(
        `WHERE NOT EXISTS (SELECT 1 FROM ${q("dc_pages_locales")} ` +
          `WHERE ${q("dc_pages_locales")}.${q("_parent")} = ${q("dc_pages")}.${q("id")} ` +
          `AND ${q("dc_pages_locales")}.${q("_locale")} = 'en')`
      );
    }
  );

  // The control. Guarding must not cost the statements their actual work.
  it("still seeds and still drops", () => {
    const sql = buildLocalizationUpSql(spec("sqlite"));
    expect(sql).toContain(
      `INSERT INTO "dc_pages_locales" ("_parent", "_locale", "title", "body") ` +
        `SELECT "id", 'en', "title", "body" FROM "dc_pages"`
    );
    expect(sql).toContain(`ALTER TABLE "dc_pages" DROP COLUMN "title"`);
  });
});
