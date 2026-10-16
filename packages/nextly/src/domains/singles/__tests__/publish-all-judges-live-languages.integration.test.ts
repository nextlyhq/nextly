// Publishing every language judges the languages already live, when a pending
// change rewrites what they share.
//
// A pending change of one language can carry shared values, which go to the
// main row and so into every language's document. A language already live is
// changed by it as surely as one going live, so a rule that reads a
// translated sibling is asked of it too.

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

async function boot(): Promise<SingleEntryService> {
  current = await createTestNextly({
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "siteName", localized: true }),
          text({
            name: "region",
            localized: false,
            // Shared, and judged against the language's own translation.
            validate: (value: unknown, { data }) =>
              !(value === "eu" && data.siteName === "Hallo") ||
              "region eu cannot go with siteName Hallo",
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

describe("publishing every language of a Single", () => {
  it("refuses a pending shared value that makes a language already live invalid", async () => {
    const singles = await boot();
    for (const [locale, siteName] of [
      ["en", "Hello"],
      ["de", "Hallo"],
    ] as const) {
      const live = await singles.update(
        SLUG,
        { siteName, region: "us", status: "published" },
        { locale, overrideAccess: true }
      );
      expect(live.success, JSON.stringify(live)).toBe(true);
    }
    // Held as English's pending change, and valid for English.
    const held = await singles.update(
      SLUG,
      { region: "eu" },
      { locale: "en", overrideAccess: true }
    );
    expect(held.success, JSON.stringify(held)).toBe(true);

    let refused: unknown;
    await singles
      .publishAllLocales(SLUG, { overrideAccess: true })
      .catch(error => (refused = error));

    expect(
      (
        refused as { publicData?: { errors?: { path: string }[] } } | undefined
      )?.publicData?.errors?.map(issue => issue.path)
    ).toEqual(["region"]);
  });
});
