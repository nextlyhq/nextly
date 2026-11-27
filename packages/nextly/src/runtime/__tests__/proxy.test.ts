import { afterEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type {
  PluginContext,
  PluginDefinition,
} from "../../plugins/plugin-context";
import {
  clearProxyHandlers,
  markProxyHandlersReady,
  registerProxyHandler,
} from "../../plugins/proxy/proxy-registry";
import type {
  PluginProxyHandler,
  ProxyAnswer,
} from "../../plugins/proxy/proxy-types";
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

afterEach(() => {
  clearProxyHandlers();
  vi.useRealTimers();
});

/** A copy handler as a plugin contributes it: it claims every `.md` address. */
const copyHandler: PluginProxyHandler = {
  name: "copies",
  claims: request => new URL(request.url).pathname.endsWith(".md"),
  handle: request =>
    new URL(request.url).pathname.endsWith(".md")
      ? { response: new Response("the copy", { status: 200 }) }
      : undefined,
};

/** A site's config whose one plugin contributes `handler`. */
function configWith(handler: PluginProxyHandler): SanitizedNextlyConfig {
  const plugin = {
    name: "p",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { proxy: [handler] },
  } as PluginDefinition;
  return { plugins: [plugin] } as unknown as SanitizedNextlyConfig;
}

/** A start that finishes, registering `handler`, only when told to. */
function startOnCue(handler: PluginProxyHandler) {
  let finish: () => void = () => undefined;
  const start = vi.fn(
    () =>
      new Promise<void>(resolve => {
        finish = () => {
          registerProxyHandler({ pluginName: "p", handler }, ctx);
          markProxyHandlersReady();
          resolve();
        };
      })
  );
  return { start, finish: () => finish() };
}

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

  it("waits for a start under way on a request only a handler can answer, then answers it", async () => {
    // The first request of a cold server is for a page's plain-text copy:
    // no page serves it, so going on to the page would answer not found.
    const { deps, calls } = fakeNext();
    const { start, finish } = startOnCue(copyHandler);
    deps.start = start;

    const answering = createNextlyProxy(
      configWith(copyHandler),
      deps
    )(new Request("https://example.com/blog/hello.md"));
    await Promise.resolve();
    finish();
    const response = await answering;

    expect(start).toHaveBeenCalledTimes(1);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("the copy");
    expect(calls).toEqual([]);
  });

  it("asks a claimed request to come back where the start outlasts the wait, and keeps the start running", async () => {
    vi.useFakeTimers();
    const { deps } = fakeNext();
    deps.start = () => new Promise<never>(() => {});
    const waitUntil = vi.fn();

    const answering = createNextlyProxy(configWith(copyHandler), deps)(
      new Request("https://example.com/blog/hello.md"),
      { waitUntil }
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await answering;

    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("30");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("never holds a request no handler claims, and keeps the start it begins running", async () => {
    const { deps, calls } = fakeNext();
    deps.start = () => new Promise<never>(() => {});
    const waitUntil = vi.fn();

    expect(
      await createNextlyProxy(configWith(copyHandler), deps)(
        new Request("https://example.com/blog/hello"),
        { waitUntil }
      )
    ).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it("lets a claimed request through where Nextly cannot start", async () => {
    const { deps } = fakeNext();
    deps.start = async () => {
      throw new Error("no database");
    };

    expect(
      await createNextlyProxy(
        configWith(copyHandler),
        deps
      )(new Request("https://example.com/blog/hello.md"))
    ).toBeUndefined();
  });

  it("takes a claim that throws as no claim, and never holds the request", async () => {
    const { deps } = fakeNext();
    deps.start = () => new Promise<never>(() => {});
    const throwing: PluginProxyHandler = {
      ...copyHandler,
      claims: () => {
        throw new Error("broken claim");
      },
    };

    expect(
      await createNextlyProxy(
        configWith(throwing),
        deps
      )(new Request("https://example.com/blog/hello.md"))
    ).toBeUndefined();
  });
});
