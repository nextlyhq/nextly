// Publishing every language of a Single is an update of it, so the hooks a
// publish of one language runs before it writes run for it too, and any of
// them can refuse it: the Single's `beforeValidate` (its `beforeUpdate`
// queue), a `beforeUpdate` heard on every type, and its `beforeChange`.
//
// The broken implementation this separates from publishes without asking
// them, so a site's rule that refuses a publish through a save of one
// language is passed by publishing every language at once. A refusal must
// leave every language as it was: nothing is written before the hooks run.

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import { resetHookRegistry } from "../../../hooks/hook-registry";
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
  resetHookRegistry();
});

/** What each hook phase was handed, by phase, in the order they ran. */
type Calls = { phase: string; data: Record<string, unknown> }[];

/** A localized Single with a status, whose hooks note what they are handed. */
async function boot(
  dialect: TestDialect,
  calls: Calls,
  refuse: { phase?: string } = {}
): Promise<TestNextly> {
  const note =
    (phase: string) =>
    (context: { data?: unknown }): unknown => {
      calls.push({ phase, data: { ...(context.data as object) } });
      if (refuse.phase === phase) {
        throw NextlyError.forbidden({
          logContext: { refusedBy: `the ${phase} hook` },
        });
      }
      return context.data;
    };
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: "notices",
        localized: true,
        status: true,
        hooks: {
          beforeValidate: [note("beforeValidate")],
          beforeChange: [note("beforeChange")],
        },
        fields: [
          text({
            name: "headline",
            localized: true,
            // Run for the fields a write carries: a move of the status
            // carries none of the Single's own, on either path.
            hooks: {
              beforeChange: [
                ({ value, data }) => {
                  calls.push({
                    phase: "field beforeChange",
                    data: { ...(data as object) },
                  });
                  return value;
                },
              ],
            },
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  // As a plugin's rule hears saves: every type, through the app's registry.
  current.hooks.register("beforeUpdate", "*", context => {
    if (context.collection !== "single:notices") return undefined;
    return note("beforeUpdate (every type)")(context);
  });
  return current;
}

function singlesOf(t: TestNextly): SingleEntryService {
  return t.getService("singleEntryService");
}

/** Both languages saved as drafts, through the real update path. */
async function seedDrafts(t: TestNextly): Promise<void> {
  for (const locale of ["en", "de"]) {
    await singlesOf(t).update(
      "notices",
      { headline: `Draft ${locale}`, status: "draft", _overwrite: true },
      { locale, overrideAccess: true }
    );
  }
}

/** Each stored language's status, read through the adapter on any dialect. */
async function statuses(t: TestNextly): Promise<Record<string, unknown>> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    "single_notices_locales",
    {}
  );
  return Object.fromEntries(rows.map(row => [row._locale, row._status]));
}

describe.each(getConfiguredTestDialects())(
  "publishing every language of a Single runs its before hooks (%s)",
  dialect => {
    it("asks the hooks a publish of one language asks, once, handed the move to published", async () => {
      const calls: Calls = [];
      const t = await boot(dialect, calls);
      await seedDrafts(t);

      // What a publish of one language through a save asks, observed rather
      // than written down here.
      calls.length = 0;
      await singlesOf(t).update(
        "notices",
        { status: "published", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      const oneLanguage = calls.map(call => call.phase);
      expect(oneLanguage).toContain("beforeUpdate (every type)");
      expect(oneLanguage).toContain("beforeValidate");
      expect(oneLanguage).toContain("beforeChange");

      calls.length = 0;
      const res = await singlesOf(t).publishAllLocales("notices", {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(res.success).toBe(true);

      // The same phases in the same order, each once.
      expect(calls.map(call => call.phase)).toEqual(oneLanguage);
      // Each handed the move to published, as a save of `{ status }` is.
      for (const call of calls) expect(call.data.status).toBe("published");
      expect(await statuses(t)).toEqual({ en: "published", de: "published" });
    });

    for (const phase of [
      "beforeUpdate (every type)",
      "beforeValidate",
      "beforeChange",
    ]) {
      it(`is refused by a ${phase} hook that throws, and changes no language`, async () => {
        const calls: Calls = [];
        const refuse: { phase?: string } = {};
        const t = await boot(dialect, calls, refuse);
        await seedDrafts(t);
        // Armed once the drafts are saved, which the same hook would refuse.
        refuse.phase = phase;

        await expect(
          singlesOf(t).publishAllLocales("notices", {
            overrideAccess: true,
            data: { _overwrite: true },
          })
        ).rejects.toMatchObject({ statusCode: 403 });

        expect(await statuses(t)).toEqual({ en: "draft", de: "draft" });
      });
    }

    it("is refused where a hook takes the publish away", async () => {
      const calls: Calls = [];
      const t = await boot(dialect, calls);
      await seedDrafts(t);
      // A rule that keeps this Single a draft, as a save of it is kept one.
      t.hooks.register("beforeUpdate", "single:notices", context => ({
        ...(context.data as object),
        status: "draft",
      }));

      await expect(
        singlesOf(t).publishAllLocales("notices", {
          overrideAccess: true,
          data: { _overwrite: true },
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await statuses(t)).toEqual({ en: "draft", de: "draft" });
    });
  }
);
