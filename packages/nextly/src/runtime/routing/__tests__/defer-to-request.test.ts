/**
 * `deferToRequest` waits on `connection()`, and passes only the two contexts
 * that have no request to wait for: Next.js not installed, and a caller outside
 * any request scope. The second is read off the installed Next.js itself, so a
 * change to how it reports that case fails here rather than in a user's script.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../../next-api");
  vi.resetModules();
});

/** `deferToRequest` loaded against a `next/server` that exports `module`. */
async function withNextServer(module: Record<string, unknown> | null) {
  vi.resetModules();
  vi.doMock("../../next-api", async importOriginal => ({
    ...(await importOriginal<typeof import("../../next-api")>()),
    loadNextModule: () => module,
  }));
  return (await import("../defer-to-request")).deferToRequest;
}

describe("deferToRequest", () => {
  it("passes outside a request scope, as the installed Next.js reports one", async () => {
    vi.resetModules();
    const { deferToRequest } = await import("../defer-to-request");
    await expect(deferToRequest()).resolves.toBeUndefined();
  });

  it("waits for the request through connection()", async () => {
    let released = false;
    const connection = vi.fn(
      () =>
        new Promise<void>(resolve =>
          setTimeout(() => {
            released = true;
            resolve();
          }, 5)
        )
    );
    const deferToRequest = await withNextServer({ connection });

    await deferToRequest();

    expect(connection).toHaveBeenCalledTimes(1);
    expect(released).toBe(true);
  });

  it("rethrows any other failure of connection()", async () => {
    const failure = new Error("Route /x used `connection()` inside `after()`");
    const deferToRequest = await withNextServer({
      connection: () => Promise.reject(failure),
    });

    await expect(deferToRequest()).rejects.toBe(failure);
  });

  it("is a no-op where Next.js is not installed", async () => {
    const deferToRequest = await withNextServer(null);
    await expect(deferToRequest()).resolves.toBeUndefined();
  });
});
