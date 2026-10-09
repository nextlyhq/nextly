/**
 * Code outside core — auth hooks, strategies, plugin routes — receives the
 * request without the refresh cookie, and with everything else it carried.
 */
import { describe, expect, it } from "vitest";

import { AuthHookRegistry } from "../../pipeline/hooks";
import { runStrategyChain } from "../../pipeline/strategy-chain";
import { withoutRefreshCookie } from "../refresh-token-cookie";

const URL_ = "http://localhost:3000/admin/api/auth/login";
const COOKIE = "nextly_session=acc; nextly_refresh=secret; theme=dark";
const ctx = {} as never;

function post(cookie = COOKIE): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { cookie, "x-custom": "1", "content-type": "application/json" },
    body: JSON.stringify({ email: "a@b.c" }),
  });
}

describe("withoutRefreshCookie", () => {
  it("removes only the refresh cookie and keeps method, url, headers and body", async () => {
    const original = post();
    const copy = await withoutRefreshCookie(original);
    expect(copy.headers.get("cookie")).toBe("nextly_session=acc; theme=dark");
    expect(copy.headers.get("x-custom")).toBe("1");
    expect(copy.method).toBe("POST");
    expect(copy.url).toBe(URL_);
    expect(await copy.json()).toEqual({ email: "a@b.c" });
    // The original stays readable, cookie included.
    expect(original.headers.get("cookie")).toBe(COOKIE);
    expect(await original.json()).toEqual({ email: "a@b.c" });
  });

  it("drops the header when the refresh cookie was the only one", async () => {
    const copy = await withoutRefreshCookie(post("nextly_refresh=secret"));
    expect(copy.headers.has("cookie")).toBe(false);
  });

  it("copies a request whose body was already read, without the body", async () => {
    const original = post();
    await original.json();
    const copy = await withoutRefreshCookie(original);
    expect(copy.headers.get("cookie")).toBe("nextly_session=acc; theme=dark");
    expect(copy.method).toBe("POST");
  });

  it("returns a request without the cookie unchanged", async () => {
    const original = post("nextly_session=acc");
    expect(await withoutRefreshCookie(original)).toBe(original);
  });
  it("copies a request of another Request class, as a framework hands over", async () => {
    // Next.js passes an instance of its own Request class, which the global
    // constructor cannot read; the copy is built from the request's values.
    const real = post();
    const foreignOf = (request: Request): Request =>
      ({
        url: request.url,
        method: request.method,
        headers: request.headers,
        get body() {
          return request.body;
        },
        get bodyUsed() {
          return request.bodyUsed;
        },
        signal: request.signal,
        redirect: request.redirect,
        clone: () => foreignOf(request.clone()),
        arrayBuffer: () => request.arrayBuffer(),
      }) as unknown as Request;
    const foreign = foreignOf(real);
    const copy = await withoutRefreshCookie(foreign);
    expect(copy.headers.get("cookie")).toBe("nextly_session=acc; theme=dark");
    expect(copy.method).toBe("POST");
    expect(await copy.json()).toEqual({ email: "a@b.c" });
    expect(await real.json()).toEqual({ email: "a@b.c" });
  });
});

describe("auth hooks and strategies", () => {
  it("never see the refresh cookie, and still see the others", async () => {
    const seen: string[] = [];
    const record = (request: Request) =>
      seen.push(request.headers.get("cookie") ?? "");
    const hooks = new AuthHookRegistry();
    hooks.add({
      beforeLogin: input => void record(input.request),
      determineUser: request => {
        record(request);
        return null;
      },
    });

    await hooks.runBeforeLogin(
      { request: post(), body: {}, strategyName: "" },
      ctx
    );
    await hooks.runDetermineUser(
      new Request(URL_.replace("login", "session"), {
        headers: { cookie: COOKIE },
      }),
      ctx
    );
    await runStrategyChain(
      [
        {
          name: "probe",
          authenticate: input => {
            record(input.request);
            return Promise.resolve({ type: "pass" });
          },
        },
      ],
      { request: post(), body: {} },
      ctx
    );

    expect(seen).toEqual([
      "nextly_session=acc; theme=dark",
      "nextly_session=acc; theme=dark",
      "nextly_session=acc; theme=dark",
    ]);
  });
});

describe("withoutRefreshCookie and a large body", () => {
  /** A request carrying the refresh cookie whose body streams `bytes` bytes, with no Content-Length. */
  function streaming(bytes: number): {
    request: Request;
    pulled: () => number;
  } {
    let sent = 0;
    const chunk = new Uint8Array(16 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(URL_, {
      method: "POST",
      headers: { cookie: COOKIE },
      body,
      duplex: "half",
    } as RequestInit);
    return { request, pulled: () => sent };
  }

  it("refuses a body past the CSRF body cap without reading all of it", async () => {
    const { request, pulled } = streaming(8 * 1024 * 1024);

    const refused = await withoutRefreshCookie(request).catch(
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "body-too-large", maxBytes: 64 * 1024 },
    });
    expect(pulled()).toBeLessThan(1024 * 1024);
  });

  it("refuses a declared length past the cap before reading", async () => {
    const original = new Request(URL_, {
      method: "POST",
      headers: { cookie: COOKIE, "content-length": String(1024 * 1024) },
      body: "x",
    });

    await expect(withoutRefreshCookie(original)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "body-too-large" },
    });
  });

  it("copies a body under the cap", async () => {
    const { request } = streaming(32 * 1024);

    const copy = await withoutRefreshCookie(request);

    expect((await copy.arrayBuffer()).byteLength).toBe(32 * 1024);
  });
});
