/**
 * The key an escape is listed under: its file and function, without the line,
 * so an accepted entry survives ordinary edits to the file it names.
 */
import { describe, expect, it } from "vitest";

import {
  siteKeyOf,
  statementFingerprint,
  UNKNOWN_SITE,
} from "./transaction-escapes";

describe("siteKeyOf", () => {
  it("keys a named frame by its file from packages/ on and its function", () => {
    expect(
      siteKeyOf(
        "NoticesService.tablePresent (/home/runner/work/nextly/nextly/packages/nextly/src/domains/notices/notices-service.ts:212:7)"
      )
    ).toBe(
      "packages/nextly/src/domains/notices/notices-service.ts#NoticesService.tablePresent"
    );
  });

  it("drops the line and column, so the same function at another line keys the same", () => {
    const at = (line: number) =>
      siteKeyOf(
        `reportPrincipalDeleted (/repo/packages/nextly/src/domains/audit/erase-principal.ts:${String(line)}:3)`
      );
    expect(at(40)).toBe(at(97));
  });

  it("keys a frame with no function name as anonymous, from a file URL too", () => {
    expect(
      siteKeyOf("file:///repo/packages/nextly/src/init/boot.ts:10:5")
    ).toBe("packages/nextly/src/init/boot.ts#<anonymous>");
  });

  it("keys a report that named no call site as unknown", () => {
    expect(siteKeyOf(undefined)).toBe(UNKNOWN_SITE);
  });
});

describe("statementFingerprint", () => {
  it.each([
    [
      'select "id", "slug" from "nextly_dynamic_collections" where "slug" = $1',
      "select nextly_dynamic_collections",
    ],
    [
      "SELECT `id` FROM `nextly`.`dc_posts` WHERE `id` = ? LIMIT 1",
      "select dc_posts",
    ],
    [
      'insert into "nextly_schema_events" ("id") values ($1)',
      "insert nextly_schema_events",
    ],
    ['update "dc_posts" set "title" = $1', "update dc_posts"],
    ['delete from "dc_posts" where "id" = $1', "delete dc_posts"],
    [
      'CREATE TABLE IF NOT EXISTS "nextly_i18n_archive" ("id" text)',
      "create nextly_i18n_archive",
    ],
    ['ALTER TABLE "dc_posts" ADD COLUMN "x" text', "alter dc_posts"],
    ["SELECT 1", "select"],
  ])("fingerprints %s as %s", (sql, expected) => {
    expect(statementFingerprint(sql)).toBe(expected);
  });

  it("drops literals and parameters, so the same query with other values keeps its fingerprint", () => {
    expect(
      statementFingerprint('select * from "dc_posts" where "id" = \'a\'')
    ).toBe(statementFingerprint('select * from "dc_posts" where "id" = \'b\''));
  });

  it("names a checkout that carried no statement", () => {
    expect(statementFingerprint(undefined)).toBe("checkout");
  });
});
