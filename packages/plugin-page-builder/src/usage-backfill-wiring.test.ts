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
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { installContext } from "./plugin";
import {
  backfillScopeKey,
  GONE_SCOPES_SWEPT_KEY,
} from "./usage-backfill-scope";
import {
  backfillScopes,
  backfillSurvey,
  forgetGoneScopes,
  goneScopes,
  hostGeneration,
  type BackfillHost,
} from "./usage-backfill-wiring";
import type { UsageRowReader } from "./usage-count";

const runtime = vi.hoisted(() => ({ requireNextly: vi.fn() }));
vi.mock("nextly/runtime", () => runtime);

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

  describe("a Single referencing a field group", () => {
    const referencing = {
      collectionSlugs: async () => [],
      singles: async () => [
        {
          slug: "home",
          fields: [
            { type: "text", name: "headline" },
            { type: "component", name: "card", component: "link-card" },
          ],
        },
      ],
    };
    const declaring = (fields: unknown[]) => async () => (slug: string) =>
      slug === "link-card" ? { fields } : undefined;

    it("leaves nothing out of reach when the group is declared with no blocks field", async () => {
      const survey = await backfillSurvey(
        host({
          ...referencing,
          fieldGroups: declaring([{ type: "text", name: "heading" }]),
        })
      );
      expect(survey.unaddressable).toBe(false);
    });

    it("stays out of reach when the declared group holds a blocks field", async () => {
      const survey = await backfillSurvey(
        host({
          ...referencing,
          fieldGroups: declaring([{ type: "blocks", name: "body" }]),
        })
      );
      expect(survey.unaddressable).toBe(true);
    });

    it("stays out of reach when the site does not declare the group", async () => {
      const survey = await backfillSurvey(
        host({ ...referencing, fieldGroups: async () => () => undefined })
      );
      expect(survey.unaddressable).toBe(true);
    });

    it("reads the definitions once for each survey, and again for the next", async () => {
      // The per-survey read is what a group gaining a blocks field after boot
      // depends on; once per survey is what keeps a site with many documents
      // from re-reading the registry for each.
      let definition: unknown[] = [{ type: "text", name: "heading" }];
      let reads = 0;
      const site = host({
        ...referencing,
        singles: async () => [
          ...(await referencing.singles()),
          {
            slug: "about",
            fields: [
              { type: "component", name: "card", component: "link-card" },
            ],
          },
        ],
        fieldGroups: async () => {
          reads += 1;
          return slug =>
            slug === "link-card" ? { fields: definition } : undefined;
        },
      });

      expect((await backfillSurvey(site)).unaddressable).toBe(false);
      expect(reads).toBe(1);

      definition = [{ type: "blocks", name: "body" }];
      expect((await backfillSurvey(site)).unaddressable).toBe(true);
      expect(reads).toBe(2);
    });
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

/**
 * The installed plugin's own answer, through the host it builds: what decides
 * whether the survey sees a field group as it is now or as it was at boot.
 */
describe("the field groups an installed site's survey reads", () => {
  const HOLDS_TEXT = [{ type: "text", name: "heading" }];
  const HOLDS_BLOCKS = [{ type: "blocks", name: "body" }];

  /** The registry's answer: one group, whatever fields it holds now. */
  const listing = (fields: unknown[]) => ({
    items: [{ slug: "link-card", fields }],
    meta: { total: 1, hasNext: false },
  });

  /**
   * A site with one Single placing the group `link-card`, whose code declares
   * the groups in `inCode` and never changes after this runs.
   */
  function installed(find: () => Promise<unknown>, inCode: unknown[]) {
    const warn = vi.fn();
    runtime.requireNextly.mockReturnValue({ fieldGroups: { find } });
    const site = installContext(
      {
        config: { fieldGroups: inCode, singles: [] },
        logger: { warn },
        services: {
          collections: {
            listCollections: async () => ({
              data: [],
              pagination: { total: 0, hasMore: false },
            }),
          },
          singles: {
            list: async () => ({
              data: [
                {
                  slug: "home",
                  fields: [
                    { type: "component", name: "card", component: "link-card" },
                  ],
                },
              ],
              total: 1,
            }),
          },
        },
      } as never,
      {}
    );
    return { site, warn };
  }

  const DECLARED_TEXT = [{ slug: "link-card", fields: HOLDS_TEXT }];

  it("sees a group the registry now says holds a blocks field, though the code it booted with did not", async () => {
    // A reload syncs the registry and does not run `init` again, so the
    // config this host was built from still says the group is plain. Asked of
    // that, the survey reports nothing out of reach and a shared style those
    // blocks use could be deleted as unused.
    let fields = HOLDS_TEXT;
    const { site } = installed(async () => listing(fields), DECLARED_TEXT);

    expect((await backfillSurvey(site)).unaddressable).toBe(false);

    fields = HOLDS_BLOCKS;
    expect((await backfillSurvey(site)).unaddressable).toBe(true);
  });

  it("keeps a group out of reach when the registry cannot be read, whatever the code says", async () => {
    const { site, warn } = installed(async () => {
      throw new Error("the registry is unavailable");
    }, DECLARED_TEXT);

    expect((await backfillSurvey(site)).unaddressable).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps a reference out of reach when neither the registry nor the code knows the group", async () => {
    const { site } = installed(
      async () => ({ items: [], meta: { total: 0, hasNext: false } }),
      []
    );

    expect((await backfillSurvey(site)).unaddressable).toBe(true);
  });
});

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
    // The predicate honoured as the table store honours it, so a sweep
    // that asks a narrower question reads fewer rows here too.
    const matching = all.filter(row =>
      Object.entries(args.where).every(([column, predicate]) =>
        "equals" in predicate
          ? row[column] === predicate.equals
          : predicate.in.includes(String(row[column]))
      )
    );
    const start =
      args.after === undefined
        ? 0
        : matching.findIndex(row => row.id === args.after) + 1;
    const items = matching.slice(start, start + size);
    return { items, hasNext: start + size < matching.length };
  };
  return { rows, asked };
}

