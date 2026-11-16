/**
 * The REST limit through the plugin route dispatcher: a route asking for a
 * plugin's kind of signed-in person counts the request by that person, with
 * failed resolutions bounded per plugin before the resolver runs, and a route
 * with an auth budget of its own is kept out of the unresolved sources'
 * ceiling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

vi.mock("../../di/service-access", () => ({ getService: () => ({}) }));

import {
  createPluginAuthApi,
  type CompleteLoginDeps,
} from "../../auth/plugin-auth-api";
import { InMemoryRateLimitStore } from "../../middleware/rate-limit";
import type { RestCallerReaders } from "../../middleware/rest-callers";
import {
  openRestLimitGate,
  runWithRestLimitGate,
  type RestLimitDecider,
} from "../../middleware/rest-limit-gate";
import {
  createRestLimits,
  SESSION_BUDGET_MULTIPLE,
  UNRESOLVED_CEILING_MULTIPLE,
} from "../../middleware/rest-limits";
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
import type { PluginRoute } from "./route-types";

const READS = 2;

/** Reads the plugin's own cookie, as an accounts plugin's resolver would. */
const resolve = vi.fn(async (request: Request) => {
  const match = /acc_session=([^;]+)/.exec(request.headers.get("cookie") ?? "");
  return match ? { id: match[1], attributes: {} } : null;
});

const accounts = {
  name: "accounts",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      { name: "account", attributes: {}, resolve },
    ] as unknown as PrincipalKindDefinition[],
  },
} as PluginDefinition;

