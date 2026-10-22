/**
 * Publishing a Single's pending change never puts back a shared value that
 * someone else published after the change began, and publishing every
 * language at once keeps the later save's value where two changes edited one
 * shared field.
 *
 * The collection file has the reasoning; this is the same rule on a Single's
 * two publish paths. Every refusal is paired with what stayed live, and every
 * success with what went live.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, group, number, text } from "../../../config";
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

const SLUG = "site";

async function boot(
  dialect: TestDialect,
  maxPerDoc: number | false = false
): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true, maxPerDoc },
        access: { read: () => true, update: () => true },
        fields: [
          // Translated.
          text({ name: "siteName" }),
          // Shared by every language.
          number({ name: "articleCount" }),
          number({ name: "rating" }),
          // Shared, and neither readable nor writable without a trusted
          // context.
          number({
            name: "internalScore",
            access: { read: () => false, update: () => false },
          }),
          // Shared, with a nested field only a trusted context may write.
          group({
            name: "details",
            fields: [
              text({ name: "label" }),
              text({ name: "note", access: { update: () => false } }),
            ],
          }),
          // Shared, and not writable by a request for Spanish.
          number({
            name: "ranking",
            access: {
              update: ({ locale }: { locale?: string }) => locale !== "es",
            },
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

function save(
  singles: SingleEntryService,
  locale: string,
  data: Record<string, unknown>
) {
  return singles.update(SLUG, data, { locale, overrideAccess: true });
}

async function liveCount(singles: SingleEntryService): Promise<unknown> {
  const res = await singles.get(SLUG, { locale: "en", overrideAccess: true });
  return (res.data as { articleCount?: unknown } | null)?.articleCount;
}

async function liveName(
  singles: SingleEntryService,
  locale: string
): Promise<unknown> {
  const res = await singles.get(SLUG, { locale, overrideAccess: true });
  return (res.data as { siteName?: unknown } | null)?.siteName;
}

async function pendingLocales(): Promise<string[]> {
  const rows = await current!.adapter.select<{ locale: string | null }>(
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

/** How many pending-change bases the Single still pins. */
async function basePinCount(): Promise<number> {
  const rows = await current!.adapter.select<{ id: string }>(
    "nextly_version_pins",
    {
      columns: ["id"],
      where: {
        and: [
          { column: "scopeSlug", op: "=", value: SLUG },
          { column: "holder", op: "=", value: "shared-publish-base" },
        ],
      },
    }
  );
  return rows.length;
}

/** How many of the Single's kept versions hold this count. */
async function versionsHoldingCount(count: number): Promise<number> {
  const rows = await current!.adapter.select<{ snapshot: unknown }>(
    "nextly_versions",
    {
      columns: ["snapshot"],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: "single" },
          { column: "scopeSlug", op: "=", value: SLUG },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NOT NULL" },
        ],
      },
    }
  );
  return rows.filter(row => {
    const snapshot: unknown =
      typeof row.snapshot === "string"
        ? JSON.parse(row.snapshot)
        : row.snapshot;
    return (snapshot as { articleCount?: unknown }).articleCount === count;
  }).length;
}

/** A language's pending change, as stored. */
async function pendingSnapshot(
  locale: string
): Promise<Record<string, unknown>> {
  const rows = await current!.adapter.select<{ snapshot: unknown }>(
    "nextly_versions",
    {
      columns: ["snapshot"],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: "single" },
          { column: "scopeSlug", op: "=", value: SLUG },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "locale", op: "=", value: locale },
        ],
      },
    }
  );
  const snapshot = rows[0]?.snapshot;
  return (
    typeof snapshot === "string" ? JSON.parse(snapshot) : (snapshot ?? {})
  ) as Record<string, unknown>;
}

/** Live in both languages with a count of 10. */
async function live(singles: SingleEntryService): Promise<void> {
  expect(
    (
      await save(singles, "en", {
        siteName: "EN",
        articleCount: 10,
        internalScore: 1,
        rating: 1,
        status: "published",
      })
    ).success
  ).toBe(true);
  expect(
    (await save(singles, "es", { siteName: "ES", status: "published" })).success
  ).toBe(true);
  expect(
    (await save(singles, "fr", { siteName: "FR", status: "published" })).success
  ).toBe(true);
}

