/**
 * The route helpers ask the page-metadata provider for every page they serve,
 * with no wiring in the route.
 *
 * What each case pins:
 * - a route that supplies no metadata still gets the provider's answer, told
 *   the address it served, the language and the document it resolved;
 * - a route's own `buildMetadata` reaches the provider as the code level, and
 *   its own visibility never reaches the head;
 * - with no provider, a route serves what it always served, and a route with
 *   no `buildMetadata` reads nothing for its metadata at all;
 * - a Single route, which is not told where the app mounts it, asks without
 *   a path unless the app names one;
 * - a route that reads its Single itself asks exactly as a Single route does;
 * - a worker where nothing has started Nextly yet, every read of the page a
 *   cache hit, starts it and serves the provider's answer, not the route's;
 * - the page's render is handed the structured data of the same answer, as
 *   JSON-LD text that no value can break out of, and nothing without a
 *   provider;
 * - what a route says about its page for its structured data reaches the
 *   provider with the structured data's ask only, never the head's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FindArgs } from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import {
  forgetCapabilityProviders,
  recordCapabilityProviders,
} from "../../../plugins/capabilities";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  clearPluginServices,
  registerPluginService,
} from "../../../plugins/services/plugin-services-registry";
import type {
  PageMetadataInput,
  PageMetadataResolver,
} from "../../seo/page-metadata-contract";
import {
  contentPageMetadata,
  createContentRoute,
  createPublicContentRoute,
} from "../content-route";
import type { NextlyContentReader } from "../resolve-content";
import {
  createPublicSingleRoute,
  createSingleRoute,
  singlePageMetadata,
  singlePageStructuredData,
  type NextlySingleReader,
} from "../single-route";

// Nextly's start in this process, stood in for: a boot records the
// providers, as `getCachedNextly` starting Nextly does.
const start = vi.hoisted(() => ({
  boot: undefined as (() => void) | undefined,
  calls: 0,
  /** Whether the start cannot be made, as where the app registered none. */
  fails: false,
}));
vi.mock("../../../init", () => ({
  getCachedNextly: async () => {
    start.calls += 1;
    if (start.fails)
      throw new Error("getCachedNextly() called before initialization");
    start.boot?.();
    return {};
  },
  awaitStartOrRetry: async () => undefined,
}));

const ABOUT = { id: "a1", slug: "about", title: "About", status: "published" };

function contentReader(): { reader: NextlyContentReader; finds: FindArgs[] } {
  const finds: FindArgs[] = [];
  const reader: NextlyContentReader = {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      finds.push(args);
      const slug = (args.where as { slug?: { equals?: unknown } } | undefined)
        ?.slug?.equals;
      const items = slug === ABOUT.slug ? [ABOUT] : [];
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
    findByID: async () => null,
  };
  return { reader, finds };
}

function singleReader(): NextlySingleReader {
  return {
    findSingle: async () => ({ title: "Home" }),
  } as unknown as NextlySingleReader;
}

/** Start a provider the way a boot does, and return what it was asked. */
function provide(answer: PageMetadataResolver["resolve"]): PageMetadataInput[] {
  const asked: PageMetadataInput[] = [];
  const resolver: PageMetadataResolver = {
    resolve: input => {
      asked.push(input);
      return answer(input);
    },
  };
  recordCapabilityProviders([
    {
      name: "@test/seo",
      version: "1.0.0",
      nextly: ">=0.0.0",
      provides: ["page-metadata"],
      contributes: { services: { pageMetadata: () => resolver } },
    } as PluginDefinition,
  ]);
  registerPluginService("@test/seo", "pageMetadata", () => resolver);
  return asked;
}

const params = (slug: string[]) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  start.boot = undefined;
  start.calls = 0;
  start.fails = false;
});

afterEach(() => {
  recordCapabilityProviders([]);
  clearPluginServices();
});

