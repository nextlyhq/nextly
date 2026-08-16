/**
 * Autosave must never run the form's validator.
 *
 * Both entry forms are deliberately `mode: "onSubmit"` so nothing complains
 * until the author asks to save. Autosave fires on a timer with the author
 * doing nothing, so routing it through `handleSubmit` instead of `getValues`
 * would light up inline errors and the top-level toast while they are still
 * mid-field -- and would additionally DROP the save, because `handleSubmit`
 * does not invoke its callback when the form is invalid. Losing exactly the
 * half-finished work a recovery point exists to keep.
 *
 * That swap is silent: types allow it, and a form filled in correctly behaves
 * identically. These tests fail on it.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mutations = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ item: {} }),
  update: vi.fn().mockResolvedValue({ item: {} }),
  remove: vi.fn().mockResolvedValue(undefined),
  discard: vi.fn().mockResolvedValue({ item: {} }),
}));

const versionApiMock = vi.hoisted(() => ({
  autosave: vi.fn().mockResolvedValue({ message: "ok" }),
  // The recovery read the editor makes on open. Null: these tests are about
  // the write path, and an offered snapshot would replace the form values.
  getAutosave: vi.fn().mockResolvedValue(null),
}));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: mutations.create, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: mutations.update, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: mutations.remove, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({
    mutateAsync: mutations.discard,
    isPending: false,
  }),
}));
vi.mock("@admin/services/versionApi", () => ({ versionApi: versionApiMock }));

import { useEntryForm } from "../useEntryForm";

// A required field left empty is what separates the two implementations: it is
// valid input for a recovery point and invalid input for a submit.
const COLLECTION = {
  name: "posts",
  fields: [
    { name: "title", type: "text", required: true },
    { name: "body", type: "text" },
  ],
} as unknown as Parameters<typeof useEntryForm>[0]["collection"];

const ENTRY = {
  id: "e1",
  title: "",
  body: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as Parameters<typeof useEntryForm>[0]["entry"];

async function flushAsync() {
  // The recovery read settles on the microtask queue; fake timers make
  // `waitFor` unusable because it polls on real ones.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderEditForm() {
  return renderHook(() =>
    useEntryForm({ collection: COLLECTION, entry: ENTRY, mode: "edit" })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("entry autosave", () => {
  it("stores a snapshot that would fail validation, and raises no errors", async () => {
    const { result } = renderEditForm();

    // `title` is required and stays empty: a submit would refuse this.
    act(() => {
      result.current.form.setValue("body", "half a thought", {
        shouldDirty: true,
      });
      result.current.autosave.notifyChange();
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(versionApiMock.autosave).toHaveBeenCalledTimes(1);
    const [scope, snapshot] = versionApiMock.autosave.mock.calls[0] ?? [];
    expect(scope).toEqual({
      kind: "collection",
      slug: "posts",
      entryId: "e1",
    });
    expect(snapshot).toMatchObject({ body: "half a thought" });

    // The author is mid-field: nothing may have complained at them yet.
    expect(result.current.form.formState.errors).toEqual({});
    expect(result.current.form.formState.submitCount).toBe(0);
  });

  it("leaves the form dirty after a recovery point is stored", async () => {
    // A recovery point is not a save. Clearing the dirty flag would drop the
    // unsaved-changes guard and let someone leave believing they had published.
    const { result } = renderEditForm();

    act(() => {
      result.current.form.setValue("body", "unsaved", { shouldDirty: true });
      result.current.autosave.notifyChange();
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(versionApiMock.autosave).toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);
  });

  it("offers a recovery point that is newer than the saved document", async () => {
    versionApiMock.getAutosave.mockResolvedValueOnce({
      updatedAt: "2026-01-02T00:00:00.000Z",
      snapshot: { title: "recovered", body: "recovered body" },
    });
    const { result } = renderEditForm();

    await flushAsync();

    expect(result.current.recovery.savedAt).not.toBeNull();

    act(() => {
      result.current.recovery.restore();
    });

    expect(result.current.form.getValues()).toMatchObject({
      title: "recovered",
      body: "recovered body",
    });
    // Restoring shows unsaved work rather than persisting it, so the
    // leave-page guard has to keep warning.
    expect(result.current.isDirty).toBe(true);
  });

  it("does not offer a recovery point older than the saved document", async () => {
    // It describes work the author has since committed; offering it would
    // invite them to undo their own save.
    versionApiMock.getAutosave.mockResolvedValueOnce({
      updatedAt: "2025-12-31T00:00:00.000Z",
      snapshot: { title: "stale" },
    });
    const { result } = renderEditForm();

    await flushAsync();

    expect(result.current.recovery.savedAt).toBeNull();
  });

  it("does not autosave when the schema turns it off", async () => {
    // A stated preference. Writing recovery rows anyway would make the
    // documented setting inert.
    const off = {
      ...COLLECTION,
      versions: { enabled: true, drafts: { autosave: { enabled: false } } },
    } as unknown as Parameters<typeof useEntryForm>[0]["collection"];

    const { result } = renderHook(() =>
      useEntryForm({ collection: off, entry: ENTRY, mode: "edit" })
    );

    act(() => {
      result.current.form.setValue("body", "typed", { shouldDirty: true });
      result.current.autosave.notifyChange();
      result.current.autosave.saveNow();
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(versionApiMock.autosave).not.toHaveBeenCalled();
    // And it must not ASK for one either: offering a recovery point for a
    // document that stores none would be an empty promise.
    expect(versionApiMock.getAutosave).not.toHaveBeenCalled();
  });

  it("still autosaves when the schema says nothing about it", async () => {
    // Absence is not a preference. Reading it as "off" would silently withdraw
    // recovery from every document whose owner never expressed a view.
    const { result } = renderEditForm();

    act(() => {
      result.current.form.setValue("body", "typed", { shouldDirty: true });
      result.current.autosave.notifyChange();
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(versionApiMock.autosave).toHaveBeenCalled();
  });

  it("does not autosave while creating", async () => {
    // There is no stored record for a snapshot to attach to yet.
    const { result } = renderHook(() =>
      useEntryForm({ collection: COLLECTION, mode: "create" })
    );

    act(() => {
      result.current.form.setValue("body", "typed", { shouldDirty: true });
      result.current.autosave.notifyChange();
      result.current.autosave.saveNow();
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(versionApiMock.autosave).not.toHaveBeenCalled();
  });
});
