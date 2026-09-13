import { createRequire } from "node:module";

import {
  McpServer,
  createMcpHandler,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/server";
import type { PluginRoute, PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { mcpPlugin } from "../../plugin";

const require = createRequire(import.meta.url);
const manifest = require("../../../package.json") as { version: string };

/**
 * The endpoint, exercised as a client reaches it.
 *
 * Through the plugin definition rather than the internals, because the thing
 * that has to hold is what an install serves: a handler that is correct and a
 * route that is not wired to it protects nothing.
 */
const ENDPOINT = "https://cms.example.com/admin/api/mcp";

function endpointRoutes(
  options: Parameters<typeof mcpPlugin>[0] = {}
): PluginRoute[] {
  const definition = mcpPlugin({
    enabled: true,
    allowedHosts: ["cms.example.com"],
    ...options,
  });
  return definition.contributes?.routes ?? [];
}

function routeFor(method: string, options?: Parameters<typeof mcpPlugin>[0]) {
  const route = endpointRoutes(options).find(r => r.method === method);
  if (!route) throw new Error(`no ${method} route contributed`);
  return route;
}

/** The route handler takes a context it does not read at this stage. */
const NO_CONTEXT = {} as PluginRouteContext;

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    },
  });
}

function initialize(headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: initializeBody(),
  });
}

/** The JSON-RPC error a 403 carries, whether the body is JSON or an SSE frame. */
async function errorOf(response: Response) {
  const text = await response.text();
  return JSON.parse(text) as {
    jsonrpc: string;
    id: unknown;
    error?: { code: number; message: string };
  };
}

describe("the endpoint refuses a request addressed somewhere else", () => {
  it("refuses a Host nobody published", async () => {
    // DNS rebinding: the attacker's own name is made to resolve here, so the
    // browser believes the page is same-origin and the Origin header agrees
    // with itself. The name it arrived under is the part that does not agree.
    const response = await routeFor("POST").handler(
      initialize({ host: "evil.example.com" }),
      NO_CONTEXT
    );

    expect(response.status).toBe(403);
    const body = await errorOf(response);
    // The shape the transport specification names for this refusal.
    expect(body.error?.code).toBe(-32000);
    expect(body.id).toBeNull();
  });

  it("refuses a browser Origin nobody published", async () => {
    const response = await routeFor("POST").handler(
      initialize({
        host: "cms.example.com",
        origin: "https://evil.example.com",
      }),
      NO_CONTEXT
    );

    expect(response.status).toBe(403);
    expect((await errorOf(response)).error?.code).toBe(-32000);
  });

  it("refuses the opaque origin a sandboxed page sends", async () => {
    // A `null` Origin is a value, not an absence, and it is what a sandboxed
    // iframe or a data: document sends. Treating it as "no browser involved"
    // would admit exactly the context that cannot be identified.
    const response = await routeFor("POST").handler(
      initialize({ host: "cms.example.com", origin: "null" }),
      NO_CONTEXT
    );

    expect(response.status).toBe(403);
  });

  it("serves a request that reached a name the operator published", async () => {
    // The control on all three refusals. Without it, "the endpoint refuses" is
    // equally satisfied by an endpoint that refuses everything, which is what a
    // mis-parsed allowlist produces.
    const response = await routeFor("POST").handler(
      initialize({ host: "cms.example.com" }),
      NO_CONTEXT
    );

    expect(response.status).toBe(200);
  });

  it("serves a browser on the site the operator published", async () => {
    // The case every refusal above needs beside it. Without it, "refuses the
    // wrong Origin" is equally satisfied by refusing EVERY Origin — which is
    // what an allowlist in the wrong shape produces, and which would lock out
    // every browser client on the configured site while looking like a working
    // guard. The refusals here all send no Origin or a foreign one, so none of
    // them can tell the two apart.
    const response = await routeFor("POST").handler(
      initialize({
        host: "cms.example.com",
        origin: "https://cms.example.com",
      }),
      NO_CONTEXT
    );

    expect(response.status).toBe(200);
  });

  it("serves one when the operator configured a full origin, not a hostname", async () => {
    // The check compares HOSTNAMES and is port-agnostic, so an allowlist entry
    // carrying a scheme matches nothing. An operator pastes what is in their
    // address bar, so the entry is reduced to its hostname before it gets
    // there; handing the full origin straight through is what would refuse the
    // configured site.
    const response = await routeFor("POST", {
      allowedHosts: ["https://cms.example.com"],
    }).handler(
      initialize({
        host: "cms.example.com",
        origin: "https://cms.example.com",
      }),
      NO_CONTEXT
    );

    expect(response.status).toBe(200);
  });

  it("serves a client that sends no Origin at all, which is every real one", async () => {
    // An MCP client is not a browser and sends no Origin. Refusing on absence
    // would be a guard that refuses every genuine caller and no attacker.
    const response = await routeFor("POST").handler(
      initialize({ host: "cms.example.com" }),
      NO_CONTEXT
    );

    expect(response.status).toBe(200);
  });

  it("is what refuses, because the protocol library does not", async () => {
    // The reason this module exists, asserted rather than asserted about. The
    // library ships both checks and applies neither, so a handler wired
    // straight to a route answers a forged Host with 200. If that ever changes,
    // this goes red and the guard can be reconsidered — rather than staying
    // for a reason nobody can still check.
    const bare = createMcpHandler(
      () => new McpServer({ name: "bare", version: "0.0.0" })
    );
    try {
      const response = await bare.fetch(
        initialize({ host: "evil.example.com" })
      );
      expect(response.status).toBe(200);
    } finally {
      await bare.close();
    }
  });
});

