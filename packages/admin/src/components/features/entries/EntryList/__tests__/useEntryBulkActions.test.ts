/**
 * Which bulk actions the entry list offers, and so whether rows can be
 * selected at all: delete with the delete permission, publish and unpublish
 * with theirs on a collection with the Draft / Published lifecycle.
 *
 * The property that separates it from a plausible broken one is that a
 * permission the collection cannot use offers nothing: publish held on a
 * collection without a status is not a bulk action, so a reader holding it
 * gets no checkboxes.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionForColumns } from "../EntryTableColumns";
import { useEntryBulkActions } from "../useEntryBulkActions";

const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => false),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

/** A caller holding exactly these permission slugs. */
const holding = (...slugs: string[]): void => {
  canFor.mockImplementation(slug => slugs.includes(slug));
};

const posts: CollectionForColumns = {
  slug: "posts",
  fields: [],
  status: true,
};

const notes: CollectionForColumns = { slug: "notes", fields: [] };

beforeEach(() => {
  canFor.mockReset();
  holding();
});

describe("useEntryBulkActions", () => {
  it("offers nothing to a caller who may only read", () => {
    holding("read-posts");
    const { result } = renderHook(() => useEntryBulkActions(posts));
    expect(result.current).toEqual({
      delete: false,
      publish: false,
      unpublish: false,
      any: false,
    });
  });

  it("offers delete alone with the delete permission", () => {
    holding("read-posts", "delete-posts");
    const { result } = renderHook(() => useEntryBulkActions(posts));
    expect(result.current).toEqual({
      delete: true,
      publish: false,
      unpublish: false,
      any: true,
    });
  });

  it("offers publish and unpublish each with its own permission", () => {
    holding("read-posts", "unpublish-posts");
    const { result } = renderHook(() => useEntryBulkActions(posts));
    expect(result.current).toEqual({
      delete: false,
      publish: false,
      unpublish: true,
      any: true,
    });
  });

  it("offers no publish on a collection without the Draft / Published lifecycle", () => {
    holding("read-notes", "publish-notes", "unpublish-notes");
    const { result } = renderHook(() => useEntryBulkActions(notes));
    expect(result.current).toEqual({
      delete: false,
      publish: false,
      unpublish: false,
      any: false,
    });
  });

  it("offers nothing without a collection", () => {
    canFor.mockImplementation(() => true);
    const { result } = renderHook(() => useEntryBulkActions(undefined));
    expect(result.current.any).toBe(false);
  });
});
