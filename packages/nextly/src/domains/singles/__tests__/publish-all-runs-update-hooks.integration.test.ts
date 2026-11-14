// Publishing every language of a Single is an update of it, so the hooks an
// update runs once it is durable run for it too: the Single's own
// `afterChange` (its update phase), a plugin's `afterUpdate` heard on every
// type, and the fields' `afterChange`.
//
// The broken implementation this separates from is the one that publishes
// and tells no one: the languages go live, the cache flushes, and every
// integration that follows saves through these hooks (a search index, a
// content date, a problem check) keeps what it last saw. A publish of one
// language through the update path runs them; a publish of every language
// must not be the one way past them.

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // A Single's hooks register into the global registry.
  resetHookRegistry();
});

interface Heard {
  collection?: string;
  operation?: string;
  data?: Record<string, unknown>;
  originalData?: Record<string, unknown>;
}

async function boot(heard: {
  own: Heard[];
  everyType: Heard[];
  field: unknown[];
}): Promise<TestNextly> {
  current = await createTestNextly({
    singles: [
      defineSingle({
        slug: "preferences",
        localized: true,
        status: true,
        hooks: {
          afterChange: [
            context => {
              heard.own.push({
                collection: context.collection,
                operation: context.operation,
                data: context.data as Record<string, unknown>,
                originalData: context.originalData as Record<string, unknown>,
              });
              return context.data;
            },
          ],
        },
        fields: [
          text({
            name: "siteName",
            localized: true,
            hooks: {
              afterChange: [
                ({ value }) => {
                  heard.field.push(value);
                  return value;
                },
              ],
            },
          }),
          text({ name: "region", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  // As a plugin hears saves: every type, through the registry the app runs.
  current.hooks.register("afterUpdate", "*", context => {
    heard.everyType.push({
      collection: context.collection,
      operation: context.operation,
      data: context.data as Record<string, unknown>,
    });
    return undefined;
  });
  return current;
}

function singlesOf(t: TestNextly): SingleEntryService {
  return t.getService("singleEntryService");
}

/** Both languages written as drafts, through the real update path. */
async function seedDrafts(t: TestNextly): Promise<string> {
  const singles = singlesOf(t);
  const en = await singles.update(
    "preferences",
    { siteName: "Prefs EN", region: "eu", status: "draft", _overwrite: true },
    { locale: "en", overrideAccess: true }
  );
  await singles.update(
    "preferences",
    { siteName: "Prefs DE", status: "draft", _overwrite: true },
    { locale: "de", overrideAccess: true }
  );
  return String(en.data?.id);
}

describe("publishing every language of a Single runs its update hooks", () => {
  it("hands the published document to the Single's, a plugin's and the fields' hooks", async () => {
    const heard = { own: [] as Heard[], everyType: [] as Heard[], field: [] };
    const t = await boot(heard);
    const id = await seedDrafts(t);
    // What the seeding saves ran is not what this test is about.
    heard.own.length = 0;
    heard.everyType.length = 0;
    heard.field.length = 0;

    const res = await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: true,
      data: { _overwrite: true },
    });
    expect(res.success).toBe(true);

    // Once, for the one publish, as an update of the Single.
    expect(heard.own).toHaveLength(1);
    const [own] = heard.own;
    expect(own.collection).toBe("single:preferences");
    expect(own.operation).toBe("update");
    expect(String(own.data?.id)).toBe(id);
    // The document as the publish left it, read in the default language,
    // against the document as it stood before.
    expect(own.data?.status).toBe("published");
    expect(own.data?.siteName).toBe("Prefs EN");
    expect(own.originalData?.status).toBe("draft");

    // A plugin hearing every type's saves is told under the Single's key.
    expect(heard.everyType).toHaveLength(1);
    expect(heard.everyType[0]?.collection).toBe("single:preferences");
    expect(String(heard.everyType[0]?.data?.id)).toBe(id);

    // The fields' change hooks run as an update runs them.
    expect(heard.field).toEqual(["Prefs EN"]);
  });

  it("hands a promoted change's hooks the document as it stood before, where nothing else reads it", async () => {
    // A Single that records no events and has no in-transaction handler: the
    // update hooks are the only ones handed the document before the publish,
    // so nothing else would have read it before the promotion rewrote it.
    const own: Heard[] = [];
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "notices",
          localized: true,
          status: true,
          versions: { drafts: true },
          webhooks: { record: false },
          hooks: {
            afterChange: [
              context => {
                own.push({
                  data: context.data as Record<string, unknown>,
                  originalData: context.originalData as Record<string, unknown>,
                });
                return context.data;
              },
            ],
          },
          fields: [text({ name: "headline", localized: true })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles = singlesOf(current);
    for (const locale of ["en", "de"]) {
      await singles.update(
        "notices",
        { headline: `Live ${locale}`, status: "published", _overwrite: true },
        { locale, overrideAccess: true }
      );
    }
    // A pending change of the live English text, held until published.
    await singles.update(
      "notices",
      { headline: "Edited en", _overwrite: true },
      { locale: "en", overrideAccess: true }
    );
    own.length = 0;

    const res = await singles.publishAllLocales("notices", {
      overrideAccess: true,
      data: { _overwrite: true },
    });
    expect(res.success).toBe(true);

    expect(own).toHaveLength(1);
    expect(own[0]?.data?.headline).toBe("Edited en");
    // Before the publish, readers saw the live text, not the change.
    expect(own[0]?.originalData?.headline).toBe("Live en");
  });

  it("runs none of them for a publish that is refused", async () => {
    const heard = { own: [] as Heard[], everyType: [] as Heard[], field: [] };
    const t = await boot(heard);
    await seedDrafts(t);
    heard.own.length = 0;
    heard.everyType.length = 0;
    heard.field.length = 0;

    // Asked with no one signed in, who never publishes: refused before
    // anything is written.
    const res = await singlesOf(t).publishAllLocales("preferences", {
      overrideAccess: false,
      data: { _overwrite: true },
    });
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(401);

    expect(heard.own).toHaveLength(0);
    expect(heard.everyType).toHaveLength(0);
    expect(heard.field).toHaveLength(0);
  });
});
