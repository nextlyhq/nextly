/**
 * Plain-text copies of pages with no stored words of their own, on every
 * configured dialect: a page built in the site's code, and a page whose
 * stored fields hold nothing beyond its title (a layout, as a Page Builder
 * page is). Each is copied from the page as it renders, asked for as the
 * public asks, at the page's own listed address.
 *
 * What each case pins:
 * - such a copy holds the rendered page's main words, with front matter
 *   from the page's head, and llms.txt links it;
 * - the page is asked for once, as HTML, marked as a copy's request, and a
 *   request so marked is never itself answered with a copy;
 * - a page that does not render as HTML has no copy: the request is the
 *   site's to answer;
 * - a page whose stored fields hold words is copied from them, never
 *   rendered;
 * - where the site names no address of its own, no page is rendered, and
 *   neither llms.txt nor a page's head links a rendered copy;
 * - a page built in code links its copy from its head;
 * - on a site whose addresses name their language, a page built in code is
 *   copied at the address it is served at, in every language;
 * - a page built in code at a copy's address is served there, never
 *   replaced by another page's copy, and no copy is linked to it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SanitizedNextlyConfig } from "nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, json, text, textarea } from "nextly";
import { createDynamicHandlers, createNextlyProxy } from "nextly/runtime";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoMetadata } from "../../code-pages/metadata";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { RENDERING_HEADER } from "../rendered-fetch";

const SITE = "https://acme.example";

/**
 * A production build of a site with pages built in code: `/pricing`, and
 * `/guide` beside a page of its own at `/guide.md`, the address `/guide`'s
 * copy would have.
 */
const BUILD = mkdtempSync(join(tmpdir(), "seo-rendered-copies-"));
mkdirSync(join(BUILD, "server"), { recursive: true });
writeFileSync(
  join(BUILD, "server/app-paths-manifest.json"),
  JSON.stringify({
    "/(site)/pricing/page": "app/(site)/pricing/page.js",
    "/(site)/guide/page": "app/(site)/guide/page.js",
    "/(site)/guide.md/page": "app/(site)/guide.md/page.js",
  })
);
writeFileSync(
  join(BUILD, "prerender-manifest.json"),
  JSON.stringify({
    version: 4,
    routes: {
      "/pricing": { srcRoute: "/pricing" },
      "/guide": { srcRoute: "/guide" },
      "/guide.md": { srcRoute: "/guide.md" },
    },
  })
);

/**
 * A production build of a site whose addresses name their language, with
 * one page built in code served in each: `/en/pricing` and `/de/pricing`.
 */
const LANGUAGE_BUILD = mkdtempSync(join(tmpdir(), "seo-rendered-copies-de-"));
mkdirSync(join(LANGUAGE_BUILD, "server"), { recursive: true });
writeFileSync(
  join(LANGUAGE_BUILD, "server/app-paths-manifest.json"),
  JSON.stringify({ "/[locale]/pricing/page": "app/[locale]/pricing/page.js" })
);
writeFileSync(
  join(LANGUAGE_BUILD, "prerender-manifest.json"),
  JSON.stringify({
    version: 4,
    routes: {
      "/en/pricing": { srcRoute: "/[locale]/pricing" },
      "/de/pricing": { srcRoute: "/[locale]/pricing" },
    },
  })
);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(BUILD, { recursive: true, force: true });
  rmSync(LANGUAGE_BUILD, { recursive: true, force: true });
});

const open = { read: () => true };

/**
 * The site booted; `named` false, it names no address of its own (no
 * `baseUrl`, no production address), so its listed addresses are the
 * request's host; `languages`, it is in English and German, each named in
 * its addresses, and built as {@link LANGUAGE_BUILD}.
 */
