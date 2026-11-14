import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

import { test } from "../support/visible";

import { PORT } from "../../production-server.mjs";
import {
  SEO_SITE_ACCOUNT,
  startSeoSite,
  type SeoSite,
} from "../../seo-site/site";

/**
 * The SEO plugin on a site of its own, built and served for production: what
 * a build makes, what the first start says, and what the site's root files
 * and home page head carry. The playground cannot stand in for it (the
 * fixture's README says why), so `e2e/seo-site` is built here, once, and every
 * test below reads that one build.
 *
 * - A sitemap the site makes during `next build` lists the pages a route
 *   declares through `seoStaticParams`.
 * - A declared address whose page answers not found is left out of the
 *   plugin's sitemap and `llms.txt`.
 * - An address made Gone answers 410 with the site's own page where
 *   `gonePage` names one, and with the plugin's plain page where none does.
 * - An address no route matches, answered by Next.js's `global-not-found`
 *   page, is logged as the plugin's guide shows.
 * - Neither the build nor the first start after a deploy that moved addresses
 *   logs a cache-expiry error. (Parallel build workers recording one code
 *   route quietly is a race a build of this size cannot make happen on
 *   demand, so the integration test of two workers covers it.)
 * - The verification codes saved in the SEO settings are meta tags in the home
 *   page's head, and in no other page's.
 * - robots.txt serves the site's own rules after the plugin's lines.
 *
 * @module tests/production/seo-site
 */

// Inside the block of ports a worktree's slot owns, clear of the setup
// install's (`PORT + 1` on the default slot) and of the other specs' servers
// (`PORT + 6` and `PORT + 7`).
const SITE_PORT = PORT + 4;

/** The codes saved for each service, and one other service's tag. */
const VERIFICATION = {
  google: "google-code-1A2b",
  bing: "BING0CODE0123",
  pinterest: "pinterestcode456",
  yandex: "yandex789code",
  baidu: "code-baidu-012",
  others: [{ name: "facebook-domain-verification", code: "fbcode345" }],
};

/** Each saved code as the meta tag that carries it. */
const VERIFICATION_TAGS: Array<[name: string, code: string]> = [
  ["google-site-verification", VERIFICATION.google],
  ["msvalidate.01", VERIFICATION.bing],
  ["p:domain_verify", VERIFICATION.pinterest],
  ["yandex-verification", VERIFICATION.yandex],
  ["baidu-site-verification", VERIFICATION.baidu],
  ["facebook-domain-verification", "fbcode345"],
];

/** The site's own robots.txt rule, saved in the SEO settings. */
const OWN_RULE = "Disallow: /seo-site-search";

/** A tag of this run's own, so addresses from an earlier run never count. */
const run = Date.now().toString(36);

let site: SeoSite | undefined;
let admin: APIRequestContext | undefined;

/** The site, once `beforeAll` has started it. */
function started(): SeoSite {
  if (site === undefined) throw new Error("the SEO site did not start");
  return site;
}

/** The plugin's admin routes, as the admin calls them. */
const pluginApi = (path: string) =>
  `/admin/api/plugins/@nextlyhq/plugin-seo${path}`;

/** The `<head>` of a page's HTML, or "" when it has none. */
function headOf(html: string): string {
  return /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
}

/** Each `<meta name content>` in `head`, as [name, content] pairs. */
function namedMetaTags(head: string): Array<[string, string]> {
  const tags: Array<[string, string]> = [];
  for (const match of head.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = match[0];
    const name = /\bname="([^"]*)"/i.exec(tag)?.[1];
    const content = /\bcontent="([^"]*)"/i.exec(tag)?.[1];
    if (name !== undefined && content !== undefined) {
      tags.push([name, content]);
    }
  }
  return tags;
}

/** Asks for `path` as a visitor does, with no session. */
async function visit(request: APIRequestContext, path: string) {
  const response = await request.get(`${started().url}${path}`, {
    headers: { cookie: "" },
    maxRedirects: 0,
  });
  return {
    status: response.status(),
    headers: response.headers(),
    body: await response.text(),
  };
}

/** The headers a signed-in change sends: the session's CSRF token and the site's origin. */
async function changeHeaders(): Promise<Record<string, string>> {
  if (admin === undefined) throw new Error("not signed in");
  const csrf = (await (await admin.get("/admin/api/auth/csrf")).json()) as {
    token: string;
  };
  return { "x-csrf-token": csrf.token, origin: started().url };
}

