/**
 * That the scope enumeration REFUSES rather than answering an empty list.
 *
 * An empty list is a legitimate answer here - a site with no blocks field
 * anywhere - and completion reads it as finished. So the failure worth testing
 * is not a wrong scope, it is a configuration the wiring could not read being
 * reported as a site with nothing to do, which marks the index whole while
 * every existing document stays unindexed.
 *
 * @module usage-backfill-wiring.test
 */
import { describe, expect, it } from "vitest";

import { backfillScopeKey } from "./usage-backfill-scope";
import {
  backfillScopes,
  backfillSurvey,
  goneSingleScopes,
  type BackfillHost,
} from "./usage-backfill-wiring";
import type { UsageRowReader } from "./usage-count";

const NOT_USED = () => {
  throw new Error("the scope enumeration should not have reached this");
};

function host(over: Partial<BackfillHost>): BackfillHost {
  return {
    nextly: NOT_USED as never,
    collectionSlugs: async () => ["pages"],
    resolveCollection: async () => ({
      fields: [{ name: "content", type: "blocks" }],
    }),
    hasDrafts: () => false,
    singles: async () => [],
    locales: () => [],
    limits: NOT_USED as never,
    db: NOT_USED as never,
    bookkeeping: NOT_USED as never,
    ...over,
  };
}

describe("enumerating the scopes a site currently has", () => {
  it("REFUSES when the collection registry cannot be read", async () => {
    // The direction that destroys: answering `[]` here reports the backfill
    // complete, so every count claims to be whole while nothing was ever
    // walked. A throw costs one tick, because the sweep is re-queued.
    await expect(
      backfillScopes(host({ collectionSlugs: async () => undefined }))
    ).rejects.toThrow(/could not read the collection registry/);
  });

  it("answers an EMPTY list for a site whose collections have no blocks field", async () => {
    // The control on the refusal above, and the case it must not be confused
    // with: this site genuinely has nothing to index, and saying so is correct.
    // Without this, "throw whenever the list is empty" would pass the test
    // above while caveating every count on a site that can never have one.
    const scopes = await backfillScopes(
      host({ resolveCollection: async () => ({ fields: [] }) })
    );

    expect(scopes).toEqual([]);
  });

  it("walks a collection the Schema Builder created, which no config lists", async () => {
    // THE case the configured list cannot reach, and the reason the enumeration
    // reads the registry instead. A Builder-made collection exists only there,
    // so a backfill built from `ctx.config.collections` never creates its
    // scopes — while completion is judged against that same short list and
    // reports the index whole. Its existing documents then have no rows, and
    // every component used only there reads as used by nothing.
    //
    // A control built from code-first collections alone passes either way, so
    // this fixture supplies a slug that is in the registry and in no config.
    const scopes = await backfillScopes(
      host({
        collectionSlugs: async () => ["builder_made"],
        resolveCollection: async () => ({
          fields: [{ name: "content", type: "blocks" }],
        }),
      })
    );

    expect(scopes.map(s => s.entity)).toEqual(["builder_made"]);
  });

  it("skips a slug the registry no longer resolves", async () => {
    // A collection removed while a backfill is in flight is ordinary, and its
    // rows are the delete hook's to clear rather than this pass's to fail on.
    const scopes = await backfillScopes(
      host({
        collectionSlugs: async () => ["pages", "gone"],
        resolveCollection: async slug =>
          slug === "gone"
            ? null
            : { fields: [{ name: "content", type: "blocks" }] },
      })
    );

    expect(scopes.map(s => s.entity)).toEqual(["pages"]);
  });

  it("expands locales and variants from the site's own configuration", async () => {
    // The product is the write path's, so this asserts the wiring FEEDS it
    // correctly rather than re-testing the expansion: two locales and a draft
    // variant make four scopes for one localized field.
    const scopes = await backfillScopes(
      host({
        // BOTH switches. A field is localized only when the collection's own
        // master switch is on as well, so a fixture setting the field alone
        // enumerates two scopes rather than four — which is the wiring being
        // right and the fixture describing a site that does not exist.
        resolveCollection: async () => ({
          localized: true,
          fields: [{ name: "content", type: "blocks", localized: true }],
        }),
        locales: () => ["en", "fr"],
        hasDrafts: () => true,
      })
    );

    expect(scopes).toHaveLength(4);
  });

  it("walks each Single holding blocks, in both forms, under its own scope", async () => {
    const scopes = await backfillScopes(
      host({
        collectionSlugs: async () => [],
        singles: async () => [
          { slug: "home", fields: [{ name: "content", type: "blocks" }] },
        ],
      })
    );

    expect(scopes.map(s => `${s.scope}:${s.entity}:${s.variant}`)).toEqual([
      "single:home:published",
      "single:home:draft",
    ]);
  });

  it("reads a Single whose fields' languages are unknown in every language", async () => {
    // Its field flags are not on the surface a plugin reads, so a field is
    // read per language rather than a translation being missed.
    const scopes = await backfillScopes(
      host({
        collectionSlugs: async () => [],
        singles: async () => [
          {
            slug: "home",
            fields: [{ name: "content", type: "blocks" }],
            localized: true,
            languagesUnknown: true,
          },
        ],
        locales: () => ["en", "fr"],
      })
    );

    expect(
      scopes.filter(s => s.variant === "published").map(s => s.locale)
    ).toEqual(["en", "fr"]);
  });

  it("reads a blocks field in a nameless group per language when a Single's languages are unknown", async () => {
    // The group is presentational, so the field is stored at the top level;
    // marked per language only at the top, it read as shared and a
    // translation's components were missed.
    const scopes = await backfillScopes(
      host({
        collectionSlugs: async () => [],
        singles: async () => [
          {
            slug: "home",
            fields: [
              { type: "group", fields: [{ name: "content", type: "blocks" }] },
            ],
            localized: true,
            languagesUnknown: true,
          },
        ],
        locales: () => ["en", "fr"],
      })
    );

    expect(
      scopes.filter(s => s.variant === "published").map(s => s.locale)
    ).toEqual(["en", "fr"]);
  });

  it("REFUSES when the Singles registry cannot be read", async () => {
    // As for collections: answering no Singles would call a site whose
    // homepage is a Single whole without having walked it.
    await expect(
      backfillScopes(host({ singles: async () => undefined }))
    ).rejects.toThrow(/could not read the Singles registry/);
  });
});

