/**
 * The per-request memo of access lookups: kept within a request, never
 * outside one, never for a failure, forgotten when the request writes, and
 * forgotten for a user when a role assignment the answers came from expires.
 */
import { describe, expect, it, vi } from "vitest";

import {
  answersHoldUntil,
  forgetRequestAccess,
  rememberForRequest,
  runWithAccessMemo,
} from "./request-memo";

describe("rememberForRequest", () => {
  it("looks a value up once within a request", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      expect(await rememberForRequest("u1", "roles", load)).toEqual(["editor"]);
      expect(await rememberForRequest("u1", "roles", load)).toEqual(["editor"]);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing outside a request", async () => {
    // Work with no request, such as a job, looks every answer up as before.
    const load = vi.fn(async () => ["editor"]);
    await rememberForRequest("u1", "roles", load);
    await rememberForRequest("u1", "roles", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing from one request for the next", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(() => rememberForRequest("u1", "roles", load));
    await runWithAccessMemo(() => rememberForRequest("u1", "roles", load));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("looks a different key up on its own", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      await rememberForRequest("u1", "roles", load);
      await rememberForRequest("u2", "roles", load);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not keep a lookup that failed", async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("the read failed");
      return ["editor"];
    });
    await runWithAccessMemo(async () => {
      await expect(rememberForRequest("u1", "roles", load)).rejects.toThrow(
        "the read failed"
      );
      expect(await rememberForRequest("u1", "roles", load)).toEqual(["editor"]);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("forgets what the request kept once the request writes", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      await rememberForRequest("u1", "roles", load);
      forgetRequestAccess();
      await rememberForRequest("u1", "roles", load);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares the memo of a request already open", async () => {
    // A plugin route reached inside the REST catch-all is the same request.
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      await rememberForRequest("u1", "roles", load);
      await runWithAccessMemo(() => rememberForRequest("u1", "roles", load));
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets what it kept about a user once a role behind it expires", async () => {
    const load = vi.fn(async () => ["editor"]);
    const asked = vi.fn(async () => true);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await runWithAccessMemo(async () => {
        await rememberForRequest("u1", "roles", load);
        await rememberForRequest("u1", "permission", asked);
        answersHoldUntil("u1", Date.now() + 1000);
        vi.advanceTimersByTime(999);
        await rememberForRequest("u1", "roles", load);
        expect(load).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        // Every answer about the user goes, not only the role walk.
        await rememberForRequest("u1", "roles", load);
        await rememberForRequest("u1", "permission", asked);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(load).toHaveBeenCalledTimes(2);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it("keeps the soonest of the moments it is told", async () => {
    const load = vi.fn(async () => ["editor"]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await runWithAccessMemo(async () => {
        await rememberForRequest("u1", "roles", load);
        answersHoldUntil("u1", Date.now() + 1000);
        answersHoldUntil("u1", Date.now() + 5000);
        vi.advanceTimersByTime(1000);
        await rememberForRequest("u1", "roles", load);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps another user's answers when one user's expire", async () => {
    const load = vi.fn(async () => ["editor"]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await runWithAccessMemo(async () => {
        await rememberForRequest("u1", "roles", load);
        await rememberForRequest("u2", "roles", load);
        answersHoldUntil("u1", Date.now() + 1000);
        vi.advanceTimersByTime(1000);
        await rememberForRequest("u2", "roles", load);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(load).toHaveBeenCalledTimes(2);
  });
});
