/**
 * A write of the entry's status alone: what a user who may publish, and not
 * change the document, sends to publish or unpublish it. It names nothing
 * but the status, so the server judges it by that permission alone, and it
 * does not wait on the form, which such a user cannot change.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
// Whether the read asks translation state, which the save keys its cache on.
vi.mock("@admin/hooks/useCanRequest", () => ({
  useAsksTranslationStatus: () => false,
}));
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useEntryForm } from "../useEntryForm";

const collection = {
  name: "pages",
  label: "Pages",
  fields: [{ name: "title", type: "text", label: "Title", required: true }],
} as never;
// The required title is empty: the form would refuse a save of it.
const entry = { id: "e1", title: "" };

afterEach(() => {
  update.mockReset();
});

describe("useEntryForm writeStatus", () => {
  it("publishes with the status alone, though the form would refuse a save", async () => {
    update.mockResolvedValue({ item: { id: "e1", status: "published" } });
    const { result } = renderHook(() =>
      useEntryForm({ collection, entry, mode: "edit" })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.writeStatus("published");
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ status: "published" });
    expect(outcome).toEqual({
      ok: true,
      item: { id: "e1", status: "published" },
    });
  });

  it("unpublishes with the status alone", async () => {
    update.mockResolvedValue({ item: { id: "e1", status: "draft" } });
    const { result } = renderHook(() =>
      useEntryForm({ collection, entry, mode: "edit" })
    );

    await act(async () => {
      await result.current.writeStatus("draft");
    });

    expect(update).toHaveBeenCalledWith({ status: "draft" });
  });

  it("names a refused write as failed, with the server's own words", async () => {
    update.mockRejectedValue(new Error("You may not publish this."));
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useEntryForm({ collection, entry, mode: "edit", onError })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.writeStatus("published");
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      ok: false,
      reason: "failed",
      message: "You may not publish this.",
    });
  });
});
