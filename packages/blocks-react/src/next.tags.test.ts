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
});
