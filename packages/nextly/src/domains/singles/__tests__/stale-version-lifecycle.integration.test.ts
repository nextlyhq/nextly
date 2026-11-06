/**
 * Publishing a Single, in one language or in all of them, and rewriting its
 * pending change, are judged by the version their caller read, as a save is.
 *
 * Publishing every language judges every language: a Spanish save since the
 * read refuses it. Taking the live values into a pending change, and
 * discarding one, are judged on the Single's own row and the change's
 * language, so a colleague's newer edit to the change is not lost.
 *
 * @module domains/singles/__tests__/stale-version-lifecycle.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineSingle, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { VersionsRepository } from "../../versions/versions-repository";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Translated, with a lifecycle per language and no drafts. */
const BANNER = "sv_banner";
/** Translated, with drafts, and a shared count a pending change can fall behind on. */
const SITE = "sv_site";
const ANA = { id: "user-sv-ana", name: "Ana", email: "ana@sv.test" };

type Doc = Record<string, unknown>;
type Result = {
  success?: boolean;
  code?: string;
  statusCode?: number;
  data?: Doc | null;
  publicData?: Doc;
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: BANNER,
        localized: true,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "siteName" }), number({ name: "articleCount" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  const now = new Date();
  await current.adapter.insert("users", {
    ...ANA,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService") as unknown as SingleEntryService;

function save(
  t: TestNextly,
  slug: string,
  locale: string,
  data: Doc,
  user?: typeof ANA
): Promise<Result> {
  return singlesOf(t).update(slug, data, {
    locale,
    overrideAccess: true,
    ...(user ? { user: user as never } : {}),
  }) as Promise<Result>;
}

/** The version a read of `locale` gives, `*` for every language; drafts included. */
async function readRev(
  t: TestNextly,
  slug: string,
  locale: string
): Promise<string> {
  const read = (await singlesOf(t).get(slug, {
    locale,
    status: "all",
    overrideAccess: true,
  } as never)) as Result;
  const rev = read.data?._rev;
  if (typeof rev !== "string") throw new Error(`no _rev for ${slug}`);
  return rev;
}

const q = (t: TestNextly, name: string) =>
  t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Everything a lifecycle move can change, read raw. */
async function lifecycleOf(t: TestNextly, slug: string) {
  const [main] = await t.adapter.select<Doc>(`single_${slug}`, {});
  const rows = await t.adapter.executeQuery<Doc>(
    `SELECT ${q(t, "_locale")}, ${q(t, "_status")}, ${q(t, "_revision")} FROM ${q(t, `single_${slug}_locales`)}`,
    []
  );
  return {
    status: main?.status,
    revision: Number(main?._revision),
    languages: Object.fromEntries(
      rows
        .map(r => [
          String(r._locale),
          `${String(r._status)}#${Number(r._revision)}`,
        ])
        .sort(([a], [b]) => (a < b ? -1 : 1))
    ),
  };
}

/** The banner as a draft in English and Spanish, with the version of a read of every language. */
async function translatedBanner(t: TestNextly): Promise<string> {
  await save(t, BANNER, "en", {
    headline: "hello",
    _rev: await readRev(t, BANNER, "en"),
  });
  await save(t, BANNER, "es", {
    headline: "hola",
    _rev: await readRev(t, BANNER, "es"),
  });
  return readRev(t, BANNER, "*");
}

const publishAll = (t: TestNextly, data: Doc) =>
  singlesOf(t).publishAllLocales(BANNER, {
    overrideAccess: true,
    data,
  }) as Promise<Result>;

const overwritesOf = async (t: TestNextly, slug: string) => {
  const [row] = await t.adapter.select<Doc>(`single_${slug}`, {});
  return (
    await t.nextly.contentEvents.list({
      subject: { kind: "single", slug, id: String(row?.id) },
      limit: 100,
    })
  ).items.filter(e => e.kind === "overwritten");
};

/**
 * The site live in both languages; English begins a pending change while the
 * count is 10; Spanish then publishes 13, so English's change can take it.
 */
async function englishBehindSpanish(t: TestNextly): Promise<void> {
  expect(
    (
      await save(t, SITE, "en", {
        siteName: "EN",
        articleCount: 10,
        status: "published",
        _rev: await readRev(t, SITE, "en"),
      })
    ).success
  ).toBe(true);
  expect(
    (
      await save(t, SITE, "es", {
        siteName: "ES",
        status: "published",
        _rev: await readRev(t, SITE, "es"),
      })
    ).success
  ).toBe(true);
  expect(
    (
      await save(t, SITE, "en", {
        siteName: "EN edited",
        _rev: await readRev(t, SITE, "en"),
      })
    ).success
  ).toBe(true);
  expect(
    (
      await save(t, SITE, "es", {
        articleCount: 13,
        _rev: await readRev(t, SITE, "es"),
      })
    ).success
  ).toBe(true);
  expect(
    (
      await save(t, SITE, "es", {
        status: "published",
        _rev: await readRev(t, SITE, "es"),
      })
    ).success
  ).toBe(true);
}

/** The English pending change's name, as a read of the change shows it. */
async function pendingName(t: TestNextly): Promise<unknown> {
  const read = (await singlesOf(t).get(SITE, {
    locale: "en",
    status: "draft",
    overrideAccess: true,
  } as never)) as Result;
  return read.data?.siteName;
}

/** The code a call threw or answered with, or "applied". */
async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    const answer = (await call()) as Result | number;
    return typeof answer === "object" && answer?.success === false
      ? String(answer.code)
      : "applied";
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
}

describe.each(getConfiguredTestDialects())(
  "publishing a Single and rewriting its pending change, judged by version (%s)",
  dialect => {
    describe("publishing every language", () => {
      it("refuses a publish of every language after one of them changed", async () => {
        const t = await boot(dialect);
        const read = await translatedBanner(t);
        await save(
          t,
          BANNER,
          "es",
          { headline: "hola otra vez", _overwrite: true },
          ANA
        );
        const before = await lifecycleOf(t, BANNER);

        const refused = await publishAll(t, { _rev: read });
        expect(refused.code, JSON.stringify(refused)).toBe("STALE_VERSION");
        expect(refused.publicData).toMatchObject({
          currentVersion: await readRev(t, BANNER, "*"),
          changedBy: { kind: "person", name: ANA.name },
        });
        expect(await lifecycleOf(t, BANNER)).toEqual(before);

        // Through an update of every language's status too.
        const viaWildcard = await save(t, BANNER, "*", {
          status: "published",
          _rev: read,
        });
        expect(viaWildcard.code, JSON.stringify(viaWildcard)).toBe(
          "STALE_VERSION"
        );
        expect(await lifecycleOf(t, BANNER)).toEqual(before);
      });

      it("refuses a one-language version, which can't say whether another language changed", async () => {
        const t = await boot(dialect);
        await translatedBanner(t);
        const english = await readRev(t, BANNER, "en");
        const before = await lifecycleOf(t, BANNER);
        expect(await codeOf(() => publishAll(t, { _rev: english }))).toBe(
          "VALIDATION_ERROR"
        );
        expect(
          await codeOf(() =>
            save(t, BANNER, "*", { status: "published", _rev: english })
          )
        ).toBe("VALIDATION_ERROR");
        expect(await lifecycleOf(t, BANNER)).toEqual(before);
      });

      it("publishes from the current version, answering with every language's new one", async () => {
        const t = await boot(dialect);
        const read = await translatedBanner(t);
        const published = await publishAll(t, { _rev: read });
        expect(published.success, JSON.stringify(published)).toBe(true);
        expect((await lifecycleOf(t, BANNER)).status).toBe("published");
        expect(published.data?._rev).toBe(await readRev(t, BANNER, "*"));
      });

      it("publishes with no version, until a version is required", async () => {
        const t = await boot(dialect);
        await translatedBanner(t);
        await save(t, BANNER, "es", {
          headline: "hola otra vez",
          _overwrite: true,
        });
        expect((await publishAll(t, {})).success).toBe(true);
      });

      it("publishes over a change with the overwrite choice, and records it", async () => {
        const t = await boot(dialect);
        const read = await translatedBanner(t);
        await save(
          t,
          BANNER,
          "es",
          { headline: "hola otra vez", _rev: await readRev(t, BANNER, "es") },
          ANA
        );
        const published = await publishAll(t, {
          _rev: read,
          _overwrite: true,
        });
        expect(published.success, JSON.stringify(published)).toBe(true);
        expect((await overwritesOf(t, BANNER)).map(e => e.payload)).toEqual([
          expect.objectContaining({
            given: "stale",
            replaced: expect.objectContaining({ kind: "person", id: ANA.id }),
          }),
        ]);
      });
    });

    describe("rewriting a pending change", () => {
      it("refuses taking the live values from an out-of-date version", async () => {
        const t = await boot(dialect);
        await englishBehindSpanish(t);
        const read = await readRev(t, SITE, "en");
        await save(
          t,
          SITE,
          "en",
          { siteName: "Ana's draft", _overwrite: true },
          ANA
        );
        const asAnaLeftIt = await pendingName(t);

        const refused = (await singlesOf(t).takeLiveSharedValues({
          slug: SITE,
          locale: "en",
          overrideAccess: true,
          version: { _rev: read },
        })) as Result;
        expect(refused.code, JSON.stringify(refused)).toBe("STALE_VERSION");
        expect(refused.publicData).toMatchObject({
          currentVersion: await readRev(t, SITE, "en"),
        });
        expect(await pendingName(t)).toBe(asAnaLeftIt);

        const taken = (await singlesOf(t).takeLiveSharedValues({
          slug: SITE,
          locale: "en",
          overrideAccess: true,
          version: { _rev: await readRev(t, SITE, "en") },
        })) as Result;
        expect(taken.success, JSON.stringify(taken)).toBe(true);
      });

      it("refuses discarding a pending change from an out-of-date version", async () => {
        const t = await boot(dialect);
        await englishBehindSpanish(t);
        const read = await readRev(t, SITE, "en");
        await save(
          t,
          SITE,
          "en",
          { siteName: "Ana's draft", _overwrite: true },
          ANA
        );
        const asAnaLeftIt = await pendingName(t);

        expect(
          await codeOf(() =>
            singlesOf(t).discardWorkingDraftCounted({
              slug: SITE,
              locale: "en",
              version: { _rev: read },
            })
          )
        ).toBe("STALE_VERSION");
        expect(await pendingName(t)).toBe(asAnaLeftIt);

        const removed = await singlesOf(t).discardWorkingDraftCounted({
          slug: SITE,
          locale: "en",
          version: { _rev: await readRev(t, SITE, "en") },
        });
        expect(removed).toBe(1);
        // The pending change is gone: the Single reads as it is live.
        const live = (await singlesOf(t).get(SITE, {
          locale: "en",
          overrideAccess: true,
        } as never)) as Result;
        expect(live.data?.siteName).toBe("EN");
      });

      it("judges a discard before removing anything", async () => {
        const t = await boot(dialect);
        await englishBehindSpanish(t);
        const read = await readRev(t, SITE, "en");
        await save(
          t,
          SITE,
          "en",
          { siteName: "Ana's draft", _overwrite: true },
          ANA
        );
        // A removal that fails: a discard that removed before judging would
        // answer with this failure rather than with the refusal.
        const removal = vi
          .spyOn(VersionsRepository.prototype, "deleteWorkingDraft")
          .mockRejectedValue(new Error("removal failed"));
        try {
          expect(
            await codeOf(() =>
              singlesOf(t).discardWorkingDraftCounted({
                slug: SITE,
                locale: "en",
                version: { _rev: read },
              })
            )
          ).toBe("STALE_VERSION");
          expect(removal).not.toHaveBeenCalled();
        } finally {
          removal.mockRestore();
        }
      });

      it("discards over a change with the overwrite choice, and records it", async () => {
        const t = await boot(dialect);
        await englishBehindSpanish(t);
        const read = await readRev(t, SITE, "en");
        await save(t, SITE, "en", { siteName: "Ana's draft", _rev: read }, ANA);
        const removed = await singlesOf(t).discardWorkingDraftCounted({
          slug: SITE,
          locale: "en",
          version: { _rev: read, _overwrite: true },
        });
        expect(removed).toBe(1);
        expect((await overwritesOf(t, SITE)).map(e => e.payload)).toEqual([
          expect.objectContaining({
            given: "stale",
            replaced: expect.objectContaining({ kind: "person", id: ANA.id }),
          }),
        ]);
      });
    });
  }
);