async function boot(
  dialect: TestDialect,
  { named = true, languages = false } = {}
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    ...(languages
      ? {
          localization: { locales: ["en", "de"], defaultLocale: "en" },
          languageAddresses: { by: "prefix" as const },
        }
      : {}),
    plugins: [
      seoPlugin({
        collections: ["landings", "notes"],
        ...(named ? { baseUrl: SITE } : {}),
        nextBuildDir: languages ? LANGUAGE_BUILD : BUILD,
      }),
    ],
    collections: [
      // A page whose words are its layout: nothing a copy can read.
      defineCollection({
        slug: "landings",
        status: true,
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          json({ name: "layout" }),
        ],
        publicAddress: "/l/{slug}",
      }),
      // A page whose stored fields hold its words.
      defineCollection({
        slug: "notes",
        status: true,
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          textarea({ name: "body" }),
        ],
        publicAddress: "/notes/{slug}",
      }),
    ],
  });
  await lastCatchUp();
  await current.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: {
      _overwrite: true,
      siteName: "Acme",
      productionAddresses: named ? [SITE] : [],
      plainTextCopies: true,
      llmsTxt: true,
    },
  });
  return current;
}

/** The site's Proxy, as an app wires it. */
const proxy = createNextlyProxy({} as SanitizedNextlyConfig, {
  start: async () => undefined,
  next: () => () => new Response("the page", { status: 200 }),
});

async function ask(path: string, headers: Record<string, string> = {}) {
  const response = await proxy(new Request(`${SITE}${path}`, { headers }));
  return {
    type: response?.headers.get("content-type") ?? null,
    body: (await response?.text()) ?? "",
  };
}

