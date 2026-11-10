/**
 * Who may read the stored site style through the editor's route, and what
 * they are answered.
 *
 * The permission questions are asked of a recording caller, so each test
 * states exactly which grants the caller holds; the dispatcher and the real
 * permission reads are the integration suite's (`site-style-read`).
 *
 * @module site-style-route.test
 */
import { describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "./collections/components";
import { PAGES_SLUG } from "./collections/pages";
import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";
import {
  mayReadSiteStyle,
  readSiteStyleForEditor,
  type SiteStyleRouteContext,
} from "./site-style-route";
import { SITE_STYLE_SLUG } from "./site-style-storage";
import { SPACING_MODE_SERVICE } from "./spacing-mode-reader";

const blocks = (name: string) => ({ name, type: "blocks" });

/** A caller holding exactly `grants`, each spelled `action-resource`. */
function context(
  grants: readonly string[],
  registry: {
    collections?: readonly unknown[];
    singles?: readonly unknown[];
    renamed?: Record<string, string>;
    /** The Singles configuration declares; every listed one when absent. */
    declared?: unknown;
  } = {}
): SiteStyleRouteContext & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    config: {
      singles:
        "declared" in registry
          ? registry.declared
          : (registry.singles ?? []).map(row => ({
              slug: (row as { slug: string }).slug,
            })),
    },
    self: {
      collections: { ...registry.renamed },
      singles: {},
    },
    caller: {
      can: async (action, resource) => {
        asked.push(`${action}-${resource}`);
        return grants.includes(`${action}-${resource}`);
      },
    },
    services: {
      collections: {
        listCollections: async () => ({
          data: [...(registry.collections ?? [])],
          pagination: { hasMore: false },
        }),
      },
      singles: {
        list: async () => ({
          data: [...(registry.singles ?? [])],
          total: registry.singles?.length ?? 0,
        }),
      },
    },
  };
}

describe("who may read the site style through the editor's route", () => {
  it("refuses a caller nobody identified", async () => {
    const ctx = { ...context([]), caller: null };
    expect(await mayReadSiteStyle(ctx, {})).toBe(false);
  });

  it("admits a caller holding Design's read without asking anything else", async () => {
    const ctx = context([`read-${SITE_STYLE_SLUG}`]);
    expect(await mayReadSiteStyle(ctx, {})).toBe(true);
    expect(ctx.asked).toEqual([`read-${SITE_STYLE_SLUG}`]);
  });

  it("admits an author who may update pages", async () => {
    expect(await mayReadSiteStyle(context([`update-${PAGES_SLUG}`]), {})).toBe(
      true
    );
  });

  it("asks about pages under the name the host gave them", async () => {
    const renamed = { [PAGES_SLUG]: "site-pages" };
    expect(
      await mayReadSiteStyle(context(["update-site-pages"], { renamed }), {})
    ).toBe(true);
    expect(
      await mayReadSiteStyle(context([`update-${PAGES_SLUG}`], { renamed }), {})
    ).toBe(false);
  });

  it("admits an author who may update components, in the store they live in", async () => {
    expect(
      await mayReadSiteStyle(context([`update-${COMPONENTS_SLUG}`]), {})
    ).toBe(true);
    expect(
      await mayReadSiteStyle(context(["update-widgets"]), {
        collection: "widgets",
      })
    ).toBe(true);
  });

  it("admits an author who may update another collection the builder opens", async () => {
    const collections = [
      { slug: "articles", fields: [{ name: "title" }, blocks("body")] },
    ];
    expect(
      await mayReadSiteStyle(context(["update-articles"], { collections }), {})
    ).toBe(true);
  });

  it("admits an author who may update a collection whose only blocks field is in a repeater's rows", async () => {
    // The builder opens that field row by row, so its editors need the site
    // style as much as an editor of a top-level field does.
    const collections = [
      {
        slug: "landing",
        fields: [
          { name: "sections", type: "repeater", fields: [blocks("body")] },
        ],
      },
    ];
    expect(
      await mayReadSiteStyle(context(["update-landing"], { collections }), {})
    ).toBe(true);
  });

  it("refuses for a repeater whose rows declare their own id, which the builder cannot open", async () => {
    const collections = [
      {
        slug: "landing",
        fields: [
          {
            name: "sections",
            type: "repeater",
            fields: [{ name: "id", type: "text" }, blocks("body")],
          },
        ],
      },
    ];
    expect(
      await mayReadSiteStyle(context(["update-landing"], { collections }), {})
    ).toBe(false);
  });

  it("admits an author who may update a Single holding a blocks field", async () => {
    const singles = [{ slug: "homepage", fields: [blocks("content")] }];
    expect(
      await mayReadSiteStyle(context(["update-homepage"], { singles }), {})
    ).toBe(true);
  });

  it("refuses the former editor of a code-first Single configuration no longer declares", async () => {
    // A removed Single's registry row stays readable, and so do the role
    // grants on its permission; neither is a document the builder opens now.
    const singles = [
      { slug: "old-home", source: "code", fields: [blocks("content")] },
    ];
    expect(
      await mayReadSiteStyle(
        context(["update-old-home"], { singles, declared: [] }),
        {}
      )
    ).toBe(false);
  });

  it("admits the editor of a code-first Single configuration declares", async () => {
    const singles = [
      { slug: "homepage", source: "code", fields: [blocks("content")] },
    ];
    expect(
      await mayReadSiteStyle(
        context(["update-homepage"], {
          singles,
          declared: [{ slug: "homepage" }],
        }),
        {}
      )
    ).toBe(true);
  });

  it("admits the editor of a Single built in the admin, which no configuration declares", async () => {
    const singles = [
      { slug: "landing", source: "ui", fields: [blocks("content")] },
    ];
    expect(
      await mayReadSiteStyle(
        context(["update-landing"], { singles, declared: [] }),
        {}
      )
    ).toBe(true);
  });

  it("refuses a code-first Single when configuration's Singles cannot be read", async () => {
    // Unable to tell a live Single from a removed one, the gate refuses.
    const singles = [
      { slug: "homepage", source: "code", fields: [blocks("content")] },
    ];
    expect(
      await mayReadSiteStyle(
        context(["update-homepage"], { singles, declared: undefined }),
        {}
      )
    ).toBe(false);
  });

  it("refuses an author whose only update is on something the builder does not open", async () => {
    const collections = [{ slug: "articles", fields: [{ name: "title" }] }];
    const singles = [{ slug: "footer", fields: [{ name: "copyright" }] }];
    expect(
      await mayReadSiteStyle(
        context(["update-articles", "update-footer"], {
          collections,
          singles,
        }),
        {}
      )
    ).toBe(false);
  });

  it("asks the update questions at type level, so a row-filtered right counts", async () => {
    // A caller whose update on pages is limited by a row filter: plain `can`
    // answers no, the type-level question (`anyEntry`) answers yes.
    const ctx = context([]);
    const typeLevel: { action: string; anyEntry: boolean }[] = [];
    const filtered = {
      ...ctx,
      caller: {
        can: async (
          action: string,
          resource: string,
          options?: { anyEntry?: boolean }
        ) => {
          typeLevel.push({ action, anyEntry: options?.anyEntry === true });
          return (
            action === "update" &&
            resource === PAGES_SLUG &&
            options?.anyEntry === true
          );
        },
      },
    };
    expect(await mayReadSiteStyle(filtered, {})).toBe(true);
    // Design's read is still asked plainly: it names one document.
    expect(typeLevel).toEqual([
      { action: "read", anyEntry: false },
      { action: "update", anyEntry: true },
    ]);
  });

  it("refuses a caller who may only read what the builder edits", async () => {
    expect(
      await mayReadSiteStyle(
        context([`read-${PAGES_SLUG}`, `read-${COMPONENTS_SLUG}`]),
        {}
      )
    ).toBe(false);
  });
});