const baseCtx = {
  self: { name: "accounts", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
  auth: createPluginAuthApi(
    () => ({ secret: "s".repeat(40) }) as unknown as CompleteLoginDeps
  ),
  principals: createPluginPrincipals(accounts),
} as unknown as PluginContext;

function personRoute(pluginName = "accounts"): RouteMatch {
  return {
    pluginName,
    route: {
      method: "GET",
      path: "/me",
      principal: { kind: "accounts:account" },
      handler: () => Response.json({ ok: true }),
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

function publicRoute(extra: Partial<PluginRoute> = {}): RouteMatch {
  return {
    pluginName: "accounts",
    route: {
      method: "GET",
      path: "/csrf",
      public: true,
      handler: () => Response.json({ ok: true }),
      ...extra,
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

/** Staff sessions are a `staff=<user>` cookie here; nothing else verifies. */
const readers: RestCallerReaders = {
  sessionUser: async request =>
    /staff=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null,
  lookupKey: async () => null,
  debitKey: async () => null,
};

let limits: RestLimitDecider;

function configure(unresolvedCeiling?: { readLimit: number }): void {
  limits = createRestLimits(
    {
      enabled: true,
      readLimit: READS,
      writeLimit: 1,
      trustProxy: true,
      store: new InMemoryRateLimitStore(),
      ...(unresolvedCeiling ? { unresolvedCeiling } : {}),
    },
    readers
  );
}

function request(cookies: string[], address?: string): Request {
  return new Request("http://localhost/admin/api/plugins/accounts/me", {
    headers: {
      ...(cookies.length > 0 ? { cookie: cookies.join("; ") } : {}),
      ...(address ? { "x-forwarded-for": address } : {}),
    },
  });
}

/** Dispatch through the REST entry point's gate, as `withSecurity` does. */
async function dispatch(req: Request, matched: RouteMatch): Promise<number> {
  const gate = openRestLimitGate(limits, req);
  const res = await runWithRestLimitGate(gate, () =>
    runPluginRoute(req, matched)
  );
  return res.status;
}

/** A request the built-in router answers, as the entry point settles it. */
async function core(cookies: string[], address?: string): Promise<number> {
  const refused = await openRestLimitGate(
    limits,
    request(cookies, address)
  ).settle("core");
  return refused?.status ?? 200;
}

async function times(n: number, run: () => Promise<number>): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push(await run());
  return statuses;
}

const ok = (statuses: number[]) => statuses.filter(s => s === 200).length;

beforeEach(() => {
  resolve.mockClear();
  setNextlyLogger({ warn() {}, error() {}, info() {}, debug() {} });
  publishPrincipalKinds(collectPrincipalKinds([accounts]));
  configure();
});

afterEach(() => {
  setNextlyLogger(undefined);
  publishPrincipalKinds(new Map());
});

describe("a route asking for a kind of person", () => {
  it("admits a person from an unresolved source after the anonymous ceiling is spent", async () => {
    const ceiling = READS * UNRESOLVED_CEILING_MULTIPLE;
    expect(ok(await times(ceiling + 3, () => core([])))).toBe(ceiling);
    expect(await dispatch(request(["acc_session=m1"]), personRoute())).toBe(
      200
    );
  });

  it("spends only the person's budget on a request also carrying a staff session, resolving once each", async () => {
    const budget = READS * SESSION_BUDGET_MULTIPLE;
    const both = ["acc_session=m1", "staff=u1"];
    const statuses = await times(budget + 2, () =>
      dispatch(request(both), personRoute())
    );
    expect(ok(statuses)).toBe(budget);
    expect(statuses.at(-1)).toBe(429);
    expect(resolve).toHaveBeenCalledTimes(budget + 2);
    // The staff session's own budget is untouched.
    expect(ok(await times(budget, () => core(["staff=u1"])))).toBe(budget);
  });

  it("bounds failed resolutions from unresolved sources by the plugin's ceiling, before the resolver", async () => {
    const bound = READS * UNRESOLVED_CEILING_MULTIPLE;
    const flood = await times(bound + 5, () =>
      dispatch(request([]), personRoute())
    );
    expect(flood.filter(s => s === 401)).toHaveLength(bound);
    expect(resolve).toHaveBeenCalledTimes(bound);
    // The next valid person from an unresolved source is refused before
    // the resolver runs.
    expect(await dispatch(request(["acc_session=m1"]), personRoute())).toBe(
      429
    );
    expect(resolve).toHaveBeenCalledTimes(bound);
    // Another plugin's people, and the anonymous ceiling, are untouched.
    expect(
      await dispatch(request(["acc_session=m1"]), personRoute("shop"))
    ).toBe(200);
    expect(await core([])).toBe(200);
  });

  it("takes a configured ceiling as the plugin's failed-resolution ceiling", async () => {
    configure({ readLimit: 3 });
    const flood = await times(6, () => dispatch(request([]), personRoute()));
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(flood.filter(s => s === 429)).toHaveLength(3);
  });

  it("bounds failed resolutions from a resolved address apart from its own budget", async () => {
    const from = "203.0.113.7";
    const flood = await times(5, () =>
      dispatch(request([], from), personRoute())
    );
    expect(resolve).toHaveBeenCalledTimes(READS);
    expect(flood.filter(s => s === 429)).toHaveLength(5 - READS);
    // A valid person under the spent bound is refused before resolution.
    expect(
      await dispatch(request(["acc_session=m1"], from), personRoute())
    ).toBe(429);
    expect(resolve).toHaveBeenCalledTimes(READS);
    // From another address, or of another plugin, a person is admitted.
    expect(
      await dispatch(request(["acc_session=m1"], "198.51.100.1"), personRoute())
    ).toBe(200);
    expect(
      await dispatch(request(["acc_session=m1"], from), personRoute("shop"))
    ).toBe(200);
    // The address's own budget, and the anonymous ceiling, are unspent.
    expect(ok(await times(READS, () => core([], from)))).toBe(READS);
    expect(await core([])).toBe(200);
  });
});

describe("a route with an auth budget of its own", () => {
  it("is kept out of the unresolved sources' ceiling, unlike any other route", async () => {
    await times(READS * UNRESOLVED_CEILING_MULTIPLE, () => core([]));
    expect(await dispatch(request([]), publicRoute())).toBe(429);
    expect(
      await dispatch(request([]), publicRoute({ rateLimit: "auth" }))
    ).toBe(200);
  });
});
