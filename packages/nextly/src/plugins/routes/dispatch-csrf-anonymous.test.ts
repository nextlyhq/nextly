/**
 * The cross-site check a public plugin route applies to a caller no session
 * authenticates, driven through the dispatcher.
 *
 * A guest-facing route (a cart, a signup) that declares `csrf: true` and keeps
 * its own cookie gets that cookie sent on any cross-site form post. So such a
 * route checks an anonymous write's origin, as the session path does, without
 * a token an anonymous caller has no way to hold. Only a `Bearer` token
 * exempts a caller: a browser attaches Basic, Digest, Negotiate or NTLM
 * credentials on its own, never a `Bearer` one.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// These tests read a session with no database behind it. Whether the account
// may still use its token is the session check's own question, covered by
// `auth/session/__tests__/session-standing.test.ts` and, on each dialect,
// `session-cutoff.integration.test.ts`; here every account may.
vi.mock("../../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../auth/session/session-standing")
  >()),
  sessionTokenIsCurrent: async () => true,
}));

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

const auditWrite = vi.hoisted(() => vi.fn());
vi.mock("../../domains/audit/audit-log-writer", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../domains/audit/audit-log-writer")
  >()),
  buildAuditLogWriter: () => ({ write: auditWrite }),
}));

vi.mock("../../di/service-access", () => ({ getService: () => ({}) }));

import { signAccessToken } from "../../auth/jwt/sign";
import { requireAuthentication } from "../../auth/middleware";
import { _resetEnvCache } from "../../shared/lib/env";
import type { PluginContext } from "../plugin-context";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const SITE = "http://localhost:3000";
const ALLOWED = "https://shop.example";
const CROSS_SITE = "https://evil.example";

const baseCtx = {
  self: { name: "@a/cart", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

let handlerCalls = 0;
function match(extra: Partial<PluginRoute> = {}): RouteMatch {
  return {
    pluginName: "@a/cart",
    route: {
      method: "POST",
      path: "/cart/items",
      public: true,
      handler: () => {
        handlerCalls++;
        return Response.json({ ok: true });
      },
      ...extra,
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

/** A guest's write: the plugin's own cookie, and no CSRF token anywhere. */
function write(
  opts: { origin?: string; cookie?: string; authorization?: string } = {}
): Request {
  const cookie = ["cart_id=c1", opts.cookie].filter(Boolean).join("; ");
  return new Request(`${SITE}/admin/api/plugins/@a/cart/cart/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
    },
    body: JSON.stringify({ sku: "tee" }),
  });
}

function secret(): string {
  const value = process.env.NEXTLY_SECRET;
  if (!value) throw new Error("the test setup sets NEXTLY_SECRET");
  return value;
}

/** A session cookie that verified once and has since expired. */
async function expiredSession(): Promise<string> {
  const token = await signAccessToken(
    { sub: "u1", email: "u1@x.com" },
    secret(),
    -60
  );
  return `nextly_session=${token}`;
}

/** A session cookie that authenticates. */
async function liveSession(): Promise<string> {
  const token = await signAccessToken(
    { sub: "u1", email: "u1@x.com" },
    secret()
  );
  return `nextly_session=${token}`;
}

const MALFORMED_SESSION = "nextly_session=not-a-token";

async function expectRefused(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(handlerCalls).toBe(0);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("CSRF_FAILED");
}

function expectAdmitted(res: Response): void {
  expect(res.status).toBe(200);
  expect(handlerCalls).toBe(1);
}

const previousAllowed = process.env.NEXTLY_ALLOWED_ORIGINS;
beforeAll(() => {
  process.env.NEXTLY_ALLOWED_ORIGINS = ALLOWED;
  _resetEnvCache();
});
afterAll(() => {
  if (previousAllowed === undefined) delete process.env.NEXTLY_ALLOWED_ORIGINS;
  else process.env.NEXTLY_ALLOWED_ORIGINS = previousAllowed;
  _resetEnvCache();
});

beforeEach(() => {
  handlerCalls = 0;
  auditWrite.mockReset();
});

describe("an anonymous write to a public route that declares csrf: true", () => {
  it("is refused from another site before the handler runs, and recorded", async () => {
    const res = await runPluginRoute(
      write({ origin: CROSS_SITE }),
      match({ csrf: true })
    );
    await expectRefused(res);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "csrf-failed",
        metadata: { path: "plugins/@a/cart/cart/items", method: "POST" },
      })
    );
  });

  it("is refused when it names no origin at all", async () => {
    // As on the session path: a proxy that strips `Origin` can carry a real
    // browser's forged post, so a missing origin is not taken as a server.
    const res = await runPluginRoute(write(), match({ csrf: true }));
    await expectRefused(res);
  });

  it("is refused from another site with an expired session cookie", async () => {
    const res = await runPluginRoute(
      write({ origin: CROSS_SITE, cookie: await expiredSession() }),
      match({ csrf: true })
    );
    await expectRefused(res);
  });

  it("is refused from another site with a malformed session cookie", async () => {
    const res = await runPluginRoute(
      write({ origin: CROSS_SITE, cookie: MALFORMED_SESSION }),
      match({ csrf: true })
    );
    await expectRefused(res);
  });

  it("reaches the handler from the site itself without a token", async () => {
    const res = await runPluginRoute(
      write({ origin: SITE }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("reaches the handler from an allowed origin without a token", async () => {
    const res = await runPluginRoute(
      write({ origin: ALLOWED }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("reaches the handler from the site with an expired session cookie, without a token", async () => {
    // An expired cookie authenticates nobody, so the caller is anonymous and
    // has no token to send; demanding one refused a guest whose old admin
    // session happened to linger in the browser.
    const res = await runPluginRoute(
      write({ origin: SITE, cookie: await expiredSession() }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("reaches the handler from an allowed origin with an expired session cookie, without a token", async () => {
    const res = await runPluginRoute(
      write({ origin: ALLOWED, cookie: await expiredSession() }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("reaches the handler from the site with a malformed session cookie, without a token", async () => {
    const res = await runPluginRoute(
      write({ origin: SITE, cookie: MALFORMED_SESSION }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("still demands the token when the session cookie authenticates", async () => {
    // The control: a classifier that treated every session cookie as
    // anonymous would pass the expired-cookie cases above while dropping the
    // token a signed-in caller owes this route.
    const res = await runPluginRoute(
      write({ origin: SITE, cookie: await liveSession() }),
      match({ csrf: true })
    );
    await expectRefused(res);
  });
});

describe("an anonymous write to a public route that leaves csrf unset", () => {
  it("reaches the handler naming no origin", async () => {
    // A webhook or other server caller sends no origin and carries no cookie
    // worth forging; a route for such callers leaves `csrf` unset.
    const res = await runPluginRoute(write(), match());
    expectAdmitted(res);
  });

  it("reaches the handler from another site", async () => {
    const res = await runPluginRoute(write({ origin: CROSS_SITE }), match());
    expectAdmitted(res);
  });
});

describe("an Authorization header on an anonymous write to a csrf: true route", () => {
  // Each a scheme a browser can attach by itself (HTTP authentication), and
  // an invented one, so a list of known browser schemes cannot pass.
  it.each([
    ["Basic", "Basic dXNlcjpwYXNz"],
    ["Digest", 'Digest username="u", realm="r", nonce="n", response="x"'],
    ["Negotiate", "Negotiate YIIGhgYGKwYBBQUCoIIGejCCBnag"],
    ["NTLM", "NTLM TlRMTVNTUAABAAAAB4IIogAAAAAAAAAAAAAAAAAAAAAGAbEdAAAADw=="],
    ["an invented scheme", "Cartkey abc123"],
  ])("does not exempt a cross-site write carrying %s", async (_, header) => {
    const res = await runPluginRoute(
      write({ origin: CROSS_SITE, authorization: header }),
      match({ csrf: true })
    );
    await expectRefused(res);
  });

  it("does not exempt one whose scheme merely starts with Bearer", async () => {
    const res = await runPluginRoute(
      write({ origin: CROSS_SITE, authorization: "Bearerish abc123" }),
      match({ csrf: true })
    );
    await expectRefused(res);
  });

  it("exempts a Bearer token that authenticates nobody, with no origin and no token", async () => {
    // A public route resolves no Bearer token, so whether it would
    // authenticate never enters the decision: its presence is what proves the
    // caller is not a browser acting on its own.
    const res = await runPluginRoute(
      write({ authorization: "Bearer not-a-key" }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("exempts a Bearer token that authenticates, with no origin and no token", async () => {
    // A route that requires a caller resolves the key; the API key, not a
    // cookie, admitted the request, so there is nothing for a page to forge.
    vi.mocked(requireAuthentication).mockResolvedValueOnce({
      userId: "u1",
      userEmail: "u1@x.com",
      userName: "U",
      authMethod: "api-key",
    } as never);
    const res = await runPluginRoute(
      write({ authorization: "Bearer nx_live_abc" }),
      match({ csrf: true, public: false })
    );
    expectAdmitted(res);
  });

  it("exempts a Bearer token whose scheme is written in lower case", async () => {
    // RFC 9110 §11.1: the scheme name is case-insensitive.
    const res = await runPluginRoute(
      write({ authorization: "bearer nx_live_abc" }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("exempts a Bearer token beside an expired session cookie", async () => {
    const res = await runPluginRoute(
      write({
        origin: CROSS_SITE,
        cookie: await expiredSession(),
        authorization: "Bearer nx_live_abc",
      }),
      match({ csrf: true })
    );
    expectAdmitted(res);
  });

  it("does not exempt Basic beside an expired session cookie", async () => {
    const res = await runPluginRoute(
      write({
        origin: CROSS_SITE,
        cookie: await expiredSession(),
        authorization: "Basic dXNlcjpwYXNz",
      }),
      match({ csrf: true })
    );
    await expectRefused(res);
  });
});
