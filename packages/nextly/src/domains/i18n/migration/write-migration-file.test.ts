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

import {
  LOCALIZATION_INTENT_HEADER,
  parseLocalizationIntent,
} from "./migration-intent";
import {
  writeCompanionMigrationFile,
  writeLocalizationMigrationFile,
} from "./write-migration-file";
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
    expect(upSql).toContain(`CREATE TABLE IF NOT EXISTS "dc_pages_locales"`);
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
    expect(downSql).toContain(`CREATE TABLE IF NOT EXISTS "dc_pages_locales"`);
  });
});

describe("declared intent in the written header", () => {
  const intentSpec: CompanionMigrationSpec = {
    dialect: "postgresql",
    collection: "posts",
    mainTable: "dc_posts",
    companionTable: "dc_posts_locales",
    defaultLocale: "en",
    parentIdType: "TEXT",
    columns: [{ name: "body", kind: "text" }],
    columnsOnMain: ["body"],
  };

  // The two sides are only useful together: a header the writer emits and the parser cannot read
  // would leave the apply path silently falling back to verbatim SQL.
  it("writes an intent the parser can read back", () => {
    const dir = mkdtempSync(join(tmpdir(), "nextly-intent-"));
    const path = writeCompanionMigrationFile(dir, intentSpec, {
      kind: "enable",
      entity: "collection",
      upSql: "SELECT 1;",
      downSql: "SELECT 1;",
      now: new Date("2026-08-02T00:00:00.000Z"),
    });

    const intent = parseLocalizationIntent(readFileSync(path, "utf-8"), path);

    expect(intent?.kind).toBe("enable");
    expect(intent?.entity).toBe("collection");
    expect(intent?.spec.mainTable).toBe("dc_posts");
    expect(intent?.spec.columnsOnMain).toEqual(["body"]);
    rmSync(dir, { recursive: true, force: true });
  });

  // The kind is half the transition record's key, so a single and a collection sharing a slug
  // must not produce files that name the same record.
  it("records the entity kind it was given", () => {
    const dir = mkdtempSync(join(tmpdir(), "nextly-intent-"));
    const path = writeCompanionMigrationFile(dir, intentSpec, {
      kind: "create-only",
      entity: "fieldGroup",
      upSql: "SELECT 1;",
      downSql: "SELECT 1;",
      now: new Date("2026-08-02T00:00:00.000Z"),
    });

    expect(
      parseLocalizationIntent(readFileSync(path, "utf-8"), path)?.entity
    ).toBe("fieldGroup");
    rmSync(dir, { recursive: true, force: true });
  });

  // Header lines live before `-- UP`, which is what keeps the JSON out of the statement splitter.
  it("keeps the intent out of the UP section", () => {
    const dir = mkdtempSync(join(tmpdir(), "nextly-intent-"));
    const path = writeCompanionMigrationFile(dir, intentSpec, {
      kind: "enable",
      entity: "collection",
      upSql: "SELECT 1;",
      downSql: "SELECT 1;",
      now: new Date("2026-08-02T00:00:00.000Z"),
    });

    const content = readFileSync(path, "utf-8");
    const up = content.slice(
      content.indexOf("-- UP"),
      content.indexOf("-- DOWN")
    );
    expect(up).not.toContain(LOCALIZATION_INTENT_HEADER);
    rmSync(dir, { recursive: true, force: true });
  });
});

/*
 * 🔴 The header files the entity under a KIND, and the sweep that decides
 * whether a registry row is still waiting reads one set per kind. A single or a
 * field group written as `-- Collections:` lands in the collections set, its own
 * kind's set stays empty, and the row is promoted to `applied` before the
 * companion table its migration creates exists. A collection, a single and a
 * field group may share a slug, so the kind is the only thing separating them.
 */
describe("the companion header names the entity by its kind", () => {
  const spec = {
    collection: "shared_slug",
    companionTable: "dc_shared_slug_locales",
    parentTable: "dc_shared_slug",
    parentIdType: "TEXT" as const,
    columns: [{ name: "body", kind: "text" as const }],
    columnsOnMain: ["body"],
  };

  function headerFor(entity: "collection" | "single" | "fieldGroup"): string {
    const dir = mkdtempSync(join(tmpdir(), "nextly-companion-kind-"));
    const path = writeCompanionMigrationFile(dir, spec, {
      kind: "create-only",
      entity,
      upSql: "SELECT 1;",
      downSql: "SELECT 1;",
      now: new Date("2026-08-02T00:00:00.000Z"),
    });
    return readFileSync(path, "utf-8");
  }

  it("files a single under Singles, not Collections", () => {
    const content = headerFor("single");
    expect(content).toContain("-- Singles: shared_slug");
    expect(content).not.toContain("-- Collections:");
  });

  it("files a field group under Field groups, not Collections", () => {
    const content = headerFor("fieldGroup");
    expect(content).toContain("-- Field groups: shared_slug");
    expect(content).not.toContain("-- Collections:");
  });

  it("still files a collection under Collections", () => {
    // The control: without it, a writer that emitted no entity header at all
    // would satisfy both exclusions above.
    const content = headerFor("collection");
    expect(content).toContain("-- Collections: shared_slug");
  });
});
