import type { DocumentLockHolder } from "nextly/document-lock";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { act, renderHook } from "@admin/__tests__/utils";
import type { useDocumentLock as lockHook } from "@admin/hooks/queries/useDocumentLock";

const { useDocumentLock } = vi.hoisted(() => ({ useDocumentLock: vi.fn() }));
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));

import { useDocumentLockSurface } from "../useDocumentLockSurface";

const bob: DocumentLockHolder = {
  ownerId: "u2",
  ownerLabel: "Bob",
  expiresInSeconds: 90,
};
const takeOver = vi.fn();
const requestAccess = vi.fn();
const options = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("remembering who held the document", () => {
  it("keeps a colleague through a failed refresh", () => {
    // 🔴 Every beat re-asks, so a transient rejection arrives long after a holder
    // was reported. Forgetting them hands the document to a second editor while
    // the last confirmed fact is that somebody holds an unexpired lease.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob, requestSent: false },
      takeOver,
      requestAccess,
    });
    const { result, rerender } = renderHook(() =>
      useDocumentLockSurface(options)
    );
    expect(result.current.readOnly).toBe(true);

    useDocumentLock.mockReturnValue({
      state: { status: "unavailable" },
      takeOver,
      requestAccess,
    });
    rerender();

    expect(result.current.readOnly).toBe(true);
    expect(result.current.notice?.message).toContain("Bob");
  });

  it("forgets them when a new document is being claimed", () => {
    // 🔴 Both editors reuse the mounted hook when the id changes, and a new
    // document announces itself as `acquiring`. Carrying the last one's holder
    // into it renders a document read-only over a colleague who was never in it.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob, requestSent: false },
      takeOver,
      requestAccess,
    });
    const { result, rerender } = renderHook(() =>
      useDocumentLockSurface(options)
    );
    expect(result.current.readOnly).toBe(true);

    useDocumentLock.mockReturnValue({
      state: { status: "acquiring" },
      takeOver,
      requestAccess,
    });
    rerender();
    useDocumentLock.mockReturnValue({
      state: { status: "unavailable" },
      takeOver,
      requestAccess,
    });
    rerender();

    expect(result.current.readOnly).toBe(false);
    expect(result.current.notice?.takeOverLabel).toBeNull();
  });

  it("forgets them once this editor holds it", () => {
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob, requestSent: false },
      takeOver,
      requestAccess,
    });
    const { result, rerender } = renderHook(() =>
      useDocumentLockSurface(options)
    );

    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me", someoneWaiting: false },
      takeOver,
      requestAccess,
    });
    rerender();
    useDocumentLock.mockReturnValue({
      state: { status: "unavailable" },
      takeOver,
      requestAccess,
    });
    rerender();

    expect(result.current.readOnly).toBe(false);
  });

  it("republishes the polite ask, so an editor is not left with only the steal", () => {
    // The surface is what both editors render from. Publishing `takeOver` and
    // not this would leave a locked-out author one option -- displacing a
    // colleague -- which is the dead end this whole change exists to remove.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob, requestSent: false },
      takeOver,
      requestAccess,
    });
    const { result } = renderHook(() => useDocumentLockSurface(options));

    result.current.requestAccess();

    expect(requestAccess).toHaveBeenCalledTimes(1);
    expect(takeOver).not.toHaveBeenCalled();
  });
});