describe("what the editor's route answers", () => {
  it("answers the stored sections, read past the Single's permission, and nothing else", async () => {
    const reads: unknown[] = [];
    const nextly = {
      findSingle: async (args: unknown) => {
        reads.push(args);
        return {
          id: "row-1",
          updatedAt: "2026-01-01",
          tokens: { tokens: [] },
          classes: [],
        };
      },
    };
    const answer = await readSiteStyleForEditor(
      context([`update-${PAGES_SLUG}`]),
      nextly,
      {}
    );
    expect(answer).toEqual({
      tokens: { tokens: [] },
      fonts: null,
      classes: [],
      breakpoints: null,
      // The model lives outside the Single; a reader offering no plugin
      // services records none.
      spacingMode: null,
    });
    expect(reads).toEqual([{ slug: SITE_STYLE_SLUG, overrideAccess: true }]);
  });

  it("answers the Single's version as the same read gave it", async () => {
    // What the editor's saves send back, so a save made in between refuses
    // them rather than being overwritten.
    const answer = await readSiteStyleForEditor(
      context([`update-${PAGES_SLUG}`]),
      { findSingle: async () => ({ tokens: { tokens: [] }, _rev: "7" }) },
      {}
    );
    expect(answer._rev).toBe("7");
    expect(answer.tokens).toEqual({ tokens: [] });
  });

  it("answers the site's recorded spacing model beside the sections", async () => {
    const answer = await readSiteStyleForEditor(
      context([`update-${PAGES_SLUG}`]),
      {
        findSingle: async () => ({}),
        plugins: {
          [PAGE_BUILDER_PLUGIN_NAME]: {
            [SPACING_MODE_SERVICE]: { read: async () => "classic" },
          },
        },
      },
      {}
    );
    expect(answer.spacingMode).toBe("classic");
  });

  it("refuses before reading anything", async () => {
    let read = false;
    const nextly = {
      findSingle: async () => {
        read = true;
        return {};
      },
    };
    await expect(
      readSiteStyleForEditor(context([]), nextly, {})
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).toBe(false);
  });
});
