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
});
