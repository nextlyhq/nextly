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

// The reader reviews somewhere: the global waiting scope says so. It decides nothing here, since
// whether moves are offered on a collection is judged on that collection's own steps.
vi.mock("@admin/hooks/queries/useWaitingForMe", () => ({
  useWaitingScope: () => ({ data: { reviews: true, stages: 1 } }),
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
      workflowMoves: false,
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
      workflowMoves: false,
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
      workflowMoves: false,
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
      workflowMoves: false,
      any: false,
    });
  });

  it("offers no delete on a collection deleted through an action of its own", () => {
    holding("read-posts", "delete-posts", "publish-posts");
    const { result } = renderHook(() =>
      useEntryBulkActions({ ...posts, disableDelete: true })
    );
    expect(result.current).toEqual({
      delete: false,
      publish: true,
      unpublish: false,
      workflowMoves: false,
      any: true,
    });
  });

  it("offers nothing without a collection", () => {
    canFor.mockImplementation(() => true);
    const { result } = renderHook(() => useEntryBulkActions(undefined));
    expect(result.current.any).toBe(false);
  });

  it("offers the workflow's moves on a collection a workflow holds, to an editor or a reviewer of it alone", () => {
    const held: CollectionForColumns = {
      ...posts,
      workflow: {
        slug: "review",
        label: "Review",
        steps: [
          { name: "submit", label: "Submit", kind: "submit", action: "update" },
          { name: "clear", label: "Clear", kind: "approve", action: "approve" },
          {
            name: "bounce",
            label: "Send back",
            kind: "request-changes",
            action: "sign-off",
          },
        ],
      },
    };
    holding("read-posts");
    expect(
      renderHook(() => useEntryBulkActions(held)).result.current
    ).toMatchObject({ workflowMoves: false, any: false });

    // An editor of the collection.
    holding("read-posts", "update-posts");
    expect(
      renderHook(() => useEntryBulkActions(held)).result.current
    ).toMatchObject({ workflowMoves: true, any: true });

    // A reviewer who may send work back on this collection, and edits nothing.
    holding("read-posts", "sign-off-posts");
    expect(
      renderHook(() => useEntryBulkActions(held)).result.current
    ).toMatchObject({ workflowMoves: true, any: true });

    // A reviewer of another collection only: no step here is theirs, so no checkbox leads them
    // to moves every document would refuse.
    holding("read-posts", "sign-off-pages");
    expect(
      renderHook(() => useEntryBulkActions(held)).result.current
    ).toMatchObject({ workflowMoves: false, any: false });

    // No workflow, no moves, whatever the reader holds.
    holding("read-posts", "update-posts");
    expect(
      renderHook(() => useEntryBulkActions(posts)).result.current
    ).toMatchObject({ workflowMoves: false });
  });
});
