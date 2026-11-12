import { afterEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { PluginContext } from "../../plugins/plugin-context";
import {
  clearProxyHandlers,
  markProxyHandlersReady,
  registerProxyHandler,
} from "../../plugins/proxy/proxy-registry";
import type { ProxyAnswer } from "../../plugins/proxy/proxy-types";
import { createNextlyProxy, type NextlyProxyDeps } from "../proxy";

const config = {} as SanitizedNextlyConfig;
const ctx = { logger: { error: vi.fn() } } as unknown as PluginContext;

/** A stand-in for `NextResponse.next`, recording what it was given. */
function fakeNext() {
  const calls: { request?: { headers: Headers } }[] = [];
  const deps: NextlyProxyDeps = {
    next: () => init => {
      calls.push(init ?? {});
      return new Response(null, { headers: { "x-middleware-next": "1" } });
    },
    start: async () => undefined,
  };
  return { deps, calls };
}

/** A handler answering `answer`, registered and ready, as a finished start leaves it. */
function answering(answer: ProxyAnswer | undefined): void {
  registerProxyHandler(
    { pluginName: "p", handler: { name: "h", handle: () => answer } },
    ctx
  );
  markProxyHandlersReady();
}

const request = () =>
  new Request("https://example.com/old?x=1", {
    headers: { cookie: "a=1" },
  });

afterEach(() => clearProxyHandlers());

describe("the site's Proxy", () => {
  it("lets every request through where no plugin contributes a handler", async () => {
    const { deps, calls } = fakeNext();

    expect(await createNextlyProxy(config, deps)(request())).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("lets the request through where Nextly cannot start", async () => {
    // A start that fails never registers the handlers.
    const { deps } = fakeNext();
    deps.start = async () => {
      throw new Error("no database");
    };

    expect(await createNextlyProxy(config, deps)(request())).toBeUndefined();
  });

  it("never holds a request for a start still under way, and begins one", async () => {
    // Nothing registered yet: the start that registers the handlers runs.
    const { deps, calls } = fakeNext();
    const start = vi.fn(() => new Promise<never>(() => {}));
    deps.start = start;

    // Settles though the start never does: the page is served at once, and
    // the handlers apply from the first request after the start finishes.
    expect(await createNextlyProxy(config, deps)(request())).toBeUndefined();
    expect(start).toHaveBeenCalledWith(config);
    expect(calls).toEqual([]);
  });

  it("answers with a handler's response, carrying every handler's headers", async () => {
    answering({
      response: Response.redirect("https://example.com/new", 301),
      headers: { "x-robots-tag": "noindex" },
    });
    const { deps, calls } = fakeNext();

    const response = await createNextlyProxy(config, deps)(request());

    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://example.com/new");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
    expect(calls).toEqual([]);
  });

  it("sets headers on the page it lets through", async () => {
    answering({ headers: { "x-robots-tag": "noindex" } });
    const { deps, calls } = fakeNext();

    const response = await createNextlyProxy(config, deps)(request());

    expect(response?.headers.get("x-middleware-next")).toBe("1");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
    expect(calls).toEqual([{}]);
  });

  it("passes request headers on beside the request's own", async () => {
    answering({ requestHeaders: { "x-asked-for": "/old" } });
    const { deps, calls } = fakeNext();

    await createNextlyProxy(config, deps)(request());

    const forwarded = calls[0]?.request?.headers;
    expect(forwarded?.get("x-asked-for")).toBe("/old");
    expect(forwarded?.get("cookie")).toBe("a=1");
  });

  it("leaves the request untouched where every handler answers nothing", async () => {
    answering(undefined);
    answering({});
    const { deps, calls } = fakeNext();

    expect(await createNextlyProxy(config, deps)(request())).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
