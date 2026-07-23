import { describe, it, expect } from "vitest";

import { planCompanionMigration } from "./plan-companion-migration";
import type { CompanionMigrationSpec } from "./types";

const spec: CompanionMigrationSpec = {
  dialect: "sqlite",
  collection: "pages",
  mainTable: "dc_pages",
  companionTable: "dc_pages_locales",
  defaultLocale: "en",
  parentIdType: "TEXT",
  columns: [{ name: "title", kind: "text" }],
};

describe("planCompanionMigration", () => {
  it("ENABLE when the previous main table held the localized columns", () => {
    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames: ["id", "title", "price"],
      companionExisted: false,
    });
    expect(plan.kind).toBe("enable");
    expect(plan.upSql).toContain("INSERT INTO"); // seeds
    expect(plan.upSql).toContain("DROP COLUMN"); // drops from main
    expect(plan.downSql).toContain("DROP TABLE"); // reverse
  });

  it("ENABLE seeds and drops only the columns the previous main carried", () => {
    // `summary` is added and localized in the same config change: it is in `columns`
    // (the companion CREATE needs it) but was never on the previous main table, so the
    // seed SELECT and the main-table DROP must skip it or the migration fails on apply.
    const plan = planCompanionMigration({
      spec: {
        ...spec,
        columns: [
          { name: "title", kind: "text" },
          { name: "summary", kind: "text" },
        ],
      },
      prevMainColumnNames: ["id", "title", "price"],
      companionExisted: false,
    });
    expect(plan.kind).toBe("enable");
    // The companion still gets both columns.
    expect(plan.upSql).toContain('"summary" TEXT');
    // Seed and drop touch only the pre-existing column.
    expect(plan.upSql).toContain('SELECT "id", \'en\', "title"');
    expect(plan.upSql).toContain('DROP COLUMN "title"');
    expect(plan.upSql).not.toContain('DROP COLUMN "summary"');
    // DOWN re-adds and restores only what UP dropped, but still archives every
    // translation (including `summary`) so no language data is silently lost.
    expect(plan.downSql).toContain('ADD COLUMN "title"');
    expect(plan.downSql).not.toContain('ADD COLUMN "summary"');
    expect(plan.downSql).toContain("'summary'");
  });

  it("CREATE-ONLY for a fresh localized collection (main never had the columns)", () => {
    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames: ["id", "price"],
      companionExisted: false,
    });
    expect(plan.kind).toBe("create-only");
    expect(plan.upSql).toContain("CREATE TABLE");
    expect(plan.upSql).not.toContain("INSERT INTO");
    expect(plan.upSql).not.toContain("DROP COLUMN");
    expect(plan.downSql).toContain("DROP TABLE");
  });

  it("NONE when the companion already existed and no relocation is needed", () => {
    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames: ["id", "price"],
      companionExisted: true,
    });
    expect(plan.kind).toBe("none");
    expect(plan.upSql).toBe("");
    expect(plan.downSql).toBe("");
  });

  // the DISABLE transition (localized true → false).
  describe("DISABLE (localized true → false)", () => {
    it("restores the default locale, archives the rest, then drops the companion", () => {
      const plan = planCompanionMigration({
        spec,
        prevMainColumnNames: [],
        companionExisted: false,
        localized: false,
        previouslyLocalized: true,
      });
      expect(plan.kind).toBe("disable");
      // Guarded, recoverable order: re-add → restore default → archive others → drop.
      expect(plan.upSql).toContain("ADD COLUMN");
      expect(plan.upSql).toContain("UPDATE");
      expect(plan.upSql).toContain("nextly_i18n_archive");
      expect(plan.upSql).toContain("DROP TABLE");
    });

    it("is reversible — its DOWN re-enables (re-creates + re-seeds the companion)", () => {
      const plan = planCompanionMigration({
        spec,
        prevMainColumnNames: [],
        companionExisted: false,
        localized: false,
        previouslyLocalized: true,
      });
      expect(plan.downSql).toContain("CREATE TABLE");
      expect(plan.downSql).toContain("INSERT INTO");
    });

    it("archives only the NON-default locales (the default is restored onto main)", () => {
      const plan = planCompanionMigration({
        spec,
        prevMainColumnNames: [],
        companionExisted: false,
        localized: false,
        previouslyLocalized: true,
      });
      expect(plan.upSql).toContain("<> 'en'");
    });

    it("NONE when the previous snapshot never recorded it as localized (no false-positive)", () => {
      // This is the "someone added fields to a non-localized collection" case — the shape
      // looks identical to a disable, so only the explicit marker may trigger one.
      const plan = planCompanionMigration({
        spec,
        prevMainColumnNames: ["id", "title", "price"],
        companionExisted: false,
        localized: false,
        previouslyLocalized: false,
      });
      expect(plan.kind).toBe("none");
      expect(plan.upSql).toBe("");
    });

    it("NONE on a pre-marker snapshot (marker undefined = unknown, never destructive)", () => {
      const plan = planCompanionMigration({
        spec,
        prevMainColumnNames: ["id", "title"],
        companionExisted: false,
        localized: false,
        // previouslyLocalized omitted — an older snapshot that predates the marker.
      });
      expect(plan.kind).toBe("none");
    });
  });
});
