/**
 * What a wildcard publish owes a pending edit it promotes.
 *
 * Promotion and the companion write are two decisions about one draft. The
 * promotion loads it and splits its fields by NAME — a localized field lands in
 * `companionData` whichever language the draft belongs to — while the companion
 * write is skipped for a wildcard, so the document never receives what was
 * promoted. The delete that follows is unconditional. These tests state the
 * property that spans all three: an edit an author saved is either live or
 * still pending afterwards, never neither.
 *
 * @module domains/singles/__tests__/wildcard-promoted-draft-loss.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
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

const SLUG = "prefs";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "siteName", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

/** The LIVE translated value for one language, read raw. */
async function liveSiteName(
  t: TestNextly,
  locale: string
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ site_name?: string }>(
    `single_${SLUG}_locales`,
    { where: { and: [{ column: "_locale", op: "=", value: locale }] } }
  );
  return row?.site_name;
}

/**
 * What a reader actually gets for one language — the oracle, in place of any
 * table this value might be stored in. `status: "all"` is the widest view the
 * product offers: a value absent from it is absent from every read path.
 */
async function readSiteName(
  t: TestNextly,
  locale: string,
  everyStatus = true
): Promise<unknown> {
  const doc = (await t.nextly.findSingle({
    slug: SLUG as never,
    locale,
    overrideAccess: true,
    ...(everyStatus ? { status: "all" } : {}),
  } as never)) as Record<string, unknown> | null;
  return doc?.siteName;
}

/** Every pending working draft this Single holds, by locale. */
async function pendingDrafts(
  t: TestNextly
): Promise<{ locale: string; snapshot: string }[]> {
  // `nextly_versions` is a mapped system table: its rows come back camelCased,
  // unlike the dynamic content tables, whose columns stay snake_case.
  const rows = await t.adapter.select<{
    locale?: unknown;
    snapshot?: unknown;
    scopeSlug?: unknown;
    versionNo?: unknown;
  }>("nextly_versions", {});
  return rows
    .filter(r => String(r.scopeSlug) === SLUG && r.versionNo === null)
    .map(r => ({
      locale: String(r.locale),
      snapshot:
        typeof r.snapshot === "string"
          ? r.snapshot
          : JSON.stringify(r.snapshot),
    }));
}

/**
 * A Single live in German only: the main row published by a wildcard, and no
 * English companion, because a wildcard moves the rows that exist rather than
 * manufacturing a default-language translation.
 */
async function germanOnlyAndPublished(t: TestNextly): Promise<void> {
  await singlesOf(t).update(
    SLUG,
    { siteName: "DE live", status: "published" },
    { locale: "de", overrideAccess: true }
  );
  await singlesOf(t).update(
    SLUG,
    { status: "published" },
    { locale: "*", overrideAccess: true }
  );
}

describe.each(getConfiguredTestDialects())(
  "a wildcard publish and the draft it promotes (%s)",
  dialect => {
    it("does not lose a promoted edit it never writes", async () => {
      const t = await boot(dialect);
      await germanOnlyAndPublished(t);

      // The precondition the guard produces: no English translation row, so a
      // promotion into it has nowhere to land.
      expect(await readSiteName(t, "en")).toBeFalsy();

      // A status-less save on a published document is held as a pending edit.
      await singlesOf(t).update(
        SLUG,
        { siteName: "EN pending" },
        { locale: "en", overrideAccess: true }
      );

      // POPULATION CONTROL: the edit really was held. Without it, a later
      // "nothing pending" reads as the defect when it could equally mean the
      // save never became a draft and the test proves nothing.
      expect(JSON.stringify(await pendingDrafts(t))).toContain("EN pending");

      const result = await singlesOf(t).update(
        SLUG,
        { status: "published" },
        { locale: "*", overrideAccess: true }
      );

      // An edit the author saved is either readable or still pending. Which of
      // the two is an implementation choice; that it is one of them is not.
      const readable = await readSiteName(t, "en");
      const stillPending = JSON.stringify(await pendingDrafts(t)).includes(
        "EN pending"
      );
      expect(readable === "EN pending" || stillPending).toBe(true);

      // A refusal is a legitimate outcome, but only if it keeps the work.
      if (!result.success) expect(stillPending).toBe(true);
    });

    it("CONTROL: the same edit survives a publish that names the language", async () => {
      const t = await boot(dialect);
      await germanOnlyAndPublished(t);

      await singlesOf(t).update(
        SLUG,
        { siteName: "EN pending" },
        { locale: "en", overrideAccess: true }
      );
      expect(JSON.stringify(await pendingDrafts(t))).toContain("EN pending");

      await singlesOf(t).update(
        SLUG,
        { status: "published" },
        { locale: "en", overrideAccess: true }
      );

      const readable = await readSiteName(t, "en");
      const stillPending = JSON.stringify(await pendingDrafts(t)).includes(
        "EN pending"
      );
      expect(readable === "EN pending" || stillPending).toBe(true);
    });

    it("CONTROL: the language that does have a translation is unaffected", async () => {
      const t = await boot(dialect);
      await germanOnlyAndPublished(t);

      await singlesOf(t).update(
        SLUG,
        { siteName: "EN pending" },
        { locale: "en", overrideAccess: true }
      );
      await singlesOf(t).update(
        SLUG,
        { status: "published" },
        { locale: "*", overrideAccess: true }
      );

      // Proves the probe is aimed correctly: the read path works, and German
      // content is untouched by whatever happens to English.
      expect(await readSiteName(t, "de", false)).toBe("DE live");
    });
  }
);
