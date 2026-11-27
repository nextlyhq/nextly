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
 * - a page that does not render as HTML is copied as its name and
 *   description, never as nothing, and is named, with why, for the problem
 *   list until it renders again;
 * - llms-full.txt holds a page built in code's rendered words, its
 *   description where it does not render, and its description where the
 *   file's time for rendering has run out, which is noted too;
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

import type { PluginContext } from "@nextlyhq/plugin-sdk";
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
import type { CodeRoute } from "../../code-pages/routes";
import type { ReadRules } from "../../resolver/provider";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { readSeoRules } from "../../settings/rules";
import { llmsFullTxtOf } from "../ai-outputs";
import { copyFailures } from "../copy-failures";
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

/** The SEO plugin's own context in the current test, from its start. */
let seoContext: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  seoContext = undefined;
  vi.restoreAllMocks();
});

/** The SEO plugin's context, which the current test's boot kept. */
function seoCtx(): PluginContext {
  if (seoContext === undefined) throw new Error("no SEO plugin context");
  return seoContext;
}

/** `plugin`, keeping the context it starts with. */
function keepingContext(
  plugin: ReturnType<typeof seoPlugin>
): ReturnType<typeof seoPlugin> {
  return {
    ...plugin,
    init(ctx) {
      seoContext = ctx;
      return plugin.init?.(ctx);
    },
  };
}

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
      keepingContext(
        seoPlugin({
          collections: ["landings", "notes"],
          ...(named ? { baseUrl: SITE } : {}),
          nextBuildDir: languages ? LANGUAGE_BUILD : BUILD,
        })
      ),
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
      llmsFullTxt: true,
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

