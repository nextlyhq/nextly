/**
 * A content or Single route answers a miss with the site's own `notFound`
 * where it was given one, and with Next.js's `notFound()` where it was not.
 *
 * What separates a correct route from a plausible broken one:
 *
 * - without a handler, a miss is answered exactly as before, by Next's
 *   `notFound()`;
 * - with one, the page and `generateMetadata` both answer a miss through it,
 *   so a site that logs misses there sees the ones its head decides too;
 * - a handler that returns instead of throwing still leaves the request
 *   answered not found, never served;
 * - a path the route serves never calls it.
 *
 * `next/navigation` is stood in for, so Next's not-found and the site's
 * handler are told apart by what they throw.
 */
import { describe, expect, it, vi } from "vitest";

import type { ListResult } from "../../../direct-api/types/shared";
import { createContentRoute } from "../content-route";
import type { NextlyContentReader } from "../resolve-content";
import { createSingleRoute, type NextlySingleReader } from "../single-route";

vi.mock("../../next-api", () => ({
  loadNextModule: () => ({
    // What the route awaits before reading: a request is already in hand here.
    connection: async () => undefined,
    notFound: () => {
      throw new Error("next: not found");
    },
    permanentRedirect: (path: string) => {
      throw new Error(`permanent redirect to ${path}`);
    },
  }),
  requireNextApi: (module: Record<string, unknown>, _: string, name: string) =>
    module[name],
}));

/** A reader holding one page, at `about`. */
const nextly: NextlyContentReader = {
  find: async (args): Promise<ListResult<Record<string, unknown>>> => {
    const slug = (args.where as { slug?: { equals?: unknown } } | undefined)
      ?.slug?.equals;
    const items = slug === "about" ? [{ id: "about", slug: "about" }] : [];
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

/** A handler that throws its own error, counting its calls. */
function throwingHandler(): { notFound: () => never; calls: () => number } {
  let calls = 0;
  return {
    notFound: () => {
      calls += 1;
      throw new Error("site: not found");
    },
    calls: () => calls,
  };
}

function contentRoute(notFound?: () => never | Promise<never>) {
  return createContentRoute<string>({
    collections: ["pages"],
    nextly,
    render: entry => `page ${String(entry.id)}`,
    // Its own metadata, so the head resolves the path as the page does.
    buildMetadata: entry => ({ title: String(entry.id) }),
    ...(notFound === undefined ? {} : { notFound }),
  });
}

const at = (path: string) => ({ params: { slug: path.split("/") } });

describe("a content route's miss", () => {
  it("is answered by Next's notFound() when the site passed no handler", async () => {
    const { ContentPage, generateMetadata } = contentRoute();
    await expect(ContentPage(at("missing"))).rejects.toThrow("next: not found");
    await expect(generateMetadata(at("missing"))).rejects.toThrow(
      "next: not found"
    );
  });

  it("is answered by the site's handler, for the page and its head", async () => {
    const handler = throwingHandler();
    const { ContentPage, generateMetadata } = contentRoute(handler.notFound);
    await expect(ContentPage(at("missing"))).rejects.toThrow("site: not found");
    await expect(generateMetadata(at("missing"))).rejects.toThrow(
      "site: not found"
    );
    expect(handler.calls()).toBe(2);
  });

  it("is answered by the site's handler for a reserved path too", async () => {
    const handler = throwingHandler();
    const { ContentPage } = contentRoute(handler.notFound);
    await expect(ContentPage(at("admin"))).rejects.toThrow("site: not found");
    expect(handler.calls()).toBe(1);
  });

  it("still answers not found when the handler returns", async () => {
    let calls = 0;
    const { ContentPage } = contentRoute(async () => {
      calls += 1;
      return undefined as never;
    });
    await expect(ContentPage(at("missing"))).rejects.toThrow("next: not found");
    expect(calls).toBe(1);
  });

  it("never calls the handler for a path the route serves", async () => {
    const handler = throwingHandler();
    const { ContentPage, generateMetadata } = contentRoute(handler.notFound);
    await expect(ContentPage(at("about"))).resolves.toBe("page about");
    await expect(generateMetadata(at("about"))).resolves.toMatchObject({
      title: "about",
    });
    expect(handler.calls()).toBe(0);
  });
});

/** A reader whose Single is not there. */
const noSingle = {
  findSingle: async () => null,
} as unknown as NextlySingleReader;

describe("a Single route's miss", () => {
  it("is answered by Next's notFound() when the site passed no handler", async () => {
    const { SinglePage } = createSingleRoute({
      slug: "homepage",
      nextly: noSingle,
      render: () => "rendered",
    });
    await expect(SinglePage()).rejects.toThrow("next: not found");
  });

  it("is answered by the site's handler", async () => {
    const handler = throwingHandler();
    const { SinglePage } = createSingleRoute({
      slug: "homepage",
      nextly: noSingle,
      render: () => "rendered",
      notFound: handler.notFound,
    });
    await expect(SinglePage()).rejects.toThrow("site: not found");
    expect(handler.calls()).toBe(1);
  });

  it("is answered by the site's handler for its head too", async () => {
    const handler = throwingHandler();
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: noSingle,
      render: () => "rendered",
      buildMetadata: () => ({ title: "Home" }),
      notFound: handler.notFound,
    });
    await expect(generateMetadata()).rejects.toThrow("site: not found");
    expect(handler.calls()).toBe(1);
  });

  it("keeps an empty head for a miss when the site passed no handler", async () => {
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: noSingle,
      render: () => "rendered",
      buildMetadata: () => ({ title: "Home" }),
    });
    await expect(generateMetadata()).resolves.toEqual({});
  });
});
