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

import { DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS } from "nextly/document-lock";

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
const held = { message: "", item: { status: "held", holder: other } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  post.mockResolvedValue(acquired);
  patch.mockResolvedValue({ message: "", item: { status: "renewed" } });
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
    });
  });
});
