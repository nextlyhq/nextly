/**
 * How many pages a change to a component reaches.
 *
 * The properties a plausible implementation gets wrong: counting only the
 * documents that place the component directly (so a page reached through a
 * nested component, or through a Layout, is missed), counting a component or
 * a pattern as a page, counting one page twice when it is reached two ways,
 * missing the pages that fall back to the site's default Layout, and
 * reporting a bounded read as the whole answer.
 */
import { MAX_COMPOSED_DEPTH } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  componentPageReach,
  type PageLayoutRow,
  type PageReachSources,
} from "./component-page-reach";
import type { DocumentsUsing } from "./usage-count";

/** Which documents place each component, by collection. */
type Placements = Record<string, Record<string, (string | null)[]>>;

function sources(args: {
  placements?: Placements;
  incomplete?: readonly string[];
  layouts?: { id: string; components: string[] }[];
  layoutsComplete?: boolean;
  defaultLayout?: string | null;
  pages?: PageLayoutRow[];
  pagesComplete?: boolean;
}): PageReachSources & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    componentsCollection: "components",
    notPages: new Set(["patterns", "layouts"]),
    pagesCollection: "pages",
    documentsUsingEach: async ids => {
      asked.push([...ids]);
      const out = new Map<string, DocumentsUsing>();
      for (const id of ids) {
        const byCollection = args.placements?.[id] ?? {};
        out.set(id, {
          collections: Object.entries(byCollection).map(
            ([collection, documents]) => ({ collection, documents })
          ),
          complete: !(args.incomplete ?? []).includes(id),
        });
      }
      return out;
    },
    publishedLayouts: async () => ({
      layouts: args.layouts ?? [],
      complete: args.layoutsComplete ?? true,
    }),
    defaultLayout: async () => args.defaultLayout ?? null,
    pagesChoosing: async () => ({
      pages: args.pages ?? [],
      complete: args.pagesComplete ?? true,
    }),
  };
}

