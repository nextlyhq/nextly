/**
 * A routed page drawn inside its Layout: which regions it gets, what it reads
 * to find out, and what its cache entry carries because it read it.
 *
 * In its own file because it replaces `cachedFind` to capture the tags each
 * read carries, and that substitution is hoisted over the whole module. The
 * tags are the point: under Next a tagged read nested in a page's render puts
 * its tags on the PAGE's cache entry, so the union of the tags captured during
 * one render is the set of writes that rebuild that page. Every claim below
 * about revalidation is a claim about that set.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  regionDocument,
  resolveComponentInstances,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { Fragment, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { afterOverrunLines } from "./__tests__/overrun-quiet";

import { coreBlocks } from "./blocks";
import { createBlockResolver } from "./resolver";
import { throughBoundary } from "./__tests__/through-boundary";

const cached = vi.fn();
/**
 * The reads that SUCCEEDED, with their options. A cache stores nothing for a
 * read whose function threw, so only these become entries a page is built on.
 */
const settled = vi.fn();
const routeConfigs = vi.fn();

vi.mock("nextly/runtime", async importActual => {
  const actual = await importActual<typeof import("nextly/runtime")>();
  return {
    ...actual,
    cachedFind: vi.fn(
      async (reader: () => Promise<unknown>, options: unknown) => {
        cached(options);
        // The real one runs the reader on a miss, so the double must too, or
        // the assertions below would pass over a read that never happened.
        const value = await reader();
        settled(options);
        return value;
      }
    ),
    releaseBoundedRevalidate: vi.fn(async () => 42),
    // The public's fields of every source: a condition on a field visitors
    // may not read fails closed, so the entry's title must be one.
    bindingFieldShapes: vi.fn(async () => [{ name: "title", type: "text" }]),
    // No Nextly instance is registered here to say which fields are hidden.
    createPublicReader: (
      ...[source, binding]: Parameters<typeof actual.createPublicReader>
    ) =>
      actual.createPublicReader(source, {
        ...binding,
        declarations: { hiddenFields: () => [] },
      }),
    // The real factory, observed: what the helper asks the route to tag EVERY
    // page with is the static half of a page's tags.
    createContentRoute: vi.fn((config: unknown) => {
      routeConfigs(config);
      return actual.createContentRoute(
        config as Parameters<typeof actual.createContentRoute>[0]
      );
    }),
  };
});

const { createBlocksPage, createSinglePage } = await import("./next");
const { PageRenderer } = await import("./page-renderer");
const { entryIdTag, nextlySingleTags, nextlyTags, releaseBoundedRevalidate } =
  await import("nextly/runtime");

const SETTINGS = "page-builder-settings";
const LAYOUTS = "layouts";

interface FindArgs {
  collection: string;
  where?: Record<string, { equals?: unknown; in?: unknown }>;
  status?: string;
  locale?: string;
  select?: Record<string, boolean>;
  depth?: number;
}

interface LayoutRow {
  areas: unknown[];
  published: boolean;
  /** Pending areas, reachable only through a per-id draft read. */
  draftAreas?: unknown[];
}

interface Site {
  page: Record<string, unknown>;
  layouts?: Record<string, LayoutRow>;
  components?: Record<string, unknown>;
}

const doc = (nodes: unknown[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: nodes as BlockDocument["nodes"],
});

const definition = (nodes: unknown[]): unknown => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
});

const heading = (id: string, text: string, level = "h2") => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level },
});

const instance = (id: string, componentId: string) => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const areas = (header?: string, footer?: string) => [
  ...(header === undefined ? [] : [{ area: "header", component: header }]),
  ...(footer === undefined ? [] : [{ area: "footer", component: footer }]),
];

/** The ordinary site: a header and a footer component, two published Layouts. */
const COMPONENTS: Record<string, unknown> = {
  "main-header": definition([heading("mh", "Main header")]),
  "main-footer": definition([heading("mf", "Main footer")]),
  "landing-header": definition([heading("lh", "Landing header")]),
};