/**
 * Content the scopes cannot cover, reported rather than left absent.
 *
 * A blocks field nested under a named group has no addressable subject, so no
 * scope is enumerated for it. That stays. What changed is that it is no longer
 * SILENT: "every scope walked" is vacuously true for a collection whose only
 * blocks field is nested, and health would report an index that never saw those
 * references as exact — which is the one answer a safe delete must never get.
 */
describe("reporting content no scope can cover", () => {
  it("reports a collection whose ONLY blocks field is nested", async () => {
    const survey = await backfillSurvey(
      host({
        resolveCollection: async () => ({
          fields: [
            {
              type: "group",
              name: "hero",
              fields: [{ type: "blocks", name: "content" }],
            },
          ],
        }),
      })
    );

    // No scope — and the reason no scope exists is now visible.
    expect(survey.scopes).toEqual([]);
    expect(survey.unaddressable).toBe(true);
  });

  it("reports one that sits BESIDE a field it can address", async () => {
    // The case a "did this collection contribute any scopes" check cannot see:
    // the collection walks its own scope to completion and the nested field is
    // still never indexed.
    const survey = await backfillSurvey(
      host({
        resolveCollection: async () => ({
          fields: [
            { type: "blocks", name: "body" },
            {
              type: "group",
              name: "hero",
              fields: [{ type: "blocks", name: "content" }],
            },
          ],
        }),
      })
    );

    expect(survey.scopes.length).toBe(1);
    expect(survey.unaddressable).toBe(true);
  });

  it("reports a Single whose blocks field is nested", async () => {
    const survey = await backfillSurvey(
      host({
        collectionSlugs: async () => [],
        singles: async () => [
          {
            slug: "home",
            fields: [
              {
                type: "group",
                name: "hero",
                fields: [{ type: "blocks", name: "content" }],
              },
            ],
          },
        ],
      })
    );

    expect(survey.unaddressable).toBe(true);
  });

  it("CONTROL: an ordinary site reports nothing out of reach", async () => {
    // Without this, reporting every site as unreachable would satisfy both
    // cases above and withhold completeness from every installation for ever.
    const survey = await backfillSurvey(host({}));

    expect(survey.scopes.length).toBe(1);
    expect(survey.unaddressable).toBe(false);
  });

  it("answers the same scopes as backfillScopes, which is derived from it", async () => {
    const one = host({});
    expect(await backfillScopes(one)).toEqual(
      (await backfillSurvey(one)).scopes
    );
  });
});

describe("finding the rows of Singles that are gone", () => {
  /** A table of `pages` pages of `size` rows, read as the row reader reads it. */
  function rowsOf(pages: number, size: number, last: Record<string, unknown>) {
    const all: Record<string, unknown>[] = [];
    for (let n = 0; n < pages * size; n += 1) {
      all.push({
        id: `r${String(n).padStart(6, "0")}`,
        scope: "single",
        entity: "home",
        field: "content",
        locale: "",
        variant: "published",
      });
    }
    all.push({ ...last, id: "r999999" });
    const asked: (string | undefined)[] = [];
    const rows: UsageRowReader = async args => {
      asked.push(args.after);
      const start =
        args.after === undefined
          ? 0
          : all.findIndex(row => row.id === args.after) + 1;
      const items = all.slice(start, start + size);
      return { items, hasNext: start + size < all.length };
    };
    return { rows, asked };
  }

  const HOME = backfillScopeKey({
    scope: "single",
    entity: "home",
    field: "content",
    locale: "",
    variant: "published",
  });

  it("reads to the end of the table, however many pages that takes", async () => {
    // Past the hundred pages a fixed bound once stopped at, with only the
    // last row naming a Single that is gone.
    const { rows, asked } = rowsOf(150, 2, {
      scope: "single",
      entity: "retired",
      field: "content",
      locale: "",
      variant: "published",
    });

    const gone = await goneSingleScopes(rows, new Set([HOME]));

    expect(gone.map(scope => scope.entity)).toEqual(["retired"]);
    // Each page after the first starts after the last id the one before read.
    expect(asked.slice(0, 3)).toEqual([undefined, "r000001", "r000003"]);
  });

  it("CONTROL: finds nothing gone when every row's Single is live", async () => {
    const { rows } = rowsOf(3, 2, {
      scope: "single",
      entity: "home",
      field: "content",
      locale: "",
      variant: "published",
    });

    expect(await goneSingleScopes(rows, new Set([HOME]))).toEqual([]);
  });
});
