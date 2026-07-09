import { describe, it, expect } from "vitest";

import { buildLocalizationUpSql } from "./generate-up";
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

/**
 * Locks the design §5.4 safety claim: enabling localization rides the verbatim file
 * path (which never invokes the diff classifier / RealPreCleanupExecutor — the only
 * place `delete_nonconforming` DELETE lives), and its SQL never tightens an existing
 * column to NOT NULL nor deletes content rows.
 */
describe("localization enable is non-destructive", () => {
  it("emits no NOT NULL tightening and no unfiltered DELETE (the delete_nonconforming shapes)", () => {
    const up = buildLocalizationUpSql(spec).toUpperCase();
    expect(up).not.toContain("SET NOT NULL");
    expect(up).not.toMatch(/ALTER COLUMN .* NOT NULL/);
    expect(up).not.toContain("DELETE FROM");
  });

  it("creates new companion columns nullable (localized columns are always nullable)", () => {
    const up = buildLocalizationUpSql(spec);
    expect(up).not.toMatch(/"title" TEXT NOT NULL/);
  });
});
