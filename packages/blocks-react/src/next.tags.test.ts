/**
 * What `createBlocksPage` asks the content route to cache the page under.
 *
 * In its own file because it replaces the route factory to capture the config
 * it receives, and that substitution is hoisted over a whole module — the rest
 * of the suite drives the real factory and must keep doing so.
 *
 * The real implementation still runs. What is asserted is the composition: the
 * helper's job here is to widen the route's tags, and the route's own caching
 * belongs to `nextly` to test.
 */
import { describe, expect, it, vi } from "vitest";

const created = vi.fn();

vi.mock("nextly/runtime", async importActual => {
  const actual = await importActual<typeof import("nextly/runtime")>();
  return {
    ...actual,
    createContentRoute: vi.fn((config: unknown) => {
      created(config);
      return actual.createContentRoute(
        config as Parameters<typeof actual.createContentRoute>[0]
      );
    }),
  };
});

const { createBlocksPage } = await import("./next");

describe("createBlocksPage cache tags", () => {
  it("adds the records its blocks resolve, keeping the caller's own", () => {
    created.mockClear();
    createBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      tags: ["custom-tag"],
    });

    const tags = (created.mock.calls[0][0] as { tags: string[] }).tags;

    // The caller's tag survives: a site that named a related collection must
    // not lose it because the helper had tags of its own to add.
    expect(tags).toContain("custom-tag");
    // Media, because the default resolver reads media records through
    // `findByID`, which contributes no tag of its own.
    expect(tags.some(tag => tag.includes("media"))).toBe(true);
    // And every collection the route resolves, because an entry-path lookup
    // reads one of those the same untagged way.
    expect(tags.some(tag => tag.includes("pages"))).toBe(true);
    expect(tags.some(tag => tag.includes("posts"))).toBe(true);
  });

  it("tags a site's own media collection when one is named", () => {
    created.mockClear();
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      mediaCollection: "photos",
    });

    const tags = (created.mock.calls[0][0] as { tags: string[] }).tags;

    expect(tags.some(tag => tag.includes("photos"))).toBe(true);
  });

  it("tags the single a siteStyles provider reads", () => {
    // A provider is called per render, which is not the same as being read per
    // render: on a pre-rendered route the whole render is cached, and only a
    // tag the page carries rebuilds it. The Direct API read inside the provider
    // contributes none, so without this an admin's save invalidates
    // `nextly:single:site-style` and no cache entry anywhere names it — the
    // page keeps serving the old sheet, which looks exactly like the style
    // never saving.
    created.mockClear();
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      siteStyles: { read: () => undefined, singles: ["site-style"] },
    });

    const tags = (created.mock.calls[0][0] as { tags: string[] }).tags;

    expect(tags).toContain("nextly:single:site-style");
  });

  it("adds no single tag when the provider declares it reads none", () => {
    // The control: the tag comes from the slug the route stated, not from the
    // helper deciding that any route using siteStyles reads one particular
    // single. A host can store its style anywhere.
    //
    // An empty array is a STATEMENT here, not an omission — the provider and
    // its dependencies are one type, so a provider without them does not
    // compile and the unsafe configuration is no longer expressible.
    created.mockClear();
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      siteStyles: { read: () => undefined, singles: [] },
    });

    const tags = (created.mock.calls[0][0] as { tags: string[] }).tags;

    expect(tags.some(tag => tag.startsWith("nextly:single:"))).toBe(false);
  });
});