describe("a content route with a page-metadata provider", () => {
  it("serves the provider's answer when the route supplies no metadata", async () => {
    const asked = provide(() => ({ title: "About us" }));
    const { reader } = contentReader();
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      locale: "en",
      mountPath: "/company",
      render: () => "page",
    });

    const metadata = await route.generateMetadata(params(["about"]));

    expect(metadata.title).toEqual({ absolute: "About us" });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      path: "/company/about",
      locale: "en",
      source: { kind: "entry", collection: "pages", entry: ABOUT },
      code: {},
    });
  });

  it("passes the route's own metadata as the code level, its hiding included", async () => {
    const asked = provide(() => ({ title: "Answered" }));
    const { reader } = contentReader();
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: () => "page",
      buildMetadata: () => ({
        title: "From code",
        robots: { index: false, follow: false },
      }),
    });

    const metadata = await route.generateMetadata(params(["about"]));

    expect(asked[0]?.code).toEqual({ title: "From code", hidden: true });
    expect(metadata.title).toEqual({ absolute: "Answered" });
    // The route hid its page and the answer states no visibility: hidden.
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("hands the provider what the page's content offers", async () => {
    const asked = provide(() => ({}));
    const { reader } = contentReader();
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: () => "page",
      derivedMetadata: entry => ({ title: `Drawn ${String(entry.title)}` }),
    });

    await route.generateMetadata(params(["about"]));

    expect(asked[0]?.derived).toEqual({ title: "Drawn About" });
  });

  it("answers an address the route does not serve as not found, asking nothing", async () => {
    // A crawler is answered once its head is ready, so a head that says "not
    // found" is what gives it a 404 rather than a 200 with a not-found body.
    const asked = provide(() => ({ title: "Never" }));
    const { reader } = contentReader();
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: () => "page",
    });

    await expect(route.generateMetadata(params(["missing"]))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/
    );
    expect(asked).toHaveLength(0);
  });
});

describe("a content route with no page-metadata provider", () => {
  it("serves the route's own metadata exactly", async () => {
    recordCapabilityProviders([]);
    const own = { title: "Own", robots: { index: false, follow: false } };
    const { reader } = contentReader();
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: () => "page",
      buildMetadata: () => own,
    });

    expect(await route.generateMetadata(params(["about"]))).toBe(own);
  });

  it("reads nothing for metadata when the route supplies none", async () => {
    recordCapabilityProviders([]);
    const { reader, finds } = contentReader();
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: () => "page",
    });

    expect(await route.generateMetadata(params(["about"]))).toEqual({});
    expect(finds).toHaveLength(0);
  });
});

describe("a Single route with a page-metadata provider", () => {
  it("asks without a path where the app names none, naming the Single and its document", async () => {
    const asked = provide(() => ({ title: "Home, answered" }));
    const route = createSingleRoute({
      slug: "homepage",
      nextly: singleReader(),
      locale: "en",
      render: () => "home",
    });

    const metadata = await route.generateMetadata();

    expect(metadata.title).toEqual({ absolute: "Home, answered" });
    expect(asked[0]).toEqual({
      locale: "en",
      source: {
        kind: "single",
        slug: "homepage",
        document: { title: "Home" },
      },
      code: {},
      derived: {},
    });
  });

  it("asks with the address the app serves the Single at, so a later page of its list is its own page", async () => {
    const asked = provide(() => ({}));
    const fixed = createSingleRoute({
      slug: "blog-page",
      nextly: singleReader(),
      path: "/blog",
      render: () => "blog",
    });
    const paged = createPublicSingleRoute({
      slug: "blog-page",
      nextly: singleReader(),
      path: params => `/blog/page/${String(params.page)}`,
      render: () => "blog",
    });

    await fixed.generateMetadata();
    await paged.generateMetadata({ params: Promise.resolve({ page: "2" }) });

    expect(asked.map(input => input.path)).toEqual(["/blog", "/blog/page/2"]);
  });

  it("hands the provider what the Single's content offers", async () => {
    const asked = provide(() => ({}));
    const route = createSingleRoute({
      slug: "homepage",
      nextly: singleReader(),
      render: () => "home",
      derivedMetadata: document => ({
        title: `Drawn ${String(document.title)}`,
      }),
    });

    await route.generateMetadata();

    expect(asked[0]?.derived).toEqual({ title: "Drawn Home" });
  });

  it("serves the route's own metadata exactly with no provider", async () => {
    recordCapabilityProviders([]);
    const own = { title: "Own home" };
    const route = createSingleRoute({
      slug: "homepage",
      nextly: singleReader(),
      render: () => "home",
      buildMetadata: () => own,
    });

    expect(await route.generateMetadata()).toBe(own);
  });
});

/** The JSON-LD text a render was handed, read back. */
function graphOf(text: string | undefined): unknown {
  return (JSON.parse(text ?? "") as { "@graph": unknown })["@graph"];
}

const NODES = [{ "@type": "WebPage", name: "About </script><script>x" }];

