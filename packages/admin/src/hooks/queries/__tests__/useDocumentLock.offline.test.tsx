/**
 * A claim lost to a dropped connection comes back by itself.
 *
 * Offline (or asleep) for longer than the loss deadline, an editor stops
 * being able to vouch for its claim and reports it lost, which holds the
 * form. Once the connection is back it asks again, with its own token first:
 * a lease the server still holds is renewed, one the server let go with
 * nobody taking it is claimed again with a plain claim, which displaces
 * nobody, and a claim somebody else holds is reported as theirs. It asks on
 * every beat, and at once when the browser says it is online or the tab is
 * shown again.
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
  it("takes a fresh claim when its old one is still live, so a late release cannot remove it", async () => {
    const { result } = await lostWhileOffline();

    // The release sent when the claim was lost is still on its way.
    let releaseLands: () => void = () => {};
    del.mockReturnValue(
      new Promise<void>(resolve => {
        releaseLands = resolve;
      })
    );
    patch.mockResolvedValue({
      message: "",
      item: { status: "renewed", waiting: false },
    });
    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "t2" },
    });
    await beat();

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    // Asked about with the old token, then held under a new one: the release
    // names the old token, so it deletes nothing when it lands.
    expect(patch).toHaveBeenCalledWith("/document-lock", {
      ...ref,
      claimToken: "t1",
    });
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: false,
      requestAccess: false,
    });
    await act(async () => {
      releaseLands();
    });
    await beat();
    expect(patch).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      claimToken: "t2",
    });
  });

  it("asks again when an ask never answers", async () => {
    const { result } = await lostWhileOffline();

    // The first ask after the outage stalls; the next one is answered.
    patch.mockReturnValueOnce(new Promise(() => {}));
    patch.mockResolvedValue({ message: "", item: { status: "lost" } });
    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "t2" },
    });
    const asked = patch.mock.calls.length;
    await beat();
    expect(patch).toHaveBeenCalledTimes(asked + 1);

    await beat(2);
    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(patch.mock.calls.length).toBeGreaterThan(asked + 1);
  });

  it("is claimed again with a plain claim when the server let it go and nobody took it", async () => {
    const { result } = await lostWhileOffline();

    patch.mockResolvedValue({ message: "", item: { status: "lost" } });
    post.mockResolvedValue({
      message: "",
      item: { status: "acquired", claimToken: "t2" },
    });
    await beat();

    await waitFor(() => expect(result.current.state.status).toBe("held-by-me"));
    expect(post).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      takeover: false,
      requestAccess: false,
    });

    // The new claim is the one renewed from here on.
    patch.mockResolvedValue({
      message: "",
      item: { status: "renewed", waiting: false },
    });
    await beat();
    expect(patch).toHaveBeenLastCalledWith("/document-lock", {
      ...ref,
      claimToken: "t2",
    });
  });

  it("names who took it when somebody else claimed it meanwhile", async () => {
    const { result } = await lostWhileOffline();

    patch.mockResolvedValue({
      message: "",
      item: { status: "lost", holder: colleague },
    });
    await beat();

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "taken-over",
        holder: colleague,
      })
    );
    // Theirs now: never claimed, and never taken over, without the person.
    expect(post).toHaveBeenCalledTimes(1);

    // And not asked about again on later beats, as for any takeover.
    const asked = patch.mock.calls.length;
    await beat(2);
    expect(patch).toHaveBeenCalledTimes(asked);
  });

  it("keeps asking while the connection stays down", async () => {
    const { result } = await lostWhileOffline();

    await beat(3);
    expect(result.current.state.status).toBe("lost");

    patch.mockResolvedValue({ message: "", item: { status: "lost" } });
    await beat();
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
      patch.mockResolvedValue({
        message: "",
        item: { status: "renewed", waiting: false },
      });
      const asked = patch.mock.calls.length;

      await act(async () => {
        wake();
      });

      await waitFor(() =>
        expect(result.current.state.status).toBe("held-by-me")
      );
      expect(patch).toHaveBeenCalledTimes(asked + 1);
    }
  );
});
