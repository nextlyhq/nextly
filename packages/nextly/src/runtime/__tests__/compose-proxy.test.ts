import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info.js";
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { PluginContext } from "../../plugins/plugin-context";
import {
  clearProxyHandlers,
  markProxyHandlersReady,
  registerProxyHandler,
} from "../../plugins/proxy/proxy-registry";
import type { ProxyAnswer } from "../../plugins/proxy/proxy-types";
import {
  composeProxy,
  createNextlyProxy,
  nextlyProxyMatcher,
  nextlyProxyRunsFor,
  type NextlyProxyDeps,
} from "../proxy";

/** What Next.js's own compiler of `config.matcher` answers for each pattern. */
type CompileMatchers = (
  matchers: string[],
  nextConfig: Record<string, unknown>
) => { regexp: string }[];

/**
 * Next.js's own compiler of `config.matcher`, as its build runs it. Internal
 * to Next.js, so its declarations don't name it: read off the module.
 */
function getMiddlewareMatchers(
  ...args: Parameters<CompileMatchers>
): ReturnType<CompileMatchers> {
  const compile: unknown = Reflect.get(pageStaticInfo, "getMiddlewareMatchers");
  if (typeof compile !== "function") {
    throw new Error("Next.js no longer has getMiddlewareMatchers");
  }
  return Reflect.apply(compile, undefined, args) as ReturnType<CompileMatchers>;
}

const config = {} as SanitizedNextlyConfig;
const ctx = { logger: { error: vi.fn() } } as unknown as PluginContext;

/** Next.js's own `NextResponse.next`, as the Proxy uses it in an app. */
const deps: NextlyProxyDeps = {
  next: () => init => NextResponse.next(init),
  start: async () => undefined,
};

/** A handler answering `answer` for every request, registered and ready. */
function answering(answer: ProxyAnswer | undefined): void {
  registerProxyHandler(
    { pluginName: "p", handler: { name: "h", handle: () => answer } },
    ctx
  );
  markProxyHandlersReady();
}

/** A site's consent Proxy: sets a cookie and goes on to the page. */
function consentProxy() {
  return vi.fn((_request: Request) => {
    const response = NextResponse.next();
    response.cookies.set("consent", "granted");
    return response;
  });
}

const page = (path = "/blog/hello") =>
  new Request(`https://example.com${path}`, { headers: { cookie: "a=1" } });

afterEach(() => {
  clearProxyHandlers();
});

