import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * A published page is served inside its Layout, from a PRODUCTION build.
 *
 * The playground's page route turns Layouts on with the plugin's provider, so
 * a page naming no Layout is drawn inside the site's default: its header
 * component, the page, then its footer component. Everything is authored
 * through the API the editor writes with, and read back as an anonymous
 * visitor, because the claim is about what the product serves for content the
 * product accepted.
 *
 * What this route cannot show is the COUNT of revalidations a write causes:
 * it is per-request (its preview gate reads a cookie), so only the reads
 * inside it are cached, not the page. What it does show is that a region's
 * cached component read is refreshed by that component's publish, which is
 * the tag doing its work in a real build; which pages each write reaches, and
 * how many times, is measured over the tag sets in
 * `packages/blocks-react/src/next.layouts.test.ts`.
 *
 * @module tests/production/pages-in-their-layout
 */

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);
const HEADER_ONE = `Layout header one ${STAMP}`;
const HEADER_TWO = `Layout header two ${STAMP}`;
const FOOTER = `Layout footer ${STAMP}`;
const BODY = `Page inside its Layout ${STAMP}`;
const SLUG = `in-its-layout-${STAMP}`;

const headingDocument = (
  kind: "page" | "component",
  id: string,
  text: string
) => ({
  formatVersion: 1,
  kind,
  nodes: [
    { id, type: "core/heading", version: 1, props: { text, level: "h2" } },
  ],
});

/** Fail with the server's message rather than with a bare status code. */
async function itemOf(
  response: APIResponse,
  what: string
): Promise<{ id: string }> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { item?: { id?: unknown } };
  const id = body.item?.id;
  if (typeof id !== "string") {
    throw new Error(`${what} answered no id: ${JSON.stringify(body)}`);
  }
  return { id };
}

/** The page as an anonymous visitor gets it. */
async function served(request: APIRequestContext): Promise<string> {
  const response = await request.get(`/${SLUG}`, { headers: { cookie: "" } });
  expect(response.status()).toBe(200);
  return await response.text();
}

test.describe("a page served inside its Layout", () => {
  test("draws the default Layout's header and footer, drops them when switched off, and follows a header publish", async ({
    page,
    request,
  }, testInfo) => {
    // 1. Signed in as the file's one sign-in; dev auto-login is blocked here.
    await signIn(page);
    const api = page.request;

    // 2. A header and a footer component, a Layout naming them, and that
    //    Layout made the site's default through the one route that may.
    const header = await itemOf(
      await api.post(`${API}/collections/components/entries`, {
        data: {
          title: `Header ${STAMP}`,
          slug: `header-${STAMP}`,
          content: headingDocument("component", "hdr", HEADER_ONE),
          status: "published",
        },
      }),
      "creating the header component"
    );
    const footer = await itemOf(
      await api.post(`${API}/collections/components/entries`, {
        data: {
          title: `Footer ${STAMP}`,
          slug: `footer-${STAMP}`,
          content: headingDocument("component", "ftr", FOOTER),
          status: "published",
        },
      }),
      "creating the footer component"
    );
    const layout = await itemOf(
      await api.post(`${API}/collections/layouts/entries`, {
        data: {
          title: `Main ${STAMP}`,
          slug: `main-${STAMP}`,
          areas: [
            { area: "header", component: header.id },
            { area: "footer", component: footer.id },
          ],
          status: "published",
        },
      }),
      "creating the Layout"
    );
    // A plugin route checks the double-submit CSRF token, as the admin's own
    // requests carry it; the collection routes above take the session alone.
    const csrf = await api.get(`${API}/auth/csrf`);
    expect(csrf.ok()).toBe(true);
    const { token } = (await csrf.json()) as { token: string };
    const made = await api.post(`${PLUGIN}/layouts/${layout.id}/make-default`, {
      headers: { "x-csrf-token": token, origin: new URL(page.url()).origin },
      data: {},
    });
    expect(
      made.ok(),
      `make-default: ${made.status()} ${await made.text()}`
    ).toBe(true);

    // 3. A published page naming no Layout: it uses the default.
    const created = await itemOf(
      await api.post(`${API}/collections/pages/entries`, {
        data: {
          title: `In its Layout ${STAMP}`,
          slug: SLUG,
          content: headingDocument("page", "body", BODY),
          status: "published",
        },
      }),
      "creating the page"
    );

    const html = await served(request);
    // Kept with the run, so a failure below can be read against what was served.
    await testInfo.attach("served.html", {
      body: html,
      contentType: "text/html",
    });
    // The population first, so the region assertions cannot pass on an
    // empty page.
    expect(html).toContain(BODY);
    expect(html).toContain('data-nextly-region="header"');
    expect(html).toContain('data-nextly-region="footer"');
    // Positions in the drawn markup only. The response also carries the React
    // payload in inline scripts, which names the page's title and its whole
    // tree again, ahead of where the markup draws them.
    const drawn = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<title>[\s\S]*?<\/title>/g, "");
    const at = (text: string) => drawn.indexOf(text);
    expect(at(HEADER_ONE)).toBeGreaterThan(-1);
    expect(at(HEADER_ONE)).toBeLessThan(at(BODY));
    expect(at(FOOTER)).toBeGreaterThan(at(BODY));
    // One site sheet for the header, the page and the footer together.
    expect(drawn.match(/data-nx-site-sheet=/g) ?? []).toHaveLength(1);
    // The landmarks a visitor's screen reader moves by, in the browser.
    await page.goto(`/${SLUG}`);
    await expect(
      page.getByRole("banner").getByRole("heading", { name: HEADER_ONE })
    ).toBeVisible();
    await expect(
      page.getByRole("contentinfo").getByRole("heading", { name: FOOTER })
    ).toBeVisible();

    // 4. "No header or footer" switched on: neither is served.
    const switchedOff = await api.patch(
      `${API}/collections/pages/entries/${created.id}`,
      { data: { noHeaderFooter: true, status: "published", _overwrite: true } }
    );
    expect(
      switchedOff.ok(),
      `switching off: ${switchedOff.status()} ${await switchedOff.text()}`
    ).toBe(true);
    const bare = await served(request);
    expect(bare).toContain(BODY);
    expect(bare).not.toContain("data-nextly-region");
    expect(bare).not.toContain(HEADER_ONE);
    expect(bare).not.toContain(FOOTER);

    // 5. Back on, then a new revision of the header published: the page
    //    serves the new header, through the cached component read its publish
    //    revalidated.
    const switchedOn = await api.patch(
      `${API}/collections/pages/entries/${created.id}`,
      { data: { noHeaderFooter: false, status: "published", _overwrite: true } }
    );
    expect(switchedOn.ok()).toBe(true);
    expect(await served(request)).toContain(HEADER_ONE);

    const revised = await api.patch(
      `${API}/collections/components/entries/${header.id}`,
      {
        data: {
          content: headingDocument("component", "hdr", HEADER_TWO),
          status: "published",
          _overwrite: true,
        },
      }
    );
    expect(
      revised.ok(),
      `publishing the header: ${revised.status()} ${await revised.text()}`
    ).toBe(true);
    const after = await served(request);
    expect(after).toContain(HEADER_TWO);
    expect(after).not.toContain(HEADER_ONE);
  });
});
