/**
 * The per-request memo of access lookups: kept within a request, never
 * outside one, never for a failure, and forgotten when the request writes.
 */
import { describe, expect, it, vi } from "vitest";

import {
  forgetRequestAccess,
  rememberForRequest,
  runWithAccessMemo,
} from "./request-memo";

describe("rememberForRequest", () => {
  it("looks a value up once within a request", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      expect(await rememberForRequest("roles\u0000u1", load)).toEqual([
        "editor",
      ]);
      expect(await rememberForRequest("roles\u0000u1", load)).toEqual([
        "editor",
      ]);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing outside a request", async () => {
    // Work with no request, such as a job, looks every answer up as before.
    const load = vi.fn(async () => ["editor"]);
    await rememberForRequest("roles\u0000u1", load);
    await rememberForRequest("roles\u0000u1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing from one request for the next", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(() => rememberForRequest("roles\u0000u1", load));
    await runWithAccessMemo(() => rememberForRequest("roles\u0000u1", load));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("looks a different key up on its own", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      await rememberForRequest("roles\u0000u1", load);
      await rememberForRequest("roles\u0000u2", load);
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
      await expect(rememberForRequest("roles\u0000u1", load)).rejects.toThrow(
        "the read failed"
      );
      expect(await rememberForRequest("roles\u0000u1", load)).toEqual([
        "editor",
      ]);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("forgets what the request kept once the request writes", async () => {
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      await rememberForRequest("roles\u0000u1", load);
      forgetRequestAccess();
      await rememberForRequest("roles\u0000u1", load);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares the memo of a request already open", async () => {
    // A plugin route reached inside the REST catch-all is the same request.
    const load = vi.fn(async () => ["editor"]);
    await runWithAccessMemo(async () => {
      await rememberForRequest("roles\u0000u1", load);
      await runWithAccessMemo(() => rememberForRequest("roles\u0000u1", load));
    });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
