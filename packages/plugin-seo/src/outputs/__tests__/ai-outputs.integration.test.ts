/**
 * The optional outputs for AI tools on every configured dialect: `/llms.txt`
 * and each listed page's plain-text copy are off until switched on in the SEO
 * settings, list exactly the pages the sitemap lists, give every reader the
 * same answer, and never change what a page serves.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { SanitizedNextlyConfig } from "nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  defineCollection,
  defineSingle,
  richText,
  text,
  textarea,
} from "nextly";
import {
  contentPageMetadata,
  createDynamicHandlers,
  createNextlyProxy,
  type ContentEntry,
} from "nextly/runtime";
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import type { ReadRules } from "../../resolver/provider";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { readSeoRules } from "../../settings/rules";
import { llmsFullTxtOf } from "../ai-outputs";

/** How many pages' plain-text copies have been built since last reset. */
const copies = vi.hoisted(() => ({ built: 0 }));

// Each copy is still built as the plugin builds it; the count is what
// shows llms-full.txt builds no page it cannot hold.
vi.mock("../plain-copy", async importOriginal => {
  const actual = await importOriginal<typeof import("../plain-copy")>();
  return {
    ...actual,
    plainCopyOf: (...args: Parameters<typeof actual.plainCopyOf>) => {
      copies.built += 1;
      return actual.plainCopyOf(...args);
    },
  };
});

const SITE = "https://acme.example";

let current: TestNextly | undefined;

/** The SEO plugin's own context in the current test, from its start. */
let seoContext: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  seoContext = undefined;
});

const open = { read: () => true };

const words = (value: string) => ({ type: "text", text: value, format: 0 });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });
const body = (...children: unknown[]) => ({
  root: { type: "root", children },
});

/**
 * The SEO plugin as the site configures it, keeping the context it starts
 * with, so a test can call an output with the plugin's own reads.
 */
function seoHandingOverContext(): ReturnType<typeof seoPlugin> {
  const plugin = seoPlugin({
    collections: ["posts", "members", "guides"],
    singles: ["home"],
    baseUrl: SITE,
  });
  return {
    ...plugin,
    init(ctx) {
      seoContext = ctx;
      return plugin.init?.(ctx);
    },
  };
}

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    // The Public role a real boot makes, which judges every visitor's read.
    seedPublic: true,
    plugins: [seoHandingOverContext()],
    collections: [
      defineCollection({
        slug: "posts",
        labels: { singular: "Blog post", plural: "Blog posts" },
        status: true,
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          textarea({ name: "excerpt" }),
          richText({ name: "body" }),
          // Kept from the public, and so from every copy.
          textarea({ name: "internal", access: { read: () => false } }),
        ],
        publicAddress: "/blog/{slug}",
      }),
      // Pages whose title the public may not read.
      defineCollection({
        slug: "guides",
        status: true,
        access: open,
        fields: [
          text({ name: "title", access: { read: () => false } }),
          text({ name: "slug" }),
          textarea({ name: "excerpt" }),
        ],
        publicAddress: "/guides/{slug}",
      }),
      // Pages the public may not read at all, though they have an address.
      defineCollection({
        slug: "members",
        status: true,
        access: { read: () => false },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/members/{slug}",
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        access: open,
        fields: [text({ name: "title" }), richText({ name: "intro" })],
        publicAddress: "/",
      }),
      // A page named index.html, whose copy's name the home page's has too.
      defineSingle({
        slug: "legacy-index",
        access: open,
        fields: [text({ name: "title" })],
        publicAddress: "/index.html",
      }),
      // A page whose own address is the one `/blog/hello`'s copy would have.
      defineSingle({
        slug: "hello-notes",
        access: open,
        fields: [text({ name: "title" })],
        publicAddress: "/blog/hello.md",
      }),
    ],
  });
  await lastCatchUp();
  return current;
}