describe("the endpoint speaks the protocol", () => {
  it("answers initialize as this install", async () => {
    const response = await routeFor("POST").handler(
      initialize({ host: "cms.example.com" }),
      NO_CONTEXT
    );

    const text = await response.text();
    expect(text).toContain('"name":"nextly"');
    // Read from the manifest, so the version a client is told cannot drift from
    // the one that shipped.
    expect(text).toContain(`"version":"${manifest.version}"`);
  });

  it("exposes no capabilities, because it carries no tools yet", async () => {
    // What this stage is: an address that speaks the protocol and offers
    // nothing through it. A client connecting to an install that has published
    // nothing should be told exactly that.
    const response = await routeFor("POST").handler(
      initialize({ host: "cms.example.com" }),
      NO_CONTEXT
    );

    expect(await response.text()).toContain('"capabilities":{}');
  });

  it("answers the removed session methods the way the revision says to", async () => {
    // GET and DELETE were the session operations. A server on this revision
    // replies 405 to both; leaving them unclaimed would hand an old client the
    // host application's own not-found, which reads as a wrong URL.
    for (const method of ["GET", "DELETE"]) {
      const response = await routeFor(method).handler(
        new Request(ENDPOINT, { method, headers: { host: "cms.example.com" } }),
        NO_CONTEXT
      );

      expect(response.status, method).toBe(405);
    }
  });

  it("refuses on the address even where the protocol would have answered", async () => {
    // A `GET` is something the protocol has its own answer for, and the refusal
    // still wins. Status alone cannot say which ran first, though — see below.
    const response = await routeFor("GET").handler(
      new Request(ENDPOINT, {
        method: "GET",
        headers: { host: "evil.example.com" },
      }),
      NO_CONTEXT
    );

    expect(response.status).toBe(403);
  });

  it("does not let the protocol read a request it refused", async () => {
    // What "before" means, observably. The protocol consumes the request body,
    // so an untouched body is proof it never saw this one — where a status code
    // is equally produced by a guard consulted afterwards and preferred.
    const refused = initialize({ host: "evil.example.com" });
    await routeFor("POST").handler(refused, NO_CONTEXT);

    expect(refused.bodyUsed).toBe(false);

    // The control. Without it, an untouched body is equally satisfied by a
    // protocol that reads nothing at all, and the assertion above would hold
    // against a handler wired to nothing.
    const served = initialize({ host: "cms.example.com" });
    await routeFor("POST").handler(served, NO_CONTEXT);

    expect(served.bodyUsed).toBe(true);
  });
});

describe("what the plugin contributes, and when", () => {
  it("claims one path for the three methods it answers", () => {
    const routes = endpointRoutes();

    expect(routes.map(r => r.method).sort()).toEqual(["DELETE", "GET", "POST"]);
    expect([...new Set(routes.map(r => r.path))]).toEqual(["/mcp"]);
    // At the address an operator publishes, not buried under this plugin's own
    // name in the plugin namespace.
    expect([...new Set(routes.map(r => r.mount))]).toEqual(["root"]);
  });

  it("leaves every route authenticated", () => {
    // `public` unset is what makes the route inherit the authentication every
    // other plugin route gets. Setting it would open the endpoint to anyone who
    // can reach the URL, and nothing else here would notice.
    expect(endpointRoutes().every(r => r.public === undefined)).toBe(true);
  });

  it("refuses a path that cannot address one endpoint", () => {
    // Caught where it is written, rather than as a 404 an operator has to
    // explain. Each of these produces a route that either never matches or
    // matches more than the one address this endpoint has.
    for (const bad of ["mcp", "/mcp/", "/agents/:id", "/"]) {
      expect(() => mcpPlugin({ enabled: true, path: bad }), bad).toThrow();
    }
  });

  it("accepts the shapes that DO address one endpoint", () => {
    // The control. Refusing everything satisfies the case above perfectly, and
    // would make the option unusable while looking like validation.
    for (const good of ["/mcp", "/agents/mcp", "/a/b/c"]) {
      expect(
        () => mcpPlugin({ enabled: true, path: good }),
        good
      ).not.toThrow();
    }
  });

  it("says which option is wrong and what it received", () => {
    // A refusal an operator cannot act on is a 404 with extra steps.
    expect(() => mcpPlugin({ enabled: true, path: "mcp" })).toThrow(/path/);
    expect(() => mcpPlugin({ enabled: true, path: "mcp" })).toThrow(/"mcp"/);
  });

  it("answers where an operator asks it to", () => {
    expect(endpointRoutes({ path: "/agents/mcp" }).map(r => r.path)).toEqual([
      "/agents/mcp",
      "/agents/mcp",
      "/agents/mcp",
    ]);
  });
});
