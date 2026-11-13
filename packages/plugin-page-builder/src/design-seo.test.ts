/**
 * Which design the service asks the route's derivation about for a page:
 * a page's own blocks field, an entry's own published design or its
 * collection's published template, and nothing where no design draws it.
 */
import { describe, expect, it, vi } from "vitest";

import { designSeoService, type DeriveDesignValues } from "./design-seo";

const OWN = { formatVersion: 1, kind: "template", nodes: [], own: true };
const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

/** A Direct API over the templates: posts' template, and p2's own design. */
function nextly() {
  return {
    find: vi.fn(async ({ where }: { where: unknown }) => {
      const asked = JSON.stringify(where);
      const items: Record<string, unknown>[] = [];
      if (asked.includes("posts")) {
        items.push({ id: "t1", collection: "posts", content: TEMPLATE });
      }
      if (asked.includes("posts/p2")) {
        items.push({ id: "t2", entry: "posts/p2", content: OWN });
      }
      return { items };
    }),
  };
}

function service(derive: DeriveDesignValues) {
  const api = nextly();
  return {
    api,
    service: designSeoService({
      nextly: async () => api,
      pages: { collection: "pages", field: "content" },
      templatesCollection: "templates",
      derive,
    }),
  };
}

describe("the design level of a page", () => {
  it("is a page's own blocks field, derived as the pages route derives it", async () => {
    const derive = vi.fn<DeriveDesignValues>(async () => ({ title: "About" }));
    const { service: s, api } = service(derive);

    await expect(
      s.valuesFor({ collection: "pages", entry: { id: "a", slug: "about" } })
    ).resolves.toEqual({ title: "About" });
    expect(derive).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "pages", field: "content" })
    );
    expect(derive.mock.calls[0]?.[0].document).toBeUndefined();
    expect(api.find).not.toHaveBeenCalled();
  });

  it("is an entry's own published design where it has one", async () => {
    const derive = vi.fn<DeriveDesignValues>(async () => ({ title: "Own" }));
    const { service: s } = service(derive);

    await s.valuesFor({
      collection: "posts",
      entry: { id: "p2" },
      locale: "de",
    });

    expect(derive).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        document: OWN,
        locale: "de",
      })
    );
  });

  it("is the collection's published template for an entry with no design of its own, and for one never saved", async () => {
    const derive = vi.fn<DeriveDesignValues>(async () => ({ title: "T" }));
    const { service: s } = service(derive);

    await s.valuesFor({ collection: "posts", entry: { id: "p1" } });
    await s.valuesFor({ collection: "posts", entry: { title: "New" } });

    expect(derive.mock.calls.map(([args]) => args.document)).toEqual([
      TEMPLATE,
      TEMPLATE,
    ]);
  });

  it("is the design handed in, unsaved, whatever is saved", async () => {
    const derive = vi.fn<DeriveDesignValues>(async () => ({ title: "Draft" }));
    const { service: s, api } = service(derive);
    const draft = { formatVersion: 1, kind: "template", nodes: [] };

    await s.valuesFor({
      collection: "posts",
      entry: { id: "p2" },
      document: draft,
    });

    expect(derive.mock.calls[0]?.[0].document).toBe(draft);
    expect(api.find).not.toHaveBeenCalled();
  });

  it("says what drew the page: a page's own blocks and an entry's own design are its design, a collection's template its template", async () => {
    const derive = vi.fn<DeriveDesignValues>(async () => ({ title: "x" }));
    const { service: s } = service(derive);

    const page = await s.designFor({ collection: "pages", entry: { id: "a" } });
    const own = await s.designFor({ collection: "posts", entry: { id: "p2" } });
    const shared = await s.designFor({
      collection: "posts",
      entry: { id: "p1" },
    });

    expect([page?.drawnBy, own?.drawnBy, shared?.drawnBy]).toEqual([
      "design",
      "design",
      "template",
    ]);
    expect(shared?.values).toEqual({ title: "x" });
    await expect(
      s.designFor({ collection: "news", entry: { id: "n1" } })
    ).resolves.toBeUndefined();
  });

  it("is nothing where no design draws the entry", async () => {
    const derive = vi.fn<DeriveDesignValues>(async () => ({ title: "x" }));
    const { service: s } = service(derive);

    await expect(
      s.valuesFor({ collection: "news", entry: { id: "n1" } })
    ).resolves.toBeUndefined();
    expect(derive).not.toHaveBeenCalled();
  });
});
