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

import { backfillScopes, type BackfillHost } from "./usage-backfill-wiring";

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
    locales: () => [],
    limits: NOT_USED as never,
    slugs: NOT_USED as never,
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
});