describe("structured data handed to a page's render", () => {
  it("hands a content page the structured data of the answer its head reads", async () => {
    const asked = provide(() => ({ title: "About", structuredData: NODES }));
    const { reader } = contentReader();
    const rendered: Array<string | undefined> = [];
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      locale: "en",
      render: (_, context) => {
        rendered.push(context.structuredData);
        return "page";
      },
      buildMetadata: () => ({ title: "From code" }),
    });

    await route.generateMetadata(params(["about"]));
    await route.ContentPage(params(["about"]));

    expect(graphOf(rendered[0])).toEqual(NODES);
    // No value ends the script element the text is placed in.
    expect(rendered[0]).not.toMatch(/<\/script/i);
    // Asked about the same page the same way, so both read one answer.
    expect(asked).toHaveLength(2);
    expect(asked[1]).toEqual(asked[0]);
  });

  it("hands a Single page the structured data of the answer its head reads", async () => {
    const asked = provide(() => ({ structuredData: NODES }));
    const rendered: Array<string | undefined> = [];
    const route = createSingleRoute({
      slug: "homepage",
      nextly: singleReader(),
      locale: "en",
      render: (_, context) => {
        rendered.push(context.structuredData);
        return "home";
      },
    });

    await route.generateMetadata();
    await route.SinglePage();

    expect(graphOf(rendered[0])).toEqual(NODES);
    expect(asked[1]).toEqual(asked[0]);
  });

  it("hands nothing, and works nothing out, with no provider", async () => {
    recordCapabilityProviders([]);
    const { reader } = contentReader();
    const contexts: object[] = [];
    let built = 0;
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (_, context) => {
        contexts.push(context);
        return "page";
      },
      buildMetadata: () => {
        built += 1;
        return { title: "Own" };
      },
    });

    await route.ContentPage(params(["about"]));

    expect(contexts[0]).not.toHaveProperty("structuredData");
    expect(built).toBe(0);
  });

  it("tells the provider what the route says about the page, for its structured data only", async () => {
    const asked = provide(() => ({ title: "About", structuredData: NODES }));
    const { reader } = contentReader();
    let hinted = 0;
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      locale: "en",
      render: () => "page",
      structuredDataHints: entry => {
        hinted += 1;
        return {
          type: "aboutPage",
          name: String(entry.title),
          items: [{ name: "Team", url: "/about/team" }],
          questions: [{ question: "Who?", answer: "Us." }],
        };
      },
    });

    await route.generateMetadata(params(["about"]));
    expect(hinted).toBe(0);
    await route.ContentPage(params(["about"]));

    expect(hinted).toBe(1);
    // The head is asked without them; the structured data with them, as
    // the route gave them, and apart from the head's answer.
    expect(asked[0]).not.toHaveProperty("structuredDataHints");
    expect(asked[1]?.structuredDataHints).toEqual({
      type: "aboutPage",
      name: "About",
      items: [{ name: "Team", url: "/about/team" }],
      questions: [{ question: "Who?", answer: "Us." }],
    });
    expect({ ...asked[1], structuredDataHints: undefined }).toEqual({
      ...asked[0],
      structuredDataHints: undefined,
    });
  });

  it("renders the page without structured data when the provider fails", async () => {
    provide(() => {
      throw new Error("settings unreadable");
    });
    const { reader } = contentReader();
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (_, context) => context.structuredData ?? "no structured data",
    });

    expect(await route.ContentPage(params(["about"]))).toBe(
      "no structured data"
    );
  });
});

describe("a route that reads its Single itself", () => {
  const document = { title: "Blog" };

  it("asks the provider as a Single route does, with the address it served", async () => {
    const asked = provide(() => ({ title: "Blog | Example" }));

    const metadata = await singlePageMetadata(
      { buildMetadata: () => ({ title: "From code" }), tags: ["posts"] },
      document,
      { slug: "blog-page", locale: "en" },
      "/blog/page/2"
    );

    expect(metadata.title).toEqual({ absolute: "Blog | Example" });
    expect(asked).toEqual([
      {
        path: "/blog/page/2",
        locale: "en",
        source: { kind: "single", slug: "blog-page", document },
        code: { title: "From code" },
        derived: {},
      },
    ]);
  });

  it("asks without a path where it is given none", async () => {
    const asked = provide(() => ({}));
    await singlePageMetadata({}, document, { slug: "blog-page" });
    expect(asked[0]).not.toHaveProperty("path");
  });

  it("reads the structured data of the same answer as the head", async () => {
    const asked = provide(() => ({ structuredData: NODES }));
    const config = { buildMetadata: () => ({ title: "From code" }) };
    const context = { slug: "blog-page" };

    await singlePageMetadata(config, document, context, "/blog");
    const text = await singlePageStructuredData(
      config,
      document,
      context,
      "/blog"
    );

    expect(graphOf(text)).toEqual(NODES);
    expect(asked[1]).toEqual(asked[0]);
  });

  it("tells the provider what the route says about the Single, for its structured data only", async () => {
    const asked = provide(() => ({ structuredData: NODES }));
    const config = {
      structuredDataHints: () => ({
        type: "collectionPage",
        items: [{ name: "First post", url: "/blog/first" }],
      }),
    };
    const context = { slug: "blog-page" };

    await singlePageMetadata(config, document, context, "/blog");
    await singlePageStructuredData(config, document, context, "/blog");

    expect(asked[0]).not.toHaveProperty("structuredDataHints");
    expect(asked[1]?.structuredDataHints).toEqual({
      type: "collectionPage",
      items: [{ name: "First post", url: "/blog/first" }],
    });
  });

  it("serves the route's own metadata exactly, and no structured data, with no provider", async () => {
    recordCapabilityProviders([]);
    const own = { title: "Own" };
    expect(
      await singlePageMetadata({ buildMetadata: () => own }, document, {
        slug: "blog-page",
      })
    ).toBe(own);
    expect(
      await singlePageStructuredData({}, document, { slug: "blog-page" })
    ).toBeUndefined();
  });
});

