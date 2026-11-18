/**
 * `nextly upgrade` back-fills each Single's translation stamps (`_updated_at`) from its version
 * history, as collections' already are: a translation written before the stamp was kept would
 * otherwise have no time to be judged out of date by, and an out-of-date Spanish Single would
 * never be found.
 *
 * The plausible broken upgrades: one that back-fills collections only, and one that stamps every
 * row with the same time, which makes every translation and its source compare equal.
 */
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { runUpgrade } from "../../../cli/commands/upgrade";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  BANNER,
  bootSite,
  openUpgradeDatabase,
  seedLegacyStates,
  SITE,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";

describeEachDialect("upgrading a Single's translation stamps", dialect => {
  let database: UpgradeDatabase | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
    _resetPerLanguageStorage();
    vi.unstubAllEnvs();
  });

  /** Each language's stamp on the banner's translations, as milliseconds or null. */
  async function stamps(): Promise<Record<string, number | null>> {
    const rows = await database!.adapter.queryStatement<{
      locale: string;
      stamp: unknown;
    }>(
      sql`SELECT ${sql.identifier("_locale")} AS ${sql.identifier("locale")}, ${sql.identifier("_updated_at")} AS ${sql.identifier("stamp")} FROM ${sql.identifier("single_banner_locales")}`
    );
    return Object.fromEntries(
      rows.map(row => [
        row.locale,
        row.stamp === null || row.stamp === undefined
          ? null
          : new Date(
              typeof row.stamp === "number" && row.stamp < 1e11
                ? row.stamp * 1000
                : (row.stamp as string)
            ).getTime(),
      ])
    );
  }

  it("dates each language from its own last version", async () => {
    database = await openUpgradeDatabase(dialect);
    const t = await bootSite(database, "legacy");
    await seedLegacyStates(t, database);
    const [{ id: entryId } = { id: "" }] =
      await database.adapter.queryStatement<{
        id: string;
      }>(
        sql`SELECT ${sql.identifier("id")} AS ${sql.identifier("id")} FROM ${sql.identifier("single_banner")}`
      );
    // The banner's translations as written before stamps were kept: no time on either language.
    const clear = sql`UPDATE ${sql.identifier("single_banner_locales")} SET ${sql.identifier("_updated_at")} = NULL`;
    if (dialect === "sqlite") {
      database.adapter.getDrizzle<{ run(q: unknown): unknown }>().run(clear);
    } else {
      await database.adapter
        .getDrizzle<{ execute(q: unknown): Promise<unknown> }>()
        .execute(clear);
    }
    // Its history as such an installation kept it: each language's own last version, a day apart,
    // in place of the versions this release's saves just recorded.
    await database.adapter.delete(VERSIONS_TABLE, {
      and: [
        { column: "scopeKind", op: "=", value: "single" },
        { column: "scopeSlug", op: "=", value: BANNER },
        { column: "versionNo", op: "IS NOT NULL" },
      ],
    });
    // Each language's own history, a day apart.
    const versionIn = async (locale: string, at: string, versionNo: number) =>
      database!.adapter.insert(
        VERSIONS_TABLE,
        {
          id: crypto.randomUUID(),
          scopeKind: "single",
          scopeSlug: BANNER,
          entryId,
          versionNo,
          status: "published",
          isAutosave: false,
          snapshot: JSON.stringify({ title: locale }),
          label: null,
          locale,
          draftKey: null,
          sourceVersionNo: null,
          createdBy: null,
          createdAt: new Date(at),
          updatedAt: new Date(at),
        },
        { returning: [] }
      );
    await versionIn("en", "2026-08-02T10:00:00Z", 900);
    await versionIn("es", "2026-08-01T10:00:00Z", 901);

    await runUpgrade(
      { confirmBackedUp: true },
      { adapter: database.adapter as never, config: SITE }
    );

    const after = await stamps();
    expect(after.en).not.toBeNull();
    expect(after.es).not.toBeNull();
    // Spanish was last written a day before English, so it reads as older than its source.
    expect(after.es!).toBeLessThan(after.en!);
  });
});