const LAYOUT_ROWS: Record<string, LayoutRow> = {
  main: { areas: areas("main-header", "main-footer"), published: true },
  landing: { areas: areas("landing-header"), published: true },
  unpublished: { areas: areas("landing-header"), published: false },
};

const PAGE_BODY = doc([heading("p", "Page body")]);

/**
 * A reader over one page, a Layout store and a component store.
 *
 * Its list read honours `status` for Layouts, because whether a Layout is
 * published is exactly what the route asks it; its by-id read reaches a
 * pending edit, because that is the asymmetry of the real service.
 */
function siteReader(site: Site) {
  const calls: FindArgs[] = [];
  const byId: { collection: string; id: string; draft?: boolean }[] = [];
  const layouts = site.layouts ?? LAYOUT_ROWS;
  const components = site.components ?? COMPONENTS;
  return {
    calls,
    byId,
    nextly: {
      find: vi.fn(async (args: FindArgs) => {
        calls.push(args);
        const wanted = args.where?.id?.in;
        const ids = Array.isArray(wanted) ? (wanted as string[]) : [];
        if (args.collection === "components") {
          return {
            items: ids
              .filter(id => Object.hasOwn(components, id))
              .map(id => ({ id, content: components[id] })),
            meta: {},
          };
        }
        if (args.collection === LAYOUTS) {
          return {
            items: ids
              .filter(id => Object.hasOwn(layouts, id))
              .filter(
                id => args.status !== "published" || layouts[id]!.published
              )
              .map(id => ({ id, areas: layouts[id]!.areas })),
            meta: {},
          };
        }
        return {
          items: [
            { id: "p1", slug: "about", title: "Entry title", ...site.page },
          ],
          meta: {},
        };
      }),
      findByID: vi.fn(
        async (args: { collection: string; id: string; draft?: boolean }) => {
          byId.push(args);
          if (args.collection === LAYOUTS) {
            const row = layouts[args.id];
            if (row === undefined) return null;
            return {
              id: args.id,
              areas:
                args.draft === true && row.draftAreas
                  ? row.draftAreas
                  : row.areas,
            };
          }
          if (args.collection === "components") {
            const row = components[args.id];
            return row === undefined ? null : { id: args.id, content: row };
          }
          return null;
        }
      ),
      media: { findByID: vi.fn(async () => null) },
    } as never,
  };
}

function provider(defaultLayout: string | null) {
  return {
    readDefault: vi.fn(async () => defaultLayout),
    singles: [SETTINGS],
  };
}

const BREAKPOINTS = { viewport: [], container: [] };

async function render(
  site: Site,
  options: {
    defaultLayout?: string | null;
    layouts?: false;
    extra?: Record<string, unknown>;
  } = {}
) {
  cached.mockClear();
  settled.mockClear();
  routeConfigs.mockClear();
  const r = siteReader(site);
  const layouts = provider(
    options.defaultLayout === undefined ? "main" : options.defaultLayout
  );
  const route = createBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: r.nextly,
    blocks: createBlockResolver(coreBlocks),
    styleContext: { breakpoints: BREAKPOINTS },
    ...(options.layouts === false ? {} : { layouts }),
    ...options.extra,
  } as Parameters<typeof createBlocksPage>[0]);
  const element = await throughBoundary(
    route.ContentPage({ params: { slug: ["about"] } })
  );
  const tags = cached.mock.calls.flatMap(
    call => (call[0] as { tags: string[] }).tags
  );
  const staticTags = (routeConfigs.mock.calls[0]![0] as { tags: string[] })
    .tags;
  return {
    element: element as ReactElement,
    html: renderToStaticMarkup(element as ReactElement),
    tags,
    staticTags,
    calls: r.calls,
    byId: r.byId,
    readDefault: layouts.readDefault,
    route,
  };
}

const layoutReads = (calls: FindArgs[]) =>
  calls.filter(call => call.collection === LAYOUTS);

