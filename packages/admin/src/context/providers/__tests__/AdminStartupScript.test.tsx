// @vitest-environment jsdom

/**
 * The prebuilt admin page sends the startup request as the browser reads it,
 * before the admin's code has loaded, and the admin then takes that request.
 *
 * The page is rendered as the build renders it, on the server, and its
 * scripts are run as a browser runs them: alone, with nothing of the admin's
 * code loaded. What they send is held to what the admin sends when no script
 * ran, on every kind of screen the one page is served for, so the two cannot
 * name different paths; and the admin, once it starts, sends nothing more.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ADMIN_STARTUP_SCREENS_ELEMENT_ID } from "nextly/config";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetcher } from "@admin/lib/api/fetcher";
import {
  EARLY_STARTUP_SLOT,
  resetStartupRequestForTests,
} from "@admin/lib/api/startup-request";
import { RootLayout } from "@admin/layout/RootLayout";

import { beginAdminStartup } from "../admin-startup";
import { AdminStartupScript } from "../AdminStartupScript";

const fetchSpy = vi.fn();
const slots = window as unknown as Record<string, unknown>;

/** Every screen is served the same prebuilt page, under the admin's address. */
const SCREENS: Array<[string, string]> = [
  ["the dashboard", "/admin"],
  ["a collection list", "/admin/collections/posts"],
  [
    "an edit page",
    "/admin/collections/posts/0b6f4a8e-7d0c-4c55-9a51-2f1c4b0b9d11",
  ],
  ["a Single", "/admin/singles/site-settings"],
  ["settings", "/admin/settings/general"],
  ["a plugin's screen", "/admin/plugins/seo/overview"],
  ["the sign-in screen", "/admin/login"],
  ["an address no screen has", "/admin/no/such/screen"],
  ["an address under a locale prefix", "/fr/admin/collections/posts"],
];

