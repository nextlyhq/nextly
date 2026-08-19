/**
 * A published Single holds a status-less edit instead of publishing it.
 *
 * Singles had no pending-changes code at all: every edit to a published
 * Homepage or Site Settings went straight to the live site. The engine pieces
 * are shared with collections — the same hold rule, the same locale key, the
 * same write — so this proves the wiring rather than re-proving the mechanism.
 *
 * Each "unaffected" assertion is paired with a positive one in the same case:
 * "the stored document is unchanged" is satisfied just as well by a write that
 * stored nothing at all. And each case asserts the operation SUCCEEDED before
 * asserting its effects, because a soft failure otherwise reads as "the write
 * did nothing".
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "preferences";

async function bootPlain(): Promise<TestNextly> {
  current = await createTestNextly({
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "siteName" }), text({ name: "tagline" })],
      }),
    ],
  });
  return current;
}

async function bootLocalized(): Promise<TestNextly> {
  current = await createTestNextly({
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "siteName", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

function singlesOf(t: TestNextly): SingleEntryService {
  return t.getService("singleEntryService");
}

/** Pending changes for this Single, by the language they are keyed under. */
async function pendingLocales(t: TestNextly): Promise<string[]> {
  const rows = await t.adapter.select<{ locale: string | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "scopeKind", op: "=", value: "single" },
          { column: "scopeSlug", op: "=", value: SLUG },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    }
  );
  return rows.map(r => r.locale ?? "(none)").sort();
}

async function storedName(t: TestNextly, locale?: string): Promise<unknown> {
  const res = await singlesOf(t).get(SLUG, { locale, overrideAccess: true });
  return (res.data as { siteName?: unknown } | null)?.siteName;
}

describe("pending changes for Singles (integration)", () => {
  it("writes the live row when the Single is not published (control)", async () => {
    const t = await bootPlain();
    const singles = singlesOf(t);
    const created = await singles.update(
      SLUG,
      { siteName: "first", status: "draft" },
      { overrideAccess: true }
    );
    expect(created.success).toBe(true);

    const res = await singles.update(
      SLUG,
      { siteName: "edited" },
      { overrideAccess: true }
    );
    expect(res.success).toBe(true);

    // Nothing is live to protect, so the edit belongs on the row.
    expect(await storedName(t)).toBe("edited");
    expect(await pendingLocales(t)).toEqual([]);
  });

  it("holds a status-less edit to a published Single", async () => {
    const t = await bootPlain();
    const singles = singlesOf(t);
    expect(
      (
        await singles.update(
          SLUG,
          { siteName: "live", status: "published" },
          { overrideAccess: true }
        )
      ).success
    ).toBe(true);

    const res = await singles.update(
      SLUG,
      { siteName: "edited" },
      { overrideAccess: true }
    );
    expect(res.success).toBe(true);

    expect(await pendingLocales(t)).toEqual(["(none)"]);
    expect(await storedName(t)).toBe("live");
  });

  it("promotes the pending change when the Single is published", async () => {
    const t = await bootPlain();
    const singles = singlesOf(t);
    await singles.update(
      SLUG,
      { siteName: "live", status: "published" },
      { overrideAccess: true }
    );
    await singles.update(
      SLUG,
      { siteName: "edited" },
      { overrideAccess: true }
    );

    const published = await singles.update(
      SLUG,
      { status: "published" },
      { overrideAccess: true }
    );
    expect({ success: published.success }).toEqual({ success: true });

    expect(await storedName(t)).toBe("edited");
    expect(await pendingLocales(t)).toEqual([]);
  });

  it("holds a German edit under German and leaves English alone", async () => {
    const t = await bootLocalized();
    const singles = singlesOf(t);
    await singles.update(
      SLUG,
      { siteName: "EN live", status: "published" },
      { locale: "en", overrideAccess: true }
    );
    await singles.update(
      SLUG,
      { siteName: "DE live", status: "published" },
      { locale: "de", overrideAccess: true }
    );

    const res = await singles.update(
      SLUG,
      { siteName: "DE edited" },
      { locale: "de", overrideAccess: true }
    );
    expect(res.success).toBe(true);

    // The positive half, without which the negative half proves nothing.
    expect(await pendingLocales(t)).toEqual(["de"]);
    expect(await storedName(t, "en")).toBe("EN live");
    expect(await storedName(t, "de")).toBe("DE live");
  });

  it("publishAllLocales applies every language's pending change", async () => {
    const t = await bootLocalized();
    const singles = singlesOf(t);
    await singles.update(
      SLUG,
      { siteName: "EN live", status: "published" },
      { locale: "en", overrideAccess: true }
    );
    await singles.update(
      SLUG,
      { siteName: "DE live", status: "published" },
      { locale: "de", overrideAccess: true }
    );
    await singles.update(
      SLUG,
      { siteName: "EN edited" },
      { locale: "en", overrideAccess: true }
    );
    await singles.update(
      SLUG,
      { siteName: "DE edited" },
      { locale: "de", overrideAccess: true }
    );
    // The fixture has to have held both, or the assertions below are trivially
    // satisfied by a system that stored nothing.
    expect(await pendingLocales(t)).toEqual(["de", "en"]);

    const res = await singles.publishAllLocales(SLUG, {
      overrideAccess: true,
    });
    expect({ success: res.success }).toEqual({ success: true });

    // Both go live together, and neither pending change is left behind to be
    // re-applied by a later publish.
    expect(await storedName(t, "en")).toBe("EN edited");
    expect(await storedName(t, "de")).toBe("DE edited");
    expect(await pendingLocales(t)).toEqual([]);
  });
});