describe("composeProxy", () => {
  it("answers with Nextly's redirect and never calls the site's Proxy", async () => {
    answering({
      response: Response.redirect("https://example.com/new", 301),
    });
    const site = consentProxy();

    const response = await composeProxy(createNextlyProxy(config, deps), site)(
      page("/old"),
      {}
    );

    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://example.com/new");
    expect(site).not.toHaveBeenCalled();
  });

  it("keeps the site's cookie on a page Nextly lets through, with Nextly's headers added", async () => {
    answering({ headers: { "x-robots-tag": "noindex" } });
    const site = consentProxy();

    const response = await composeProxy(createNextlyProxy(config, deps), site)(
      page(),
      {}
    );

    expect(site).toHaveBeenCalledTimes(1);
    expect(response?.headers.getSetCookie()).toEqual([
      "consent=granted; Path=/",
    ]);
    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
    expect(response?.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps a header the site sets itself over Nextly's", async () => {
    answering({ headers: { "x-robots-tag": "noindex" } });
    const site = () => {
      const response = NextResponse.next();
      response.headers.set("X-Robots-Tag", "all");
      return response;
    };

    const response = await composeProxy(createNextlyProxy(config, deps), site)(
      page(),
      {}
    );

    expect(response?.headers.get("x-robots-tag")).toBe("all");
  });

  it("hands the page Nextly's request headers as Next.js encodes them, beside the request's own", async () => {
    answering({ requestHeaders: { "x-asked-for": "/blog/hello" } });

    const response = await composeProxy(
      createNextlyProxy(config, deps),
      consentProxy()
    )(page(), {});

    // What NextResponse.next itself writes for the same set of headers.
    const forwarded = new Headers(page().headers);
    forwarded.set("x-asked-for", "/blog/hello");
    const expected = NextResponse.next({ request: { headers: forwarded } });
    for (const name of [
      "x-middleware-override-headers",
      "x-middleware-request-cookie",
      "x-middleware-request-x-asked-for",
    ]) {
      expect(response?.headers.get(name)).toBe(expected.headers.get(name));
    }
  });

  it("adds Nextly's request headers to those the site's Proxy sets, keeping the site's", async () => {
    answering({ requestHeaders: { "x-asked-for": "/blog/hello" } });
    const site = (request: Request) => {
      const headers = new Headers(request.headers);
      headers.set("x-consent", "yes");
      return NextResponse.next({ request: { headers } });
    };

    const response = await composeProxy(createNextlyProxy(config, deps), site)(
      page(),
      {}
    );

    expect(
      response?.headers.get("x-middleware-override-headers")?.split(",")
    ).toEqual(["cookie", "x-consent", "x-asked-for"]);
    expect(response?.headers.get("x-middleware-request-x-consent")).toBe("yes");
    expect(response?.headers.get("x-middleware-request-x-asked-for")).toBe(
      "/blog/hello"
    );
  });

  it("gives the page Nextly's value for its own request header over one the visitor sent", async () => {
    answering({ requestHeaders: { "x-asked-for": "/blog/hello" } });
    const spoofed = () =>
      new Request("https://example.com/blog/hello", {
        headers: { cookie: "a=1", "x-asked-for": "/somewhere-else" },
      });
    // A site Proxy passing the request on as it came, both ways it can.
    const plain = () => NextResponse.next();
    const carried = (request: Request) =>
      NextResponse.next({ request: { headers: new Headers(request.headers) } });

    for (const site of [plain, carried]) {
      const response = await composeProxy(
        createNextlyProxy(config, deps),
        site
      )(spoofed(), {});
      expect(response?.headers.get("x-middleware-request-x-asked-for")).toBe(
        "/blog/hello"
      );
      expect(
        response?.headers
          .get("x-middleware-override-headers")
          ?.split(",")
          .filter(name => name === "x-asked-for")
      ).toEqual(["x-asked-for"]);
    }
  });

  it("answers with Nextly's own answer where the site's Proxy answers nothing", async () => {
    answering({ headers: { "x-robots-tag": "noindex" } });

    const response = await composeProxy(
      createNextlyProxy(config, deps),
      () => undefined
    )(page(), {});

    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
    expect(response?.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes Next.js's event to the site's Proxy and on to Nextly's start", async () => {
    // Not started yet: the start is kept running through the event.
    const start = vi.fn(() => new Promise<never>(() => {}));
    const site = vi.fn(() => undefined);
    const waitUntil = vi.fn();
    const event = { waitUntil };

    await composeProxy(createNextlyProxy(config, { ...deps, start }), site)(
      page(),
      event
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(site).toHaveBeenCalledWith(expect.any(Request), event);
  });

  it("asks Nextly nothing about an address outside its matcher", async () => {
    const handle = vi.fn(() => undefined);
    registerProxyHandler(
      { pluginName: "p", handler: { name: "h", handle } },
      ctx
    );
    markProxyHandlersReady();
    const site = consentProxy();

    await composeProxy(createNextlyProxy(config, deps), site)(
      page("/_next/static/chunks/app.js"),
      {}
    );

    expect(handle).not.toHaveBeenCalled();
    expect(site).toHaveBeenCalledTimes(1);
  });

  it("refuses a Proxy createNextlyProxy did not make", () => {
    expect(() => composeProxy(async () => undefined)).toThrow();
  });
});

describe("nextlyProxyMatcher", () => {
  // Compiled by Next.js itself, as it compiles `config.matcher` at build.
  const [compiled] = getMiddlewareMatchers([...nextlyProxyMatcher], {});
  const nextMatches = (path: string) =>
    new RegExp(compiled?.regexp ?? "^$").test(path);

  const reached = [
    "/",
    "/blog/hello",
    "/blog/hello.md",
    "/0123456789abcdef0123456789abcdef.txt",
    "/old-page",
    "/old-page.html",
    "/administration",
  ];
  const leftOut = [
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/admin",
    "/admin/api/me/permissions",
    "/images/logo.png",
    "/fonts/inter.woff2",
    "/styles/site.css",
    "/favicon.ico",
  ];

  it.each(reached)(
    "reaches %s, in Next.js and in the Proxy's own check",
    path => {
      expect(nextMatches(path)).toBe(true);
      expect(nextlyProxyRunsFor(path)).toBe(true);
    }
  );

  it.each(leftOut)(
    "leaves out %s, in Next.js and in the Proxy's own check",
    path => {
      expect(nextMatches(path)).toBe(false);
      expect(nextlyProxyRunsFor(path)).toBe(false);
    }
  );
});
