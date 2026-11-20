/**
 * Whether a part is live (`readPartIsLive`) answers as `languageIsLive` decides, on every
 * configured dialect, for every combination it reads: the main row's status, a due release
 * withdrawing or publishing the document, and for a language, its own status (a translation row
 * published, a draft, or none at all), asked of the shared part, the default language and another
 * language. A due release decides first, as it does for the public read.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { languageIsLive } from "../../i18n/runtime/language-lifecycle";
import type { ReleaseVisibility } from "../../releases/release-visibility";
import { entityOf } from "../../workflows/implicit-stage";
import { readPartIsLive } from "../part-liveness";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** Runs a write the fixture makes, on any dialect: SQLite's driver runs it, the others execute it. */
async function exec(app: TestNextly, statement: SQL): Promise<void> {
  if (app.adapter.getCapabilities().dialect === "sqlite") {
    await app.adapter.getDrizzle<{ run(query: SQL): unknown }>().run(statement);
    return;
  }
  await app.adapter.queryStatement(statement);
}

type MainStatus = "published" | "draft";
type Release = "none" | "hide" | "reveal";
/** A language's own status: its translation row's, or `none` for no row. */
type Own = "published" | "draft" | "none";

const MAIN: readonly MainStatus[] = ["published", "draft"];
const RELEASES: readonly Release[] = ["none", "hide", "reveal"];
const OWN: readonly Own[] = ["published", "draft", "none"];
const PARTS: readonly (string | null)[] = [null, "en", "es"];

/** One document of the matrix: its main row's status, a due release, its languages' own status. */
interface Case {
  id: string;
  main: MainStatus;
  release: Release;
  own: Own;
}

/** A note with a translation row in each language, its statuses then set as `each` says. */
async function seedCase(
  app: TestNextly,
  tables: { main: SQL; languages: SQL },
  each: Omit<Case, "id">
): Promise<Case> {
  const created = await app.nextly.create({
    collection: "notes",
    data: { title: "Hello" },
    overrideAccess: true,
  });
  const id = String((created.item as { id: string }).id);
  // A translation row in each language, so its status can be set or the row removed.
  for (const locale of ["en", "es"]) {
    await app.nextly.update({
      collection: "notes",
      id,
      locale,
      // An update names its version or says it overwrites; this one read none.
      data: { title: `Hello ${locale}`, _overwrite: true },
      overrideAccess: true,
    } as never);
  }
  await exec(
    app,
    sql`UPDATE ${tables.main} SET ${sql.identifier("status")} = ${each.main} WHERE ${sql.identifier("id")} = ${id}`
  );
  await exec(
    app,
    each.own === "none"
      ? sql`DELETE FROM ${tables.languages} WHERE ${sql.identifier("_parent")} = ${id}`
      : sql`UPDATE ${tables.languages} SET ${sql.identifier("_status")} = ${each.own} WHERE ${sql.identifier("_parent")} = ${id}`
  );
  return { id, ...each };
}

/** What `languageIsLive` decides for `part` of `each`, a due withdrawal deciding first. */
function decided(each: Case, part: string | null): boolean {
  return (
    each.release !== "hide" &&
    languageIsLive({
      mainStatus: each.main,
      ownStatus: each.own === "none" ? null : each.own,
      locale: part,
      defaultLocale: "en",
      perLanguageStatus: true,
      mainRevealed: each.release === "reveal",
    })
  );
}

/** Every combination the matrix asks about. */
function combinations(): Omit<Case, "id">[] {
  return MAIN.flatMap(main =>
    RELEASES.flatMap(release => OWN.map(own => ({ main, release, own })))
  );
}

describe.each(getConfiguredTestDialects())(
  "whether a part is live (integration, %s)",
  dialect => {
    it("answers as languageIsLive decides, a due release deciding first", async () => {
      t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "notes",
            localized: true,
            status: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      });
      const app = t;
      const entity = await entityOf({
        scopeKind: "collection",
        scopeSlug: "notes",
      });
      if (!entity) throw new Error("no notes in the registry");
      const tables = {
        main: sql`${sql.identifier(entity.tableName)}`,
        languages: sql`${sql.identifier(`${entity.tableName}_locales`)}`,
      };
      const cases: Case[] = [];
      for (const each of combinations()) {
        cases.push(await seedCase(app, tables, each));
      }
      // Due releases deciding 70,000 other documents too, more than any dialect binds in one
      // statement (SQLite 32,766, PostgreSQL and MySQL 65,535): a read of one part binds none of
      // them, so no release takes it past the limit.
      const others = Array.from({ length: 70_000 }, () => randomUUID());
      const visibility: ReleaseVisibility = {
        decisions: () =>
          Promise.resolve({
            hide: [
              ...cases.filter(c => c.release === "hide").map(c => c.id),
              ...others.slice(0, 35_000),
            ],
            reveal: [
              ...cases.filter(c => c.release === "reveal").map(c => c.id),
              ...others.slice(35_000),
            ],
          }),
      };

      const answered: string[] = [];
      const expected: string[] = [];
      for (const each of cases) {
        for (const part of PARTS) {
          const label = `${each.main}/${each.release}/${each.own}/${part ?? "*"}`;
          const live = await readPartIsLive({
            adapter: app.adapter,
            scopeKind: "collection",
            entity,
            entryId: each.id,
            part,
            defaultLocale: "en",
            visibility,
          });
          answered.push(`${label}=${live}`);
          expected.push(`${label}=${decided(each, part)}`);
        }
      }
      expect(answered).toEqual(expected);
      // The matrix reaches both answers in every part, so it cannot pass by answering one.
      for (const part of PARTS) {
        const label = `/${part ?? "*"}=`;
        expect(answered.some(a => a.includes(`${label}true`))).toBe(true);
        expect(answered.some(a => a.includes(`${label}false`))).toBe(true);
      }
    });
  }
);
