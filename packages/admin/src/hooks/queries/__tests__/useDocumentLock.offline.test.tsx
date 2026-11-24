/**
 * A claim lost to a dropped connection comes back by itself.
 *
 * Offline (or asleep) for longer than the loss deadline, an editor stops
 * being able to vouch for its claim and reports it lost, which holds the
 * form. Once the connection is back it claims the document again, naming the
 * token it had, which the server lets replace only that claim: it comes back
 * under a new token where nobody else holds it, and a claim somebody else
 * holds (the same person's other tab included) is reported as theirs. It asks
 * on every beat, and at once when the browser says it is online or the tab is
 * shown again; until it is answered, the claim stays lost.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const ref = { scopeKind: "collection" as const, slug: "pages", entryId: "7" };
const colleague = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 120 };
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

/** What a reclaim of the lost claim sends. */
const reclaim = {
  ...ref,
  takeover: false,
  requestAccess: false,
  reclaimToken: "t1",
};

/** The server's answer to a claim. */
const answer = (item: object) => Promise.resolve({ message: "", item });

/** One beat, settled. */
async function beat(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
  }
}

/** Held, then offline on time-keeping beats until the claim is lost. */
async function lostWhileOffline() {
  const seen: string[] = [];
  const hook = renderHook(() => {
    const lock = useDocumentLock(ref);
    seen.push(lock.state.status);
    return lock;
  });
  await waitFor(() =>
    expect(hook.result.current.state.status).toBe("held-by-me")
  );
  patch.mockImplementation(offline);
  post.mockImplementation(offline);
  del.mockImplementation(offline);
  await beat(
    Math.ceil(DOCUMENT_LOCK_LOSS_AFTER_MS / DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS)
  );
  await waitFor(() => expect(hook.result.current.state.status).toBe("lost"));
  return { ...hook, seen };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  post.mockResolvedValue({
    message: "",
    item: { status: "acquired", claimToken: "t1" },
  });
  patch.mockResolvedValue({
    message: "",
    item: { status: "renewed", waiting: false },
  });
  del.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a claim lost while offline", () => {
  it("comes back under a new token once the connection returns, so a late release cannot remove it", async () => {
    const { result } = await lostWhileOffline();

    // The release sent when the claim was lost is still on its way.
    let releaseLands: () => void = () => {};
    del.mockReturnValue(
      new Promise<void>(resolve => {
        releaseLands = resolve;
      })
    );
    post.mockImplementation(() =>
      answer({ status: "acquired", claimToken: "t2" })
    );
    patch.mockImplementation(() =>
      answer({ status: "renewed", waiting: false })
    );
    await beat();

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post).toHaveBeenLastCalledWith("/document-lock", reclaim);
    await act(async () => {
      releaseLands();
    });
    // The new claim is the one renewed from here on.
    await beat();
    expect(patch).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      claimToken: "t2",
    });
  });

  it("names who took it when somebody else claimed it meanwhile", async () => {
    const { result } = await lostWhileOffline();

    post.mockImplementation(() =>
      answer({ status: "held", holder: colleague, waiting: false })
    );
    await beat();

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "taken-over",
        holder: colleague,
      })
    );
    // Theirs now, and never taken over without the person: nothing more is
    // asked on later beats, as for any takeover.
    const asked = post.mock.calls.length;
    await beat(2);
    expect(post).toHaveBeenCalledTimes(asked);
    expect(post).not.toHaveBeenCalledWith(
      "/document-lock",
      expect.objectContaining({ takeover: true })
    );
  });

  it("stays lost, never unchecked, while the asks fail", async () => {
    const { result, seen } = await lostWhileOffline();
    const before = seen.length;

    await beat(3);

    expect(result.current.state.status).toBe("lost");
    // Not even for a moment: an unchecked claim lets the editor save.
    expect(seen.slice(before)).not.toContain("unavailable");
    expect(post).toHaveBeenLastCalledWith("/document-lock", reclaim);

    post.mockImplementation(() =>
      answer({ status: "acquired", claimToken: "t2" })
    );
    await beat();
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
  });

  it("asks again when an ask never answers", async () => {
    const { result } = await lostWhileOffline();

    // The first ask after the outage stalls; the next one is answered.
    post.mockImplementationOnce(() => new Promise(() => {}));
    post.mockImplementation(() =>
      answer({ status: "acquired", claimToken: "t2" })
    );
    const asked = post.mock.calls.length;
    await beat();
    expect(post).toHaveBeenCalledTimes(asked + 1);

    await beat(2);
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post.mock.calls.length).toBeGreaterThan(asked + 1);
  });

  /**
   * Two reclaims out at once: the first wins `t2` and answers late, so the
   * second, which still names `t1`, is refused by this editor's own new
   * claim. That refusal is not a colleague's.
   */
  async function overlappingReclaims() {
    const hook = await lostWhileOffline();
    let firstAnswers: (value: unknown) => void = () => {};
    post.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          firstAnswers = resolve;
        })
    );
    post.mockImplementation(() =>
      answer({
        status: "held",
        holder: { ownerId: "u1", ownerLabel: "Ada", expiresInSeconds: 150 },
        waiting: false,
      })
    );
    const before = hook.seen.length;
    const sent = post.mock.calls.length;
    // The first stalls past its slot; a later beat sends the second, which
    // is answered at once.
    while (post.mock.calls.length < sent + 2) await beat();
    return {
      ...hook,
      before,
      firstAnswers: (claimToken: string) =>
        act(async () => {
          firstAnswers({
            message: "",
            item: { status: "acquired", claimToken },
          });
        }),
    };
  }

  it("waits for its own earlier reclaim before taking a refusal as someone else's", async () => {
    const { result, seen, before, firstAnswers } = await overlappingReclaims();
    expect(result.current.state.status).toBe("lost");

    await firstAnswers("t2");

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(seen.slice(before)).not.toContain("taken-over");
    // Kept, not handed back.
    expect(del).not.toHaveBeenCalledWith("/document-lock", {
      ...ref,
      claimToken: "t2",
    });
  });

  it("reports the refusal a beat later when the earlier reclaim never answers, and still takes a late win", async () => {
    const { result, firstAnswers } = await overlappingReclaims();

    await beat();
    await waitFor(() => expect(result.current.state.status).toBe("taken-over"));

    // The earlier reclaim's win arrives after all: it was this editor's own.
    await firstAnswers("t2");
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
  });

  it.each([
    [
      "the browser says it is online",
      () => window.dispatchEvent(new Event("online")),
    ],
    [
      "the tab is shown again",
      () => document.dispatchEvent(new Event("visibilitychange")),
    ],
  ])(
    "asks at once when %s, without waiting for a beat",
    async (_case, wake) => {
      const { result } = await lostWhileOffline();
      post.mockImplementation(() =>
        answer({ status: "acquired", claimToken: "t2" })
      );
      const asked = post.mock.calls.length;

      await act(async () => {
        wake();
      });

      await waitFor(() =>
        expect(result.current.state.status).toBe("held-by-me")
      );
      expect(post).toHaveBeenCalledTimes(asked + 1);
      expect(post).toHaveBeenLastCalledWith("/document-lock", reclaim);
    }
  );
});
