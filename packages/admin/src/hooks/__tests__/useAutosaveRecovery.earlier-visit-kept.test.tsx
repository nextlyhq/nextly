/**
 * A recovery point from an earlier visit is kept until its author answers it.
 *
 * Each author has ONE recovery point per document. An editor opened again,
 * in a new tab or after the old one froze, is offered that point; its first
 * edit used to be recorded over it about two seconds later, so the earlier
 * unsaved work was gone for good and Restore brought back only the new edit.
 * The recordings of the new visit now wait until the author has answered the
 * offer: restored it, discarded it, or saved.
 *
 * Driven through the real recovery hook and the real recording machinery,
 * keyed to the same document as the editor's recorders are, with the network
 * mocked: the property is what reaches the server, and when.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSpy, putSpy } = vi.hoisted(() => ({
  getSpy: vi.fn(),
  putSpy: vi.fn(),
}));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { getAutosave: getSpy, saveAutosave: putSpy },
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en", locales: [], enabled: true }),
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "author-1",
}));

import { useAutosaveRecovery } from "../useAutosaveRecovery";
import { documentRecordingKey } from "../useDocumentAutosave";
import { useSnapshotAutosave } from "../useSnapshotAutosave";

const SCOPE = { kind: "collection" as const, slug: "pages", entryId: "p1" };
const STORED = { title: "stored" };
/** The earlier visit's work: a heading and a subtitle never saved. */
const EARLIER = {
  snapshot: { title: "stored", blocks: ["heading", "subtitle"] },
  updatedAt: "2026-11-24T10:00:00.000Z",
  locale: null,
};
const DEBOUNCE = 2000;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The editor as a new visit opens it: the offer, and a recorder of the same
 * document (the page builder's canvas records through one like it).
 */
function useNewVisit(savedCount = 0) {
  const form = useForm<Record<string, unknown>>({ defaultValues: STORED });
  const recovery = useAutosaveRecovery({ scope: SCOPE, form, savedCount });
  const recorder = useSnapshotAutosave({
    identity: `${documentRecordingKey(SCOPE)}:`,
    document: documentRecordingKey(SCOPE),
    save: () => putSpy({ blocks: ["divider"] }),
    debounceMs: DEBOUNCE,
  });
  return { recovery, recorder };
}

function openNewVisit() {
  return renderHook(({ savedCount }) => useNewVisit(savedCount), {
    wrapper,
    initialProps: { savedCount: 0 },
  });
}

/** The debounce given every chance to fire. */
async function letTimersRun() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);
  });
}

/** An edit in the new visit, and the debounce given every chance to fire. */
async function editAndWait(schedule: () => void) {
  act(() => schedule());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  window.sessionStorage.clear();
  putSpy.mockResolvedValue({ updatedAt: "2026-11-24T10:05:00.000Z" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a recovery point from an earlier visit", () => {
  it("is not recorded over by the new visit's first edit", async () => {
    getSpy.mockResolvedValue(EARLIER);
    const { result } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

    await editAndWait(result.current.recorder.schedule);

    expect(putSpy).not.toHaveBeenCalled();
  });

  it("is not recorded over while the offer is still being read", async () => {
    let answer: (point: typeof EARLIER) => void = () => {};
    getSpy.mockReturnValue(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    const { result } = openNewVisit();

    await editAndWait(result.current.recorder.schedule);
    expect(putSpy).not.toHaveBeenCalled();

    await act(async () => {
      answer(EARLIER);
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);
    });
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("is still kept after Not now, which promises to keep it", async () => {
    getSpy.mockResolvedValue(EARLIER);
    const { result } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

    act(() => result.current.recovery.dismiss());
    await editAndWait(result.current.recorder.schedule);

    expect(putSpy).not.toHaveBeenCalled();
  });

  it("lets the held edit be recorded once the author restores it", async () => {
    getSpy.mockResolvedValue(EARLIER);
    const { result } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
    await editAndWait(result.current.recorder.schedule);
    expect(putSpy).not.toHaveBeenCalled();

    // Asked about again before it is restored: still the same point.
    act(() => result.current.recovery.restore());
    await waitFor(() => expect(result.current.recovery.offer).toBeNull());
    await letTimersRun();

    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it("lets the held edit be recorded once the author discards it", async () => {
    getSpy.mockResolvedValue(EARLIER);
    const { result } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
    await editAndWait(result.current.recorder.schedule);

    act(() => result.current.recovery.discard());
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    await letTimersRun();

    // The emptying, through the recording's own write, then the held edit.
    expect(putSpy.mock.calls).toEqual([
      [SCOPE, {}, null],
      [{ blocks: ["divider"] }],
    ]);
  });

  it("lets recording go on once a save has stored the page", async () => {
    getSpy.mockResolvedValue(EARLIER);
    const { result, rerender } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

    // A save deletes the point on the server: nothing is left to keep.
    rerender({ savedCount: 1 });
    await editAndWait(result.current.recorder.schedule);

    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it("holds nothing where there is no earlier work", async () => {
    getSpy.mockResolvedValue(null);
    const { result } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.isResolved).toBe(true));

    await editAndWait(result.current.recorder.schedule);

    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it("holds nothing where the point holds the stored page", async () => {
    getSpy.mockResolvedValue({ ...EARLIER, snapshot: STORED });
    const { result } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.isResolved).toBe(true));

    await editAndWait(result.current.recorder.schedule);

    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it("holds nothing once the read fails, rather than recording nothing", async () => {
    getSpy.mockRejectedValue(new Error("offline"));
    const { result } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.isResolved).toBe(true));

    await editAndWait(result.current.recorder.schedule);

    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it("stops holding once the editor closes", async () => {
    getSpy.mockResolvedValue(EARLIER);
    const { result, unmount } = openNewVisit();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
    unmount();

    // Another recorder of the same document, after the editor went away.
    const { result: later } = renderHook(() =>
      useSnapshotAutosave({
        identity: `${documentRecordingKey(SCOPE)}:`,
        document: documentRecordingKey(SCOPE),
        save: () => putSpy({ later: true }),
        debounceMs: DEBOUNCE,
      })
    );
    await editAndWait(later.current.schedule);

    expect(putSpy).toHaveBeenCalledWith({ later: true });
  });
});