const DEFAULT_TAGS = [
  ...nextlySingleTags(SETTINGS),
  entryIdTag(LAYOUTS, "main"),
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a page drawn inside its Layout", () => {
  it("draws the header region, then the page, then the footer region", async () => {
    const { html } = await render({ page: { content: PAGE_BODY } });

    const header = html.indexOf('<header data-nextly-region="header">');
    const body = html.indexOf("Page body");
    const footer = html.indexOf('<footer data-nextly-region="footer">');
    expect(header).toBeGreaterThanOrEqual(0);
    expect(body).toBeGreaterThan(header);
    expect(footer).toBeGreaterThan(body);
    // The region's content is INSIDE its landmark, not merely after it.
    expect(html).toMatch(
      /<header data-nextly-region="header">(?:(?!<\/header>).)*Main header/s
    );
    expect(html).toMatch(
      /<footer data-nextly-region="footer">(?:(?!<\/footer>).)*Main footer/s
    );
  });

  it("emits the site sheet once, before every document's own rules", async () => {
    // Regions sharing the sheet: one copy, and FIRST, because the block
    // defaults in it are at the same specificity as every document's own
    // rules and lose only by coming earlier.
    const { html } = await render({ page: { content: PAGE_BODY } });

    const sheets = html.match(/data-nx-site-sheet=/g) ?? [];
    expect(sheets).toHaveLength(1);
    expect(html.indexOf("data-nx-site-sheet=")).toBeLessThan(
      html.indexOf("Main header")
    );
  });

  it("compiles a region's own styles, as a placed component's are", async () => {
    const styled = definition([
      {
        ...heading("sh", "Styled header"),
        styles: { base: { base: { color: "rgb(1, 2, 3)" } } },
      },
    ]);
    const { html } = await render({
      page: { content: PAGE_BODY },
      components: { ...COMPONENTS, "main-header": styled },
    });

    expect(html).toContain("Styled header");
    expect(html).toContain("rgb(1, 2, 3)");
  });

  /**
   * Draw a page and a header holding the same node id, styled differently,
   * and hold each colour to its own part's scope. `extra` is the route's own
   * style inputs.
   */
  async function expectEachRuleUnderItsOwnPart(
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    // A node id is unique within a document, not across documents. The
    // header's node is drawn under the id composition gives it, so the page
    // here holds a node with exactly that id, styled differently: unscoped,
    // both share one generated class and each sheet would restyle the other.
    const headerDefinition = definition([
      {
        ...heading("a", "Header A"),
        styles: { base: { base: { color: "rgb(1, 1, 1)" } } },
      },
    ]) as BlockDocument;
    const composed = resolveComponentInstances(
      regionDocument([{ area: "header", componentId: "main-header" }]),
      {
        has: id => id === "main-header",
        get: id => (id === "main-header" ? headerDefinition : undefined),
      }
    ).document;
    const sharedId = composed.nodes[0]!.id;

    const { html } = await render(
      {
        page: {
          content: doc([
            {
              ...heading(sharedId, "Page A"),
              styles: { base: { base: { color: "rgb(2, 2, 2)" } } },
            },
          ]),
        },
        components: { ...COMPONENTS, "main-header": headerDefinition },
      },
      { extra }
    );

    // The positive control: the two headings really do share one class.
    const classOf = (text: string) => {
      const at = html.indexOf(text);
      const open = html.lastIndexOf("<h2", at);
      return /class="([^"]*)"/.exec(html.slice(open, at))?.[1];
    };
    expect(classOf("Header A")).toBeDefined();
    expect(classOf("Header A")).toBe(classOf("Page A"));

    // Each part's root carries its own scope class...
    const rootOf = (text: string) => {
      const at = html.indexOf(text);
      const root = html.lastIndexOf('<div class="nx-pb-page', at);
      return html.slice(root, html.indexOf(">", root));
    };
    expect(rootOf("Header A")).toContain("nx-pb-part-header");
    expect(rootOf("Page A")).toContain("nx-pb-part-page");
    // ...and each colour is written only under its own document's scope.
    const ruleFor = (color: string) => {
      const at = html.indexOf(color);
      return html.slice(html.lastIndexOf("}", at) + 1, at);
    };
    expect(ruleFor("rgb(1, 1, 1)")).toContain("nx-pb-part-header");
    expect(ruleFor("rgb(1, 1, 1)")).not.toContain("nx-pb-part-page");
    expect(ruleFor("rgb(2, 2, 2)")).toContain("nx-pb-part-page");
    expect(ruleFor("rgb(2, 2, 2)")).not.toContain("nx-pb-part-header");
  }

  it("keeps each document's rules to its own root when the page and a region hold the same node id", async () => {
    await expectEachRuleUnderItsOwnPart();
  });

  it("keeps them apart when the route states only the site's styles", async () => {
    // A route serving a stored artifact names its breakpoints through
    // `siteStyles` and states no compile context: the part drawn first, which
    // emits the site sheet, is still compiled under its own scope.
    await expectEachRuleUnderItsOwnPart({
      styleContext: undefined,
      siteStyles: { breakpoints: BREAKPOINTS },
    });
  });

  it("draws neither region for a page that switches them off, and reads nothing", async () => {
    const { html, calls, tags, readDefault, byId } = await render({
      page: { content: PAGE_BODY, layout: "landing", noHeaderFooter: true },
    });

    expect(html).not.toContain("data-nextly-region");
    expect(html).toContain("Page body");
    expect(layoutReads(calls)).toEqual([]);
    expect(byId).toEqual([]);
    expect(readDefault).not.toHaveBeenCalled();
    expect(tags).toEqual([]);
  });

  it("uses the published Layout a page names, tagged by its id and nothing about the default", async () => {
    const { html, tags, readDefault } = await render({
      page: { content: PAGE_BODY, layout: "landing" },
    });

    expect(html).toContain("Landing header");
    expect(html).not.toContain("Main header");
    expect(tags).toContain(entryIdTag(LAYOUTS, "landing"));
    for (const tag of DEFAULT_TAGS) expect(tags).not.toContain(tag);
    expect(readDefault).not.toHaveBeenCalled();
  });

  it("reads a populated Layout reference as its id", async () => {
    const { html } = await render({
      page: { content: PAGE_BODY, layout: { id: "landing", title: "Landing" } },
    });

    expect(html).toContain("Landing header");
  });

  it("gives a page naming nothing the default, carrying the Single's and the default's tags", async () => {
    const { html, tags } = await render({ page: { content: PAGE_BODY } });

    expect(html).toContain("Main header");
    for (const tag of DEFAULT_TAGS) expect(tags).toContain(tag);
  });

  it("falls back from an unpublished Layout, carrying its id AND the default's tags", async () => {
    const { html, tags } = await render({
      page: { content: PAGE_BODY, layout: "unpublished" },
    });

    expect(html).toContain("Main header");
    expect(html).not.toContain("Landing header");
    // The requested id even though the read found nothing, so publishing that
    // Layout refreshes this page.
    expect(tags).toContain(entryIdTag(LAYOUTS, "unpublished"));
    for (const tag of DEFAULT_TAGS) expect(tags).toContain(tag);
  });

  it("draws no regions without a usable default, says so, and still renders the page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const none = await render(
      { page: { content: PAGE_BODY } },
      { defaultLayout: null }
    );
    expect(none.html).not.toContain("data-nextly-region");
    expect(none.html).toContain("Page body");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("has no default Layout")
    );

    warn.mockClear();
    const unpublished = await render(
      { page: { content: PAGE_BODY } },
      { defaultLayout: "unpublished" }
    );
    expect(unpublished.html).not.toContain("data-nextly-region");
    expect(unpublished.html).toContain("Page body");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("(unpublished) is not published")
    );
    // Tagged with the default's id, so its publish refreshes the page.
    expect(unpublished.tags).toContain(entryIdTag(LAYOUTS, "unpublished"));
  });

  it("tags a region's nested components by id", async () => {
    const { html, tags } = await render({
      page: { content: PAGE_BODY },
      components: {
        ...COMPONENTS,
        "main-header": definition([instance("logo-at", "logo")]),
        logo: definition([heading("lg", "Nested logo")]),
      },
    });

    expect(html).toContain("Nested logo");
    expect(tags).toContain(entryIdTag("components", "main-header"));
    expect(tags).toContain(entryIdTag("components", "logo"));
  });

  it("never tags a page with the whole Layouts collection", async () => {
    // A collection tag would make publishing any Layout rebuild every page.
    const layoutsTag = nextlyTags(LAYOUTS)[0]!;
    for (const page of [
      { content: PAGE_BODY },
      { content: PAGE_BODY, layout: "landing" },
      { content: PAGE_BODY, layout: "unpublished" },
    ]) {
      const { tags, staticTags } = await render({ page });
      expect(tags).not.toContain(layoutsTag);
      expect(staticTags).not.toContain(layoutsTag);
      // Nor the Single on every page: only a page that reads the default
      // carries it, which a route-wide tag could not express.
      for (const tag of nextlySingleTags(SETTINGS)) {
        expect(staticTags).not.toContain(tag);
      }
    }
  });

  it("selects only what a region needs, at the route's posture", async () => {
    const { calls } = await render({
      page: { content: PAGE_BODY, layout: "landing" },
    });

    const [read] = layoutReads(calls);
    expect(read?.select).toEqual({ id: true, areas: true });
    // Only the ids `areas` stores are used; a populated read would load each
    // region component, and what it relates to, for nothing.
    expect(read?.depth).toBe(0);
    expect(read?.status).toBe("published");
  });

  it("spends the page's ONE query budget", async () => {
    // Page components (one read), the named Layout (one), and the region's
    // components (one). With two, the region's components are refused.
    const page = {
      content: doc([instance("pi", "main-footer")]),
      layout: "landing",
    };
    const short = await render({ page }, { extra: { maxQueries: 2 } });
    expect(
      short.calls.filter(
        call =>
          call.collection === "components" &&
          (call.where?.id?.in as string[]).includes("landing-header")
      )
    ).toEqual([]);
    expect(short.html).not.toContain("Landing header");

    // The positive control: one more read and the region draws.
    const enough = await render({ page }, { extra: { maxQueries: 3 } });
    expect(enough.html).toContain("Landing header");
  });

  it("reads regions in the page's locale, with tags that carry none", async () => {
    const { calls, tags } = await render(
      { page: { content: PAGE_BODY } },
      { extra: { locale: "fr" } }
    );

    expect(layoutReads(calls)[0]?.locale).toBe("fr");
    const regionComponents = calls.filter(
      call =>
        call.collection === "components" &&
        (call.where?.id?.in as string[]).includes("main-header")
    );
    expect(regionComponents[0]?.locale).toBe("fr");
    expect(tags.some(tag => tag.includes("fr"))).toBe(false);
  });

  it("previews a Layout's pending edit only on a route serving drafts", async () => {
    const site: Site = {
      page: { content: PAGE_BODY, layout: "landing" },
      layouts: {
        ...LAYOUT_ROWS,
        landing: {
          areas: areas("landing-header"),
          draftAreas: areas("main-header"),
          published: true,
        },
      },
    };

    const draft = await render(site, { extra: { draft: true } });
    expect(draft.html).toContain("Main header");
    expect(draft.byId).toContainEqual(
      expect.objectContaining({
        collection: LAYOUTS,
        id: "landing",
        draft: true,
        depth: 0,
      })
    );

    // A per-path gate grants the page, not what it is drawn inside: the
    // published Layout, through the published read.
    const gated = await render(site, { extra: { draft: () => "p1" } });
    expect(gated.html).toContain("Landing header");
    expect(layoutReads(gated.calls)[0]?.status).toBe("published");
  });

  it("never derives the page's title from a region", async () => {
    const r = siteReader({
      page: {
        content: doc([
          { id: "t", type: "core/text", version: 1, props: { text: "Body" } },
        ]),
      },
      components: {
        ...COMPONENTS,
        "main-header": definition([heading("hb", "Header brand", "h1")]),
      },
    });
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
      blocks: createBlockResolver(coreBlocks),
      layouts: provider("main"),
      metadata: (entry, _context, derived) => ({
        title: derived.title ?? (entry.title as string),
      }),
    });

    // The positive control: the header IS on the page this route serves.
    const element = await throughBoundary(
      route.ContentPage({ params: { slug: ["about"] } })
    );
    expect(renderToStaticMarkup(element as ReactElement)).toContain(
      "Header brand"
    );

    const meta = await route.generateMetadata({ params: { slug: ["about"] } });
    expect(meta.title).toBe("Entry title");
  });

  it("spends a tight budget in metadata as the render does, when the page's conditions read the entry", async () => {
    // A heading shown by a condition on the entry: no binding, but the entry
    // read it needs comes after the Layout's, in the render and in metadata.
    const content = doc([
      {
        ...heading("c", "Conditioned title", "h1"),
        visibility: {
          conditions: [
            [{ field: "title", op: "equals", value: "Entry title" }],
          ],
        },
      },
    ]);
    const routeWith = (maxQueries?: number) => {
      const r = siteReader({ page: { content } });
      return createBlocksPage({
        collections: ["pages"],
        field: "content",
        nextly: r.nextly,
        blocks: createBlockResolver(coreBlocks),
        layouts: provider("main"),
        metadata: (_entry, _context, derived) => ({
          title: derived.title ?? "No derived title",
        }),
        ...(maxQueries === undefined ? {} : { maxQueries }),
      });
    };
    const outcome = async (maxQueries?: number) => {
      const element = await throughBoundary(
        routeWith(maxQueries).ContentPage({ params: { slug: ["about"] } })
      );
      const html = renderToStaticMarkup(element as ReactElement);
      const meta = await routeWith(maxQueries).generateMetadata({
        params: { slug: ["about"] },
      });
      return { drawn: html.includes("Conditioned title"), title: meta.title };
    };
    // One claim: the Layout takes it, so the entry can't be read and the
    // block fails closed; metadata, reading in the same order, agrees.
    expect(await outcome(1)).toEqual({
      drawn: false,
      title: "No derived title",
    });
    // CONTROL: with room for both, the block shows and names the page.
    expect(await outcome()).toEqual({
      drawn: true,
      title: "Conditioned title",
    });
  });

  it("renders exactly as before when the option is off", async () => {
    const off = await render(
      { page: { content: PAGE_BODY, layout: "landing" } },
      { layouts: false }
    );
    // The page's own renderer, unwrapped: no fragment, no region, no read.
    expect(off.element.type).toBe(PageRenderer);
    expect(off.element.type).not.toBe(Fragment);
    expect(layoutReads(off.calls)).toEqual([]);
    expect(off.tags).toEqual([]);

    // And the same bytes as a route WITH the option drawing nothing.
    const switchedOff = await render({
      page: { content: PAGE_BODY, layout: "landing", noHeaderFooter: true },
    });
    expect(off.html).toBe(switchedOff.html);
    expect(off.html).toContain("data-nx-site-sheet=");
  });
});

