import { afterEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { PluginContext } from "../../plugins/plugin-context";
import {
  clearProxyHandlers,
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

function answering(answer: ProxyAnswer | undefined): void {
  registerProxyHandler(
    { pluginName: "p", handler: { name: "h", handle: () => answer } },
    ctx
  );
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
    answering({ response: new Response("never") });
    const { deps } = fakeNext();
    deps.start = async () => {
      throw new Error("no database");
    };

    expect(await createNextlyProxy(config, deps)(request())).toBeUndefined();
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
