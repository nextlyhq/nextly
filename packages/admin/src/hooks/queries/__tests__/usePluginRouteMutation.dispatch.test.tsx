/**
 * A plugin's admin write, end to end: the hook, the admin's fetcher and the
 * core dispatcher, with the cookies and `Origin` a browser sends.
 *
 * Each half has its own tests, and each passes on its own while the pair
 * fails: the dispatcher's tests build the request a test author imagined the
 * admin sends, and the hook's tests stop at a mocked client. A route that
 * declares `csrf: true` refused every save from its own admin page that way,
 * with both suites green.
 *
 * Only the session lookup is stubbed: everything that decides the cross-site
 * check — the token endpoint and its cookie, the route registry, the
 * dispatcher — is core's own code.
 */
import { join } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthentication = vi.hoisted(() => vi.fn());

vi.mock("../../../../../nextly/src/auth/middleware", () => ({
  requireAuthentication,
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));
vi.mock("../../../../../nextly/src/domains/audit/audit-log-writer", () => ({
  buildAuditLogWriter: () => ({ write: vi.fn() }),
}));
vi.mock("../../../../../nextly/src/di/register", () => ({
  getService: () => ({}),
}));
// Refuses to load where `window` exists, as server code must in a browser.
// This test runs the server's half in the browser's environment on purpose,
// and no route here reads a role.
vi.mock("../../../../../nextly/src/services/lib/permissions", () => ({
  resolveRoleSlugs: vi.fn(),
}));

import { usePluginRouteMutation } from "../usePluginRouteMutation";

/**
 * Core's source, loaded by a specifier the compiler does not follow.
 *
 * The admin's type-check covers its tests, and a static import here would pull
 * core's server graph into it, under path aliases only core's own config
 * defines. So core is typed below by the little this test uses.
 */
const CORE = join(process.cwd(), "..", "nextly", "src");

function loadCore<T>(path: string): Promise<T> {
  return import(/* @vite-ignore */ join(CORE, `${path}.ts`)) as Promise<T>;
}

interface RouteMatch {
  readonly route: unknown;
}

const [{ handleCsrf }, collect, dispatch, routes] = await Promise.all([
  loadCore<{
    handleCsrf: (
      request: Request,
      deps: { isProduction: boolean }
    ) => Promise<Response>;
  }>("auth/handlers/csrf"),
  loadCore<{
    collectPluginRoutes: (
      plugins: unknown[]
    ) => Array<{ pluginName: string; route: unknown }>;
  }>("plugins/routes/collect-routes"),
  loadCore<{
    runPluginRoute: (request: Request, match: RouteMatch) => Promise<Response>;
  }>("plugins/routes/dispatch"),
  loadCore<{
    PluginRouteRegistry: new () => {
      register(pluginName: string, route: unknown, baseCtx: unknown): void;
      match(method: string, path: string, mount: "plugin"): RouteMatch | null;
    };
  }>("plugins/routes/route-registry"),
]);
const { runPluginRoute } = dispatch;

const PLUGIN = "@acme/notes";
const ORIGIN = window.location.origin;

/** What each route's handler received, so a refusal is told from a write. */
let written: Array<{ path: string; body: unknown }> = [];

function note(path: string, csrf?: true) {
  return {
    method: "POST" as const,
    path,
    ...(csrf ? { csrf } : {}),
    handler: async (request: Request) => {
      written.push({ path, body: await request.json() });
      return Response.json({ message: "Saved.", item: { id: "n1" } });
    },
  };
}

const plugin = {
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [note("/notes"), note("/strict-notes", true)],
  },
};

const registry = new routes.PluginRouteRegistry();
const baseCtx = {
  self: { name: PLUGIN, collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
};
for (const collected of collect.collectPluginRoutes([plugin])) {
  registry.register(collected.pluginName, collected.route, baseCtx);
}

/**
 * The browser: a cookie jar that `Set-Cookie` writes to, the session cookie a
 * sign-in left, and the page's own `Origin` on every request. A cookie without
 * `HttpOnly` is also handed to `document.cookie`, as a browser exposes it to
 * the page.
 */
const jar = new Map<string, string>();
let csrfFetches = 0;
let sentOrigin = ORIGIN;

function storeCookies(response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
    if (!/;\s*HttpOnly/i.test(header)) document.cookie = header;
  }
}

async function browserFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set(
    "cookie",
    [...jar].map(([name, value]) => `${name}=${value}`).join("; ")
  );
  headers.set("origin", sentOrigin);
  const request = new Request(String(input), { ...init, headers });
  const path = new URL(request.url).pathname.replace(/^\/admin\/api/, "");

  if (path === "/auth/csrf") {
    csrfFetches += 1;
    const answer = await handleCsrf(request, { isProduction: false });
    storeCookies(answer);
    return answer;
  }
  const match = registry.match(request.method, path, "plugin");
  if (match === null) return new Response(null, { status: 404 });
  return runPluginRoute(request, match);
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

async function save(path: string) {
  const { result } = renderHook(
    () => usePluginRouteMutation({ plugin: PLUGIN, path }),
    { wrapper: wrapper() }
  );
  let answered: unknown;
  await act(async () => {
    answered = await result.current.write({ text: "hello" });
  });
  return { answered, error: result.current.error };
}

beforeEach(() => {
  written = [];
  csrfFetches = 0;
  sentOrigin = ORIGIN;
  jar.clear();
  jar.set("nextly_session", "signed-in");
  // The admin's pages live under `/admin`, where the CSRF cookie is scoped.
  window.history.pushState({}, "", "/admin/plugins/notes");
  // The dispatcher reads core's environment, which needs a dialect; no
  // database is opened.
  vi.stubEnv("DB_DIALECT", "sqlite");
  document.cookie = "nextly_csrf=; Path=/admin; Max-Age=0";
  vi.stubGlobal("fetch", vi.fn(browserFetch));
  requireAuthentication.mockResolvedValue({
    userId: "u1",
    userEmail: "u1@example.com",
    userName: "U",
    authMethod: "session",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a plugin's admin page writing to its own route", () => {
  it("reaches a route that leaves csrf unset", async () => {
    const { answered, error } = await save("/notes");

    expect(error).toBeNull();
    expect(answered).toEqual({ message: "Saved.", item: { id: "n1" } });
    expect(written).toEqual([{ path: "/notes", body: { text: "hello" } }]);
  });

  it("reaches a route that declares csrf: true", async () => {
    const { answered, error } = await save("/strict-notes");

    expect(error).toBeNull();
    expect(answered).toEqual({ message: "Saved.", item: { id: "n1" } });
    expect(written).toEqual([
      { path: "/strict-notes", body: { text: "hello" } },
    ]);
  });

  it("asks for a token once, and reuses the cookie it set", async () => {
    // A token fetched per write rotates the cookie, and a write still in
    // flight then carries a token the cookie no longer matches. Reading the
    // cookie also pins its name to the one the server sets.
    await save("/strict-notes");
    await save("/strict-notes");

    expect(csrfFetches).toBe(1);
    expect(written).toHaveLength(2);
  });

  it("is still refused from another origin, token and all", async () => {
    // The control: a dispatcher that admitted every write would pass the cases
    // above. The page holds a valid token; only the origin differs.
    sentOrigin = "https://evil.example";

    const { answered, error } = await save("/strict-notes");

    expect(answered).toBeUndefined();
    expect(error).toMatchObject({ status: 403, code: "CSRF_FAILED" });
    expect(written).toEqual([]);
  });
});
