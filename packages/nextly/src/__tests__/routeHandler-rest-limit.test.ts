/**
 * The REST limit at the entry point every verb passes through: the admin API
 * is limited with no exemption by path, a staff session spends its own
 * budget, a plugin's signed-in person is counted by that person rather than by
 * the staff session the browser also holds, and with the unresolved sources'
 * ceiling spent, an auth route is still judged by its own rules.
 *
 * The real handler, routing, session verification and limit run; only the
 * service boot and the built-in dispatcher are stood in for, and whether an
 * account may still use its token answers yes.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../auth/session/session-standing")
  >()),
  sessionTokenIsCurrent: async () => true,
}));

/** The service boot, stood in for and watched: a refused request must not cause one. */
const boot = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../route-handler", async importOriginal => ({
  ...(await importOriginal<typeof import("../route-handler")>()),
  ensureServicesInitialized: boot,
  getDispatcher: async () => ({
    dispatch: async () => ({ success: true, status: 200, data: {} }),
  }),
}));

import { signAccessToken } from "../auth/jwt/sign";
import {
  createPluginAuthApi,
  type CompleteLoginDeps,
} from "../auth/plugin-auth-api";
import { setNextlyLogger } from "../observability/logger";
import type {
  PluginContext,
  PluginDefinition,
} from "../plugins/plugin-context";
import { createPluginPrincipals } from "../plugins/principals/api";
import {
  collectPrincipalKinds,
  publishPrincipalKinds,
} from "../plugins/principals/registry";
import type { PrincipalKindDefinition } from "../plugins/principals/types";
import { getPluginRouteRegistry } from "../plugins/routes/route-registry";
import type { PluginRoute } from "../plugins/routes/route-types";
import { createDynamicHandlers } from "../routeHandler";
import { _resetEnvCache } from "../shared/lib/env";
import { sanitizeConfig } from "../shared/types/config";

const SECRET = "a-test-secret-of-at-least-thirty-two-characters";
const READS = 2;

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
process.env.DB_DIALECT = "sqlite";
process.env.NEXTLY_SECRET = SECRET;
_resetEnvCache();

const resolve = vi.fn(async (request: Request) => {
  const match = /acme_member=([^;]+)/.exec(request.headers.get("cookie") ?? "");
  return match ? { id: match[1], attributes: {} } : null;
});

const routes: PluginRoute[] = [
  {
    method: "GET",
    path: "/me",
    principal: { kind: "acme:member" },
    handler: () => Response.json({ ok: true }),
  },
  {
    method: "POST",
    path: "/sign-in",
    public: true,
    rateLimit: "auth",
    handler: () => Response.json({ ok: true }),
  },
  {
    method: "GET",
    path: "/open",
    public: true,
    handler: () => Response.json({ ok: true }),
  },
];

const acme = {
  name: "acme",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    routes,
    principals: [
      { name: "member", attributes: {}, resolve },
    ] as unknown as PrincipalKindDefinition[],
  },
} as PluginDefinition;

