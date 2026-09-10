import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { post, patch, del } = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post, patch, delete: del },
}));

import {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  DOCUMENT_LOCK_LOSS_AFTER_MS,
} from "nextly/document-lock";

import { useDocumentLock } from "../useDocumentLock";

const ref = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "42",
};
const other = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 };

const acquired = {
  message: "",
  item: { status: "acquired", claimToken: "t1" },
};
const held = {
  message: "",
  item: { status: "held", holder: other, waiting: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  post.mockResolvedValue(acquired);
  patch.mockResolvedValue({
    message: "",
    item: { status: "renewed", waiting: false },
  });
  del.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentLock", () => {
  it("claims the document it was given", async () => {
    const { result } = renderHook(() => useDocumentLock(ref));

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post).toHaveBeenCalledWith("/document-lock", {
      ...ref,
      takeover: false,
      requestAccess: false,
    });
  });

  it("claims once per document, not once per render", async () => {
    // The document reference is memoised on the three values that identify it.
    // Rebuilt each render, the effect would tear down and re-claim on every
    // one: a stream of acquire and release calls, and a colleague watching the
    // lock flicker between held and free.
    const { result, rerender } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    rerender();
    rerender();

    expect(post).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  it("names the holder when someone else has it", async () => {
    // Advisory: the second editor is told who, not merely refused.
    post.mockResolvedValue(held);

    const { result } = renderHook(() => useDocumentLock(ref));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "held-by-other",
        holder: other,
        requestSent: false,
      })
    );
  });

  it("claims nothing for a document that does not exist yet", () => {
    // A new entry has no id, so there is nothing to lock and nothing to ask.
    const { result } = renderHook(() =>
      useDocumentLock({ ...ref, entryId: null })
    );

    expect(result.current.state.status).toBe("idle");
    expect(post).not.toHaveBeenCalled();
  });

  it("does not claim on a surface that is not being edited", () => {
    // A past version and a translation source are read through the same
    // editor, and reading is not editing.
    renderHook(() => useDocumentLock({ ...ref, enabled: false }));

    expect(post).not.toHaveBeenCalled();
  });

  it("renews on the heartbeat the server's lease defines", async () => {
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    expect(patch).toHaveBeenCalledWith("/document-lock", {
      ...ref,
      claimToken: "t1",
    });
  });

  it("stops renewing once someone takes over, and says who", async () => {
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    patch.mockResolvedValue({
      message: "",
      item: { status: "lost", holder: other },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "taken-over",
        holder: other,
      })
    );

    // Asking again would either fail forever or re-take a claim the editor was
    // just told they had lost.
    const after = patch.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS * 3);
    });
    expect(patch.mock.calls.length).toBe(after);
  });

  it("treats a failed renew as a blip, not a lost claim", async () => {
    // The lease outlives several beats. Moving an editor to read-only for a
    // dropped packet is worse than waiting for the next one.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    patch.mockRejectedValue(new Error("offline"));
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    expect(result.current.state.status).toBe("held-by-me");
  });

  it("releases the claim it holds when the editor leaves", async () => {
    const { result, unmount } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    unmount();

    expect(del).toHaveBeenCalledWith("/document-lock", {
      ...ref,
      claimToken: "t1",
    });
  });

  it("releases nothing when it never held one", async () => {
    // Releasing a claim belonging to the colleague who holds it would hand the
    // document to whoever looked at it next.
    post.mockResolvedValue(held);
    const { result, unmount } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    unmount();

    expect(del).not.toHaveBeenCalled();
  });

  it("takes over on request, and holds it afterwards", async () => {
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "t2" },
    });
    await act(async () => {
      result.current.takeOver();
    });

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: true,
      requestAccess: false,
    });
  });

  it("asks for nothing until the person asks for it", async () => {
    // The control, and the reason it comes first: every locked-out editor polls
    // on every beat, so a flag that rode the poll unconditionally would nudge
    // the holder on behalf of anybody who merely opened the document to read it.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    for (const call of post.mock.calls) {
      expect(call[1]).toMatchObject({ requestAccess: false });
    }
  });

  it("asks at once, and keeps asking on every beat afterwards", async () => {
    // 🔴 A STANDING ask. The server holds it on a lease, so one request would
    // lapse under a holder who keeps working -- and the person pressed once.
    // Asking at once rather than at the next beat is what answers the press.
    post.mockResolvedValue({
      message: "",
      item: { status: "held", holder: other, waiting: true },
    });
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    await act(async () => {
      result.current.requestAccess();
    });
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: false,
      requestAccess: true,
    });

    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: false,
      requestAccess: true,
    });
  });

  it("confirms the ask only when the SERVER says it is on record", async () => {
    // 🔴 Not the click. A server that ignored the flag -- an older deployment,
    // a dropped field -- would otherwise have this editor promise a colleague
    // was told by a request that landed nowhere.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    await act(async () => {
      result.current.requestAccess();
    });

    expect(result.current.state).toEqual({
      status: "held-by-other",
      holder: other,
      requestSent: false,
    });

    post.mockResolvedValue({
      message: "",
      item: { status: "held", holder: other, waiting: true },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "held-by-other",
        holder: other,
        requestSent: true,
      })
    );
  });

  it("does not report a THIRD colleague's ask as this editor's own", async () => {
    // `waiting` says somebody is waiting, which is also true when it is not the
    // person in front of this editor. Only the conjunction says "we told them,
    // for you", and this is the half a click-driven flag cannot see.
    post.mockResolvedValue({
      message: "",
      item: { status: "held", holder: other, waiting: true },
    });
    const { result } = renderHook(() => useDocumentLock(ref));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "held-by-other",
        holder: other,
        requestSent: false,
      })
    );
  });

  it("re-renders when the ask lands, though the holder has not changed", async () => {
    // 🔴 Nobody changes holder when somebody asks for their document. A poll
    // that stayed quiet on an unchanged HOLDER would leave the button on screen
    // after the request that replaced it landed.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    post.mockResolvedValue({
      message: "",
      item: { status: "held", holder: other, waiting: true },
    });
    await act(async () => {
      result.current.requestAccess();
    });

    await waitFor(() =>
      expect(result.current.state).toMatchObject({ requestSent: true })
    );
  });

  it("stops asking once this editor has the document", async () => {
    // Nobody waits for what they hold. The server clears its own mark on the
    // same event, so neither side is left saying this editor queues for its own
    // claim.
    post.mockResolvedValue({
      message: "",
      item: { status: "held", holder: other, waiting: true },
    });
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );
    await act(async () => {
      result.current.requestAccess();
    });

    post.mockResolvedValue(acquired);
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "held-by-me",
        someoneWaiting: false,
      })
    );

    // Then lose it to nobody, and take it back. That second acquisition is what
    // makes the cleared intent OBSERVABLE: uncleared, a person taking a document
    // back would be recorded as somebody waiting for the document they now hold,
    // and their own next beat would tell them so.
    patch.mockResolvedValue({ message: "", item: { status: "lost" } });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.state.status).toBe("taken-over"));

    await act(async () => {
      result.current.takeOver();
    });
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: true,
      requestAccess: false,
    });
  });

  it("tells the holder somebody is waiting, on the beat they already make", async () => {
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(result.current.state).toEqual({
      status: "held-by-me",
      someoneWaiting: false,
    });

    patch.mockResolvedValue({
      message: "",
      item: { status: "renewed", waiting: true },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "held-by-me",
        someoneWaiting: true,
      })
    );
  });

  it("does not let an older renewal reverse a newer one's answer", async () => {
    // 🔴 Renewals overlap, and their replies can arrive out of order — the
    // lease is already advanced with `Math.max` for exactly this reason. The
    // waiting answer needs the same fence: a slow beat that left BEFORE anybody
    // asked still says "nobody is waiting", and landing after a later beat that
    // said otherwise would take the notice away from the holder until some
    // subsequent renewal happened to put it back.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    // The older beat leaves first and is still in flight, carrying the answer
    // from before the ask.
    let settleOlder: (value: unknown) => void = () => {};
    patch.mockReturnValueOnce(
      new Promise(resolve => {
        settleOlder = resolve;
      })
    );
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    // The newer beat leaves afterwards and answers first.
    patch.mockResolvedValue({
      message: "",
      item: { status: "renewed", waiting: true },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "held-by-me",
        someoneWaiting: true,
      })
    );

    await act(async () => {
      settleOlder({ message: "", item: { status: "renewed", waiting: false } });
    });

    // Still told. The stale reply describes a moment that has passed.
    expect(result.current.state).toEqual({
      status: "held-by-me",
      someoneWaiting: true,
    });
  });

  it("says it once, not once per beat", async () => {
    // 🔴 The notice lives in a live region, so re-rendering it on an unchanged
    // answer would read the same sentence to somebody every fifteen seconds.
    // State identity is the instrument: a new object IS the re-announcement.
    patch.mockResolvedValue({
      message: "",
      item: { status: "renewed", waiting: true },
    });
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ someoneWaiting: true })
    );
    const spoken = result.current.state;

    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS * 3);
    });

    expect(result.current.state).toBe(spoken);
  });

  it("reports the claim unavailable when it cannot be asked for, and retries", async () => {
    // 🔴 A rejected acquire leaves no token, and every later beat exits at its
    // token guard. Swallowing it spends the whole session silently unprotected.
    post.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useDocumentLock(ref));

    await waitFor(() =>
      expect(result.current.state.status).toBe("unavailable")
    );

    post.mockResolvedValue(acquired);
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
  });

  it("releases a claim that arrives after the editor has gone", async () => {
    // 🔴 Cleanup runs before the acquire resolves, so it finds no token to
    // release. Without this the server holds a claim nothing will ever renew or
    // release, and the next editor waits out a whole lease for a tab that closed.
    let settle: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settle = resolve;
      })
    );

    const { unmount } = renderHook(() => useDocumentLock(ref));
    unmount();

    await act(async () => {
      settle(acquired);
    });

    expect(del).toHaveBeenCalledWith("/document-lock", {
      ...ref,
      claimToken: "t1",
    });
  });

  it("reports the claim lost once a whole lease passes unconfirmed", async () => {
    // A blip is not a loss, but silence is not possession either: past the
    // deadline the lease has expired server-side and a colleague may hold the row.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    patch.mockRejectedValue(new Error("offline"));

    const beats = Math.ceil(
      DOCUMENT_LOCK_LOSS_AFTER_MS / DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
    );
    for (let beat = 0; beat < beats; beat += 1) {
      await act(async () => {
        vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
      });
    }

    await waitFor(() => expect(result.current.state.status).toBe("lost"));

    // Nothing further is asked: the beat stopped with the claim.
    const after = patch.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS * 3);
    });
    expect(patch.mock.calls.length).toBe(after);
  });

  it("holds the claim while failures stay inside the deadline", async () => {
    // The other side of the same rule, so the deadline cannot be satisfied by a
    // hook that simply reports loss on the first failure.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    patch.mockRejectedValue(new Error("offline"));
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    expect(result.current.state.status).toBe("held-by-me");
    expect(DOCUMENT_LOCK_LOSS_AFTER_MS).toBeGreaterThan(
      DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
    );
  });

  it("ignores a reply belonging to a claim that was already replaced", async () => {
    // 🔴 A takeover replaces the token WITHIN one effect run, so a generation
    // check cannot separate these: the displaced token's `lost` answer would
    // clear the claim the takeover just won.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    post.mockResolvedValue(acquired);
    await act(async () => {
      result.current.takeOver();
    });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    let settleRenew: (value: unknown) => void = () => {};
    patch.mockReturnValueOnce(
      new Promise(resolve => {
        settleRenew = resolve;
      })
    );
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    expect(patch).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      claimToken: "t1",
    });

    // A second takeover mints t2 while that first renewal is still in flight.
    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "t2" },
    });
    await act(async () => {
      result.current.takeOver();
    });
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith("/document-lock", {
        ...ref,
        takeover: true,
        requestAccess: false,
      })
    );

    await act(async () => {
      settleRenew({ message: "", item: { status: "lost", holder: other } });
    });

    expect(result.current.state.status).toBe("held-by-me");
  });

  it("notices when the colleague holding it leaves", async () => {
    // 🔴 A refused acquire leaves no token, so a hook that only renews never
    // contacts the server again and shows a holder who left hours ago. A plain
    // acquire never steals a live claim, so asking again is safe.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    post.mockResolvedValue(acquired);
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: false,
      requestAccess: false,
    });
  });

  it("does not re-render the editor while a colleague keeps holding it", async () => {
    // The poll runs every beat. A fresh state object each time would re-render
    // the whole edit view for no news.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    const first = result.current.state;
    // One beat at a time, letting each poll answer. Advancing several at once
    // holds a reply past the slot's own expiry, which is a different case and
    // has its own test.
    for (let beat = 0; beat < 2; beat += 1) {
      await act(async () => {
        vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
      });
    }

    expect(result.current.state).toBe(first);
  });

  it("clears the previous document before answering for the new one", async () => {
    // 🔴 The document can change under a mounted editor. Leaving the old answer
    // up names an unrelated holder, or says this editor holds a document it has
    // not claimed yet.
    post.mockResolvedValue(held);
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDocumentLock({ ...ref, entryId: id }),
      { initialProps: { id: "42" } }
    );
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    post.mockReturnValue(new Promise(() => {}));
    rerender({ id: "43" });

    expect(result.current.state.status).toBe("acquiring");
  });

  it("never runs two acquisitions at once, and keeps the intent when one stalls", async () => {
    // 🔴 Two claims outstanding at once is the shape that loses a token: the
    // server treats a live claim from the SAME owner as takeable, so the later
    // one to commit wins and the other's token is dead on arrival.
    //
    // 🔴 And the request is never aborted. A claim is not idempotent, so
    // cancelling one makes its outcome unknowable - it may still commit, and an
    // aborted fetch can never hand back the token it was given. Only the hold on
    // the slot expires.
    post.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDocumentLock(ref));
    expect(post).toHaveBeenCalledTimes(1);

    // A person decides to take over while that claim is still open.
    await act(async () => {
      result.current.takeOver();
    });
    expect(post).toHaveBeenCalledTimes(1);

    // The slot expires after a beat. The decision is re-asked as a decision.
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    expect(result.current.state.status).toBe("unavailable");
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: true,
      requestAccess: false,
    });
  });

  it("reaches the deadline even when no request ever settles", async () => {
    // 🔴 A stalled connection never rejects. A deadline that lived only in the
    // failure path would let an editor keep writing against a lease that ran out
    // minutes ago, while another editor already holds the row.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    patch.mockReturnValue(new Promise(() => {}));

    const beats =
      Math.ceil(
        DOCUMENT_LOCK_LOSS_AFTER_MS / DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
      ) + 1;
    for (let beat = 0; beat < beats; beat += 1) {
      await act(async () => {
        vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
      });
    }

    await waitFor(() => expect(result.current.state.status).toBe("lost"));
  });

  it("keeps renewing after the editor takes the document back", async () => {
    // 🔴 The beat must outlive the claim. Stopping it on a loss and trusting the
    // next acquire to start another hands the editor a claim nothing renews,
    // which expires silently one lease later - the exact state the lock exists
    // to prevent.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    patch.mockResolvedValue({
      message: "",
      item: { status: "lost", holder: other },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.state.status).toBe("taken-over"));

    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "t2" },
    });
    patch.mockResolvedValue({
      message: "",
      item: { status: "renewed", waiting: false },
    });
    await act(async () => {
      result.current.takeOver();
    });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    const before = patch.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    expect(patch.mock.calls.length).toBeGreaterThan(before);
    expect(patch).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      claimToken: "t2",
    });
    expect(result.current.state.status).toBe("held-by-me");
  });

  it("does not drop a take-over pressed while a poll is in flight", async () => {
    // 🔴 Serialising acquisitions must not turn a person's decision into silence.
    // The poll that holds the slot only ever asks politely, so dropping the click
    // leaves them watching a colleague hold a document they asked to take.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    let settlePoll: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settlePoll = resolve;
      })
    );
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    const duringPoll = post.mock.calls.length;

    // The click lands while that poll is still open.
    await act(async () => {
      result.current.takeOver();
    });
    expect(post.mock.calls.length).toBe(duringPoll);

    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "t2" },
    });
    await act(async () => {
      settlePoll(held);
    });

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: true,
      requestAccess: false,
    });
  });

  it("does not re-take a claim the pending poll just won", async () => {
    // 🔴 The holder can leave while a polite poll is open, so the poll returns
    // `acquired`. Draining the queued take-over before that answer is stored
    // fires a second acquire against a claim this editor already holds - and if
    // THAT one rejects, the interface reports the document unavailable over a
    // token that is held and still renewing.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    let settlePoll: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settlePoll = resolve;
      })
    );
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await act(async () => {
      result.current.takeOver();
    });
    const duringPoll = post.mock.calls.length;

    // The holder left, so the poll succeeds on its own.
    await act(async () => {
      settlePoll(acquired);
    });

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post.mock.calls.length).toBe(duringPoll);
  });

  it("hands back a claim the server may still be holding", async () => {
    // 🔴 A renewal whose reply never arrived may still have reached the server
    // and extended the lease by most of a TTL. Forgetting the token without
    // releasing leaves colleagues seeing this editor as the holder long after
    // its own interface says it is not.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    patch.mockReturnValue(new Promise(() => {}));
    const beats =
      Math.ceil(
        DOCUMENT_LOCK_LOSS_AFTER_MS / DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
      ) + 1;
    for (let beat = 0; beat < beats; beat += 1) {
      await act(async () => {
        vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
      });
    }

    await waitFor(() => expect(result.current.state.status).toBe("lost"));
    expect(del).toHaveBeenCalledWith("/document-lock", {
      ...ref,
      claimToken: "t1",
    });
  });

  it("spends a queued take-over rather than carrying it into a later claim", async () => {
    // 🔴 A take-over queued behind a poll that then SUCCEEDS has already got what
    // it asked for. Leaving the request outstanding spends it on the next
    // acquire that happens to be refused, displacing a colleague nobody asked to
    // displace.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    let settlePoll: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settlePoll = resolve;
      })
    );
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await act(async () => {
      result.current.takeOver();
    });
    await act(async () => {
      settlePoll(acquired);
    });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    // The claim is then taken away, so the editor is a contender again.
    patch.mockResolvedValue({
      message: "",
      item: { status: "lost", holder: other },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.state.status).toBe("taken-over"));

    // One deliberate take-over, refused because a colleague holds it now.
    post.mockResolvedValue(held);
    const before = post.mock.calls.length;
    await act(async () => {
      result.current.takeOver();
    });
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    expect(post.mock.calls.length).toBe(before + 1);
  });

  it("gives up on a claim that never answers, and retries", async () => {
    // 🔴 A pending request is not a failed one. Nothing clears the one-at-a-time
    // slot, so without a bound every later beat returns at the serialisation
    // guard and the editor sits in `acquiring` for the whole session with a
    // take-over queued behind a request that is never coming back.
    //
    // The mock honours the signal the way `fetch` does, since that abort is the
    // whole mechanism under test.
    post.mockImplementation(
      (_path: string, _body: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        })
    );

    const { result } = renderHook(() => useDocumentLock(ref));
    expect(result.current.state.status).toBe("acquiring");

    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(result.current.state.status).toBe("unavailable")
    );

    // The slot is free again, so the next beat asks.
    post.mockResolvedValue(acquired);
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
  });

  it("shows the holder again after a failed poll, even if nothing changed", async () => {
    // 🔴 The quiet-poll comparison must not outlive the state it was quiet about.
    // A holder renewing on this same cadence reports identical fields, so keeping
    // the cached reading suppresses the update and strands the editor on
    // `unavailable` while the server is answering perfectly well.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    post.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(result.current.state.status).toBe("unavailable")
    );

    // Same holder, same expiry: nothing about the reading changed.
    post.mockResolvedValue(held);
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "held-by-other",
        holder: other,
        requestSent: false,
      })
    );
  });

  it("repairs the live claim when an earlier run's reply displaces it", async () => {
    // 🔴 Two fences, not one. The token fence separates two claims inside a run;
    // this is two RUNS on the same document. A run whose cleanup has happened can
    // still have a request in flight, and the server treats a claim from the SAME
    // owner as takeable, so that late reply takes the row out from under the run
    // that replaced it. Releasing it then leaves the live run holding a token the
    // server has forgotten, reporting `held-by-me` over nothing.
    let settleFirst: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleFirst = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useDocumentLock({ ...ref, enabled: on }),
      { initialProps: { on: true } }
    );

    // Same document, a second run: the first is cleaned up with its claim open.
    rerender({ on: false });
    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "live" },
    });
    rerender({ on: true });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    const afterLive = post.mock.calls.length;

    await act(async () => {
      settleFirst({
        message: "",
        item: { status: "acquired", claimToken: "stale" },
      });
    });

    // Handed back...
    expect(del).toHaveBeenCalledWith(
      "/document-lock",
      expect.objectContaining({ claimToken: "stale" })
    );
    // ...and the live run told to claim again rather than trusting a token the
    // server no longer has.
    await waitFor(() =>
      expect(post.mock.calls.length).toBeGreaterThan(afterLive)
    );
    expect(result.current.state.status).toBe("held-by-me");
  });

  it("does not wake a run that moved to another document", async () => {
    // 🔴 Two claims on different documents use different lock keys, so a late
    // reply for one cannot have displaced the other. Waking it would start a
    // claim nobody asked for - and if THAT request fails it reports the document
    // unavailable while the server still records it as held.
    let settleFirst: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleFirst = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDocumentLock({ ...ref, entryId: id }),
      { initialProps: { id: "42" } }
    );

    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "live" },
    });
    rerender({ id: "43" });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    const afterLive = post.mock.calls.length;

    await act(async () => {
      settleFirst({
        message: "",
        item: { status: "acquired", claimToken: "stale" },
      });
    });

    // The stale claim is still handed back - it belongs to nobody now.
    expect(del).toHaveBeenCalledWith(
      "/document-lock",
      expect.objectContaining({ claimToken: "stale" })
    );
    // But the document on screen was never displaced, so nothing is re-asked.
    expect(post.mock.calls.length).toBe(afterLive);
    expect(result.current.state.status).toBe("held-by-me");
  });

  it("credits a renewal from when it was sent, not when the reply arrived", async () => {
    // 🔴 The lease starts when the SERVER processes a renewal. Timing it from
    // receipt credits this editor with however long the reply spent in transit,
    // so a reply delayed past the margin has the hook reporting a claim that
    // expired server-side while a colleague can already take the row.
    //
    // The timeline below separates the two readings: the renewal is sent at one
    // beat and answered much later, and the deadline that follows is reached
    // only if the send time is what counted.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    let settleRenew: (value: unknown) => void = () => {};
    patch.mockReturnValueOnce(
      new Promise(resolve => {
        settleRenew = resolve;
      })
    );
    // Every later beat is left open, so nothing else can move the deadline.
    patch.mockReturnValue(new Promise(() => {}));

    // The renewal is dispatched on this beat.
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    const sentAt = DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS;

    // It is answered a long time later, but still inside the deadline measured
    // from the last thing this editor knew.
    const answeredAt =
      DOCUMENT_LOCK_LOSS_AFTER_MS - DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS;
    await act(async () => {
      vi.advanceTimersByTime(answeredAt - sentAt);
    });
    await act(async () => {
      settleRenew({ message: "", item: { status: "renewed" } });
    });
    expect(result.current.state.status).toBe("held-by-me");

    // Now pass the deadline as measured from the SEND. Timed from the reply this
    // editor would still believe it held the document.
    await act(async () => {
      vi.advanceTimersByTime(
        sentAt +
          DOCUMENT_LOCK_LOSS_AFTER_MS -
          answeredAt +
          DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
      );
    });

    await waitFor(() => expect(result.current.state.status).toBe("lost"));
  });

  it("credits a claim from when it was sent, not when the reply arrived", async () => {
    // The same rule on the acquisition path. A claim answered slowly has already
    // spent part of its lease by the time this editor hears about it.
    let settleClaim: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleClaim = resolve;
      })
    );

    const { result } = renderHook(() => useDocumentLock(ref));
    expect(result.current.state.status).toBe("acquiring");

    // Answered slowly, but inside the slot's own expiry so it still installs.
    const answeredAt = DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS - 1000;
    await act(async () => {
      vi.advanceTimersByTime(answeredAt);
    });
    patch.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      settleClaim(acquired);
    });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    // The deadline as measured from the SEND lands on the beat at
    // `DOCUMENT_LOCK_LOSS_AFTER_MS`; measured from the reply it would be a beat
    // later, and this editor would still believe it held the document.
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_LOSS_AFTER_MS - answeredAt);
    });

    await waitFor(() => expect(result.current.state.status).toBe("lost"));
  });

  it("does not let an older renewal shorten a lease a newer one extended", async () => {
    // 🔴 Replies can arrive out of order. An older renewal landing after a newer
    // one would move the confirmation backwards, firing the deadline several
    // beats early against a lease the server had already extended.
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    let settleFirst: (value: unknown) => void = () => {};
    let settleSecond: (value: unknown) => void = () => {};
    patch.mockReturnValueOnce(
      new Promise(resolve => {
        settleFirst = resolve;
      })
    );
    patch.mockReturnValueOnce(
      new Promise(resolve => {
        settleSecond = resolve;
      })
    );
    patch.mockReturnValue(new Promise(() => {}));

    // Two renewals dispatched a beat apart.
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    // The newer one answers first, then the older one.
    const renewed = { message: "", item: { status: "renewed" } };
    await act(async () => {
      settleSecond(renewed);
    });
    await act(async () => {
      settleFirst(renewed);
    });

    // Just past the deadline measured from the OLDER renewal, and short of the
    // one measured from the newer. Moved backwards, this reports `lost`.
    await act(async () => {
      vi.advanceTimersByTime(
        DOCUMENT_LOCK_LOSS_AFTER_MS - DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
      );
    });

    expect(result.current.state.status).toBe("held-by-me");
  });

  it("queues a repair behind a claim the live run has not finished", async () => {
    // 🔴 The repair is an acquire like any other, so it meets the same
    // one-at-a-time slot. Dropping it there loses the whole point of it: the live
    // run installs a token the stale reply has already invalidated and reports
    // `held-by-me` over a claim the server has forgotten.
    let settleStale: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleStale = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useDocumentLock({ ...ref, enabled: on }),
      { initialProps: { on: true } }
    );

    rerender({ on: false });

    // The replacement run's own claim is still open when the stale one lands.
    let settleLive: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleLive = resolve;
      })
    );
    rerender({ on: true });
    const afterLiveSent = post.mock.calls.length;

    await act(async () => {
      settleStale({
        message: "",
        item: { status: "acquired", claimToken: "stale" },
      });
    });
    // Nothing new asked yet: the slot is still held by the live claim.
    expect(post.mock.calls.length).toBe(afterLiveSent);

    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "second" },
    });
    await act(async () => {
      settleLive({
        message: "",
        item: { status: "acquired", claimToken: "live" },
      });
    });

    // The repair was kept, and runs once the slot frees.
    await waitFor(() =>
      expect(post.mock.calls.length).toBeGreaterThan(afterLiveSent)
    );
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
  });

  it("re-asks a take-over as a take-over when its own request stalls", async () => {
    // 🔴 Finding the intent again is not the same as never losing it. A person's
    // decision that outlives its request must come back as a decision: retried as
    // a plain claim it politely declines to displace anyone, and the colleague
    // keeps the document despite the click.
    post.mockResolvedValue(held);
    const { result } = renderHook(() => useDocumentLock(ref));
    await waitFor(() =>
      expect(result.current.state.status).toBe("held-by-other")
    );

    post.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      result.current.takeOver();
    });
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: true,
      requestAccess: false,
    });
    const sent = post.mock.calls.length;

    // The slot expires without an answer.
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    expect(post.mock.calls.length).toBeGreaterThan(sent);
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: true,
      requestAccess: false,
    });
  });

  it("hands back a stalled claim that answers after its slot expired", async () => {
    // 🔴 The reason nothing is aborted, and the reason a claim carries a
    // sequence. The retry has already replaced this token server-side - the
    // server treats the same owner as takeable - so installing the late one would
    // report a claim the server has forgotten.
    let settleStalled: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleStalled = resolve;
      })
    );

    const { result } = renderHook(() => useDocumentLock(ref));
    expect(result.current.state.status).toBe("acquiring");

    // The slot expires, and the next beat claims again and wins.
    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "retry" },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    // Only now does the original answer.
    await act(async () => {
      settleStalled({
        message: "",
        item: { status: "acquired", claimToken: "stalled" },
      });
    });

    expect(del).toHaveBeenCalledWith(
      "/document-lock",
      expect.objectContaining({ claimToken: "stalled" })
    );
    expect(result.current.state.status).toBe("held-by-me");
  });

  it("ignores a rejection from a claim that no longer owns the slot", async () => {
    // 🔴 A retry can succeed and the original then reject. Reporting that
    // replaces a good claim with `unavailable` and leaves it there, since
    // renewals only move the confirmation forward and never restore the status.
    let rejectStalled: (reason: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectStalled = reject;
      })
    );

    const { result } = renderHook(() => useDocumentLock(ref));
    expect(result.current.state.status).toBe("acquiring");

    // The slot expires and the next beat wins.
    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "retry" },
    });
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));

    // Only now does the original fail.
    await act(async () => {
      rejectStalled(new Error("offline"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.state.status).toBe("held-by-me");
  });

  it("keeps a take-over queued while a repair says the claim may be dead", async () => {
    // 🔴 A win only satisfies a queued take-over if it actually established
    // possession. With a repair outstanding, the token just installed may already
    // be the dead one - so dropping the click means the following plain claim
    // comes back `held` and the decision is lost for good.
    let settleStale: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleStale = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useDocumentLock({ ...ref, enabled: on }),
      { initialProps: { on: true } }
    );
    rerender({ on: false });

    let settleLive: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(
      new Promise(resolve => {
        settleLive = resolve;
      })
    );
    rerender({ on: true });

    // A person decides to take over while the live claim is still open.
    await act(async () => {
      result.current.takeOver();
    });

    // The stale reply lands, raising the repair.
    await act(async () => {
      settleStale({
        message: "",
        item: { status: "acquired", claimToken: "stale" },
      });
    });

    // The live claim then wins - but a repair is outstanding, so the click stands.
    // The repair itself is refused, which is the case that loses the click when
    // the intent was dropped a moment too early.
    post.mockResolvedValueOnce(held);
    post.mockResolvedValue(acquired);
    await act(async () => {
      settleLive({
        message: "",
        item: { status: "acquired", claimToken: "live" },
      });
    });

    await waitFor(() =>
      expect(
        post.mock.calls.filter(call => call[1]?.takeover === true).length,
        "the take-over survived the repair"
      ).toBeGreaterThan(0)
    );
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
  });
});
