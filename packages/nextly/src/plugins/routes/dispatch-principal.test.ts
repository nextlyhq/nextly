/**
 * A plugin route that asks for a plugin's kind of signed-in person, driven
 * through the dispatcher: the handler sees the person or nobody, never staff;
 * a route that requires the kind refuses nobody as any route refuses an
 * unauthenticated caller; and the person's writes take the route's cross-site
 * check as a session cookie's do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../di/register", () => ({ getService: () => ({}) }));

import { signAccessToken } from "../../auth/jwt/sign";
import { requireAuthentication } from "../../auth/middleware";
import {
  createPluginAuthApi,
  type CompleteLoginDeps,
} from "../../auth/plugin-auth-api";
import { setNextlyLogger } from "../../observability/logger";
import type { PluginContext, PluginDefinition } from "../plugin-context";
import { createPluginPrincipals } from "../principals/api";
import {
  collectPrincipalKinds,
  publishPrincipalKinds,
} from "../principals/registry";
import type { PrincipalKindDefinition } from "../principals/types";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute, PluginRouteContext } from "./route-types";

const SECRET = "a-test-secret-of-at-least-thirty-two-characters";
const SITE = "http://localhost:3000";
const PERSON_COOKIE = "acc_session=member-1";

/** Reads the plugin's own cookie, as an accounts plugin's resolver would. */
const resolve = vi.fn(async (request: Request) => {
  const cookie = request.headers.get("cookie") ?? "";
  const match = /acc_session=([^;]+)/.exec(cookie);
  if (match?.[1] === "throws") throw new Error("session store down");
  return match ? { id: match[1], attributes: { verified: true } } : null;
});

const accounts = {
  name: "accounts",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      { name: "account", attributes: { verified: "boolean" }, resolve },
    ] as unknown as PrincipalKindDefinition[],
  },
} as PluginDefinition;

const auth = createPluginAuthApi(
  () => ({ secret: SECRET }) as unknown as CompleteLoginDeps
);