const startupAnswer = (status = 200) =>
  new Response(
    JSON.stringify({
      parts: [
        { path: "/me", status, body: status === 200 ? { id: "u1" } : {} },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

/** The startup requests sent, as path lists. */
const startupRequests = () =>
  fetchSpy.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter(url => url.pathname === "/admin/api/startup")
    .map(url => `${url.origin}${url.pathname}?${url.searchParams.toString()}`);

/** The scripts of a server-rendered tree, run as the browser runs them. */
function runScripts(html: string): void {
  for (const [, source] of html.matchAll(
    /<script[^>]*>([\s\S]*?)<\/script>/g
  )) {
    new Function(source)();
  }
}

/**
 * The page as the build renders it: the admin's root inside a query cache.
 * A plain cache rather than `QueryProvider`, which would send the startup
 * request here, as this test's server render has a `window`; a real one has
 * none, and sends nothing.
 */
const prebuiltPage = () =>
  renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <RootLayout />
    </QueryClientProvider>
  );

/** The startup request the admin sends itself, on a page with no script. */
function sentByTheAdminAlone(): string[] {
  resetStartupRequestForTests();
  fetchSpy.mockClear();
  beginAdminStartup();
  const sent = startupRequests();
  resetStartupRequestForTests();
  fetchSpy.mockClear();
  return sent;
}

beforeEach(() => {
  resetStartupRequestForTests();
  delete slots[EARLY_STARTUP_SLOT];
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (url: string) =>
    String(url).includes("/startup?")
      ? startupAnswer()
      : new Response(JSON.stringify({ id: "from-the-server" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
  );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete slots[EARLY_STARTUP_SLOT];
  window.history.replaceState(null, "", "/");
});

describe("the prebuilt admin page", () => {
  for (const [screen, address] of SCREENS) {
    it(`sends the admin's own startup request as it is read, on ${screen}`, () => {
      window.history.replaceState(null, "", address);
      const expected = sentByTheAdminAlone();
      expect(expected).toHaveLength(1);

      const html = prebuiltPage();
      // Rendered with no request in hand: building the page sends nothing.
      expect(fetchSpy).not.toHaveBeenCalled();
      runScripts(html);

      expect(startupRequests()).toEqual(expected);
      expect(fetchSpy.mock.calls[0]?.[1]).toEqual({
        credentials: "include",
        headers: { accept: "application/json" },
      });
    });
  }

  it("leaves the admin nothing to send: its parts are taken from the page's request", async () => {
    window.history.replaceState(null, "", "/admin/collections/posts");
    runScripts(prebuiltPage());
    expect(startupRequests(), "the page sent it").toHaveLength(1);

    beginAdminStartup();

    await expect(fetcher("/me", {}, false)).resolves.toEqual({ id: "u1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("adds no request for a visitor who is signed out", async () => {
    // Every part refused: the answer is still an answer, so nothing is sent
    // again, and the sign-in screen's own requests go as they always went.
    fetchSpy.mockImplementation(async () => startupAnswer(401));
    window.history.replaceState(null, "", "/admin/login");
    runScripts(prebuiltPage());
    expect(startupRequests(), "the page sent it").toHaveLength(1);

    beginAdminStartup();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(startupRequests()).toHaveLength(1);
  });

  it("is the same for every visitor: nothing in it depends on who asks", () => {
    window.history.replaceState(null, "", "/admin");
    const first = prebuiltPage();
    window.history.replaceState(null, "", "/admin/collections/posts");
    document.cookie = "nextly_session=someone";
    expect(prebuiltPage()).toBe(first);
  });
});

/** The plugin pages' startup reads, as the admin layout writes them into the page. */
function layoutCarries(reads: Record<string, string[]>): void {
  const element = document.createElement("script");
  element.type = "application/json";
  element.id = ADMIN_STARTUP_SCREENS_ELEMENT_ID;
  element.textContent = JSON.stringify({ reads, foldedPanels: [] });
  document.body.appendChild(element);
}

/** The paths a startup request URL names. */
const namedBy = (url: string) => new URL(url).searchParams.getAll("path");

describe("a plugin page that declares its startup reads", () => {
  const PAGE = "/admin/plugins/acme-seo/overview";
  const READ = "/plugins/@acme/seo/overview/checklist";

  afterEach(() => {
    document.getElementById(ADMIN_STARTUP_SCREENS_ELEMENT_ID)?.remove();
  });

  it("has its reads sent by the page, as the admin would send them", () => {
    layoutCarries({ [PAGE]: [READ] });
    window.history.replaceState(null, "", PAGE);
    const expected = sentByTheAdminAlone();
    expect(namedBy(expected[0] ?? "")).toContain(READ);

    runScripts(prebuiltPage());

    expect(startupRequests()).toEqual(expected);
    expect(namedBy(startupRequests()[0] ?? "").at(-1)).toBe(READ);
  });

  it("hands the page its read from the startup request, once", async () => {
    layoutCarries({ [PAGE]: [READ] });
    window.history.replaceState(null, "", `${PAGE}/`);
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes("/startup?")
        ? new Response(
            JSON.stringify({
              parts: [{ path: READ, status: 200, body: { items: ["ready"] } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        : new Response(JSON.stringify({ items: ["from-the-server"] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
    );
    runScripts(prebuiltPage());

    beginAdminStartup();

    await expect(fetcher(READ, {}, false)).resolves.toEqual({
      items: ["ready"],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("adds nothing on another page", () => {
    layoutCarries({ [PAGE]: [READ] });
    window.history.replaceState(null, "", "/admin/plugins/acme-seo/settings");

    runScripts(prebuiltPage());

    expect(startupRequests()).toHaveLength(1);
    expect(namedBy(startupRequests()[0] ?? "")).not.toContain(READ);
  });
});

describe("the startup script", () => {
  it("carries the nonce a script-src policy needs", () => {
    const html = renderToString(<AdminStartupScript nonce="n0nce" />);
    expect(html).toMatch(/<script nonce="n0nce">/);
  });

  it("throws nothing and leaves nothing when it cannot send", () => {
    vi.stubGlobal("fetch", () => {
      throw new TypeError("blocked");
    });
    const html = renderToString(<AdminStartupScript />);

    expect(() => runScripts(html)).not.toThrow();
    expect(slots[EARLY_STARTUP_SLOT]).toBeUndefined();
  });
});
