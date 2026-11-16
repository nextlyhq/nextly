/**
 * Discarding a Single's shared draft on its own, over REST, on every dialect.
 *
 * A Single's shared part keeps no draft of its own to discard alone yet, so `?part=shared` is
 * refused, and nothing is thrown away. The plausible broken implementation drops the parameter and
 * runs an ordinary discard, which throws away the default language's pending change.
 */
import { afterEach, expect, it } from "vitest";

import { runWithRequestCaller } from "../../../auth/caller-scope";
import { defineSingle, number, text } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";

describeEachDialect("discarding a Single's shared draft over REST", dialect => {
  let t: TestNextly | undefined;

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  /** The Single's pending changes, by the language each is kept under. */
  async function pendingLocales(): Promise<(string | null)[]> {
    const rows = await t!.adapter.select<{ locale: string | null }>(
      "nextly_versions",
      {
        where: {
          and: [
            { column: "scopeSlug", op: "=", value: "site" },
            { column: "versionNo", op: "IS NULL" },
            { column: "isAutosave", op: "=", value: false },
          ],
        },
      }
    );
    return rows.map(row => row.locale).sort();
  }

  it("refuses ?part=shared and keeps the default language's pending change", async () => {
    t = await createTestNextly({
      dialect,
      perLanguageStorage: true,
      collections: [],
      singles: [
        defineSingle({
          slug: "site",
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), number({ name: "views" })],
        }),
      ],
      localization: { locales: ["en", "es"], defaultLocale: "en" },
    });
    const founder = await seedLiveAuthor(t);
    await t.nextly.updateSingle({
      slug: "site",
      locale: "en",
      data: { title: "en", views: 10, status: "published", _overwrite: true },
    } as never);
    // Held as English's pending change, since the Single is live.
    await t.nextly.updateSingle({
      slug: "site",
      locale: "en",
      data: { title: "en 2", _overwrite: true },
    } as never);
    expect(await pendingLocales()).toEqual(["en"]);

    const answer = await runWithRequestCaller(
      {
        userId: founder,
        actor: { type: "user", id: founder },
        roles: ["super-admin"],
      },
      () =>
        (
          dispatchSingles(
            "discardSingleWorkingDraft",
            { slug: "site", part: "shared", _overwrite: "true" } as never,
            undefined
          ) as Promise<Response>
        ).then(
          response => response.status,
          () => 400
        )
    );

    expect(answer).toBeGreaterThanOrEqual(400);
    expect(await pendingLocales()).toEqual(["en"]);
  });
});