async function llmsTxt(): Promise<string> {
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/llms.txt`),
    { params: Promise.resolve({ params: ["llms.txt"] }) }
  );
  return response.text();
}

/** The site's pages as its server renders them, and every request for one. */
function renderedSite(pages: Record<string, string>) {
  const asked: { url: string; headers: Headers }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push({ url, headers: new Headers(init?.headers) });
    const html = pages[new URL(url).pathname];
    return html === undefined
      ? new Response("Not found", { status: 404 })
      : new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
  });
  return asked;
}

const html = (title: string, main: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><nav><a href="/">Home</a></nav><main>${main}</main><footer>Footer</footer></body></html>`;

describe.each(getConfiguredTestDialects())(
  "copies made from the rendered page (%s)",
  dialect => {
    it("copies a page built in code from the page as it renders, and llms.txt links it", async () => {
      await boot(dialect);
      await seoMetadata("/pricing", {
        metadata: { title: "Pricing", description: "Plans and prices." },
      });
      const asked = renderedSite({
        "/pricing": html(
          "Pricing | Acme",
          "<h1>Pricing</h1><p>Starter is <strong>$9</strong> a month.</p><ul><li>One site</li></ul>"
        ),
      });

      const copy = await ask("/pricing.md");
      expect(copy.type).toBe("text/markdown; charset=utf-8");
      expect(copy.body).toMatch(/^---\ntitle: "Pricing[^"]*"\n/);
      expect(copy.body).toContain(`\nurl: ${SITE}/pricing\n`);
      expect(copy.body).toContain(
        "---\n\n# Pricing\n\nStarter is **$9** a month.\n\n- One site\n"
      );
      expect(copy.body).not.toContain("Footer");
      // Asked for once, as HTML, marked as a copy's own request.
      expect(asked.map(each => each.url)).toEqual([`${SITE}/pricing`]);
      expect(asked[0]?.headers.get("accept")).toBe("text/html");
      expect(asked[0]?.headers.get(RENDERING_HEADER)).toBe("1");

      expect(await llmsTxt()).toContain(`(${SITE}/pricing.md)`);
      // Its head links the copy, as every other copied page's does.
      const head = await seoMetadata("/pricing", {
        metadata: { title: "Pricing", description: "Plans and prices." },
      });
      expect(String(head.alternates?.types?.["text/markdown"])).toMatch(
        /\/pricing\.md$/
      );
    });

    it("renders no page, and links no rendered copy, where the site names no address of its own", async () => {
      await boot(dialect, { named: false });
      const asked = renderedSite({
        "/pricing": html("Pricing", "<h1>Pricing</h1><p>Words.</p>"),
      });
      const head = await seoMetadata("/pricing", {
        metadata: { title: "Pricing" },
      });

      // The request's host is not one the site chose: nothing is fetched.
      expect((await ask("/pricing.md")).body).toBe("the page");
      expect(asked).toEqual([]);
      // So neither llms.txt nor the head points to a copy that is not served.
      const llms = await llmsTxt();
      expect(llms).toContain("/pricing)");
      expect(llms).not.toContain("/pricing.md");
      expect(head.alternates?.types?.["text/markdown"]).toBeUndefined();
    });

    it("copies a page whose fields hold no words from the page as it renders", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "landings",
        data: {
          title: "Spring sale",
          slug: "spring",
          status: "published",
          layout: { blocks: [{ type: "hero", text: "Half off" }] },
        },
      });
      renderedSite({
        "/l/spring": html(
          "Spring sale | Acme",
          "<h1>Spring sale</h1><p>Half off everything.</p>"
        ),
      });

      const copy = await ask("/l/spring.md");
      expect(copy.body).toContain("# Spring sale\n\nHalf off everything.\n");
    });

    it("leaves a page that does not render as HTML to the site", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "landings",
        data: { title: "Gone", slug: "gone", status: "published" },
      });
      renderedSite({});
      // The page has nothing to copy but its title: its stored copy stands.
      expect((await ask("/l/gone.md")).body).toContain("# Gone\n");
      await seoMetadata("/pricing", { metadata: { title: "Pricing" } });
      expect((await ask("/pricing.md")).body).toBe("the page");
    });

    it("copies a page whose fields hold words from them, never rendering it", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "notes",
        data: {
          title: "Launch",
          slug: "launch",
          status: "published",
          body: "We launched.",
        },
      });
      const asked = renderedSite({});

      expect((await ask("/notes/launch.md")).body).toContain(
        "# Launch\n\nWe launched.\n"
      );
      expect(asked).toEqual([]);
    });

    it("never answers a request made to render a copy with a copy", async () => {
      await boot(dialect);
      await seoMetadata("/pricing", { metadata: { title: "Pricing" } });
      renderedSite({ "/pricing": html("Pricing", "<p>Words.</p>") });
      expect(
        (
          await ask("/pricing", {
            accept: "text/markdown, text/html",
            [RENDERING_HEADER]: "1",
          })
        ).body
      ).toBe("the page");
    });

    it("copies a page built in code at the address it is served at, whatever language it names", async () => {
      await boot(dialect, { languages: true });
      for (const path of ["/en/pricing", "/de/pricing"]) {
        await seoMetadata(path, { metadata: { title: "Pricing" } });
      }
      renderedSite({
        "/en/pricing": html("Pricing", "<h1>Pricing</h1><p>Starter is $9.</p>"),
        "/de/pricing": html(
          "Preise",
          "<h1>Preise</h1><p>Starter kostet 9 $.</p>"
        ),
      });

      expect((await ask("/en/pricing.md")).body).toContain(
        "# Pricing\n\nStarter is $9.\n"
      );
      expect((await ask("/de/pricing.md")).body).toContain(
        "# Preise\n\nStarter kostet 9 $.\n"
      );
    });

    it("serves a page built in code at a copy's address itself, never another page's copy", async () => {
      await boot(dialect);
      await seoMetadata("/guide", { metadata: { title: "Guide" } });
      const asked = renderedSite({
        "/guide": html("Guide", "<h1>Guide</h1><p>Read me.</p>"),
      });

      // The site's own /guide.md is the site's to answer.
      expect((await ask("/guide.md")).body).toBe("the page");
      expect(asked).toEqual([]);
      // So /guide links no copy at that address, in llms.txt or its head.
      const llms = await llmsTxt();
      expect(llms).toContain(`(${SITE}/guide)`);
      expect(llms).not.toContain(`(${SITE}/guide.md)`);
      const head = await seoMetadata("/guide", {
        metadata: { title: "Guide" },
      });
      expect(head.alternates?.types?.["text/markdown"]).toBeUndefined();
    });
  }
);
