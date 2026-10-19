/**
 * A save that fails leaves the form exactly as the author left it.
 *
 * The update writes the payload into the entry's cache before the request
 * (an optimistic update) and puts the old entry back when the request fails.
 * The editor reads that cache, so both arrive here as a changed entry. What
 * these pin is that neither costs the author anything: what they typed and did
 * not manage to save is still on screen, still unsaved, after the failure.
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
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useEntryForm } from "../useEntryForm";

const collection = {
  name: "posts",
  label: "Posts",
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;
const stored = {
  id: "e1",
  title: "Shot a",
  updatedAt: "2026-10-19T02:00:00.000Z",
};

afterEach(() => {
  update.mockReset();
});

function render() {
  return renderHook(
    ({ entry }: { entry: Record<string, unknown> }) =>
      useEntryForm({ collection, entry: entry as never, mode: "edit" }),
    { initialProps: { entry: stored } }
  );
}

describe("a save that fails", () => {
  it("keeps what was typed when the optimistic copy is rolled back", async () => {
    // The request stays open until the test fails it, as a slow server does.
    let fail: (error: Error) => void = () => {};
    update.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const { result, rerender } = render();
    act(() => {
      result.current.form.setValue("title", "Shot ab", { shouldDirty: true });
    });

    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.handleSubmit();
    });
    // Validation runs first; the request is open once the update is called.
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    // The optimistic write, while the save is in flight: the payload merged
    // over the cached entry, a new object with the stored version unchanged.
    act(() => {
      rerender({ entry: { ...stored, title: "Shot ab" } });
    });
    // The request fails, and the cache is put back to the entry as stored.
    await act(async () => {
      fail(new Error("The server is unavailable."));
      await saving;
    });
    act(() => {
      rerender({ entry: stored });
    });

    expect(result.current.form.getValues("title")).toBe("Shot ab");
    expect(result.current.form.formState.isDirty).toBe(true);
  });

  it("still starts from a genuinely new version of the entry", () => {
    // The control: a version saved elsewhere (a colleague, a restore) is not
    // this editor's own save, and the form starts from it as before.
    const { result, rerender } = render();
    act(() => {
      rerender({
        entry: {
          ...stored,
          title: "Theirs",
          updatedAt: "2026-10-19T03:00:00.000Z",
        },
      });
    });

    expect(result.current.form.getValues("title")).toBe("Theirs");
  });

  it("changes nothing the author typed when the write is refused", async () => {
    update.mockRejectedValue(new Error("The server is unavailable."));
    const { result } = render();
    act(() => {
      result.current.form.setValue("title", "Shot ab", { shouldDirty: true });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.form.getValues("title")).toBe("Shot ab");
    expect(result.current.form.formState.isDirty).toBe(true);
  });
});