/**
 * How long the reads behind a "no regions, no usable default" answer may live.
 *
 * The plugin repairs a lost default from its job runner, usually outside a
 * request, where a tag revalidation can be held; a page cached on that answer
 * must ask again within a minute rather than wait for an unrelated write. The
 * release bound is stubbed to "none scheduled" (`false`), so a read carries a
 * number only where something capped it.
 */
describe("a classic site through the route", () => {
  const box = (id: string, children: unknown[]) => ({
    id,
    type: "core/box",
    version: 1,
    props: {},
    slots: { children },
  });

  /** A page and its header, each a box of blocks, on a site in `mode`. */
  async function drawn(mode: "classic" | "gaps") {
    return render(
      {
        page: {
          content: doc([
            box("pb", [heading("p1", "One"), heading("p2", "Two")]),
          ]),
          layout: "main",
        },
        components: {
          ...COMPONENTS,
          "main-header": definition([
            box("hb", [heading("h1", "Head"), heading("h2", "Line")]),
          ]),
        },
      },
      {
        extra: {
          // The site's style the way a host's route reads it: through a
          // provider, which names the single its read depends on.
          siteStyles: {
            read: async () => ({ breakpoints: BREAKPOINTS, spacingMode: mode }),
            singles: ["site-style"],
          },
        },
      }
    );
  }

  it("compiles the page and its Layout's regions under the classic model", async () => {
    const { html } = await drawn("classic");
    expect(html).toContain("Head");
    expect(html).not.toContain("nx-pb-gap");
    expect(html).toMatch(
      /:where\(h2\) \{[^}]*margin-block-end: 0\.5em; margin-block-start: 1\.5em/
    );
    // The control: the same site on container gaps marks both boxes.
    const gaps = await drawn("gaps");
    expect(gaps.html).toContain("nx-pb-gap");
  });
});

