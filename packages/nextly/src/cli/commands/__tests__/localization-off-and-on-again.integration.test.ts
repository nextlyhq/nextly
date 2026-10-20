// Turning localization off and on again, on every configured dialect, through
// the provisioning pass `db:sync` runs.
//
// The transition record is what keeps a restore from running twice: a disable
// copies the companion's values back onto the main table once, records
// `restored`, and every later pass leaves main alone. On MySQL that record
// never landed, so every later pass copied the companion's stale values over
// edits made to the main table since. And a first enable whose record was left
// at `enabling` must settle on the next pass, not report itself held by
// another process forever.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import {
  beginI18nTransition,
  forgetI18nTransition,
  readI18nTransitionState,
} from "../../../domains/i18n/migration/transition-state";
import { MetaService } from "../../../domains/meta/services/meta-service";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import {
  ensureLocalizedCompanions,
  syncCollections,
  syncComponents,
  syncSingles,
} from "../dev-build";
import { openSyncTarget, type SyncTarget } from "./helpers/sync-target";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { LoadConfigResult } from "../../utils/config-loader";

let dir: string;
let target: SyncTarget | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-locale-off-again-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(async () => {
  await target?.close();
  target = undefined;
  // Integration files share one fork, so the environment a test set is put back.
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  rmSync(dir, { recursive: true, force: true });
});

/** The command's own sequence, minus the parts that read from disk. */
async function runSync(
  dialect: TestDialect,
  config: LoadConfigResult["config"]
): Promise<void> {
  process.env.DB_DIALECT = dialect;
  target ??= await openSyncTarget(dir, dialect);
  const { cli, options, context } = target;
  const configResult = { config } as LoadConfigResult;
  await ensureLocalizedCompanions(config, cli, context, "beforeApply");
  await syncCollections(configResult, cli, options, context);
  await syncSingles(configResult, cli, options, context);
  await syncComponents(configResult, cli, options, context);
  await ensureLocalizedCompanions(config, cli, context);
}

/** The production store, so the tests act on the rows the runtime does. */
function transitionStore(): Parameters<typeof readI18nTransitionState>[0] {
  const noop = () => {};
  const meta = new MetaService(target?.adapter as unknown as DrizzleAdapter, {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  });
  return {
    getEntry: key => meta.getEntry(key),
    set: (key, v) => meta.set(key, v),
    insertIfAbsent: (key, v) => meta.insertIfAbsent(key, v),
    compareAndSet: (key, expected, next) =>
      meta.compareAndSet(key, expected, next),
    delete: key => meta.delete(key),
  };
}

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

function configs(slug: string) {
  return {
    off: defineConfig({
      collections: [
        defineCollection({ slug, fields: [text({ name: "title" })] }),
      ],
    }),
    on: defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    }),
  };
}