async function liveShared(
  singles: SingleEntryService
): Promise<{ articleCount: unknown; rating: unknown }> {
  const res = await singles.get(SLUG, { locale: "en", overrideAccess: true });
  const data = res.data as { articleCount?: unknown; rating?: unknown };
  return { articleCount: data.articleCount, rating: data.rating };
}

/** English begins a change at 10; Spanish then publishes 13. */
async function spanishPublishesThirteen(
  singles: SingleEntryService
): Promise<void> {
  await live(singles);
  expect((await save(singles, "en", { siteName: "EN edited" })).success).toBe(
    true
  );
  expect((await save(singles, "es", { articleCount: 13 })).success).toBe(true);
  expect((await save(singles, "es", { status: "published" })).success).toBe(
    true
  );
  expect(await liveCount(singles)).toBe(13);
}

describe.each(getConfiguredTestDialects())(
  "publishing a Single's pending change on %s",
  dialect => {
    it("refuses an English change older than Spanish's publish, naming the count, and keeps 13", async () => {
      const singles = await boot(dialect);
      await spanishPublishesThirteen(singles);

      const refused = await save(singles, "en", { status: "published" });

      expect({
        success: refused.success,
        statusCode: refused.statusCode,
        publicData: refused.publicData,
      }).toEqual({
        success: false,
        statusCode: 409,
        publicData: {
          reason: "shared-fields-out-of-date",
          fields: ["articleCount"],
        },
      });
      expect(await liveCount(singles)).toBe(13);
      expect(await liveName(singles, "en")).toBe("EN");
      expect(await pendingLocales()).toEqual(["en"]);
    });

    it("publishes once English takes the live values, and keeps 13", async () => {
      const singles = await boot(dialect);
      await spanishPublishesThirteen(singles);

      const taken = await singles.takeLiveSharedValues({
        slug: SLUG,
        locale: "en",
        overrideAccess: true,
      });
      expect(taken.success).toBe(true);
      const published = await save(singles, "en", { status: "published" });

      expect(published.success).toBe(true);
      expect(await liveCount(singles)).toBe(13);
      expect(await liveName(singles, "en")).toBe("EN edited");
    });

    it("counts a protected shared field without naming it", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "en", { siteName: "EN edited" })).success
      ).toBe(true);
      // Spanish publishes a new count and a new protected score.
      expect(
        (await save(singles, "es", { articleCount: 13, internalScore: 2 }))
          .success
      ).toBe(true);
      expect((await save(singles, "es", { status: "published" })).success).toBe(
        true
      );

      // A routed request: trusted, but answering to the caller's field read
      // rules, which no caller here passes for the score.
      const refused = await singles.update(
        SLUG,
        { status: "published" },
        { locale: "en", overrideAccess: true, routeAuthorized: true }
      );

      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
        hiddenCount: 1,
      });
    });

    it("refuses publishing every language while one change is out of date, and keeps 13", async () => {
      const singles = await boot(dialect);
      await spanishPublishesThirteen(singles);

      // Publishing every language throws its refusals, as its schema gate does.
      await expect(
        singles.publishAllLocales(SLUG, { overrideAccess: true })
      ).rejects.toMatchObject({
        statusCode: 409,
        publicData: {
          reason: "shared-fields-out-of-date",
          fields: ["articleCount"],
        },
      });
      expect(await liveCount(singles)).toBe(13);
      expect(await pendingLocales()).toEqual(["en"]);
    });

    it.each([
      ["English", "en", "es"],
      ["Spanish", "es", "en"],
    ])(
      "keeps the later save's count when every language is published together (%s saved last)",
      async (_label, last, other) => {
        const singles = await boot(dialect);
        await live(singles);
        // The language saved last began its change first, so its pending row
        // is the older one: the order the rows come back in is not the order
        // the saves were made in. All inside a second or two.
        expect((await save(singles, last, { articleCount: 20 })).success).toBe(
          true
        );
        expect((await save(singles, other, { articleCount: 21 })).success).toBe(
          true
        );
        expect((await save(singles, last, { articleCount: 22 })).success).toBe(
          true
        );
        expect(await pendingLocales()).toEqual(["en", "es"]);

        const published = await singles.publishAllLocales(SLUG, {
          overrideAccess: true,
        });

        expect(published.success).toBe(true);
        expect(await liveCount(singles)).toBe(22);
        expect(await pendingLocales()).toEqual([]);
        // Their bases went with them.
        expect(await basePinCount()).toBe(0);
      }
    );

    it("takes only the shared values the caller may write, and leaves the base where it was", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "en", { siteName: "EN edited" })).success
      ).toBe(true);
      expect(
        (await save(singles, "es", { articleCount: 13, internalScore: 2 }))
          .success
      ).toBe(true);
      expect((await save(singles, "es", { status: "published" })).success).toBe(
        true
      );

      // A caller the field rules apply to: the score is neither theirs to
      // write nor to read.
      const taken = await singles.takeLiveSharedValues({
        slug: SLUG,
        locale: "en",
        overrideAccess: false,
        user: { id: "u1" },
      });

      expect(taken.data).toEqual({
        taken: ["articleCount"],
        outOfDate: [],
        hiddenOutOfDate: 1,
      });
      // The score is still out of date: taking the count did not make the
      // old score look current.
      const refused = await save(singles, "en", { status: "published" });
      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({
        reason: "shared-fields-out-of-date",
        fields: ["internalScore"],
      });
    });

    it("doesn't take a shared group holding a nested field the caller may not write, and keeps the change's value", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (
          await save(singles, "en", {
            details: { label: "L", note: "N" },
            status: "published",
          })
        ).success
      ).toBe(true);
      // English's change holds a trusted edit of the protected note.
      expect(
        (
          await save(singles, "en", {
            siteName: "EN edited",
            details: { label: "L", note: "admin edit" },
          })
        ).success
      ).toBe(true);
      expect(
        (await save(singles, "es", { details: { label: "L2", note: "N" } }))
          .success
      ).toBe(true);
      expect((await save(singles, "es", { status: "published" })).success).toBe(
        true
      );

      const taken = await singles.takeLiveSharedValues({
        slug: SLUG,
        locale: "en",
        overrideAccess: false,
        user: { id: "u1" },
      });

      expect(taken.data).toEqual({ taken: [], outOfDate: ["details"] });
      expect(
        (await pendingSnapshot("en")).details as { note?: unknown }
      ).toMatchObject({ note: "admin edit" });
    });

    it("judges taking the live values by the rules of the language asked for", async () => {
      const singles = await boot(dialect);
      await live(singles);
      // Spanish begins a change; English then publishes a new ranking.
      expect(
        (await save(singles, "es", { siteName: "ES edited" })).success
      ).toBe(true);
      expect(
        (await save(singles, "en", { ranking: 5, status: "published" })).success
      ).toBe(true);

      const taken = await singles.takeLiveSharedValues({
        slug: SLUG,
        locale: "es",
        overrideAccess: false,
        user: { id: "u1" },
      });

      // The ranking's rule refuses a write for Spanish, so it isn't taken.
      expect(taken.data).toEqual({ taken: [], outOfDate: ["ranking"] });
    });

    // Every case publishes all three languages at once.
    type Step = [locale: string, data: Record<string, unknown>];
    const publishAllCases: [
      label: string,
      steps: Step[],
      expected: { articleCount: unknown; rating: unknown },
    ][] = [
      [
        "disjoint shared edits keep both",
        [
          ["en", { articleCount: 11 }],
          ["es", { rating: 5 }],
          ["fr", { siteName: "FR edited" }],
        ],
        { articleCount: 11, rating: 5 },
      ],
      [
        "the same field keeps the later save",
        [
          ["en", { articleCount: 11 }],
          ["es", { articleCount: 12 }],
          ["fr", { siteName: "FR edited" }],
        ],
        { articleCount: 12, rating: 1 },
      ],
      [
        "a later translation-only save keeps an earlier shared edit",
        [
          ["es", { siteName: "ES edited" }],
          ["en", { articleCount: 20 }],
          ["es", { siteName: "ES edited again" }],
          ["fr", { siteName: "FR edited" }],
        ],
        { articleCount: 20, rating: 1 },
      ],
      [
        "an earlier shared edit loses to a later one though its language saved last",
        [
          ["en", { articleCount: 11 }],
          ["es", { articleCount: 12 }],
          // English saves again, its words only: its count is still the
          // older edit.
          ["en", { siteName: "EN edited" }],
          ["fr", { siteName: "FR edited" }],
        ],
        { articleCount: 12, rating: 1 },
      ],
      [
        "a later shared edit wins though the earlier language saved last",
        [
          ["es", { rating: 6 }],
          ["en", { rating: 7 }],
          // Spanish saves again, its words only.
          ["es", { siteName: "ES edited" }],
          ["fr", { siteName: "FR edited" }],
        ],
        { articleCount: 10, rating: 7 },
      ],
    ];

    it.each(publishAllCases)(
      "publishing every language: %s",
      async (_label, steps, expected) => {
        const singles = await boot(dialect);
        await live(singles);
        for (const [locale, data] of steps) {
          expect((await save(singles, locale, data)).success).toBe(true);
        }

        const published = await singles.publishAllLocales(SLUG, {
          overrideAccess: true,
        });

        expect(published.success).toBe(true);
        expect(await liveShared(singles)).toEqual(expected);
        expect(await pendingLocales()).toEqual([]);
      }
    );

    // English edits the count, then Spanish edits it later; saves of words
    // follow until retention has removed both edits. Each case says how many
    // kept versions still hold each count.
    const unorderedCases: [
      label: string,
      maxPerDoc: number,
      steps: Step[],
      kept: { english: number; spanish: number },
    ][] = [
      [
        "only English's later saves keep its count",
        3,
        [
          ["en", { articleCount: 11 }],
          ["es", { articleCount: 12 }],
          ["en", { siteName: "EN 2" }],
          ["en", { siteName: "EN 3" }],
          ["en", { siteName: "EN 4" }],
        ],
        { english: 3, spanish: 0 },
      ],
      [
        "both counts survive only in later saves, English's the newer",
        4,
        [
          ["en", { articleCount: 11 }],
          ["es", { articleCount: 12 }],
          ["es", { siteName: "ES 2" }],
          ["es", { siteName: "ES 3" }],
          ["en", { siteName: "EN 2" }],
          ["en", { siteName: "EN 3" }],
        ],
        { english: 2, spanish: 2 },
      ],
    ];

    it.each(unorderedCases)(
      "publishing every language refuses edits of one field history can no longer order (%s), and keeps live",
      async (_label, maxPerDoc, steps, kept) => {
        const singles = await boot(dialect, maxPerDoc);
        await live(singles);
        for (const [locale, data] of steps) {
          expect((await save(singles, locale, data)).success).toBe(true);
        }
        // Both edits are gone from history.
        expect({
          english: await versionsHoldingCount(11),
          spanish: await versionsHoldingCount(12),
        }).toEqual(kept);

        await expect(
          singles.publishAllLocales(SLUG, { overrideAccess: true })
        ).rejects.toMatchObject({
          statusCode: 409,
          publicData: {
            reason: "shared-edits-unordered",
            fields: ["articleCount"],
          },
        });
        // Neither count was guessed into place.
        expect(await liveCount(singles)).toBe(10);
        expect(await pendingLocales()).toEqual(["en", "es"]);
      }
    );

    it("publishing every language refuses a change whose base is behind live, and keeps live", async () => {
      // Spanish and French begin at 10; English publishes 30 on its own; then
      // every language is published with the older changes still pending.
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "es", { siteName: "ES edited" })).success
      ).toBe(true);
      expect((await save(singles, "fr", { rating: 7 })).success).toBe(true);
      expect((await save(singles, "en", { articleCount: 30 })).success).toBe(
        true
      );
      expect((await save(singles, "en", { status: "published" })).success).toBe(
        true
      );

      await expect(
        singles.publishAllLocales(SLUG, { overrideAccess: true })
      ).rejects.toMatchObject({
        statusCode: 409,
        publicData: {
          reason: "shared-fields-out-of-date",
          fields: ["articleCount"],
        },
      });
      // Nothing stale won, and nothing else moved either.
      expect(await liveShared(singles)).toEqual({
        articleCount: 30,
        rating: 1,
      });
      expect(await pendingLocales()).toEqual(["es", "fr"]);
    });
  }
);