describe("a page with no usable default", () => {
  async function withRelease<T>(
    release: number | false,
    run: () => Promise<T>
  ): Promise<T> {
    vi.mocked(releaseBoundedRevalidate).mockImplementation(async () => release);
    try {
      return await run();
    } finally {
      vi.mocked(releaseBoundedRevalidate).mockImplementation(async () => 42);
    }
  }

  /** Each cached read's tags and lifetime, as this render asked for them. */
  const reads = () =>
    cached.mock.calls.map(
      call => call[0] as { tags: string[]; revalidate?: number | false }
    );
  const bounded = (revalidate: number | false | undefined) =>
    typeof revalidate === "number" && revalidate <= 60;
  const settingsTag = nextlySingleTags(SETTINGS)[0]!;

  it("is answered by reads that live no more than a minute", async () => {
    for (const defaultLayout of [null, "unpublished"]) {
      await withRelease(false, async () => {
        await render({ page: { content: PAGE_BODY } }, { defaultLayout });
        const all = reads();
        // The default read that gave the answer, by the Single's tag.
        expect(
          all.some(
            read => read.tags.includes(settingsTag) && bounded(read.revalidate)
          ),
          `default ${String(defaultLayout)}`
        ).toBe(true);
        // And the default Layout's row, where there is one to read.
        if (defaultLayout !== null) {
          expect(
            all.some(
              read =>
                read.tags.includes(entryIdTag(LAYOUTS, defaultLayout)) &&
                bounded(read.revalidate)
            )
          ).toBe(true);
        }
      });
    }
  });

  it("caches a provider that throws as no default, for at most a minute and under the settings tag", async () => {
    // The page still renders, with no regions. What it is cached on must be a
    // stored answer that expires within the bound and that a write to the
    // settings reaches: a failure caught outside every cached read leaves the
    // page cached headerless with nothing to invalidate it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = {
      readDefault: vi.fn(async () => {
        throw new Error("settings unavailable");
      }),
      singles: [SETTINGS],
    };
    await withRelease(false, async () => {
      const { html } = await render(
        { page: { content: PAGE_BODY } },
        { extra: { layouts: failing } }
      );
      expect(html).toContain("Page body");
      expect(html).not.toContain("data-nextly-region");
      const answered = settled.mock.calls
        .map(call => call[0] as { tags: string[]; revalidate?: number | false })
        .filter(read => read.tags.includes(settingsTag));
      expect(answered).toHaveLength(1);
      expect(bounded(answered[0]!.revalidate)).toBe(true);
    });
    expect(failing.readDefault).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be read")
    );
  });

  it("keeps a sooner release bound", async () => {
    await withRelease(30, async () => {
      await render({ page: { content: PAGE_BODY } }, { defaultLayout: null });
      const lifetimes = reads()
        .filter(read => read.tags.includes(settingsTag))
        .map(read => read.revalidate);
      expect(lifetimes).toContain(30);
      expect(lifetimes).not.toContain(60);
    });
  });

  it("leaves a page with a usable Layout on the ordinary lifetime", async () => {
    for (const page of [
      { content: PAGE_BODY },
      { content: PAGE_BODY, layout: "landing" },
      { content: PAGE_BODY, layout: "unpublished" },
    ]) {
      await withRelease(false, async () => {
        await render({ page });
        expect(reads().map(read => read.revalidate)).not.toContainEqual(
          expect.any(Number)
        );
      });
    }
  });
});

