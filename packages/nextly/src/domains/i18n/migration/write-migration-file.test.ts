import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, it, expect } from "vitest";

import { parseSqlSections } from "../../../cli/commands/migrate";

import { writeLocalizationMigrationFile } from "./write-migration-file";
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

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("writeLocalizationMigrationFile", () => {
  it("writes a timestamped .sql with UP/DOWN and NO snapshot", () => {
    dir = mkdtempSync(join(tmpdir(), "i18n-mig-"));
    const path = writeLocalizationMigrationFile(dir, spec, {
      direction: "enable",
      now: new Date("2026-07-08T10:20:30.400Z"),
    });

    // named YYYYMMDD_HHMMSS_mmm_<slug>.sql
    expect(path).toMatch(/20260708_102030_400_enable_localization_pages\.sql$/);
    // no meta snapshot written
    expect(existsSync(join(dir, "meta"))).toBe(false);
    expect(readdirSync(dir)).toHaveLength(1);

    // parses into non-empty UP and DOWN
    const { upSql, downSql } = parseSqlSections(readFileSync(path, "utf-8"));
    expect(upSql).toContain(`CREATE TABLE "dc_pages_locales"`);
    expect(downSql).toContain(`DROP TABLE "dc_pages_locales"`);
  });

  it("for direction=disable, UP is the disable direction and DOWN re-enables", () => {
    dir = mkdtempSync(join(tmpdir(), "i18n-mig-"));
    const path = writeLocalizationMigrationFile(dir, spec, {
      direction: "disable",
      now: new Date("2026-07-08T10:20:30.400Z"),
    });
    expect(path).toMatch(/_disable_localization_pages\.sql$/);
    const { upSql, downSql } = parseSqlSections(readFileSync(path, "utf-8"));
    expect(upSql).toContain(`DROP TABLE "dc_pages_locales"`);
    expect(downSql).toContain(`CREATE TABLE "dc_pages_locales"`);
  });
});
