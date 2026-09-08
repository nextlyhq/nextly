/**
 * The same question as `release-reveals-draft`, asked of a Single.
 *
 * Kept separate because the mechanism is genuinely different, not because the
 * question is. A collection read FILTERS rows in SQL, so a release has to widen
 * the filter. A Single is one row per slug and is never filtered — it is loaded
 * and then REFUSED with a 404 if its status does not match what the caller may
 * see. So for a Single the release has to reach the refusal, not the query.
 *
 * Both must land together. A scheduled release that publishes a collection
 * entry on time and a Single late is the asymmetry this work exists to remove,
 * moved rather than fixed.
 *
 * @module domains/releases/__tests__/release-reveals-single.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { ReleasesRepository } from "../releases-repository";
import { seedLiveAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "homepage";
const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2099-01-01T00:00:00Z");

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

/** A drafted Single, and the release that will publish it. */
async function draftedSingleInRelease(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<void> {
  const singles = singlesOf(t);
  await singles.update(
    SLUG,
    { headline: "pending", status: "draft" },
    { overrideAccess: true }
  );

  const row = await t.adapter.selectOne<{ id: string }>(`single_${SLUG}`, {});
  if (!row?.id) throw new Error("the Single has no stored row");

  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: "single",
    scopeSlug: SLUG,
    entryId: row.id,
    locale: null,
    action: "publish",
    // A live author: the read path projects a due member only when its author
    // still exists and is active, matching the write path that runs AS them.
    createdBy: await seedLiveAuthor(t),
  });
  if (scheduledAt !== null) {
    await repo.scheduleRelease(release.id, scheduledAt, "UTC");
  }
}

/** A PUBLISHED Single, and the release that will withdraw it. */
async function publishedSingleInTakedown(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<void> {
  const singles = singlesOf(t);
  await singles.update(
    SLUG,
    { headline: "live", status: "published" },
    { overrideAccess: true }
  );

  const row = await t.adapter.selectOne<{ id: string }>(`single_${SLUG}`, {});
  if (!row?.id) throw new Error("the Single has no stored row");

  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Take it down" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: "single",
    scopeSlug: SLUG,
    entryId: row.id,
    locale: null,
    action: "unpublish",
    createdBy: await seedLiveAuthor(t),
  });
  if (scheduledAt !== null) {
    await repo.scheduleRelease(release.id, scheduledAt, "UTC");
  }
}

/** Whether an ordinary untrusted read can see the Single at all. */
async function visibleToPublic(t: TestNextly): Promise<boolean> {
  const result = await singlesOf(t).get(SLUG, { overrideAccess: false });
  return result.success === true;
}

describe.each(getConfiguredTestDialects())(
  "a due release changes what a reader sees of a Single (%s)",
  dialect => {
    it("REVEALS a drafted Single whose release has come due", async () => {
      const t = await boot(dialect);
      await draftedSingleInRelease(t, PAST);
      expect(await visibleToPublic(t)).toBe(true);
    });

    it("keeps it hidden before the release is due", async () => {
      // The control. Without it, a gate that simply stopped refusing drafts
      // would satisfy the case above while publishing every drafted Single.
      const t = await boot(dialect);
      await draftedSingleInRelease(t, FUTURE);
      expect(await visibleToPublic(t)).toBe(false);
    });

    it("keeps it hidden while the release is still being assembled", async () => {
      const t = await boot(dialect);
      await draftedSingleInRelease(t, null);
      expect(await visibleToPublic(t)).toBe(false);
    });

    it("WITHDRAWS a published Single whose takedown has come due", async () => {
      // The other half of the guarantee, and the half that had no test at all.
      // Deleting the hide check in `isSingleVisible` failed nothing: the
      // repository still returned the right shape and the SQL tests still
      // passed, so a computed-then-discarded takedown would have returned in
      // silence. The stored row still says `published` here — that is exactly
      // what the release is undoing.
      const t = await boot(dialect);
      await publishedSingleInTakedown(t, PAST);
      expect(await visibleToPublic(t)).toBe(false);
    });

    it("keeps a published Single visible before its takedown is due", async () => {
      // The control. Without it, a gate that refused every Single with any
      // release member would satisfy the case above while hiding content whose
      // takedown has not arrived.
      const t = await boot(dialect);
      await publishedSingleInTakedown(t, FUTURE);
      expect(await visibleToPublic(t)).toBe(true);
    });

    it("keeps it visible while the takedown is still being assembled", async () => {
      // An unscheduled release is somebody still deciding. Consulting it would
      // make adding a document to a draft release take it off the site.
      const t = await boot(dialect);
      await publishedSingleInTakedown(t, null);
      expect(await visibleToPublic(t)).toBe(true);
    });
  }
);