/** A root file, as the site's rewrite reaches the API handler with it. */
async function rootFile(file: string) {
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/${file}`),
    { params: Promise.resolve({ params: [file] }) }
  );
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: await response.text(),
  };
}

/** The `<loc>` of every page the sitemap lists. */
async function sitemapLocs(): Promise<string[]> {
  const { body: xml } = await rootFile("sitemap.xml");
  return [...xml.matchAll(/<url><loc>([^<]*)<\/loc>/g)].map(m => m[1] ?? "");
}

/** Every address llms.txt links to, in order. */
async function llmsLinks(): Promise<string[]> {
  const { body: file } = await rootFile("llms.txt");
  return [...file.matchAll(/^- \[[^\]]*\]\(([^)]*)\)/gm)].map(m => m[1] ?? "");
}

/** The site's Proxy, as an app wires it, on the Nextly the test started. */
const proxy = createNextlyProxy({} as SanitizedNextlyConfig, {
  start: async () => undefined,
  next: () => () => new Response("the page", { status: 200 }),
});

/** What the site's Proxy answers for `path`, as a given reader asks. */
async function ask(
  path: string,
  userAgent = "Mozilla/5.0",
  host: string = SITE,
  accept?: string
) {
  const response = await proxy(
    new Request(`${host}${path}`, {
      headers: {
        "user-agent": userAgent,
        ...(accept === undefined ? {} : { accept }),
      },
    })
  );
  return {
    status: response?.status,
    type: response?.headers.get("content-type") ?? null,
    link: response?.headers.get("link") ?? null,
    body: (await response?.text()) ?? "",
  };
}

/** The caching and indexing headers the Proxy answers `path` with. */
async function servedWith(path: string, accept?: string) {
  const response = await proxy(
    new Request(`${SITE}${path}`, {
      headers: accept === undefined ? {} : { accept },
    })
  );
  return {
    vary: response?.headers.get("vary") ?? null,
    cache: response?.headers.get("cache-control") ?? null,
    robots: response?.headers.get("x-robots-tag") ?? null,
  };
}

/** A copy's body without its front matter. */
const withoutFrontMatter = (markdown: string): string =>
  markdown.replace(/^---\n[\s\S]*?\n---\n\n/, "");

async function switches(t: TestNextly, data: Record<string, unknown>) {
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: {
      _overwrite: true,
      siteName: "Acme",
      description: "Acme makes rockets.",
      ...data,
    },
  });
}

async function post(
  t: TestNextly,
  slug: string,
  status: "published" | "draft",
  extra: Record<string, unknown> = {}
): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { title: `Post ${slug}`, slug, status, ...extra },
  });
  return String(created.item.id);
}

/** The words of an HTML fragment, as a reader of the page sees them. */
function visibleWords(html: string): string[] {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .split(/\s+/)
    .filter(word => word !== "");
}

/** The words of a Markdown copy, its markup and link addresses taken out. */
function copyWords(markdown: string): string[] {
  return (
    withoutFrontMatter(markdown)
      .replace(/\]\([^)]*\)/g, "]")
      // An escaped character is the character itself.
      .replace(/\\(.)/g, "$1")
      .replace(/^#+ |^> |^- |^\d+\. /gm, "")
      .replace(/[[\]]/g, "")
      .split(/\s+/)
      .filter(word => word !== "")
  );
}

describe.each(getConfiguredTestDialects())(
  "optional outputs for AI tools (%s)",
  dialect => {
    it("are off by default: no llms.txt, and a copy's address reaches the site", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published");

      expect((await rootFile("llms.txt")).status).toBe(404);
      const asked = await ask("/blog/hello.md");
      expect(asked.body).toBe("the page");
      expect(asked.link).toBeNull();
    });

    it("llms.txt lists exactly the pages the sitemap lists, by the head's titles, and goes when switched off", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published", { excerpt: "A short hello." });
      await post(t, "second", "published");
      await post(t, "unfinished", "draft");
      // Hidden from search on its own: neither listing names it.
      await post(t, "hidden", "published", { seo: { noindex: true } });
      await t.nextly.updateSingle({
        slug: "home",
        data: { _overwrite: true, title: "Welcome" },
      });
      await switches(t, { llmsTxt: true });

      const file = await rootFile("llms.txt");
      expect(file.status).toBe(200);
      expect(file.type).toBe("text/plain; charset=utf-8");
      expect([...(await llmsLinks())].sort()).toEqual(
        [...(await sitemapLocs())].sort()
      );
      expect(await llmsLinks()).toContain(`${SITE}/blog/hello`);
      expect(await llmsLinks()).not.toContain(`${SITE}/blog/unfinished`);
      expect(await llmsLinks()).not.toContain(`${SITE}/blog/hidden`);
      expect(file.body).toContain("# Acme\n\n> Acme makes rockets.\n");
      expect(file.body).toContain("## Blog posts\n");
      expect(file.body).toContain(
        `- [Post hello | Acme](${SITE}/blog/hello): A short hello.`
      );

      await switches(t, { llmsTxt: false });
      expect((await rootFile("llms.txt")).status).toBe(404);
    });

    it("serves each listed page's plain-text copy with the words the page shows, to every reader alike", async () => {
      const t = await boot(dialect);
      const id = await post(t, "hello", "published", {
        excerpt: "A short hello.",
        body: body(
          { type: "heading", tag: "h2", children: [words("Why rockets")] },
          paragraph(
            words("They go "),
            { type: "link", url: "/up", children: [words("up")] },
            words(" fast & far.")
          ),
          {
            type: "list",
            listType: "bullet",
            children: [
              { type: "listitem", children: [words("Fuel")] },
              { type: "listitem", children: [words("Fins")] },
            ],
          }
        ),
      });
      await switches(t, { plainTextCopies: true });

      const copy = await ask("/blog/hello.md");
      expect(copy.status).toBe(200);
      expect(copy.type).toBe("text/markdown; charset=utf-8");
      expect(copy.link).toBe(`<${SITE}/blog/hello>; rel="canonical"`);
      // A link written from the site's root is made whole.
      expect(copy.body).toContain(`[up](${SITE}/up)`);
      // Front matter names the page as its head does.
      expect(copy.body).toMatch(
        new RegExp(
          `^---\\ntitle: "Post hello \\| Acme"\\ndescription: "A short hello."\\nurl: ${SITE}/blog/hello\\nlast_updated: \\d{4}-`
        )
      );

      // The page as the site renders it: its title, its excerpt and its body
      // as HTML, which the site draws with the page.
      const page = (await t.nextly.findByID({
        collection: "posts",
        id,
        richTextFormat: "html",
      })) as Record<string, unknown>;
      const shown = [
        String(page.title),
        String(page.excerpt),
        ...visibleWords(String(page.body)),
      ].flatMap(part => part.split(/\s+/));
      expect(copyWords(copy.body)).toEqual(shown);

      // No reader is told apart: a crawler is answered as a person is.
      expect(await ask("/blog/hello.md", "GPTBot/1.1")).toEqual(copy);

      // Linked from llms.txt once both are on.
      await switches(t, { plainTextCopies: true, llmsTxt: true });
      expect(await llmsLinks()).toContain(`${SITE}/blog/hello.md`);
    });

    it("answers a copy only for a page the sitemap lists, and never a page's own address", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published");
      await post(t, "unfinished", "draft");
      await post(t, "hidden", "published", { seo: { noindex: true } });
      await t.nextly.updateSingle({
        slug: "home",
        data: { _overwrite: true, title: "Welcome" },
      });
      await switches(t, { plainTextCopies: true });

      expect((await ask("/blog/unfinished.md")).body).toBe("the page");
      expect((await ask("/blog/hidden.md")).body).toBe("the page");
      expect((await ask("/blog/missing.md")).body).toBe("the page");
      // The page itself is untouched while copies are on.
      expect((await ask("/blog/hello")).body).toBe("the page");
      // The home page's copy is at index.md, and at index.html.md too.
      const home = await ask("/index.md");
      expect(withoutFrontMatter(home.body)).toBe("# Welcome\n");
      expect(home.body).toContain(`\nurl: ${SITE}/\n`);
      expect(home.link).toBe(`<${SITE}/>; rel="canonical"`);
      expect(await ask("/index.html.md")).toEqual(home);
      // Reached on another of the site's hosts, a preview say, the copy still
      // names the page at the site's own address.
      const preview = await ask(
        "/blog/hello.md",
        undefined,
        "https://preview.acme.example"
      );
      expect(preview.link).toBe(`<${SITE}/blog/hello>; rel="canonical"`);

      await switches(t, { plainTextCopies: false });
      expect((await ask("/blog/hello.md")).body).toBe("the page");
    });

    it("serves no plain-text copy of a page whose type has SEO switched off, as it lists none", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published");
      await switches(t, { plainTextCopies: true });
      expect((await ask("/blog/hello.md")).status).toBe(200);

      await switches(t, { plainTextCopies: true, typesWithSeoOff: ["posts"] });
      // Left to the site, as a page the sitemap does not list is.
      expect((await ask("/blog/hello.md")).body).toBe("the page");

      await switches(t, { plainTextCopies: true });
      expect((await ask("/blog/hello.md")).status).toBe(200);
    });

    it("holds only what the public may read: no field or page it may not", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published", {
        excerpt: "Public words.",
        internal: "Staff only.",
      });
      await t.nextly.create({
        collection: "members",
        data: { title: "Members", slug: "club", status: "published" },
      });
      await switches(t, { plainTextCopies: true });

      const copy = await ask("/blog/hello.md");
      expect(copy.body).toContain("Public words.");
      expect(copy.body).not.toContain("Staff only.");
      expect((await ask("/members/club.md")).body).toBe("the page");
    });

    it("leaves a page whose own address is a copy's to the site, and links the page instead", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published");
      await t.nextly.updateSingle({
        slug: "hello-notes",
        data: { _overwrite: true, title: "Notes" },
      });
      await switches(t, { plainTextCopies: true, llmsTxt: true });

      expect((await ask("/blog/hello.md")).body).toBe("the page");
      // `/blog/hello` links the page, its copy's address being another
      // page's; that page links its own copy.
      const links = await llmsLinks();
      expect(links).toContain(`${SITE}/blog/hello`);
      expect(links).toContain(`${SITE}/blog/hello.md.md`);
      expect(links).not.toContain(`${SITE}/blog/hello.md`);
    });

    it("gives index.html.md to the page named index.html, and index.md to the home page", async () => {
      const t = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "home",
        data: { _overwrite: true, title: "Welcome" },
      });
      await t.nextly.updateSingle({
        slug: "legacy-index",
        data: { _overwrite: true, title: "Old index" },
      });
      await switches(t, { plainTextCopies: true, llmsTxt: true });

      expect(withoutFrontMatter((await ask("/index.html.md")).body)).toBe(
        "# Old index\n"
      );
      expect(withoutFrontMatter((await ask("/index.md")).body)).toBe(
        "# Welcome\n"
      );
      const links = await llmsLinks();
      expect(links).toContain(`${SITE}/index.html.md`);
      expect(links).toContain(`${SITE}/index.md`);
    });

    it("serves a copy at its own address as a cacheable file kept out of search, pointing to llms.txt", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published");
      // Production, so the staging guard's noindex is not the one seen.
      await switches(t, { plainTextCopies: true, productionAddresses: [SITE] });
      expect(await servedWith("/blog/hello.md")).toEqual({
        vary: "Accept",
        cache: "public, max-age=300",
        robots: "noindex",
      });

      await switches(t, {
        plainTextCopies: true,
        llmsTxt: true,
        productionAddresses: [SITE],
      });
      expect((await ask("/blog/hello.md")).link).toBe(
        `<${SITE}/blog/hello>; rel="canonical", <${SITE}/llms.txt>; rel="describedby"; type="text/plain"`
      );
    });

    it("answers a page's own address with its copy only where Markdown is asked for over HTML", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published");
      await post(t, "unfinished", "draft");
      // Production, so the staging guard's noindex is not the one seen.
      await switches(t, { plainTextCopies: true, productionAddresses: [SITE] });
      const agent = "text/markdown, text/html, */*";

      const copy = await ask("/blog/hello.md");
      const asked = await ask("/blog/hello", undefined, SITE, agent);
      expect(asked.type).toBe("text/markdown; charset=utf-8");
      expect(asked.body).toBe(copy.body);
      expect(asked.link).toBe(`<${SITE}/blog/hello>; rel="canonical"`);
      // Never kept by a shared cache, and never marked noindex.
      expect(await servedWith("/blog/hello", agent)).toEqual({
        vary: "Accept",
        cache: "private, no-store",
        robots: null,
      });
      expect(
        (
          await ask(
            "/blog/hello",
            undefined,
            SITE,
            "text/markdown;q=1.0, text/html;q=0.7"
          )
        ).type
      ).toBe("text/markdown; charset=utf-8");
      // The page's address with a trailing slash, as a site that writes
      // addresses so asks for it, is the page too.
      expect((await ask("/blog/hello/", undefined, SITE, agent)).body).toBe(
        copy.body
      );

      // A browser, or a reader preferring HTML, is served the page.
      const browser =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
      expect((await ask("/blog/hello", undefined, SITE, browser)).body).toBe(
        "the page"
      );
      expect(
        (await ask("/blog/hello", undefined, SITE, "text/html, text/markdown"))
          .body
      ).toBe("the page");
      expect(
        (
          await ask(
            "/blog/hello",
            undefined,
            SITE,
            "text/markdown;q=0, text/html"
          )
        ).body
      ).toBe("the page");
      // A page the sitemap does not list is the site's to answer.
      expect((await ask("/blog/unfinished", undefined, SITE, agent)).body).toBe(
        "the page"
      );
      // Nor while copies are off.
      await switches(t, { plainTextCopies: false });
      expect((await ask("/blog/hello", undefined, SITE, agent)).body).toBe(
        "the page"
      );
    });

    it("links a page's copy from its head only where the copy is served to the public", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published");
      const club = (
        await t.nextly.create({
          collection: "members",
          data: { title: "Members", slug: "club", status: "published" },
        })
      ).item as ContentEntry;
      const hello = (
        await t.nextly.find({
          collection: "posts",
          where: { slug: { equals: "hello" } },
        })
      ).items[0] as ContentEntry;
      await switches(t, { plainTextCopies: true, productionAddresses: [SITE] });
      const headOf = (
        entry: ContentEntry,
        collection: string,
        slug: string,
        path: string
      ) =>
        contentPageMetadata(
          { buildMetadata: () => ({}) },
          entry,
          { collection, slug },
          path
        );

      expect(
        (await headOf(hello, "posts", "hello", "/blog/hello")).alternates?.types
      ).toEqual({ "text/markdown": "/blog/hello.md" });
      // Listed, but the public may not read it: it has no copy to link.
      expect((await ask("/members/club.md")).body).toBe("the page");
      expect(
        (await headOf(club, "members", "club", "/members/club")).alternates
          ?.types
      ).toBeUndefined();
    });

    it("serves llms-full.txt, every listed page's words in one file, only beside llms.txt", async () => {
      const t = await boot(dialect);
      await post(t, "hello", "published", {
        excerpt: "A short hello.",
        body: body(paragraph(words("Rockets go up."))),
        internal: "Staff only.",
      });
      await post(t, "unfinished", "draft", {
        body: body(paragraph(words("Not yet."))),
      });
      await t.nextly.create({
        collection: "members",
        data: { title: "Secret plans", slug: "plans", status: "published" },
      });
      await switches(t, {
        llmsTxt: true,
        llmsIntro: "Ask us about rockets.\n# Not a heading",
      });
      expect((await rootFile("llms-full.txt")).status).toBe(404);
      expect((await rootFile("llms.txt")).body).not.toContain("llms-full.txt");
      expect((await rootFile("llms.txt")).body).toContain(
        "> Acme makes rockets.\n\nAsk us about rockets.\n\\# Not a heading\n"
      );

      await switches(t, {
        llmsTxt: true,
        llmsFullTxt: true,
        llmsIntro: "Ask us about rockets.",
      });
      const full = await rootFile("llms-full.txt");
      expect(full.status).toBe(200);
      expect(full.type).toBe("text/plain; charset=utf-8");
      expect(
        full.body.startsWith(
          "# Acme\n\n> Acme makes rockets.\n\nAsk us about rockets.\n\n---\n\n"
        )
      ).toBe(true);
      expect(full.body).toContain(
        `# Post hello | Acme\n\nSource: ${SITE}/blog/hello\n\nA short hello.\n\nRockets go up.`
      );
      // What the public may not read is named by its address alone.
      expect(full.body).toContain(`Source: ${SITE}/members/plans`);
      expect(full.body).not.toContain("Secret plans");
      expect(full.body).not.toContain("Staff only.");
      expect(full.body).not.toContain("Not yet.");
      // llms.txt points to it.
      expect((await rootFile("llms.txt")).body).toContain(
        `[llms-full.txt](${SITE}/llms-full.txt)`
      );

      // Not without llms.txt, though its own switch is on.
      await switches(t, { llmsTxt: false, llmsFullTxt: true });
      expect((await rootFile("llms-full.txt")).status).toBe(404);
    });

    it("builds no page's words past where llms-full.txt stops short", async () => {
      const t = await boot(dialect);
      for (const n of [1, 2, 3, 4, 5, 6]) {
        await post(t, `long-${n}`, "published", {
          body: body(paragraph(words("Rockets go up. ".repeat(20).trim()))),
        });
      }
      await switches(t, { llmsTxt: true, llmsFullTxt: true });
      if (seoContext === undefined) throw new Error("no SEO plugin context");
      const readRules: ReadRules = (ctx, locale) => readSeoRules(ctx, locale);
      const rules = await readRules(seoContext, undefined);

      // A budget that holds a page or two of the six: the file stops short.
      copies.built = 0;
      const cut = await llmsFullTxtOf(
        seoContext,
        SITE,
        { readRules },
        rules,
        1024
      );
      expect(cut).toContain(
        `The rest of the site's pages are listed in [llms.txt](${SITE}/llms.txt).`
      );
      const held = (cut ?? "").match(/^Source: /gm)?.length ?? 0;
      // Each page the file holds is built, and the one found not to fit,
      // but none after it.
      expect(copies.built).toBeLessThanOrEqual(held + 1);

      // The control: with room for every page, every readable page is
      // built, more than the cut file built.
      copies.built = 0;
      const whole = await llmsFullTxtOf(seoContext, SITE, { readRules }, rules);
      expect(whole).not.toContain("The rest of the site's pages");
      expect(copies.built).toBeGreaterThan(held + 1);
    });

    it("tells the public nothing it may not read, in llms.txt or a copy's heading", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "members",
        data: {
          title: "Secret plans",
          slug: "plans",
          status: "published",
          seo: { metaDescription: "Hidden words" },
        },
      });
      await t.nextly.create({
        collection: "guides",
        data: {
          title: "Secret title",
          slug: "start",
          excerpt: "Open words.",
          status: "published",
        },
      });
      await switches(t, { llmsTxt: true, plainTextCopies: true });

      const file = (await rootFile("llms.txt")).body;
      // Listed by address, as the sitemap lists them, and nothing more.
      expect(file).toContain(`(${SITE}/members/plans)`);
      expect(file).not.toContain("Secret plans");
      expect(file).not.toContain("Hidden words");
      expect(file).not.toContain("Secret title");
      const copy = await ask("/guides/start.md");
      expect(copy.body).toContain("Open words.");
      expect(copy.body).not.toContain("Secret title");
    });
  }
);