describe("loading the latest document before a gain unlocks the form", () => {
  // The editor read this copy while a colleague held it, and the colleague may
  // have saved since. Unlocking it as it stands lets the editor's next save put
  // the older copy back over theirs.

  type Lock = ReturnType<typeof lockHook>;
  const keptOut: Lock = {
    state: { status: "held-by-other", holder: bob, requestSent: false },
    gains: 0,
    takeOver,
    requestAccess,
  };
  const gained = (gains = 1, someoneWaiting = false): Lock => ({
    state: { status: "held-by-me", someoneWaiting },
    gains,
    takeOver,
    requestAccess,
  });

  /** A reload the test settles, standing in for the document's reads. */
  function deferredReload() {
    const settles: { resolve: () => void; reject: (e: Error) => void }[] = [];
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settles.push({ resolve, reject });
        })
    );
    return { reload, settles };
  }

  /**
   * The surface as an editor mounts it, given when the document on screen was
   * read. `readAt` moves only when reads made after the gain reach the
   * document, which is what the editor shows.
   */
  function mount(reload: () => Promise<unknown>, lock: Lock = keptOut) {
    useDocumentLock.mockReturnValue(lock);
    return renderHook(
      ({ readAt }: { readAt: number | undefined }) =>
        useDocumentLockSurface({ ...options, latest: { readAt, reload } }),
      { initialProps: { readAt: 1 } }
    );
  }

  // How the hook reports each way of gaining it. That each one IS counted as a
  // gain is the hook's own test; this is what the form does once it is.
  const ways: [string, Lock[]][] = [
    ["the colleague releases it", [gained()]],
    [
      "the colleague's lease lapses, through a failed poll",
      [{ state: { status: "unavailable" }, gains: 0, takeOver, requestAccess }, gained()],
    ],
    ["this editor takes it over", [gained()]],
  ];

  it.each(ways)(
    "refetches the document before unlocking on each move to held-by-me (release, lapse, takeover): %s",
    (_way, steps) => {
      const { reload } = deferredReload();
      const { result, rerender } = mount(reload);
      expect(result.current.readOnly).toBe(true);

      for (const step of steps) {
        useDocumentLock.mockReturnValue(step);
        rerender({ readAt: 1 });
      }

      // Asked for once, and held read-only while it is on its way: Save and
      // every other write too, since any of them would write this copy.
      expect(reload).toHaveBeenCalledTimes(1);
      expect(result.current.readOnly).toBe(true);
      expect(result.current.actionsDisabled).toBe(true);
      expect(result.current.notice?.tone).toBe("loading");

      // The same read again, as when the load answered but its reads have not
      // reached the document yet: still the copy from before.
      rerender({ readAt: 1 });
      expect(result.current.readOnly).toBe(true);

      // Reads made since the gain: the render that shows them unlocks.
      rerender({ readAt: 2 });
      expect(result.current.readOnly).toBe(false);
      expect(result.current.actionsDisabled).toBe(false);
      expect(result.current.notice).toBeNull();
    }
  );

  it("unlocks a first claim at once, and loads nothing", () => {
    // `acquiring` unlocks on purpose: the copy was read a moment ago, and making
    // every open wait on a round trip costs every author on every document.
    const { reload } = deferredReload();
    const { result, rerender } = mount(reload, {
      state: { status: "acquiring" },
      gains: 0,
      takeOver,
      requestAccess,
    });
    expect(result.current.readOnly).toBe(false);

    useDocumentLock.mockReturnValue(gained(0));
    rerender({ readAt: 1 });

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.readOnly).toBe(false);
  });

  it("loads once per gain, not once per beat", () => {
    const { reload } = deferredReload();
    const { rerender } = mount(reload);

    useDocumentLock.mockReturnValue(gained(1));
    rerender({ readAt: 1 });
    useDocumentLock.mockReturnValue(gained(1, true));
    rerender({ readAt: 1 });
    rerender({ readAt: 2 });
    useDocumentLock.mockReturnValue(gained(1, false));
    rerender({ readAt: 2 });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stays read-only and offers to try again when the latest document cannot be loaded", async () => {
    const { reload, settles } = deferredReload();
    const { result, rerender } = mount(reload);
    useDocumentLock.mockReturnValue(gained());
    rerender({ readAt: 1 });

    await act(async () => {
      settles[0].reject(new Error("offline"));
    });

    expect(result.current.readOnly).toBe(true);
    expect(result.current.actionsDisabled).toBe(true);
    expect(result.current.notice?.message).toMatch(
      /couldn't load the latest version/
    );
    expect(result.current.notice?.retryLabel).toBe("Try again");

    // Trying again asks again, and stays read-only until it is in.
    act(() => {
      result.current.retryLoad();
    });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(result.current.readOnly).toBe(true);
    expect(result.current.notice?.tone).toBe("loading");

    await act(async () => {
      settles[1].resolve();
    });
    rerender({ readAt: 2 });
    expect(result.current.readOnly).toBe(false);
    expect(result.current.notice).toBeNull();
  });

  it("does not unlock a failed load because a later beat renews the claim", async () => {
    // A renewal says the claim is still this editor's. It says nothing about
    // whether the copy on screen is the current one.
    const { reload, settles } = deferredReload();
    const { result, rerender } = mount(reload);
    useDocumentLock.mockReturnValue(gained());
    rerender({ readAt: 1 });
    await act(async () => {
      settles[0].reject(new Error("offline"));
    });

    useDocumentLock.mockReturnValue(gained(1, true));
    rerender({ readAt: 1 });

    expect(result.current.readOnly).toBe(true);
    expect(result.current.notice?.retryLabel).toBe("Try again");
  });

  it("unlocks a gain as before on a surface that cannot load the document", () => {
    // A surface that hands over no way to read the document again keeps the
    // behaviour it had: nothing to wait for, so nothing to wait on.
    useDocumentLock.mockReturnValue(keptOut);
    const { result, rerender } = renderHook(() =>
      useDocumentLockSurface(options)
    );
    useDocumentLock.mockReturnValue(gained());
    rerender();

    expect(result.current.readOnly).toBe(false);
  });
});
