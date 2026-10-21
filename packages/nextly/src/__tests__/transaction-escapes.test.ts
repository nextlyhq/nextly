/**
 * The key an escape is listed under: its file and function, without the line,
 * so an accepted entry survives ordinary edits to the file it names.
 */
import { describe, expect, it } from "vitest";

import {
  ANY_OPENER,
  escapeKeyOf,
  knownEscape,
  type KnownEscape,
  OPENED_BY,
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
      "select dc_*",
    ],
    [
      'insert into "nextly_schema_events" ("id") values ($1)',
      "insert nextly_schema_events",
    ],
    ['update "dc_posts" set "title" = $1', "update dc_*"],
    ['delete from "dc_posts" where "id" = $1', "delete dc_*"],
    [
      'CREATE TABLE IF NOT EXISTS "nextly_i18n_archive" ("id" text)',
      "create nextly_i18n_archive",
    ],
    ['ALTER TABLE "dc_posts" ADD COLUMN "x" text', "alter dc_*"],
    ["SELECT 1", "select"],
    // The adapters' `tableExists` probes, as PostgreSQL and MySQL spell them.
    [
      "SELECT EXISTS ( SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 ) as exists",
      "select tables",
    ],
    [
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      "select tables",
    ],
  ])("fingerprints %s as %s", (sql, expected) => {
    expect(statementFingerprint(sql)).toBe(expected);
  });

  it.each([
    ['select * from "dc_posts_locales"', "select dc_*_locales"],
    ["SELECT `id` FROM `single_hero`", "select single_*"],
    ['delete from "comp_banner_locales"', "delete comp_*_locales"],
    ['select * from "dynamic_collections"', "select dynamic_collections"],
  ])(
    "names an entity's own table by its kind, and a system table by its name: %s",
    (sql, expected) => {
      expect(statementFingerprint(sql)).toBe(expected);
    }
  );

  it("drops literals and parameters, so the same query with other values keeps its fingerprint", () => {
    expect(
      statementFingerprint('select * from "dc_posts" where "id" = \'a\'')
    ).toBe(statementFingerprint('select * from "dc_posts" where "id" = \'b\''));
  });

  it("names a checkout that carried no statement", () => {
    expect(statementFingerprint(undefined)).toBe("checkout");
  });
});

describe("escapeKeyOf", () => {
  const site =
    "CollectionMutationService.createEntry (/repo/packages/nextly/src/domains/collections/services/collection-mutation-service.ts:120:9)";

  it("keys an escape at its own call site with the statement's verb and table", () => {
    expect(
      escapeKeyOf({
        site,
        opener: undefined,
        statement: 'select * from "nextly_webhooks"',
      })
    ).toBe(
      "packages/nextly/src/domains/collections/services/collection-mutation-service.ts#CollectionMutationService.createEntry · select nextly_webhooks"
    );
  });

  it("keys an escape with no call site by where its transaction was opened, with the statement", () => {
    expect(
      escapeKeyOf({
        site: undefined,
        opener: site,
        statement: 'select * from "dynamic_singles"',
      })
    ).toBe(
      `packages/nextly/src/domains/collections/services/collection-mutation-service.ts#CollectionMutationService.createEntry${OPENED_BY} · select dynamic_singles`
    );
  });

  it("keys a report with neither as unknown", () => {
    expect(
      escapeKeyOf({ site: undefined, opener: undefined, statement: "select 1" })
    ).toBe(UNKNOWN_SITE);
  });
});

describe("knownEscape", () => {
  const site =
    "CollectionMutationService.createEntry (/repo/packages/nextly/src/domains/collections/services/collection-mutation-service.ts:120:9)";
  const listed: KnownEscape = {
    dialect: "postgresql",
    key: escapeKeyOf({
      site,
      opener: undefined,
      statement: 'select * from "nextly_webhooks"',
    }),
    witness: "packages/nextly/src/w.integration.test.ts",
    reason: "known: test",
  };

  it("accepts the listed statement at a listed site", () => {
    const key = escapeKeyOf({
      site,
      opener: undefined,
      statement: 'select "id" from "nextly_webhooks" where "x" = $1',
    });
    expect(knownEscape("postgresql", key, [listed])).toBe(listed);
  });

  it("does not accept a new statement at the same listed site, so it fails the run", () => {
    const key = escapeKeyOf({
      site,
      opener: undefined,
      statement: 'insert into "nextly_meta" ("id") values ($1)',
    });
    expect(knownEscape("postgresql", key, [listed])).toBeUndefined();
  });

  it("does not accept the listed statement on another dialect", () => {
    expect(knownEscape("mysql", listed.key, [listed])).toBeUndefined();
  });
});

describe("a known escape listed for any opener", () => {
  const anyOpener: KnownEscape = {
    dialect: "mysql",
    key: `${ANY_OPENER}${OPENED_BY} · select dynamic_collections`,
    witness: null,
    reason: "known, timing-dependent: test",
  };
  const opener = (fn: string) =>
    `${fn} (/repo/packages/nextly/src/domains/collections/services/collection-mutation-service.ts:80:5)`;

  it("matches the statement whichever write opened the transaction", () => {
    for (const fn of [
      "CollectionMutationService.createEntry",
      "CollectionMutationService.deleteEntry",
    ]) {
      const key = escapeKeyOf({
        site: undefined,
        opener: opener(fn),
        statement: 'select * from "dynamic_collections"',
      });
      expect(knownEscape("mysql", key, [anyOpener])).toBe(anyOpener);
    }
  });

  it("does not match a write to the table, another table, another dialect, or an escape at its own call site", () => {
    const otherTable = escapeKeyOf({
      site: undefined,
      opener: opener("CollectionMutationService.createEntry"),
      statement: 'select * from "nextly_meta"',
    });
    const ownSite = escapeKeyOf({
      site: opener("CollectionMutationService.createEntry"),
      opener: undefined,
      statement: 'select * from "dynamic_collections"',
    });
    const write = escapeKeyOf({
      site: undefined,
      opener: opener("CollectionMutationService.createEntry"),
      statement: 'insert into "dynamic_collections" ("id") values ($1)',
    });
    expect(knownEscape("mysql", otherTable, [anyOpener])).toBeUndefined();
    expect(knownEscape("mysql", write, [anyOpener])).toBeUndefined();
    expect(knownEscape("mysql", ownSite, [anyOpener])).toBeUndefined();
    expect(
      knownEscape(
        "postgresql",
        escapeKeyOf({
          site: undefined,
          opener: opener("CollectionMutationService.createEntry"),
          statement: 'select * from "dynamic_collections"',
        }),
        [anyOpener]
      )
    ).toBeUndefined();
  });
});