const baseCtx = {
  self: { name: "acme", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
  auth: createPluginAuthApi(
    () => ({ secret: SECRET }) as unknown as CompleteLoginDeps
  ),
  principals: createPluginPrincipals(acme),
} as unknown as PluginContext;

const handlers = createDynamicHandlers({
  config: sanitizeConfig({
    collections: [],
    plugins: [acme],
    rateLimit: { readLimit: READS, writeLimit: 1 },
    security: { trustProxy: true },
  }),
});

afterAll(() => {
  getPluginRouteRegistry().clear();
  publishPrincipalKinds(new Map());
  setNextlyLogger(undefined);
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

let addressSeq = 0;

/** An address no other case has spent, as the limit's store is the handler's own. */
function freshAddress(): string {
  addressSeq += 1;
  return `198.51.100.${addressSeq}`;
}

async function staffCookie(sub: string): Promise<string> {
  return `nextly_session=${await signAccessToken({ sub, email: `${sub}@example.com` }, SECRET)}`;
}

function send(
  method: "GET" | "POST",
  params: string[],
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Response> {
  const req = new Request(`http://localhost/admin/api/${params.join("/")}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ctx = { params: Promise.resolve({ params }) };
  return method === "GET" ? handlers.GET(req, ctx) : handlers.POST(req, ctx);
}

/** Whether a response is the REST limit's refusal, not any other 429. */
async function refusedByRestLimit(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  const body = (await response.clone().json()) as { error?: { code?: string } };
  return body.error?.code === "RATE_LIMIT_EXCEEDED";
}

async function refusals(
  n: number,
  run: () => Promise<Response>
): Promise<number> {
  let count = 0;
  for (let i = 0; i < n; i++)
    if (await refusedByRestLimit(await run())) count++;
  return count;
}

beforeEach(() => {
  resolve.mockClear();
  setNextlyLogger({ warn() {}, error() {}, info() {}, debug() {} });
  publishPrincipalKinds(collectPrincipalKinds([acme]));
  const registry = getPluginRouteRegistry();
  registry.clear();
  for (const route of routes) registry.register("acme", route, baseCtx);
});

describe("the REST entry point's limit", () => {
  it("limits an admin API request with no exemption by path", async () => {
    const from = { "x-forwarded-for": freshAddress() };
    expect(
      await refusals(READS + 3, () => send("GET", ["collections"], from))
    ).toBe(3);
  });

  it("counts a staff session against its own budget, not its address's", async () => {
    const headers = {
      "x-forwarded-for": freshAddress(),
      cookie: await staffCookie("staff-1"),
    };
    expect(
      await refusals(READS * 5, () => send("GET", ["collections"], headers))
    ).toBe(0);
    expect(
      await refusedByRestLimit(await send("GET", ["collections"], headers))
    ).toBe(true);
  });

  it("counts a plugin's person by that person, never by the staff session the request also carries", async () => {
    const cookie = `${await staffCookie("staff-2")}; acme_member=m1`;
    const from = freshAddress();
    const person = () =>
      send("GET", ["plugins", "acme", "me"], {
        cookie,
        "x-forwarded-for": from,
      });
    expect(await refusals(READS * 5, person)).toBe(0);
    expect(resolve).toHaveBeenCalledTimes(READS * 5);
    expect(await refusedByRestLimit(await person())).toBe(true);
    // The staff session's budget is whole.
    const staff = {
      cookie: await staffCookie("staff-2"),
      "x-forwarded-for": from,
    };
    expect(
      await refusals(READS * 5, () => send("GET", ["collections"], staff))
    ).toBe(0);
  });

  it("judges an auth route by its own rules once the unresolved ceiling is spent", async () => {
    // No forwarded address: an unresolved source.
    await refusals(READS * 10, () => send("GET", ["collections"]));
    expect(await refusedByRestLimit(await send("GET", ["collections"]))).toBe(
      true
    );
    // The write half too, since a sign-in is a write.
    await refusals(10, () => send("POST", ["collections"], {}, {}));
    expect(
      await refusedByRestLimit(await send("POST", ["collections"], {}, {}))
    ).toBe(true);
    const signIn = await send(
      "POST",
      ["auth", "login"],
      {},
      {
        email: "someone@example.com",
        password: "wrong-password",
      }
    );
    expect(await refusedByRestLimit(signIn)).toBe(false);
    const pluginSignIn = await send(
      "POST",
      ["plugins", "acme", "sign-in"],
      {},
      {}
    );
    expect(await refusedByRestLimit(pluginSignIn)).toBe(false);
    expect(pluginSignIn.status).toBe(200);
  });
});

describe("the REST entry point's limit, before work", () => {
  /** Spend the unresolved sources' read ceiling, whatever earlier cases left of it. */
  async function spendReadCeiling(): Promise<void> {
    await refusals(READS * 10, () => send("GET", ["collections"]));
    expect(await refusedByRestLimit(await send("GET", ["collections"]))).toBe(
      true
    );
  }

  it("holds an auth path the auth limit does not judge to the ceiling", async () => {
    await spendReadCeiling();
    expect(
      await refusedByRestLimit(await send("GET", ["auth", "session"]))
    ).toBe(true);
  });

  it("refuses an over-budget request to a public plugin route without booting for it", async () => {
    await spendReadCeiling();
    boot.mockClear();
    const refused = await send("GET", ["plugins", "acme", "open"]);
    expect(await refusedByRestLimit(refused)).toBe(true);
    expect(boot).not.toHaveBeenCalled();
    // The control: the same route from a resolved address boots and answers.
    const served = await send("GET", ["plugins", "acme", "open"], {
      "x-forwarded-for": freshAddress(),
    });
    expect(served.status).toBe(200);
    expect(boot).toHaveBeenCalled();
  });

  it("refuses a person under a spent failed-resolution bound without booting for it", async () => {
    // Unresolvable people from unresolved sources, up to the plugin's bound.
    await refusals(READS * 10, () => send("GET", ["plugins", "acme", "me"]));
    boot.mockClear();
    resolve.mockClear();
    const refused = await send("GET", ["plugins", "acme", "me"], {
      cookie: "acme_member=m9",
    });
    expect(await refusedByRestLimit(refused)).toBe(true);
    expect(boot).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
