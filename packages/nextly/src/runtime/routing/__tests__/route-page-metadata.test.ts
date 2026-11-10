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
 * - a Single route, which is never told where the app mounts it, asks without
 *   a path.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FindArgs } from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import { recordCapabilityProviders } from "../../../plugins/capabilities";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  clearPluginServices,
  registerPluginService,
} from "../../../plugins/services/plugin-services-registry";
import type {
  PageMetadataInput,
  PageMetadataResolver,
} from "../../seo/page-metadata-contract";
import { createContentRoute, createPublicContentRoute } from "../content-route";
import type { NextlyContentReader } from "../resolve-content";
import { createSingleRoute, type NextlySingleReader } from "../single-route";

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

    expect(metadata.title).toBe("About us");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      path: "/company/about",
      locale: "en",
      source: { kind: "entry", collection: "pages", entry: ABOUT },
      code: {},
    });
  });

  it("passes the route's own metadata as the code level and keeps its visibility out", async () => {
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

    expect(asked[0]?.code).toEqual({ title: "From code" });
    expect(metadata.title).toBe("Answered");
    expect(metadata.robots).toBeUndefined();
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
  it("asks without a path, naming the Single and its document", async () => {
    const asked = provide(() => ({ title: "Home, answered" }));
    const route = createSingleRoute({
      slug: "homepage",
      nextly: singleReader(),
      locale: "en",
      render: () => "home",
    });

    const metadata = await route.generateMetadata();

    expect(metadata.title).toBe("Home, answered");
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