describe("finding the rows of scopes that are gone", () => {
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

    const gone = await goneScopes(rows, new Set([HOME]));

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

    expect(await goneScopes(rows, new Set([HOME]))).toEqual([]);
  });

  it("finds a collection's scope that is gone, as a Single's", async () => {
    // A collection that lost its blocks field, or stopped storing it in a
    // language, leaves rows no walk visits, as a removed Single does.
    const { rows } = rowsOf(2, 2, {
      scope: "collection",
      entity: "pages",
      field: "content",
      locale: "fr",
      variant: "published",
    });

    const gone = await goneScopes(rows, new Set([HOME]));

    expect(gone).toEqual([
      {
        scope: "collection",
        entity: "pages",
        field: "content",
        locale: "fr",
        variant: "published",
      },
    ]);
  });
});

describe("forgetting the scopes that are gone", () => {
  it("reads nothing on a swept run's later pass when nothing it recorded is gone", async () => {
    // The sweep runs on every jobs pass; reading every row of both tables
    // each time would cost a site whose content stays put a table scan a pass.
    const fenced: unknown[] = [];
    const host = new Proxy({} as BackfillHost, {
      get: (_target, name) => {
        throw new Error(`the cleanup read the host's ${String(name)}`);
      },
    });
    const home = {
      scope: "single" as const,
      entity: "home",
      field: "content",
      locale: "",
      variant: "published" as const,
    };

    await forgetGoneScopes(
      host,
      [home],
      async write => {
        fenced.push(write);
        return undefined as never;
      },
      {
        completed: new Set([backfillScopeKey(home), GONE_SCOPES_SWEPT_KEY]),
        markSwept: async () => {
          throw new Error("a swept run recorded its sweep again");
        },
      }
    );

    expect(fenced).toEqual([]);
  });

  it("sweeps a run with nothing left to walk, whose progress names no scope", async () => {
    // A failed write started a new run, discarding the old one's progress,
    // and the site's last blocks field went: no scope to walk, no progress
    // naming one, and rows of the removed field still in the table. The
    // absence of progress is no proof the tables are clean.
    const fenced: unknown[] = [];
    let swept = 0;
    const host = {
      collectionSlugs: async () => [],
      singles: async () => [],
      locales: () => [],
    } as unknown as BackfillHost;
    const { rows } = rowsOf(1, 1, {
      scope: "collection",
      entity: "pages",
      field: "content",
      locale: "",
      variant: "published",
    });

    await forgetGoneScopes(
      host,
      [],
      async write => {
        fenced.push(write);
        return undefined as never;
      },
      {
        completed: new Set(),
        markSwept: async () => {
          swept += 1;
        },
      },
      () => rows
    );

    // Both scopes the table holds rows for, the Single's and the removed
    // field's, are named by nothing now: each is forgotten in its own fenced
    // transaction, and the run records its sweep.
    expect(fenced).toHaveLength(2);
    expect(swept).toBe(1);
  });
});

describe("every usage index the backfill fills", () => {
  it("reads every index's table for gone scopes, the variables' included", async () => {
    const read: string[] = [];
    await forgetGoneScopes(
      host({ collectionSlugs: async () => [] }),
      [],
      async () => undefined as never,
      { completed: new Set(), markSwept: async () => undefined },
      table => {
        read.push(table.name);
        return async () => ({ items: [], hasNext: false });
      }
    );

    expect(read).toEqual([
      "page_builder__class_usage",
      "page_builder__component_usage",
      "page_builder__token_usage",
    ]);
  });

  it("names every index's table in the generation, so a new index is walked", () => {
    expect(
      hostGeneration(host({ limits: () => DEFAULT_LIMITS })).split("|")
    ).toEqual(
      expect.arrayContaining([
        "page_builder__class_usage",
        "page_builder__component_usage",
        "page_builder__token_usage",
      ])
    );
  });
});
