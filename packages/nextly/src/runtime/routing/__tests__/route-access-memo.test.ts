/**
 * A page render resolves its document and then hands it to the app's `render`
 * or `buildMetadata`, which may read again as the same person. Both run with
 * one memo of access lookups, so a lookup the resolution made is not made
 * again by the callback.
 *
 * Observed through the memo itself: the reader and the callback each ask it
 * the same question, and the question is answered once only when both ran
 * inside the same memo.
 */
import { describe, expect, it, vi } from "vitest";

import { rememberForRequest } from "../../../auth/access/request-memo";
import type { ListResult } from "../../../direct-api/types/shared";
import { createContentRoute } from "../content-route";
import type { NextlyContentReader } from "../resolve-content";
import { createSingleRoute, type NextlySingleReader } from "../single-route";

/** A question about one person, as an access lookup asks it. */
function lookup() {
  const load = vi.fn(async () => ["editor"]);
  const ask = () => rememberForRequest("person", "roles", "r1", load);
  return { load, ask };
}

function contentReader(ask: () => Promise<unknown>): NextlyContentReader {
  return {
    find: async (): Promise<ListResult<Record<string, unknown>>> => {
      await ask();
      const items = [{ id: "home", slug: "home", status: "published" }];
      return {
        items,
        meta: {
          total: 1,
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
}

function singleReader(ask: () => Promise<unknown>): NextlySingleReader {
  return {
    findSingle: async () => {
      await ask();
      return { title: "Home" };
    },
  } as unknown as NextlySingleReader;
}

const params = { params: { slug: ["home"] } };

describe("a page render looks its person up once", () => {
  it("shares one memo between a collection page's read and its render", async () => {
    const { load, ask } = lookup();
    const { ContentPage } = createContentRoute({
      collections: ["pages"],
      nextly: contentReader(ask),
      render: async () => ask(),
    });
    await ContentPage(params);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one memo between a collection page's read and its metadata", async () => {
    const { load, ask } = lookup();
    const { generateMetadata } = createContentRoute({
      collections: ["pages"],
      nextly: contentReader(ask),
      render: () => null,
      buildMetadata: async () => {
        await ask();
        return {};
      },
    });
    await generateMetadata(params);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one memo between a Single's read and its render", async () => {
    const { load, ask } = lookup();
    const { SinglePage } = createSingleRoute({
      slug: "homepage",
      nextly: singleReader(ask),
      render: async () => ask(),
    });
    await SinglePage();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one memo between a Single's read and its metadata", async () => {
    const { load, ask } = lookup();
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: singleReader(ask),
      render: () => null,
      buildMetadata: async () => {
        await ask();
        return {};
      },
    });
    await generateMetadata();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
