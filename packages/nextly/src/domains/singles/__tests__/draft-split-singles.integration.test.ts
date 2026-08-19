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
import { discardWorkingDraftForDocument } from "../../../dispatcher/handlers/versions-methods";
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
        // The discard cases below drive the DISPATCHER, which authorizes read
        // and update on the document. The service-level cases pass
        // `overrideAccess`, so these rules do not change what they exercise.
        access: { read: () => true, update: () => true },
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
        access: { read: () => true, update: () => true },
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

/**
 * Throwing a Single's pending change away.
 *
 * Driven through the dispatcher method rather than the service, because the
 * gap this closes was never in the delete: a Single had no discard PATH at all,
 * so a service-level test would pass over exactly the wiring that was missing.
 */
describe("discarding a Single's pending change (integration)", () => {
  /** The live document id, which a Single's caller resolves rather than names. */
  async function liveId(t: TestNextly): Promise<string> {
    const res = await singlesOf(t).get(SLUG, { overrideAccess: true });
    return (res.data as { id: string }).id;
  }

  it("removes the sidecar and returns the live row, leaving the document untouched", async () => {
    const t = await bootPlain();
    const singles = singlesOf(t);
    await singles.update(
      SLUG,
      { siteName: "live", status: "published" },
      { overrideAccess: true }
    );
    const res = await singles.update(
      SLUG,
      { siteName: "edited" },
      { overrideAccess: true }
    );
    expect(res.success).toBe(true);
    // The fixture must actually hold a pending change, or the assertions below
    // are satisfied by a Single that never stored one.
    expect(await pendingLocales(t)).toEqual(["(none)"]);

    const discarded = await discardWorkingDraftForDocument({
      scopeKind: "single",
      slug: SLUG,
      entryId: await liveId(t),
      user: { id: "editor-1" },
      params: { slug: SLUG, _authenticatedUserId: "editor-1" },
    });

    expect(await pendingLocales(t)).toEqual([]);
    // The response is the LIVE document, not the edit just thrown away.
    expect((discarded as { siteName?: string }).siteName).toBe("live");
    // And the live row itself never moved.
    expect(await storedName(t)).toBe("live");
  });

  it("discards only the language it was asked for", async () => {
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
    expect(await pendingLocales(t)).toEqual(["de", "en"]);

    const discarded = await discardWorkingDraftForDocument({
      scopeKind: "single",
      slug: SLUG,
      entryId: await liveId(t),
      user: { id: "editor-1" },
      locale: "de",
      params: { slug: SLUG, _authenticatedUserId: "editor-1" },
    });

    // German goes; English survives, because it is work the author never opened.
    expect(await pendingLocales(t)).toEqual(["en"]);
    // The values handed back are GERMAN's live ones, not the default language's.
    expect((discarded as { siteName?: string }).siteName).toBe("DE live");
    expect(await storedName(t, "de")).toBe("DE live");
  });

  it("is a no-op that still returns the live row when nothing is pending", async () => {
    const t = await bootPlain();
    const singles = singlesOf(t);
    await singles.update(
      SLUG,
      { siteName: "live", status: "published" },
      { overrideAccess: true }
    );
    expect(await pendingLocales(t)).toEqual([]);

    const discarded = await discardWorkingDraftForDocument({
      scopeKind: "single",
      slug: SLUG,
      entryId: await liveId(t),
      user: { id: "editor-1" },
      params: { slug: SLUG, _authenticatedUserId: "editor-1" },
    });

    expect((discarded as { siteName?: string }).siteName).toBe("live");
    expect(await pendingLocales(t)).toEqual([]);
  });
});