/**
 * One write, one revalidation per page that depends on what it wrote, and
 * none for a page that does not.
 *
 * Measured over the tag sets real renders produced: a write busts the tags
 * the write path computes for it, and a cached page is rebuilt when it carries
 * any of them. A page carrying none is untouched; a page carrying exactly one
 * is rebuilt exactly once for that write.
 */
describe("what one Layout write revalidates", () => {
  async function pages() {
    return {
      // Names a published Layout of its own.
      landing: await render({
        page: { content: PAGE_BODY, layout: "landing" },
      }),
      // Names nothing: the default.
      plain: await render({ page: { content: PAGE_BODY } }),
      // Names an unpublished Layout: the default, until that one publishes.
      fallingBack: await render({
        page: { content: PAGE_BODY, layout: "unpublished" },
      }),
    };
  }

  /** How many of `busted` each page carries, page by page. */
  function hits(
    rendered: Record<string, { tags: string[]; staticTags: string[] }>,
    busted: readonly string[]
  ): Record<string, number> {
    return Object.fromEntries(
      Object.entries(rendered).map(([name, page]) => {
        const carried = new Set([...page.tags, ...page.staticTags]);
        return [name, busted.filter(tag => carried.has(tag)).length];
      })
    );
  }

  /** What publishing a Layout busts: its collection, its id, its locale id. */
  const layoutPublish = (id: string) => nextlyTags(LAYOUTS, id, "en");

  it("publishing the default rebuilds each page that uses it once, and not the others", async () => {
    expect(hits(await pages(), layoutPublish("main"))).toEqual({
      landing: 0,
      plain: 1,
      fallingBack: 1,
    });
  });

  it("publishing a page's own Layout rebuilds that page once, and not the others", async () => {
    expect(hits(await pages(), layoutPublish("landing"))).toEqual({
      landing: 1,
      plain: 0,
      fallingBack: 0,
    });
  });

  it("publishing the Layout a page fell back from rebuilds that page once", async () => {
    expect(hits(await pages(), layoutPublish("unpublished"))).toEqual({
      landing: 0,
      plain: 0,
      fallingBack: 1,
    });
  });

  it("changing the default through the settings Single rebuilds each dependent page once", async () => {
    expect(hits(await pages(), nextlySingleTags(SETTINGS))).toEqual({
      landing: 0,
      plain: 1,
      fallingBack: 1,
    });
  });
});

describe("the layouts option at boot", () => {
  it("refuses a bare function", () => {
    expect(() =>
      createBlocksPage({
        collections: ["pages"],
        field: "content",
        layouts: (async () => "main") as never,
      })
    ).toThrow(TypeError);
  });

  it("refuses a provider that names no singles", () => {
    expect(() =>
      createBlocksPage({
        collections: ["pages"],
        field: "content",
        layouts: { readDefault: async () => "main" } as never,
      })
    ).toThrow(/singles/);
  });

  it("is not taken by a Single's route", async () => {
    const r = siteReader({ page: {} });
    const layouts = provider("main");
    const route = createSinglePage({
      slug: "homepage",
      field: "content",
      nextly: {
        ...(r.nextly as object),
        findSingle: async () => ({ id: "h", content: PAGE_BODY }),
      } as never,
      ...({ layouts } as object),
    });
    const element = await throughBoundary(route.SinglePage());
    expect(renderToStaticMarkup(element as ReactElement)).not.toContain(
      "data-nextly-region"
    );
    expect(layouts.readDefault).not.toHaveBeenCalled();
    expect(layoutReads(r.calls)).toEqual([]);
  });
});

// Pages here outrun their caps, and a route logs that after a short quiet.
afterAll(afterOverrunLines);