describe.each(getConfiguredTestDialects())(
  "localization turned off and on again (%s)",
  (dialect: TestDialect) => {
    it("gives every existing entry its default-language row when localization is turned on, an empty one included", async () => {
      // The schema apply moves a translated field's value once, and the provisioning pass around
      // it takes that move as done: an entry with no value still gets its row, so it reads as an
      // untranslated entry and not as a missing one.
      const slug = "locevery";
      const { off, on } = configs(slug);
      const q = (name: string) => quote(dialect, name);
      const main = q(`dc_${slug}`);
      const companion = q(`dc_${slug}_locales`);
      await runSync(dialect, off);
      await target?.adapter.executeQuery(
        `INSERT INTO ${main} (${q("id")}, ${q("slug")}, ${q("title")}) VALUES ('row1', 'r1', 'Before localizing'), ('row2', 'r2', NULL)`
      );

      await runSync(dialect, on);

      const rows = await target?.adapter.executeQuery<{
        parent: string;
        title: string | null;
      }>(
        `SELECT ${q("_parent")} AS parent, ${q("title")} AS title FROM ${companion} ` +
          `WHERE ${q("_locale")} = 'en' ORDER BY ${q("_parent")}`
      );
      expect(rows).toEqual([
        { parent: "row1", title: "Before localizing" },
        { parent: "row2", title: null },
      ]);
    });

    it("keeps an edit made to the main table after localization was turned off", async () => {
      const slug = "locoff";
      const { off, on } = configs(slug);
      const q = (name: string) => quote(dialect, name);
      const main = q(`dc_${slug}`);
      const companion = q(`dc_${slug}_locales`);

      await runSync(dialect, off);
      await target?.adapter.executeQuery(
        `INSERT INTO ${main} (${q("id")}, ${q("slug")}, ${q("title")}) VALUES ('row1', 'r1', 'Before localizing')`
      );
      await runSync(dialect, on);
      await target?.adapter.executeQuery(
        `UPDATE ${companion} SET ${q("title")} = 'Edited in English' WHERE ${q("_locale")} = 'en'`
      );

      // Off: the companion's values come back onto main, once.
      await runSync(dialect, off);
      const restored = await target?.adapter.executeQuery<{ title: string }>(
        `SELECT ${q("title")} FROM ${main} WHERE ${q("id")} = 'row1'`
      );
      expect(restored).toEqual([{ title: "Edited in English" }]);
      await expect(
        readI18nTransitionState(transitionStore(), "collection", slug)
      ).resolves.toMatchObject({
        status: "restored",
      });

      // Main is authoritative now, and an edit to it must survive the next pass.
      await target?.adapter.executeQuery(
        `UPDATE ${main} SET ${q("title")} = 'Edited after the disable' WHERE ${q("id")} = 'row1'`
      );
      await runSync(dialect, off);
      const after = await target?.adapter.executeQuery<{ title: string }>(
        `SELECT ${q("title")} FROM ${main} WHERE ${q("id")} = 'row1'`
      );
      expect(after).toEqual([{ title: "Edited after the disable" }]);
    });

    it("recovers an install whose earlier disable copied nothing back", async () => {
      // The state an affected MySQL install is in: localization turned off,
      // main still holding its pre-localization value, the edit only on the
      // companion, and the record at `enabling`, where a first enable that could
      // never settle left it. The next pass restores the edit onto main.
      const slug = "locrecover";
      const { off, on } = configs(slug);
      const q = (name: string) => quote(dialect, name);
      const main = q(`dc_${slug}`);
      await runSync(dialect, off);
      await target?.adapter.executeQuery(
        `INSERT INTO ${main} (${q("id")}, ${q("slug")}, ${q("title")}) VALUES ('row1', 'r1', 'Before localizing')`
      );
      await runSync(dialect, on);
      await target?.adapter.executeQuery(
        `UPDATE ${q(`dc_${slug}_locales`)} SET ${q("title")} = 'Edited while localized' WHERE ${q("_locale")} = 'en'`
      );
      const store = transitionStore();
      await forgetI18nTransition(store, "collection", slug);
      await beginI18nTransition(store, {
        kind: "collection",
        slug,
        sourceLocale: "en",
      });

      if (dialect === "mysql") {
        // The query the release notes give MySQL users, to list what the
        // recovery will change before they run it: here, the hidden edit.
        const differing = await target?.adapter.executeQuery<{
          id: string;
          on_main: string;
          in_translations: string;
        }>(
          `SELECT m.id, m.updated_at, m.title AS on_main, l.title AS in_translations FROM dc_${slug} AS m JOIN dc_${slug}_locales AS l ON l._parent = m.id AND l._locale = 'en' WHERE NOT (m.title <=> l.title)`
        );
        expect(differing).toMatchObject([
          {
            id: "row1",
            on_main: "Before localizing",
            in_translations: "Edited while localized",
          },
        ]);
      }

      await runSync(dialect, off);
      const after = await target?.adapter.executeQuery<{ title: string }>(
        `SELECT ${q("title")} FROM ${main} WHERE ${q("id")} = 'row1'`
      );
      expect(after).toEqual([{ title: "Edited while localized" }]);
      await expect(
        readI18nTransitionState(store, "collection", slug)
      ).resolves.toMatchObject({
        status: "restored",
      });
    });

    it("settles a first enable whose record was left at enabling", async () => {
      const slug = "locstuck";
      const { off, on } = configs(slug);
      await runSync(dialect, off);
      await runSync(dialect, on);

      // The state a first enable on MySQL was left in: its copy ran, and the
      // record never moved past `enabling`.
      const store = transitionStore();
      await forgetI18nTransition(store, "collection", slug);
      await beginI18nTransition(store, {
        kind: "collection",
        slug,
        sourceLocale: "en",
      });
      await expect(
        readI18nTransitionState(store, "collection", slug)
      ).resolves.toMatchObject({
        status: "enabling",
      });

      await runSync(dialect, on);
      await expect(
        readI18nTransitionState(store, "collection", slug)
      ).resolves.toMatchObject({
        status: "seeded",
        sourceLocale: "en",
      });
    });
  }
);