describe("the pages a change reaches", () => {
  it("are the pages and Singles placing the component directly", async () => {
    await expect(
      componentPageReach(
        "hero",
        sources({
          placements: { hero: { pages: ["p1", "p2"], home: ["single"] } },
        })
      )
    ).resolves.toEqual({ documents: 3, complete: true });
  });

  it("include the pages reached through a component that places it", async () => {
    const found = sources({
      placements: {
        button: { components: ["card"] },
        card: { pages: ["p1"], components: ["band"] },
        band: { pages: ["p2"] },
      },
    });
    await expect(componentPageReach("button", found)).resolves.toEqual({
      documents: 2,
      complete: true,
    });
    // A level at a time, each component asked about once.
    expect(found.asked).toEqual([["button"], ["card"], ["band"]]);
  });

  it("count neither a component nor a pattern as a page", async () => {
    await expect(
      componentPageReach(
        "hero",
        sources({
          placements: { hero: { components: ["card"], patterns: ["pat"] } },
        })
      )
    ).resolves.toEqual({ documents: 0, complete: true });
  });

  it("include the pages a published Layout naming it wraps", async () => {
    await expect(
      componentPageReach(
        "header",
        sources({
          layouts: [
            { id: "marketing", components: ["header"] },
            { id: "docs", components: ["other"] },
          ],
          defaultLayout: "docs",
          pages: [
            { id: "p1", layout: "marketing", noHeaderFooter: null },
            { id: "p2", layout: "docs", noHeaderFooter: null },
            // The switch wins over the Layout it names.
            { id: "p3", layout: "marketing", noHeaderFooter: true },
          ],
        })
      )
    ).resolves.toEqual({ documents: 1, complete: true });
  });

  it("include the pages falling back to the default Layout, when the default names it", async () => {
    await expect(
      componentPageReach(
        "header",
        sources({
          layouts: [{ id: "main", components: ["header"] }],
          defaultLayout: "main",
          pages: [
            { id: "p1", layout: null, noHeaderFooter: null },
            // Names a Layout that is not published, so it gets the default.
            { id: "p2", layout: "draft-only", noHeaderFooter: false },
            { id: "p3", layout: null, noHeaderFooter: true },
          ],
        })
      )
    ).resolves.toEqual({ documents: 2, complete: true });
  });

  it("include the pages of a Layout naming a component that places it", async () => {
    await expect(
      componentPageReach(
        "logo",
        sources({
          placements: { logo: { components: ["header"] } },
          layouts: [{ id: "main", components: ["header"] }],
          defaultLayout: "main",
          pages: [{ id: "p1", layout: null, noHeaderFooter: null }],
        })
      )
    ).resolves.toEqual({ documents: 1, complete: true });
  });

  it("count a page reached two ways once", async () => {
    await expect(
      componentPageReach(
        "header",
        sources({
          placements: { header: { pages: ["p1"] } },
          layouts: [{ id: "main", components: ["header"] }],
          defaultLayout: "main",
          pages: [{ id: "p1", layout: null, noHeaderFooter: null }],
        })
      )
    ).resolves.toEqual({ documents: 1, complete: true });
  });

  it("read no page when no Layout names it", async () => {
    const found = sources({
      layouts: [{ id: "main", components: ["other"] }],
      pages: [{ id: "p1", layout: null, noHeaderFooter: null }],
      defaultLayout: "main",
    });
    await expect(componentPageReach("hero", found)).resolves.toEqual({
      documents: 0,
      complete: true,
    });
  });

  it("are a floor when any read stopped short", async () => {
    for (const partial of [
      { incomplete: ["hero"] },
      { layoutsComplete: false },
      {
        layouts: [{ id: "main", components: ["hero"] }],
        pagesComplete: false,
      },
    ]) {
      await expect(
        componentPageReach(
          "hero",
          sources({ placements: { hero: { pages: ["p1"] } }, ...partial })
        )
      ).resolves.toEqual({ documents: 1, complete: false });
    }
  });

  it("stop where the renderer stops composing: at its depth cap, exactly", async () => {
    // c0 is the component edited; each c(i+1) places c(i), so c(i) holds it
    // i deep. A page placing c(i) draws it at depth i, which the renderer
    // composes only below its cap. Placed at the cap, it is not drawn there,
    // so that page is not reached, and the count is still exact: a chain past
    // the cap is not a read that stopped short.
    const placements: Placements = {};
    for (let i = 0; i <= MAX_COMPOSED_DEPTH + 2; i += 1) {
      placements[`c${i}`] = {
        components: [`c${i + 1}`],
        pages: [`p${i}`],
      };
    }
    await expect(
      componentPageReach("c0", sources({ placements }))
    ).resolves.toEqual({ documents: MAX_COMPOSED_DEPTH, complete: true });
  });

  it("count a Layout's pages only where it names a component holding it within the cap", async () => {
    const placements: Placements = {};
    for (let i = 0; i <= MAX_COMPOSED_DEPTH + 1; i += 1) {
      placements[`c${i}`] = { components: [`c${i + 1}`] };
    }
    const reach = (named: string) =>
      componentPageReach(
        "c0",
        sources({
          placements,
          layouts: [{ id: "main", components: [named] }],
          defaultLayout: "main",
          pages: [{ id: "p1", layout: null, noHeaderFooter: null }],
        })
      );
    // A Layout draws its component at depth 0, so c(cap - 1) still draws c0.
    await expect(reach(`c${MAX_COMPOSED_DEPTH - 1}`)).resolves.toEqual({
      documents: 1,
      complete: true,
    });
    await expect(reach(`c${MAX_COMPOSED_DEPTH}`)).resolves.toEqual({
      documents: 0,
      complete: true,
    });
  });

  it("count an index row naming no document, which no one can name", async () => {
    await expect(
      componentPageReach(
        "hero",
        sources({ placements: { hero: { pages: ["p1", null] } } })
      )
    ).resolves.toEqual({ documents: 2, complete: true });
  });
});
