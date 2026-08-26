/**
 * Does a DRAFTED Single hand back the same value SHAPES a published one does?
 *
 * The collections draft overlay rehydrates system timestamps and every declared
 * date field to `Date` before the read pipeline runs, and says why
 * (`collection-query-service.ts:3138`): a live read hands the afterRead hooks
 * Drizzle-decoded `Date` objects, so a hook that calls date methods "would fail
 * only for a drafted entry".
 *
 * The singles overlay calls neither of those functions. It runs
 * `deserializeJsonFields` with a timestamp normalizer instead — a different
 * mechanism, which may or may not reach the same result.
 *
 * This suite settles that by MEASUREMENT rather than by reading either
 * implementation. It compares the drafted read against the published read of
 * the same document: two renders of the same field, where only the overlay
 * differs. Comparing an implementation against itself would prove nothing.
 *
 * @module domains/singles/__tests__/draft-date-parity.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { date, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "release_notes";
const PUBLISHED_AT = "2026-03-04T10:00:00.000Z";
const EDITED_AT = "2026-05-06T11:30:00.000Z";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" }), date({ name: "goesLiveAt" })],
      }),
    ],
  });
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

/** What kind of thing came back, in a form an assertion can compare. */
const shapeOf = (value: unknown): string =>
  value instanceof Date ? "Date" : typeof value;

describe.each(getConfiguredTestDialects())(
  "a drafted Single's value shapes (%s)",
  dialect => {
    it("returns a declared date field in the SAME shape as a published read", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);

      await singles.update(
        SLUG,
        { headline: "live", goesLiveAt: PUBLISHED_AT, status: "published" },
        { overrideAccess: true }
      );

      const published = await singles.get(SLUG, { overrideAccess: true });
      const publishedShape = shapeOf(
        (published.data as { goesLiveAt?: unknown }).goesLiveAt
      );
      // The premise: the published read must itself return something, or the
      // comparison below is satisfied by two absences agreeing.
      expect(
        (published.data as { goesLiveAt?: unknown }).goesLiveAt
      ).toBeDefined();

      await singles.update(
        SLUG,
        { headline: "edited", goesLiveAt: EDITED_AT },
        { overrideAccess: true }
      );

      const drafted = await singles.get(SLUG, {
        overrideAccess: true,
        includeWorkingDraft: true,
        status: "all",
      });
      // The overlay is actually in effect — otherwise this compares the
      // published document with itself and passes for the wrong reason.
      expect((drafted.data as { headline?: string }).headline).toBe("edited");

      expect(
        shapeOf((drafted.data as { goesLiveAt?: unknown }).goesLiveAt)
      ).toBe(publishedShape);
    });

    it("returns the system timestamps in the SAME shape as a published read", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);

      await singles.update(
        SLUG,
        { headline: "live", goesLiveAt: PUBLISHED_AT, status: "published" },
        { overrideAccess: true }
      );
      const published = await singles.get(SLUG, { overrideAccess: true });
      const publishedShape = shapeOf(
        (published.data as { updatedAt?: unknown }).updatedAt
      );
      expect(
        (published.data as { updatedAt?: unknown }).updatedAt
      ).toBeDefined();

      await singles.update(
        SLUG,
        { headline: "edited" },
        { overrideAccess: true }
      );
      const drafted = await singles.get(SLUG, {
        overrideAccess: true,
        includeWorkingDraft: true,
        status: "all",
      });
      expect((drafted.data as { headline?: string }).headline).toBe("edited");

      expect(shapeOf((drafted.data as { updatedAt?: unknown }).updatedAt)).toBe(
        publishedShape
      );
    });
  }
);