async function rootFile(file: string): Promise<string> {
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/${file}`),
    { params: Promise.resolve({ params: [file] }) }
  );
  return response.text();
}

const llmsTxt = (): Promise<string> => rootFile("llms.txt");

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

    it("copies a page that does not render as its name and description, and names it for the problem list until it does", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "landings",
        data: {
          title: "Gone",
          slug: "gone",
          status: "published",
          seo: { metaDescription: "A sale that ended." },
        },
      });
      renderedSite({});
      // The page has nothing to copy but its title: its name and
      // description stand in for its words.
      expect((await ask("/l/gone.md")).body).toContain(
        "---\n\n# Gone\n\nA sale that ended.\n"
      );
      await seoMetadata("/pricing", {
        metadata: { title: "Pricing", description: "Plans and prices." },
      });
      const copy = await ask("/pricing.md");
      expect(copy.type).toBe("text/markdown; charset=utf-8");
      expect(copy.body).toContain("---\n\n# Pricing\n\nPlans and prices.\n");
      expect(
        (await copyFailures(seoCtx())).map(({ url, reason, retry }) => ({
          url,
          reason,
          retry,
        }))
      ).toEqual([
        {
          url: `${SITE}/pricing`,
          reason: "status 404",
          retry: `${SITE}/pricing.md`,
        },
        {
          url: `${SITE}/l/gone`,
          reason: "status 404",
          retry: `${SITE}/l/gone.md`,
        },
      ]);

      // Once the page renders, asking again copies it and takes it off.
      renderedSite({
        "/pricing": html("Pricing | Acme", "<h1>Pricing</h1><p>Words.</p>"),
      });
      expect((await ask("/pricing.md")).body).toContain(
        "# Pricing\n\nWords.\n"
      );
      expect((await copyFailures(seoCtx())).map(each => each.url)).toEqual([
        `${SITE}/l/gone`,
      ]);
    });

    it("takes a page off the problem list once its copy is made from its own words, at its copy or in llms-full.txt", async () => {
      const t = await boot(dialect);
      const note = async (slug: string) =>
        String(
          (
            await t.nextly.create({
              collection: "notes",
              data: { title: slug, slug, status: "published" },
            })
          ).item.id
        );
      const first = await note("first");
      const second = await note("second");
      // Neither holds words yet, and neither renders: both are noted.
      renderedSite({});
      await ask("/notes/first.md");
      await ask("/notes/second.md");
      expect(
        (await copyFailures(seoCtx())).map(each => each.url).sort()
      ).toEqual([`${SITE}/notes/first`, `${SITE}/notes/second`]);

      // Each gains words of its own: its copy is made from them, never
      // rendered, and that settles it.
      for (const id of [first, second]) {
        await t.nextly.update({
          collection: "notes",
          id,
          data: { body: "We launched.", _overwrite: true },
        });
      }
      expect((await ask("/notes/first.md")).body).toContain("We launched.");
      expect((await copyFailures(seoCtx())).map(each => each.url)).toEqual([
        `${SITE}/notes/second`,
      ]);
      expect(await rootFile("llms-full.txt")).toContain(
        `Source: ${SITE}/notes/second\n\nWe launched.`
      );
      expect(await copyFailures(seoCtx())).toEqual([]);
    });

    it("writes a page built in code into llms-full.txt with its rendered words, or its description where it does not render", async () => {
      await boot(dialect);
      await seoMetadata("/pricing", {
        metadata: { title: "Pricing", description: "Plans and prices." },
      });
      renderedSite({
        "/pricing": html(
          "Pricing | Acme",
          "<h1>Pricing</h1><p>Starter is <strong>$9</strong> a month.</p>"
        ),
      });
      expect(await rootFile("llms-full.txt")).toContain(
        `# Pricing\n\nSource: ${SITE}/pricing\n\nStarter is **$9** a month.\n`
      );
      expect(await copyFailures(seoCtx())).toEqual([]);
    });

    it("gives llms-full.txt a page built in code's description, and notes it, where the page does not render", async () => {
      await boot(dialect);
      await seoMetadata("/pricing", {
        metadata: { title: "Pricing", description: "Plans and prices." },
      });
      renderedSite({});
      expect(await rootFile("llms-full.txt")).toContain(
        `# Pricing\n\nSource: ${SITE}/pricing\n\nPlans and prices.\n`
      );
      expect(
        (await copyFailures(seoCtx())).map(({ url, reason }) => ({
          url,
          reason,
        }))
      ).toEqual([{ url: `${SITE}/pricing`, reason: "status 404" }]);
    });

    it("names a page built in code as structured data does: the name its route gives it over its title", async () => {
      await boot(dialect);
      await seoMetadata("/pricing", {
        name: "Plans",
        metadata: {
          title: "Affordable pricing | Acme",
          description: "Plans and prices.",
        },
      });
      renderedSite({
        "/pricing": html(
          "Affordable pricing | Acme",
          "<h1>Plans</h1><p>Words.</p>"
        ),
      });
      expect(await llmsTxt()).toContain(`- [Plans](${SITE}/pricing.md)`);
      expect(await rootFile("llms-full.txt")).toContain(
        `# Plans\n\nSource: ${SITE}/pricing\n\n`
      );
    });

    it("lets every page rendered ahead finish, and keeps what it found, where llms-full.txt stops short", async () => {
      await boot(dialect);
      await seoMetadata("/guide", { metadata: { title: "Guide" } });
      await seoMetadata("/pricing", {
        metadata: { title: "Pricing", description: "Plans and prices." },
      });
      // `/pricing` is rendered while `/guide` is written, and answers late.
      vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
        const url = new URL(
          String(input instanceof Request ? input.url : input)
        );
        if (url.pathname === "/pricing") {
          await new Promise(done => setTimeout(done, 200));
        }
        return new Response("Gone", { status: 410 });
      });
      const route = (path: string): CodeRoute => ({
        path,
        source: "built",
        route: `app${path}/page.tsx`,
      });
      const readRules: ReadRules = (ctx, locale) => readSeoRules(ctx, locale);
      const ctx = seoCtx();
      // Room for the file's head alone: it stops at its first page.
      const file = await llmsFullTxtOf(
        ctx,
        SITE,
        {
          readRules,
          codeRoutes: async () => [route("/guide"), route("/pricing")],
        },
        await readRules(ctx, undefined),
        120
      );

      expect(file).toContain("The rest of the site's pages are listed");
      expect(file).not.toContain(`Source: ${SITE}/pricing`);
      expect((await copyFailures(ctx)).map(each => each.url).sort()).toEqual([
        `${SITE}/guide`,
        `${SITE}/pricing`,
      ]);
    });

    it("renders no more pages for llms-full.txt once its time for rendering runs out", async () => {
      await boot(dialect);
      await seoMetadata("/pricing", {
        metadata: { title: "Pricing", description: "Plans and prices." },
      });
      const asked = renderedSite({
        "/pricing": html("Pricing | Acme", "<h1>Pricing</h1><p>Words.</p>"),
      });
      // Every reading of the clock is half a minute after the last: the
      // file's time for rendering has run out before its first page.
      let now = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => (now += 30_000));
      const full = await rootFile("llms-full.txt");
      vi.mocked(Date.now).mockRestore();

      expect(full).toContain(
        `# Pricing\n\nSource: ${SITE}/pricing\n\nPlans and prices.\n`
      );
      expect(asked).toEqual([]);
      expect((await copyFailures(seoCtx())).map(each => each.reason)).toEqual([
        "llms-full.txt ran out of time before rendering it",
      ]);
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