describe("a worker where nothing has started Nextly yet", () => {
  /** Every read was a cache hit: the reader answers and starts nothing. */
  function cachedSingle(): NextlySingleReader {
    return {
      findSingle: async () => ({ title: "Home" }),
    } as unknown as NextlySingleReader;
  }

  /**
   * Nothing in this worker has recorded its providers yet; starting Nextly
   * starts the provider.
   */
  function coldWorker(): void {
    forgetCapabilityProviders();
    start.boot = () => {
      provide(() => ({ title: "Answered" }));
    };
  }

  it("starts Nextly for a Single route's head, rather than serving the route's own", async () => {
    coldWorker();
    const route = createPublicSingleRoute({
      slug: "homepage",
      nextly: cachedSingle(),
      render: () => "home",
      buildMetadata: () => ({ title: "Own" }),
    });

    const metadata = await route.generateMetadata();

    expect(metadata.title).toEqual({ absolute: "Answered" });
    expect(start.calls).toBe(1);
  });

  it("starts Nextly for a page a route reads itself, its entry or its Single", async () => {
    coldWorker();
    const entry = await contentPageMetadata(
      { buildMetadata: () => ({ title: "Own" }) },
      ABOUT,
      { collection: "pages", slug: "about" },
      "/about"
    );
    expect(entry.title).toEqual({ absolute: "Answered" });

    coldWorker();
    const single = await singlePageMetadata(
      { buildMetadata: () => ({ title: "Own" }) },
      { title: "Home" },
      { slug: "homepage" },
      "/"
    );
    expect(single.title).toEqual({ absolute: "Answered" });
  });

  it("reads nothing for a provider where Nextly cannot be started, and serves the route's own", async () => {
    forgetCapabilityProviders();
    start.fails = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const derived: string[] = [];
    const built: string[] = [];
    const rendered: Array<string | undefined> = [];
    const { reader } = contentReader();
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      buildMetadata: entry => {
        built.push(String(entry.slug));
        return { title: "Own" };
      },
      derivedMetadata: entry => {
        derived.push(String(entry.slug));
        return { title: "Drawn" };
      },
      render: (_, context) => {
        rendered.push(context.structuredData);
        return "page";
      },
    });

    await route.ContentPage(params(["about"]));
    // The render asks only for structured data, which nobody can give: the
    // route's own head is not worked out for it either.
    expect(built).toEqual([]);
    const metadata = await route.generateMetadata(params(["about"]));

    // Nobody can be asked, so what the page's content offers a provider is
    // never worked out, for its render or for its head.
    expect(derived).toEqual([]);
    expect(rendered).toEqual([undefined]);
    expect(metadata.title).toBe("Own");
    expect(start.calls).toBeGreaterThan(0);
  });

  it("starts Nextly before a Single page's structured data is read", async () => {
    forgetCapabilityProviders();
    start.boot = () => {
      provide(() => ({ structuredData: NODES }));
    };
    const rendered: Array<string | undefined> = [];
    const route = createPublicSingleRoute({
      slug: "homepage",
      nextly: cachedSingle(),
      render: (_, context) => {
        rendered.push(context.structuredData);
        return "home";
      },
    });

    await route.SinglePage();

    expect(graphOf(rendered[0])).toEqual(NODES);
  });
});
