/**
 * A recovery point is written from the editor's live values, on a debounce,
 * without the form ever appearing saved.
 *
 * Driven through a REAL `useForm` rather than a stubbed one. The properties
 * under test are all about how this hook interacts with react-hook-form's own
 * behaviour -- which updates count as a user edit, what `getValues` returns
 * mid-edit, whether the dirty flag moves -- and a stub would be a second
 * implementation of exactly the behaviour being relied on.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { saveSpy } = vi.hoisted(() => ({ saveSpy: vi.fn() }));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { saveAutosave: saveSpy },
}));

import { autosaveScopeFor, useDocumentAutosave } from "../useDocumentAutosave";

const SCOPE = { kind: "collection" as const, slug: "posts", entryId: "e1" };
const DEBOUNCE = 2000;

/** The hook driving a real form, so the two can be exercised together. */
function useHarness(scope: typeof SCOPE | null = SCOPE, enabled = true) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { title: "" },
  });
  const autosave = useDocumentAutosave({
    scope,
    form,
    debounceMs: DEBOUNCE,
    enabled,
  });
  // `isDirty` is READ DURING RENDER and returned, deliberately. react-hook-form
  // tracks formState by which keys a render reads, so a test that reaches for
  // `form.formState.isDirty` after the fact observes an unsubscribed proxy and
  // reads false however dirty the form is -- which would let a hook that DID
  // clear the flag pass this suite.
  return { form, autosave, isDirty: form.formState.isDirty };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  saveSpy.mockResolvedValue({
    updatedAt: "2026-08-17T09:00:00.000Z",
    locale: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentAutosave", () => {
  it("records the values in the editor after the debounce", async () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.form.setValue("title", "hello", { shouldDirty: true });
    });
    expect(saveSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith(SCOPE, { title: "hello" }, null);
  });

  /**
   * The point of the debounce. Recording per keystroke would put one request
   * per character on the wire, and each rewrites the same row.
   */
  it("coalesces a burst of edits into one recording", async () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.form.setValue("title", "a", { shouldDirty: true });
      result.current.form.setValue("title", "ab", { shouldDirty: true });
      result.current.form.setValue("title", "abc", { shouldDirty: true });
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    // The LAST value, not the first: the recording is taken when the timer
    // fires, so it must reflect everything typed during the quiet period.
    expect(saveSpy).toHaveBeenCalledWith(SCOPE, { title: "abc" }, null);
  });

  /**
   * The property that separates a recovery point from a save. Clearing the
   * dirty flag would let the unsaved-changes guard fall silent, and someone
   * would navigate away from uncommitted work believing it was stored.
   */
  it("leaves the form dirty after recording", async () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.form.setValue("title", "hello", { shouldDirty: true });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

    expect(result.current.isDirty).toBe(true);
  });

  /**
   * Loading a document calls `reset`, which installs the loaded values as the
   * new defaults and leaves the form CLEAN. Recording on it would write the
   * document's own stored values back as a recovery point the instant the page
   * opened, and every reader would then be offered a recovery identical to what
   * they were already looking at.
   */
  it("does not record when the form is filled programmatically", async () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.form.reset({ title: "loaded from the server" });
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE * 2);
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  /**
   * A new entry has no id until it has been created once, and the endpoint
   * addresses a document that exists. Recording must be off rather than
   * addressed at an invented id.
   */
  it("records nothing while the document has no address", async () => {
    const { result } = renderHook(() => useHarness(null));

    act(() => {
      result.current.form.setValue("title", "hello", { shouldDirty: true });
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE * 2);
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("records nothing while disabled", async () => {
    const { result } = renderHook(() => useHarness(SCOPE, false));

    act(() => {
      result.current.form.setValue("title", "hello", { shouldDirty: true });
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE * 2);
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  /**
   * The timestamp is the SERVER's, read from the response. Stamping it locally
   * would make "saved 2 minutes ago" drift with an unsynchronised browser
   * clock, and it would read as saved even when the request never landed.
   */
  it("reports when the server stored it, not when the request was sent", async () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.form.setValue("title", "hello", { shouldDirty: true });
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    await waitFor(() =>
      expect(result.current.autosave.lastSavedAt).toEqual(
        new Date("2026-08-17T09:00:00.000Z")
      )
    );
    expect(result.current.autosave.status).toBe("saved");
  });

  /**
   * A failed recording is reported through status and never thrown. It is work
   * nobody asked for, so it must not surface an error over the editor or
   * interrupt typing.
   */
  it("reports a failure as status rather than throwing", async () => {
    saveSpy.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.form.setValue("title", "hello", { shouldDirty: true });
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    await waitFor(() => expect(result.current.autosave.status).toBe("error"));
    // Still dirty, still editable: a failed recording changes nothing about
    // the form it was taken from.
    expect(result.current.isDirty).toBe(true);
  });
});

/**
 * The rule that decides whether recording happens at all, kept out of the
 * editors so it is answered once and can be asserted directly.
 *
 * A rendered editor cannot cover this cheaply, and leaving it inline meant the
 * guard could be removed with no test moving.
 */
describe("autosaveScopeFor", () => {
  it("addresses a saved collection entry by its id", () => {
    expect(autosaveScopeFor("collection", "posts", "e1")).toEqual({
      kind: "collection",
      slug: "posts",
      entryId: "e1",
    });
  });

  it("addresses a saved Single by its document id", () => {
    expect(autosaveScopeFor("single", "settings", "s1")).toEqual({
      kind: "single",
      slug: "settings",
      documentId: "s1",
    });
  });

  /**
   * The guard. An entry that has never been saved has no id, and the endpoint
   * addresses a document that exists -- so recording must be OFF rather than
   * aimed at an empty or invented id, which would address a route that cannot
   * resolve.
   */
  it("refuses to address a document that has never been saved", () => {
    expect(autosaveScopeFor("collection", "posts", "")).toBeNull();
    expect(autosaveScopeFor("single", "settings", "")).toBeNull();
    // The absent forms too, so a caller holding an optional id can pass it
    // straight through. Requiring a string here only moved the decision into a
    // `?? ""` at each call site, where the helper's own tests cannot see it.
    expect(autosaveScopeFor("single", "settings", undefined)).toBeNull();
    expect(autosaveScopeFor("collection", "posts", null)).toBeNull();
  });

  it("refuses to address a document with no slug", () => {
    expect(autosaveScopeFor("collection", "", "e1")).toBeNull();
  });
});
