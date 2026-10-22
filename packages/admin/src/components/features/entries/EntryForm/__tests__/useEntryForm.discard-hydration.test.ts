/**
 * After a discard, nothing saves until the editor has the document back with
 * its stored links.
 *
 * The discard answers with the live row as the API populates it, which leaves
 * out a related item the editor may not read. The form shows that row at once,
 * but a save of it would delete those links, so saving waits until the page
 * hands the form the merged document again.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { update, discard } = vi.hoisted(() => ({
  update: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({ mutateAsync: discard, isPending: false }),
}));

import { useEntryForm } from "../useEntryForm";

const collection = {
  name: "posts",
  label: "Posts",
  fields: [
    { name: "title", type: "text", label: "Title" },
    {
      name: "tags",
      type: "relationship",
      label: "Tags",
      relationTo: "tags",
      hasMany: true,
    },
  ],
} as never;

const merged = {
  id: "e1",
  title: "Draft title",
  tags: [{ id: "t1", __restrictedReference: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({ item: { id: "e1" } });
  // The live row as the API populates it: the hidden tag is left out.
  discard.mockResolvedValue({ item: { id: "e1", title: "Live", tags: [] } });
});

describe("useEntryForm — after a discard", () => {
  it("holds saving until the merged document arrives, then saves its links", async () => {
    const { result, rerender } = renderHook(
      ({ entry }) => useEntryForm({ collection, entry, mode: "edit" }),
      { initialProps: { entry: merged as never } }
    );

    await act(async () => {
      await result.current.handleDiscardWorkingDraft();
    });
    expect(result.current.isSubmitting).toBe(true);
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(update).not.toHaveBeenCalled();

    // The page's reads settle on the live row, merged with its stored links.
    rerender({
      entry: { id: "e1", title: "Live", tags: merged.tags } as never,
    });
    expect(result.current.isSubmitting).toBe(false);
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Live", tags: ["t1"] })
    );
  });
});
