/**
 * The CSRF check must not let the caller decide what its own refusal costs.
 *
 * It runs BEFORE the token is validated and before the handler exists, so
 * every byte it reads is spent on a request that may turn out to be forged.
 * Reading the whole body to look for a token handed an attacker a cheap way
 * to make the server buffer megabytes per request — chunked, so no
 * Content-Length announced it — and be told "forbidden" only afterwards.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../auth/middleware", () => ({
  requireAuthentication: vi.fn(async () => ({
    userId: "u1",
    userEmail: "u@example.test",
    userName: null,
    authMethod: "session",
  })),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

vi.mock("../../../lib/env", () => ({
  env: { NEXTLY_ALLOWED_ORIGINS_PARSED: [] },
}));

vi.mock("../../../di/register", () => ({ getService: () => ({}) }));
vi.mock("../../../utils/proxy-trust", () => ({
  readProxyTrustSettings: () => ({ trustProxy: false, trustedProxyIps: [] }),
}));
vi.mock("../../../utils/get-trusted-client-ip", () => ({
  getTrustedClientIp: () => "1.2.3.4",
}));

import type { PluginContext } from "../../plugin-context";

import { runPluginRoute } from "../dispatch";
import type { RouteMatch } from "../route-registry";
import type { PluginRoute } from "../route-types";

const ORIGIN = "http://localhost";
const URL_ = `${ORIGIN}/admin/api/plugins/@a/x/r`;

/** The cap the CSRF read stops at, and a chunk small enough to see it. */
const MAX_CSRF_BODY_BYTES = 64 * 1024;
const CHUNK = 4 * 1024;

/**
 * What a stream costs before anyone reads it on purpose: undici primes the
 * body when the Request is constructed, and primes the second tee branch when
 * it is cloned. Measured, not assumed — see the assertions below.
 */
const PRIMED = 2 * CHUNK;

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

const csrfRoute = (
  handler: (req: Request) => Promise<Response> | Response
): RouteMatch => ({
  pluginName: "@a/x",
  route: { method: "POST", path: "/r", csrf: true, handler } as PluginRoute,
  baseCtx,
  params: {},
});

/**
 * A body that COUNTS what is taken from it.
 *
 * The defect is invisible in the response — a forged request is refused
 * either way — so the measurement has to be of the reading itself.
 */
function countingBody(chunks: number): {
  stream: ReadableStream<Uint8Array>;
  read: () => number;
} {
  let sent = 0;
  let bytes = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      sent += 1;
      bytes += CHUNK;
      controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
    },
  });
  return { stream, read: () => bytes };
}

function post(body: BodyInit, headers: Record<string, string>): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { origin: ORIGIN, ...headers },
    body,
    // Required by undici for a streamed request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("the CSRF check on a plugin route", () => {
  it("reads NOTHING when the token came in the header", async () => {
    // The header is what readCsrfFromRequest returns whenever it is present,
    // so the body could only ever have supplied a value that was discarded.
    const body = countingBody(256);
    const res = await runPluginRoute(
      post(body.stream, {
        cookie: "nextly_csrf=right",
        "x-csrf-token": "wrong",
      }),
      csrfRoute(() => Response.json({ ok: true }))
    );

    expect(res.status).toBe(403);
    // Nothing beyond what the platform primes. Without the short-circuit this
    // is a 64 KiB read, so the bound separates the two answers cleanly.
    expect(body.read()).toBeLessThanOrEqual(PRIMED);
  });

  it("stops at the cap instead of buffering the whole body", async () => {
    // 1 MB offered, with no Content-Length to declare it: the stream is
    // chunked, which is how a caller avoided the cheap early refusal.
    const body = countingBody(256);
    const res = await runPluginRoute(
      post(body.stream, { cookie: "nextly_csrf=right" }),
      csrfRoute(() => Response.json({ ok: true }))
    );

    expect(res.status).toBe(403);
    // The cap, the chunk that crossed it, and the primed pair — two orders of
    // magnitude under what was offered. Asserted as a bound rather than an
    // exact figure because the chunking is the CALLER's choice; what the test
    // pins down is that the total is the server's.
    expect(body.read()).toBeLessThanOrEqual(
      MAX_CSRF_BODY_BYTES + CHUNK + PRIMED
    );
  });

  it("still accepts a token carried in a small body", async () => {
    // The bound must not cost the body-token path its reason to exist: a
    // form-style caller with no header is still admitted.
    const res = await runPluginRoute(
      post(JSON.stringify({ csrfToken: "right" }), {
        cookie: "nextly_csrf=right",
        "content-type": "application/json",
      }),
      csrfRoute(async req => Response.json(await req.json()))
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ csrfToken: "right" });
  });
});
