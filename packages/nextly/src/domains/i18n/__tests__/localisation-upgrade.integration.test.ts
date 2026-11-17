/**
 * `nextly upgrade` moves an installation from before per-language storage into the model without
 * losing anything:
 * - every reader sees, in every language, what it saw before (R-11);
 * - a pending change kept as a whole document in one language is split by comparing it with what
 *   is live: the shared values it changed become the shared draft, its own values its language's
 *   draft, and where two languages changed the same shared field the later save wins and the
 *   conflict is listed (E5);
 * - its dry run lists what will move, what conflicts and what an editor should check, and writes
 *   nothing;
 * - a second upgrade has nothing to do.
 *
 * The plausible broken upgrades: one that leaves the translatable values where they were (the
 * upgraded boot then refuses, or reads them as gone), one that keeps each language's whole-document
 * draft (a language's draft then carries shared values), one that takes the first save rather than
 * the later, and a dry run that writes.
 */
import { afterEach, expect, it, vi } from "vitest";

import { previewUpgrade, runUpgrade } from "../../../cli/commands/upgrade";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestNextly } from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import {
  WORKING_DRAFT_SHAPE,
  type VersionRow,
} from "../../versions/versions-repository";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  ARTICLES,
  bootSite,
  openUpgradeDatabase,
  seedLegacyStates,
  SITE,
  whatEachReaderSees,
  type SeededStates,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";

describeEachDialect(
  "upgrading an installation into the localisation model",
  dialect => {
    let database: UpgradeDatabase | undefined;
    let site: TestNextly | undefined;

    afterEach(async () => {
      site = undefined;
      await database?.close();
      database = undefined;
      _resetPerLanguageStorage();
      vi.unstubAllEnvs();
    });

    /** The legacy site, filled with every state, and what each reader saw of it. */
    async function legacySite(): Promise<{
      seeded: SeededStates;
      before: Awaited<ReturnType<typeof whatEachReaderSees>>;
    }> {
      database = await openUpgradeDatabase(dialect);
      site = await bootSite(database, "legacy");
      const seeded = await seedLegacyStates(site, database);
      return { seeded, before: await whatEachReaderSees(site, seeded) };
    }

    /** Upgrade the database as `nextly upgrade --confirm-backed-up` does, for the site's config. */
    async function upgrade(): Promise<void> {
      await runUpgrade(
        { confirmBackedUp: true },
        { adapter: database!.adapter as never, config: SITE }
      );
    }

    /** Each working draft of the entry `entryId`, by its language (`shared` for none). */
    async function pendingChangesOf(
      entryId: string
    ): Promise<Record<string, Record<string, unknown>>> {
      const rows = await database!.adapter.select<VersionRow>(VERSIONS_TABLE, {
        where: {
          and: [
            { column: "entryId", op: "=", value: entryId },
            ...WORKING_DRAFT_SHAPE,
          ],
        },
      });
      return Object.fromEntries(
        rows.map(row => [
          row.locale ?? "shared",
          (typeof row.snapshot === "string"
            ? JSON.parse(row.snapshot)
            : row.snapshot) as Record<string, unknown>,
        ])
      );
    }

    it("keeps what each reader sees in every language", async () => {
      const { seeded, before } = await legacySite();

      await upgrade();
      site = await bootSite(database!, "upgraded");

      const after = await whatEachReaderSees(site, seeded);
      const published = (seen: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(seen).filter(([key]) => key.endsWith("/published"))
        );
      expect(published(after)).toEqual(published(before));
    });

    it("splits a whole-document pending change against live, the later save winning a conflict", async () => {
      const { seeded } = await legacySite();

      await upgrade();

      const split = await pendingChangesOf(seeded.articles.split);
      // The shared field both languages changed: the later save's value, in the shared draft.
      expect(split.shared).toEqual({ code: "from-fr" });
      // Each language's draft keeps its own values and no shared one.
      expect(split.es).toMatchObject({ title: "split es 2" });
      expect(split.fr).toMatchObject({ title: "split fr 2" });
      expect(split.es).not.toHaveProperty("code");
      expect(split.fr).not.toHaveProperty("code");

      // A pending change whose shared values equal live starts no shared draft.
      const copy = await pendingChangesOf(seeded.articles["stale-copy"]);
      expect(copy.shared).toBeUndefined();
      expect(copy.es).toMatchObject({ title: "stale-copy es 2" });
      expect(copy.es).not.toHaveProperty("code");
    });

    it("lists what moves, what conflicts and what to check in a dry run, and writes nothing", async () => {
      const { seeded } = await legacySite();
      const rowsBefore = await pendingChangesOf(seeded.articles.split);

      const plan = await previewUpgrade(
        { confirmBackedUp: true },
        { adapter: database!.adapter as never, config: SITE }
      );

      expect(plan.report?.move.length).toBeGreaterThan(0);
      expect(plan.report?.conflicts).toEqual([
        expect.stringMatching(
          new RegExp(`${ARTICLES}.*${seeded.articles.split}.*code.*es.*fr`)
        ),
      ]);
      expect(await pendingChangesOf(seeded.articles.split)).toEqual(rowsBefore);
    });

    it("has nothing to do the second time", async () => {
      await legacySite();
      const preview = () =>
        previewUpgrade(
          { confirmBackedUp: true },
          { adapter: database!.adapter as never, config: SITE }
        );
      // The legacy site has the model's work to do, so an empty second plan is the upgrade's doing.
      expect((await preview()).report?.move.length).toBeGreaterThan(0);

      await upgrade();

      const plan = await preview();
      expect(plan.changes).toEqual([]);
      expect(plan.report?.move ?? []).toEqual([]);
    });
  }
);
