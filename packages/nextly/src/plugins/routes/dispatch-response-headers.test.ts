/**
 * What a plugin route's response says about itself, beyond its body.
 *
 * Two properties the plugin author cannot supply and should not have to. The
 * headers that carry them are internal to this package, so a plugin cannot
 * import either one — a plugin that wanted them would have to hardcode a
 * private string, which is the same defect one indirection along.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

import { requireAuthentication } from "../../auth/middleware";
import { withTimezoneFormatting } from "../../shared/lib/date-formatting";
import type { PluginContext } from "../plugin-context";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const reqAuth = vi.mocked(requireAuthentication);

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

/** A body whose OPAQUE text happens to look like a timestamp. */
const opaque = { items: [{ props: { heading: "2026-09-08T12:34Z" } }] };

function route(extra: Partial<PluginRoute>): PluginRoute {
  return {
    method: "GET",
    path: "/r",
    handler: () => Response.json(opaque),
    ...extra,
  } as PluginRoute;
}
function match(r: PluginRoute): RouteMatch {
  return { pluginName: "@a/x", route: r, baseCtx, params: {} };
}
const req = () => new Request("http://x/api/plugins/@a/x/r");
const okAuth = { userId: "u1", userEmail: "u1@x.com", userName: "U" };

beforeEach(() => {
  reqAuth.mockReset();
});

describe("a plugin route's body is opaque to the framework", () => {
  it("REWRITES an unmarked body, which is what makes the marker matter", async () => {
    // The positive control, and it is the whole reason the test below means
    // anything: the formatter walks nested values and rewrites any string that
    // matches its ISO pattern BY VALUE, whatever the key is called. Without
    // this, an assertion that a marked body is unchanged is equally satisfied
    // by a formatter that changes nothing at all.
    const formatted = await withTimezoneFormatting(Response.json(opaque));

    expect(await formatted.json()).not.toEqual(opaque);
  });

  it("leaves a plugin's own JSON exactly as the plugin wrote it", async () => {
    // A plugin's body is whatever that plugin defined; the framework knows
    // nothing about its shape. Rewriting a value inside it is silent
    // corruption of content — a block prop holding text like the one above
    // reaches the editor already rewritten, and saving persists something the
    // author never wrote. Same reason a webhook delivery's captured text opts
    // out: opaque text must survive verbatim.
    reqAuth.mockResolvedValue(okAuth as never);

    const res = await runPluginRoute(req(), match(route({})));
    const formatted = await withTimezoneFormatting(res);

    expect(await formatted.json()).toEqual(opaque);
  });
});

describe("what a plugin route already said is kept", () => {
  it("adds Cookie to what the response already varies on", async () => {
    // Replacing it was the defect: a response varying on `Accept-Language`
    // became one varying only on `Cookie`, so a cache could answer a second
    // language out of the first one's stored copy — same session, wrong
    // representation.
    reqAuth.mockResolvedValue(okAuth as never);
    const varied = route({
      handler: () =>
        Response.json(opaque, {
          headers: { Vary: "Accept-Language", "Cache-Control": "no-transform" },
        }),
    });

    const res = await runPluginRoute(req(), match(varied));

    const vary = (res.headers.get("Vary") ?? "").toLowerCase();
    expect(vary).toContain("accept-language");
    expect(vary).toContain("cookie");
  });

  it("keeps a directive that is orthogonal to privacy", async () => {
    // `no-transform` forbids a proxy rewriting the body, which remains true
    // whether or not a cache may store the response. A handler that asked for
    // it had a reason this boundary does not know.
    reqAuth.mockResolvedValue(okAuth as never);
    const varied = route({
      handler: () =>
        Response.json(opaque, {
          headers: { "Cache-Control": "no-transform, max-age=60" },
        }),
    });

    const res = await runPluginRoute(req(), match(varied));

    const cc = (res.headers.get("Cache-Control") ?? "").toLowerCase();
    expect(cc).toContain("private");
    expect(cc).toContain("no-store");
    expect(cc).toContain("no-transform");
    // And the directive that CONTRADICTS no-store does not survive beside it.
    expect(cc).not.toContain("max-age");
  });
});

describe("an authenticated plugin route answers ONE session", () => {
  it("marks the answer private, so a shared cache cannot replay it", async () => {
    // The rows depend on the caller's own access, so a shared proxy holding
    // one authorized answer would serve it to the next request without the
    // authentication check running again.
    reqAuth.mockResolvedValue(okAuth as never);

    const res = await runPluginRoute(req(), match(route({})));

    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });

  it("marks the REFUSAL too, which is the direction that looks like a gate", async () => {
    // A cached 401 replayed to a request that DOES carry a session is the same
    // defect pointing the other way, and it reads as the gate working.
    reqAuth.mockResolvedValue({ statusCode: 401 } as never);

    const res = await runPluginRoute(req(), match(route({})));

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });

  it("leaves a PUBLIC route cacheable, because its answer is not one caller's", async () => {
    // The counterpart, and the reason this is decided from `public` rather
    // than applied to every plugin response: a public route serves the same
    // bytes to everyone, and forcing `no-store` on it would throw away caching
    // the plugin is entitled to.
    const res = await runPluginRoute(req(), match(route({ public: true })));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});