/** Makes `from` Gone through the redirects screen's route, as a person does. */
async function makeGone(from: string): Promise<void> {
  if (admin === undefined) throw new Error("not signed in");
  const response = await admin.post(pluginApi("/redirects"), {
    headers: await changeHeaders(),
    data: { from, type: "gone" },
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
}

test.beforeAll(async () => {
  // A production build of the fixture, with its database readied first.
  test.setTimeout(12 * 60 * 1000);
  site = await startSeoSite(SITE_PORT, {
    siteName: "SEO site",
    llmsTxt: true,
    verificationCodes: VERIFICATION,
    robotsRules: { text: `User-agent: *\n${OWN_RULE}\n` },
  });

  // The admin's routes, signed in as the account the setup made.
  admin = await playwrightRequest.newContext({ baseURL: site.url });
  const csrf = (await (await admin.get("/admin/api/auth/csrf")).json()) as {
    token: string;
  };
  const login = await admin.post("/admin/api/auth/login", {
    headers: { Origin: site.url },
    data: { ...SEO_SITE_ACCOUNT, csrfToken: csrf.token },
  });
  expect(login.status(), await login.text()).toBe(200);
});

test.afterAll(async () => {
  await admin?.dispose();
  await site?.stop();
});

test.describe("the SEO plugin on a production build of a site", () => {
  test("a sitemap made during next build lists the pages seoStaticParams declares", () => {
    const { app, url } = started();
    // The body `next build` prerendered, as the build wrote it: no request
    // has asked for it, so nothing after the build made it.
    const built = readFileSync(
      join(app, ".next", "server", "app", "pages-sitemap.xml.body"),
      "utf8"
    );
    for (const topic of ["guides", "news"]) {
      expect(built, topic).toContain(`<loc>${url}/topics/${topic}</loc>`);
    }
  });

  test("a declared address whose page answers not found is left out of the sitemap and llms.txt", async ({
    request,
  }) => {
    const { url } = started();
    expect((await visit(request, "/topics/empty")).status).toBe(404);
    expect((await visit(request, "/topics/guides")).status).toBe(200);

    const sitemap = await visit(request, "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    // Listed beside it: the route's pages are read at all.
    expect(sitemap.body).toContain(`<loc>${url}/topics/guides</loc>`);
    expect(sitemap.body).not.toContain(`${url}/topics/empty`);

    const llms = await visit(request, "/llms.txt");
    expect(llms.status).toBe(200);
    expect(llms.body).toContain(`${url}/topics/guides`);
    expect(llms.body).not.toContain(`${url}/topics/empty`);
  });

  test("an address made Gone answers 410 with the site's own page", async ({
    request,
  }) => {
    const from = `/seo-site-retired-${run}`;
    await makeGone(from);
    const answer = await visit(request, from);
    expect(answer.status).toBe(410);
    expect(answer.headers.location).toBeUndefined();
    expect(answer.body).toContain("This page was retired on purpose");
  });

  test("an address no route matches is logged from the global-not-found page", async ({
    request,
  }) => {
    if (admin === undefined) throw new Error("not signed in");
    const missing = `/seo-site-unmatched-${run}`;
    const answer = await visit(request, missing);
    expect(answer.status).toBe(404);
    // Answered by the site's global-not-found page, not by a route.
    expect(answer.body).toContain("Page not found");
    const signedIn = admin;
    await expect
      .poll(
        async () => {
          const response = await signedIn.get(pluginApi("/not-found"));
          const { items } = (await response.json()) as {
            items: Array<{ path: string; hits: number }>;
          };
          return items.find(row => row.path === missing)?.hits;
        },
        { timeout: 20_000 }
      )
      .toBe(1);
  });

  test("the build and the first start, after addresses moved, log no cache-expiry error", async ({
    request,
  }) => {
    // Requests first, so whatever the start left for a request has run.
    expect((await visit(request, "/")).status).toBe(200);
    expect((await visit(request, "/topics/news")).status).toBe(200);
    const logs = `${started().buildLog()}\n${started().serverLog()}`;
    // A positive control: the moved posts' addresses were recorded outside a
    // request, which expires cached pages there; without it, nothing below
    // could have been logged.
    expect(logs).toContain("cache expiry waits for a request");
    expect(logs).not.toContain("cache expiry failed");
    expect(logs).not.toMatch(/\[ERROR\]/);
  });

  test("the verification codes are meta tags in the home page's head, and only there", async ({
    request,
  }) => {
    const home = await visit(request, "/");
    expect(home.status).toBe(200);
    const tags = namedMetaTags(headOf(home.body));
    for (const tag of VERIFICATION_TAGS) {
      expect(tags, tag[0]).toContainEqual(tag);
    }

    const verificationNames = new Set(VERIFICATION_TAGS.map(([name]) => name));
    for (const path of ["/about", "/topics/guides"]) {
      const page = await visit(request, path);
      expect(page.status, path).toBe(200);
      const head = headOf(page.body);
      // A positive control: this page's head is the plugin's answer too.
      expect(head, path).toContain(`rel="canonical"`);
      expect(
        namedMetaTags(head).filter(([name]) => verificationNames.has(name)),
        path
      ).toEqual([]);
    }
  });

  test("robots.txt serves the site's own rules after the plugin's lines", async ({
    request,
  }) => {
    const { url } = started();
    const robots = await visit(request, "/robots.txt");
    expect(robots.status).toBe(200);
    // Answered by the plugin, which marks its own robots.txt.
    expect(robots.headers["x-nextly-robots"]).toBeDefined();
    const lines = robots.body.split("\n").map(line => line.trim());
    const own = lines.indexOf(OWN_RULE);
    expect(own, robots.body).toBeGreaterThan(-1);
    // The plugin's own lines are all still there, and before the site's.
    for (const line of ["Disallow: /admin/", "Disallow: /api/"]) {
      const index = lines.indexOf(line);
      expect(index, `${line}\n${robots.body}`).toBeGreaterThan(-1);
      expect(index, `${line}\n${robots.body}`).toBeLessThan(own);
    }
    expect(lines, robots.body).toContain(`Sitemap: ${url}/sitemap.xml`);
  });

  // Last: it starts the server again without the site's own Gone page.
  test("an address made Gone answers 410 with a plain page where the site names none", async ({
    request,
  }) => {
    await started().restart({ SEO_SITE_GONE_PAGE: undefined });
    const from = `/seo-site-retired-plain-${run}`;
    await makeGone(from);
    const answer = await visit(request, from);
    expect(answer.status).toBe(410);
    expect(answer.headers.location).toBeUndefined();
    expect(answer.body).not.toContain("This page was retired on purpose");
    expect(answer.body).toContain("This page is gone.");
  });
});
