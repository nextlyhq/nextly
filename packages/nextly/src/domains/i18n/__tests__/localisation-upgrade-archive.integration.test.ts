/**
 * `nextly upgrade`'s dry run lists the archived translations no entity can be found for (an
 * archive row of unknown or unresolved kind), with the restore that would claim them, and leaves
 * them in place: nothing about them is guessed, and nothing deletes them.
 *
 * The plausible broken upgrades: one that says nothing about them, and one that drops them as
 * belonging to nothing.
 */
import { afterEach, expect, it, vi } from "vitest";

import { previewUpgrade, runUpgrade } from "../../../cli/commands/upgrade";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { ensureI18nArchive } from "../migration/ensure-archive";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  bootSite,
  openUpgradeDatabase,
  SITE,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";

const ARCHIVE = "nextly_i18n_archive";

describeEachDialect(
  "upgrading archived translations of unknown kind",
  dialect => {
    let database: UpgradeDatabase | undefined;

    afterEach(async () => {
      await database?.close();
      database = undefined;
      _resetPerLanguageStorage();
      vi.unstubAllEnvs();
    });

    /** A legacy site whose archive holds translations of an entity no registry describes. */
    async function archiveOfUnknownKind(): Promise<void> {
      database = await openUpgradeDatabase(dialect);
      await bootSite(database, "legacy");
      await ensureI18nArchive(database.adapter as never, dialect);
      for (const [entityKind, entryId] of [
        ["unknown", "e1"],
        ["unresolved", "e2"],
      ] as const) {
        await database.adapter.insert(
          ARCHIVE,
          {
            collection: "old-posts",
            entityKind,
            entryId,
            locale: "es",
            field: "title",
            value: "hola",
            archivedAt: new Date("2026-08-01T10:00:00Z"),
          },
          { returning: [] }
        );
      }
    }

    async function archivedRows(): Promise<number> {
      return (await database!.adapter.select<{ entryId: string }>(ARCHIVE, {}))
        .length;
    }

    it("lists them with the restore that claims them, and keeps them", async () => {
      await archiveOfUnknownKind();
      const deps = { adapter: database!.adapter as never, config: SITE };

      const plan = await previewUpgrade({ confirmBackedUp: true }, deps);
      expect(plan.report?.check).toContainEqual(
        expect.stringMatching(
          /old-posts[\s\S]*i18n:restore --collection old-posts --kind/
        )
      );

      await runUpgrade({ confirmBackedUp: true }, deps);
      expect(await archivedRows()).toBe(2);
    });
  }
);
