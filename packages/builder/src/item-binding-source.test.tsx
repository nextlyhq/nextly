// @vitest-environment jsdom

/**
 * The list item a block sits in, as the binding controls read it: what the
 * host is asked for, and for which list.
 */
import {
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ContentServices } from "./content-controls";
import { useListItem } from "./item-binding-source";

/** A page holding one list, fed as given, with block `h` in its entry slot. */
function pageWithList(props: Record<string, unknown>): BlockDocument {
  const heading = { id: "h", type: "core/heading", version: 1, props: {} };
  const list = {
    id: "list",
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props,
    slots: { [LIST_ENTRY_SLOT]: [heading] },
  } as BlockNode;
  return { formatVersion: 1, kind: "page", nodes: [list] } as BlockDocument;
}

/** The host's two list reads, watched. */
function services(): ContentServices & {
  listLoopCollections: ReturnType<typeof vi.fn>;
  listCustomSources: ReturnType<typeof vi.fn>;
} {
  return {
    listLoopCollections: vi.fn(async () => [
      {
        slug: "posts",
        label: "Posts",
        singular: "Post",
        fields: [],
        readable: [{ name: "title", type: "text" }],
      },
    ]),
    listCustomSources: vi.fn(async () => []),
  };
}

describe("the list item a block sits in", () => {
  it("asks for no named queries for a list fed by a collection", async () => {
    // Named queries feed only lists that name one, and their read is retried
    // while it fails, so a list that needs none never starts it.
    const host = services();
    const { result } = renderHook(() =>
      useListItem(pageWithList({ collection: "posts" }), "h", host, true)
    );
    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.name).toBe("Each post in the list");
    expect(host.listCustomSources).not.toHaveBeenCalled();
  });

  it("asks for the named queries of a list fed by one", async () => {
    // The control: a list that names a query reads them, to find its rows.
    const host = services();
    renderHook(() =>
      useListItem(
        pageWithList({ namedQuery: { name: "featured" } }),
        "h",
        host,
        true
      )
    );
    await waitFor(() => expect(host.listCustomSources).toHaveBeenCalled());
  });

  it("asks the host for nothing when not wanted", () => {
    const host = services();
    const { result } = renderHook(() =>
      useListItem(pageWithList({ collection: "posts" }), "h", host, false)
    );
    expect(result.current).toBeUndefined();
    expect(host.listLoopCollections).not.toHaveBeenCalled();
    expect(host.listCustomSources).not.toHaveBeenCalled();
  });
});