const baseCtx = {
  self: { name: "accounts", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
  auth,
  principals: createPluginPrincipals(accounts),
} as unknown as PluginContext;

/** What the handler saw, the last time it ran. */
let seen: {
  user: unknown;
  caller: unknown;
  principal: PluginRouteContext["principal"];
  currentUser: unknown;
  askedAgain: unknown;
} | null;

function match(extra: Partial<PluginRoute> = {}): RouteMatch {
  return {
    pluginName: "accounts",
    route: {
      method: "POST",
      path: "/cart",
      principal: { kind: "accounts:account" },
      handler: async (req: Request, ctx: PluginRouteContext) => {
        seen = {
          user: ctx.user,
          caller: ctx.caller,
          principal: ctx.principal,
          currentUser: await ctx.auth.currentUser(req),
          askedAgain: await ctx.principals?.fromRequest(req.clone(), "account"),
        };
        return Response.json({ ok: true });
      },
      ...extra,
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

async function staffCookie(): Promise<string> {
  const token = await signAccessToken({ sub: "u1", email: "u1@x.com" }, SECRET);
  return `nextly_session=${token}; nextly_csrf=tok`;
}

function call(
  cookie: string,
  init: { method?: string; origin?: string | null; bearer?: boolean } = {}
): Request {
  const method = init.method ?? "POST";
  return new Request(`${SITE}/admin/api/plugins/accounts/cart`, {
    method,
    headers: {
      cookie,
      ...(init.origin === null ? {} : { origin: init.origin ?? SITE }),
      ...(init.bearer ? { authorization: "Bearer api-token" } : {}),
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify({ sku: "a" }) }),
  });
}

const csrfRows = () =>
  auditWrite.mock.calls.filter(
    ([event]) => (event as { kind?: string }).kind === "csrf-failed"
  );

beforeEach(() => {
  seen = null;
  resolve.mockClear();
  auditWrite.mockReset();
  vi.mocked(requireAuthentication).mockReset();
  vi.mocked(requireAuthentication).mockResolvedValue({
    userId: "u1",
    userEmail: "u1@x.com",
    userName: "U",
    authMethod: "session",
  } as never);
  setNextlyLogger({ warn() {}, error() {}, info() {}, debug() {} });
  publishPrincipalKinds(collectPrincipalKinds([accounts]));
});

afterEach(() => {
  setNextlyLogger(undefined);
  publishPrincipalKinds(new Map());
});

describe("a route that asks for a kind", () => {
  it("hands the handler the person and never staff, on a request carrying both", async () => {
    const res = await runPluginRoute(
      call(`${await staffCookie()}; ${PERSON_COOKIE}`),
      match()
    );

    expect(res.status).toBe(200);
    expect(seen?.principal).toMatchObject({
      type: "principal",
      kind: "accounts:account",
      id: "member-1",
      attributes: { verified: true },
    });
    expect(seen?.user).toBeNull();
    expect(seen?.caller).toBeNull();
    expect(seen?.currentUser).toBeNull();
    // Not read and then ignored: the staff session is never consulted.
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it("is the only route where currentUser hides the staff session", async () => {
    // The control: the same staff cookie on a route asking for no kind is a
    // signed-in user, so the case above is the route hiding it, not a
    // session that never verified.
    const res = await runPluginRoute(
      call(`${await staffCookie()}; ${PERSON_COOKIE}`),
      match({ principal: undefined })
    );
    expect(res.status).toBe(200);
    expect(seen?.currentUser).toEqual({ id: "u1", email: "u1@x.com" });
    expect(seen?.principal).toBeNull();
  });

  it("calls the resolver once, however the handler asks again", async () => {
    await runPluginRoute(call(PERSON_COOKIE), match());
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(seen?.askedAgain).toBe(seen?.principal);
  });

  it("asks about a different request the handler builds on its own", async () => {
    // A request carrying another person's session is not the routed one, and
    // must not be answered with the routed request's person.
    let other: { id?: string } | null | undefined;
    const res = await runPluginRoute(
      call(PERSON_COOKIE),
      match({
        handler: async (_req: Request, ctx: PluginRouteContext) => {
          other = await ctx.principals?.fromRequest(
            new Request(`${SITE}/shop`, {
              headers: { cookie: "acc_session=member-2" },
            }),
            "account"
          );
          return Response.json({ ok: true });
        },
      })
    );
    expect(res.status).toBe(200);
    expect(other?.id).toBe("member-2");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe("a route that requires the kind", () => {
  /** The refusal a secure staff route gives a caller with no session. */
  async function unauthenticatedStaffRefusal(): Promise<Response> {
    vi.mocked(requireAuthentication).mockResolvedValueOnce({
      statusCode: 401,
      message: "Authentication required",
      error: "Unauthorized",
    } as never);
    return runPluginRoute(call(""), match({ principal: undefined }));
  }

  async function shape(res: Response) {
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    return {
      status: res.status,
      code: body.error.code,
      message: body.error.message,
      cacheControl: res.headers.get("cache-control"),
    };
  }

  it("refuses nobody exactly as a secure route refuses an unauthenticated caller", async () => {
    const refused = await runPluginRoute(call(""), match());
    expect(seen).toBeNull();
    expect(await shape(refused)).toEqual(
      await shape(await unauthenticatedStaffRefusal())
    );
    expect(refused.status).toBe(401);
  });

  it("refuses a request whose resolver throws, the same way", async () => {
    const refused = await runPluginRoute(call("acc_session=throws"), match());
    expect(seen).toBeNull();
    expect(await shape(refused)).toEqual(
      await shape(await unauthenticatedStaffRefusal())
    );
  });

  it("refuses a staff session alone, which is nobody of the kind", async () => {
    const res = await runPluginRoute(call(await staffCookie()), match());
    expect(res.status).toBe(401);
    expect(seen).toBeNull();
  });

  it("serves nobody when the route does not require the kind", async () => {
    const res = await runPluginRoute(
      call(""),
      match({ principal: { kind: "accounts:account", required: false } })
    );
    expect(res.status).toBe(200);
    expect(seen?.principal).toBeNull();
  });
});

describe("a person's writes", () => {
  it.each([
    ["the default origin check", {}],
    ["csrf: true", { csrf: true }],
    ["csrf: false", { csrf: false }],
  ])(
    "are refused cross-site under %s, and recorded",
    async (_label, options: Partial<PluginRoute>) => {
      const res = await runPluginRoute(
        call(PERSON_COOKIE, { origin: "https://evil.example" }),
        match(options)
      );
      expect(res.status).toBe(403);
      expect(seen).toBeNull();
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CSRF_FAILED");
      expect(csrfRows()).toHaveLength(1);
      expect(csrfRows()[0]?.[0]).toMatchObject({
        metadata: { path: "plugins/accounts/cart", method: "POST" },
      });
    }
  );

  it("reach the handler from this site under the default check", async () => {
    const res = await runPluginRoute(call(PERSON_COOKIE), match());
    expect(res.status).toBe(200);
    expect(seen?.principal?.id).toBe("member-1");
  });

  it("still need the token where the route asks for one", async () => {
    // Same origin, no token: the check applied is the token's, not only the
    // origin's.
    const res = await runPluginRoute(
      call(PERSON_COOKIE),
      match({ csrf: true })
    );
    expect(res.status).toBe(403);
    expect(seen).toBeNull();
  });

  it("are exempt cross-site when the request carries a Bearer token", async () => {
    const res = await runPluginRoute(
      call(PERSON_COOKIE, { origin: "https://evil.example", bearer: true }),
      match()
    );
    expect(res.status).toBe(200);
    expect(seen?.principal?.id).toBe("member-1");
    expect(csrfRows()).toHaveLength(0);
  });

  it("are not checked when nobody of the kind is signed in", async () => {
    // A cross-site request recognising nobody can act for nobody, so a
    // route that does not require the kind serves it as anonymous.
    const res = await runPluginRoute(
      call("", { origin: "https://evil.example" }),
      match({ principal: { kind: "accounts:account", required: false } })
    );
    expect(res.status).toBe(200);
    expect(seen?.principal).toBeNull();
  });

  it("are origin-checked, without a token, when nobody of the kind is signed in on a csrf: true route", async () => {
    // Recognising nobody makes the caller anonymous, and a route that asks
    // for the check holds an anonymous write to its origin: a cookie the
    // plugin keeps for visitors not yet signed in travels cross-site too.
    const route = match({
      principal: { kind: "accounts:account", required: false },
      csrf: true,
    });
    const crossSite = await runPluginRoute(
      call("", { origin: "https://evil.example" }),
      route
    );
    expect(crossSite.status).toBe(403);
    expect(seen).toBeNull();

    const sameSite = await runPluginRoute(call(""), route);
    expect(sameSite.status).toBe(200);
    expect(seen?.principal).toBeNull();
  });

  it("are not checked when nobody of the kind is signed in and the request carries a Bearer token", async () => {
    // A Bearer token exempts by its presence whoever else the request does
    // or does not name: a page on another site cannot make a browser send
    // one, so recognising nobody must not take the exemption away.
    const res = await runPluginRoute(
      call("", { origin: "https://evil.example", bearer: true }),
      match({
        principal: { kind: "accounts:account", required: false },
        csrf: true,
      })
    );
    expect(res.status).toBe(200);
    expect(seen?.principal).toBeNull();
    expect(csrfRows()).toHaveLength(0);
  });

  it("are not checked on a read", async () => {
    const res = await runPluginRoute(
      call(PERSON_COOKIE, { method: "GET", origin: "https://evil.example" }),
      match({ method: "GET" })
    );
    expect(res.status).toBe(200);
  });
});
