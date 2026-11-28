/**
 * How the site shapes its files for AI tools, on every configured dialect:
 * llms.txt's sections renamed, ordered, merged, left out or listed under
 * "Optional", the site's own sections of links, the fields left out of
 * copies, what llms-full.txt holds and where it stops, and a folder's own
 * llms files; all read from the SEO settings' `aiFiles`.
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
import { defineCollection, defineSingle, richText, text } from "nextly";
import { createDynamicHandlers, createNextlyProxy } from "nextly/runtime";
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import {
  pageRefKey,
  problemList,
  type ProblemChecks,
} from "../../problems/check";
import type { Reader } from "../../problems/reader";
import type { ReadRules } from "../../resolver/provider";
import { aiFilesPreview } from "../../settings/ai-files-route";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { readSeoRules } from "../../settings/rules";
import { structuredDataFromSettings } from "../../settings/structured-data-rules";
import { noSocialCardRules } from "../../social/card";
import { rulesFromOptions } from "../../structured-data/rules";
import { llmsFullTxtOf } from "../ai-outputs";
import { fullFileCuts } from "../full-file-cut";

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

/** The SEO plugin, keeping the context it starts with. */
function seoKeepingContext(): ReturnType<typeof seoPlugin> {
  const plugin = seoPlugin({
    collections: ["posts", "docs"],
    singles: ["home", "about"],
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
    seedPublic: true,
    plugins: [seoKeepingContext()],
    collections: [
      defineCollection({
        slug: "posts",
        labels: { singular: "Blog post", plural: "Blog posts" },
        status: true,
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          richText({ name: "body" }),
          // Left out of every copy by the site's code.
          text({ name: "buttonLabel", custom: { seo: { copy: false } } }),
          // Left out by the settings, in the test that chooses so.
          text({ name: "aside" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
      defineCollection({
        slug: "docs",
        labels: { singular: "Doc", plural: "Docs" },
        status: true,
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          richText({ name: "body" }),
        ],
        publicAddress: "/docs/{slug}",
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        access: open,
        fields: [text({ name: "title" })],
        publicAddress: "/",
      }),
      defineSingle({
        slug: "about",
        access: open,
        fields: [text({ name: "title" })],
        publicAddress: "/about",
      }),
    ],
  });
  await lastCatchUp();
  return current;
}

/** A root file, or a folder's (`docs/llms.txt`), as the site's rewrite reaches the handler with it. */
async function rootFile(file: string) {
  const parts = file.includes("/")
    ? ["llms-files", ...file.split("/")]
    : [file];
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/${parts.join("/")}`),
    { params: Promise.resolve({ params: parts }) }
  );
  return { status: response.status, body: await response.text() };
}

/** The `<loc>` of every page the sitemap lists. */
async function sitemapLocs(): Promise<string[]> {
  const { body: xml } = await rootFile("sitemap.xml");
  return [...xml.matchAll(/<url><loc>([^<]*)<\/loc>/g)].map(m => m[1] ?? "");
}

/** The site's Proxy, as an app wires it. */
const proxy = createNextlyProxy({} as SanitizedNextlyConfig, {
  start: async () => undefined,
  next: () => () => new Response("the page", { status: 200 }),
});

/** A page's plain-text copy, as the Proxy serves it. */
async function copyAt(path: string): Promise<string> {
  const response = await proxy(new Request(`${SITE}${path}`));
  return (await response?.text()) ?? "";
}

/** The addresses a section of a file links, in order. */
function linksUnder(file: string, heading: string): string[] {
  const section = file
    .split(/^## /m)
    .find(part => part.startsWith(`${heading}\n`));
  return [...(section ?? "").matchAll(/^- \[[^\]]*\]\(([^)]*)\)/gm)].map(
    m => m[1] ?? ""
  );
}

/** The problem list's checks, for this site's types. */
const CHECKS: ProblemChecks = {
  targets: ["posts", "docs"],
  singles: ["home", "about"],
  readers: {
    readRules: readSeoRules,
    readStructuredDataRules: structuredDataFromSettings(
      rulesFromOptions(undefined, undefined)
    ),
    readSocialCardRules: noSocialCardRules,
  },
};

/** A reader who may read every page and type. */
const everything: Reader = {
  pages: async pages => new Set(pages.map(pageRefKey)),
  readsType: () => true,
  seesRedirects: true,
  count: async () => 0,
};

/** The llms-full.txt files the problem list says stopped short. */
async function cutsListed(): Promise<string[]> {
  if (seoContext === undefined) throw new Error("no SEO plugin context");
  const { problems } = await problemList(seoContext, CHECKS, everything);
  return problems
    .filter(problem => problem.kind === "llmsFullCut")
    .map(problem => problem.subject.label);
}

/** The `## ` headings of a file, in order. */
const headings = (file: string): string[] =>
  [...file.matchAll(/^## (.*)$/gm)].map(m => m[1] ?? "");

async function settings(t: TestNextly, data: Record<string, unknown>) {
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: {
      _overwrite: true,
      siteName: "Acme",
      description: "Acme makes rockets.",
      llmsTxt: true,
      ...data,
    },
  });
}

async function page(
  t: TestNextly,
  collection: "posts" | "docs",
  slug: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await t.nextly.create({
    collection,
    data: {
      title: `${collection} ${slug}`,
      slug,
      status: "published",
      ...extra,
    },
  });
}

async function singles(t: TestNextly): Promise<void> {
  await t.nextly.updateSingle({
    slug: "home",
    data: { _overwrite: true, title: "Welcome" },
  });
  await t.nextly.updateSingle({
    slug: "about",
    data: { _overwrite: true, title: "About us" },
  });
}

describe.each(getConfiguredTestDialects())(
  "the shape of the files for AI tools (%s)",
  dialect => {
    it("lists sections in the chosen order and names, merges two given one heading, writes Optional last, and leaves a left-out section out of both files but in the sitemap", async () => {
      const t = await boot(dialect);
      await page(t, "posts", "hello");
      await page(t, "docs", "start");
      await singles(t);
      await settings(t, {
        llmsFullTxt: true,
        aiFiles: {
          groups: [
            { key: "docs", heading: "Guides" },
            // The About page joins the blog under one heading.
            { key: "single:about", heading: "Writing" },
            { key: "posts", heading: "Writing" },
            { key: "single:home", optional: true },
          ],
        },
      });
      const file = (await rootFile("llms.txt")).body;
      expect(headings(file)).toEqual(["Guides", "Writing", "Optional"]);
      expect(linksUnder(file, "Writing")).toEqual([
        `${SITE}/about`,
        `${SITE}/blog/hello`,
      ]);
      expect(linksUnder(file, "Optional")).toEqual([`${SITE}/`]);
      expect(linksUnder(file, "Guides")).toEqual([`${SITE}/docs/start`]);

      // Left out: in neither llms file, still in the sitemap.
      await settings(t, {
        llmsFullTxt: true,
        aiFiles: { groups: [{ key: "posts", leftOut: true }] },
      });
      const without = (await rootFile("llms.txt")).body;
      expect(without).not.toContain(`${SITE}/blog/hello`);
      expect(without).toContain(`${SITE}/docs/start`);
      expect((await rootFile("llms-full.txt")).body).not.toContain(
        `${SITE}/blog/hello`
      );
      expect(await sitemapLocs()).toContain(`${SITE}/blog/hello`);
    });

    it("adds the site's own sections of links after the pages', one with a page section's heading joining it", async () => {
      const t = await boot(dialect);
      await page(t, "docs", "start");
      await settings(t, {
        aiFiles: {
          extraSections: [
            {
              heading: "Docs",
              links: "- [API reference](/api): Every endpoint",
            },
            {
              heading: "Elsewhere",
              links: "- [Status](https://status.acme.example)",
            },
          ],
        },
      });
      const file = (await rootFile("llms.txt")).body;
      expect(linksUnder(file, "Docs")).toEqual([
        `${SITE}/docs/start`,
        `${SITE}/api`,
      ]);
      expect(file).toContain(`- [API reference](${SITE}/api): Every endpoint`);
      expect(linksUnder(file, "Elsewhere")).toEqual([
        "https://status.acme.example/",
      ]);
      expect(headings(file).indexOf("Elsewhere")).toBeGreaterThan(
        headings(file).indexOf("Docs")
      );
    });

    it("refuses choices that are not links and plain words, and a size it does not offer", async () => {
      const t = await boot(dialect);
      await expect(
        settings(t, {
          aiFiles: {
            extraSections: [{ heading: "Docs", links: "<b>not a link</b>" }],
          },
        })
      ).rejects.toThrow();
      await expect(
        settings(t, { aiFiles: { fullMaxMegabytes: 9 } })
      ).rejects.toThrow();
    });

    it("leaves out of copies and llms-full.txt the fields the site's code and its settings leave out", async () => {
      const t = await boot(dialect);
      await page(t, "posts", "hello", {
        body: body(paragraph(words("Rockets go up."))),
        buttonLabel: "Buy now",
        aside: "A side note.",
      });
      await settings(t, { llmsFullTxt: true, plainTextCopies: true });
      const before = await copyAt("/blog/hello.md");
      expect(before).toContain("Rockets go up.");
      // The site's code leaves this one out, whatever the settings say.
      expect(before).not.toContain("Buy now");
      expect(before).toContain("A side note.");

      await settings(t, {
        llmsFullTxt: true,
        plainTextCopies: true,
        aiFiles: { copyLeftOut: { posts: ["aside"] } },
      });
      const copy = await copyAt("/blog/hello.md");
      expect(copy).toContain("Rockets go up.");
      expect(copy).not.toContain("A side note.");
      const full = (await rootFile("llms-full.txt")).body;
      expect(full).toContain("Rockets go up.");
      expect(full).not.toContain("A side note.");
      expect(full).not.toContain("Buy now");
    });

    it("never brings back from the rendered page the words the site left out of a copy", async () => {
      const t = await boot(dialect);
      await page(t, "posts", "hello", {
        body: body(paragraph(words("Rockets go up."))),
        aside: "A side note.",
        seo: { metaDescription: "A short hello." },
      });
      // Pages may be rendered: the site names its production address.
      await settings(t, {
        llmsFullTxt: true,
        plainTextCopies: true,
        productionAddresses: [SITE],
        aiFiles: { copyLeftOut: { posts: ["body", "aside"] } },
      });
      // The rendered page shows the words left out.
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(
            "<!doctype html><html><body><main><h1>posts hello</h1><p>Rockets go up.</p><p>A side note.</p></main></body></html>",
            { headers: { "content-type": "text/html; charset=utf-8" } }
          )
      );
      try {
        const copy = await copyAt("/blog/hello.md");
        expect(copy).not.toContain("Rockets go up.");
        expect(copy).not.toContain("A side note.");
        // Its description stands in, as for any page without words.
        expect(copy).toContain("A short hello.");
        const full = (await rootFile("llms-full.txt")).body;
        expect(full).toContain(`Source: ${SITE}/blog/hello`);
        expect(full).not.toContain("Rockets go up.");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("holds in llms-full.txt only the pages its settings choose: addresses under /docs/, or chosen sections", async () => {
      const t = await boot(dialect);
      await page(t, "posts", "hello");
      await page(t, "docs", "start");
      await singles(t);
      await settings(t, {
        llmsFullTxt: true,
        aiFiles: {
          fullContents: { include: "addresses", prefixes: ["/docs/"] },
        },
      });
      const docsOnly = (await rootFile("llms-full.txt")).body;
      expect([...docsOnly.matchAll(/^Source: (.*)$/gm)].map(m => m[1])).toEqual(
        [`${SITE}/docs/start`]
      );
      // llms.txt still lists every page.
      expect((await rootFile("llms.txt")).body).toContain(`${SITE}/blog/hello`);

      await settings(t, {
        llmsFullTxt: true,
        aiFiles: { fullContents: { include: "groups", groups: ["posts"] } },
      });
      const postsOnly = (await rootFile("llms-full.txt")).body;
      expect(
        [...postsOnly.matchAll(/^Source: (.*)$/gm)].map(m => m[1])
      ).toEqual([`${SITE}/blog/hello`]);
    });

    it("serves a folder's own llms.txt and llms-full.txt with only its pages, linked from the site's llms.txt, and no other folder's", async () => {
      const t = await boot(dialect);
      await page(t, "posts", "hello");
      await page(t, "docs", "start");
      await page(t, "docs", "install");
      await settings(t, { llmsFullTxt: true });
      expect((await rootFile("docs/llms.txt")).status).toBe(404);

      await settings(t, {
        llmsFullTxt: true,
        aiFiles: { folderFiles: ["docs"] },
      });
      const list = await rootFile("docs/llms.txt");
      expect(list.status).toBe(200);
      expect(
        list.body.startsWith("# Acme: Docs\n\n> Acme makes rockets.\n")
      ).toBe(true);
      expect(list.body).toContain(`${SITE}/docs/start`);
      expect(list.body).toContain(`${SITE}/docs/install`);
      expect(list.body).not.toContain(`${SITE}/blog/hello`);
      expect(list.body).toContain(
        `All of it in one file: [llms-full.txt](${SITE}/docs/llms-full.txt).`
      );
      const full = (await rootFile("docs/llms-full.txt")).body;
      expect(full).toContain(`Source: ${SITE}/docs/start`);
      expect(full).not.toContain(`Source: ${SITE}/blog/hello`);
      expect((await rootFile("llms.txt")).body).toContain(
        `Parts of the site with an llms.txt of their own: [Docs](${SITE}/docs/llms.txt).`
      );
      expect((await rootFile("blog/llms.txt")).status).toBe(404);

      // A folder's llms-full.txt only beside the site's.
      await settings(t, {
        llmsFullTxt: false,
        aiFiles: { folderFiles: ["docs"] },
      });
      expect((await rootFile("docs/llms-full.txt")).status).toBe(404);
    });

    it("notes an llms-full.txt that stops short for the problem list, and takes the note off once it fits", async () => {
      const t = await boot(dialect);
      for (const n of [1, 2, 3, 4]) {
        await page(t, "posts", `long-${n}`, {
          body: body(paragraph(words("Rockets go up. ".repeat(20).trim()))),
        });
      }
      await settings(t, { llmsFullTxt: true });
      if (seoContext === undefined) throw new Error("no SEO plugin context");
      const readRules: ReadRules = (ctx, locale) => readSeoRules(ctx, locale);
      const rules = await readRules(seoContext, undefined);

      // The site's configured origin, as the plugin's own reads have it.
      const outputs = { readRules, origin: SITE };

      // A host a request named is never noted: it could be any host.
      await llmsFullTxtOf(
        seoContext,
        "https://elsewhere.example",
        outputs,
        rules,
        1024
      );
      expect(await fullFileCuts(seoContext)).toEqual([]);

      await llmsFullTxtOf(seoContext, SITE, outputs, rules, 1024);
      const [cut, ...others] = await fullFileCuts(seoContext);
      expect(others).toEqual([]);
      expect(cut?.file).toBe(`${SITE}/llms-full.txt`);
      expect(cut?.limit).toBe(1024);
      expect(cut?.leftOut).toBeGreaterThan(0);
      expect(await cutsListed()).toEqual([`${SITE}/llms-full.txt`]);

      // Once the site names other production addresses, a file at this
      // origin is not one it serves, and the list drops it.
      await settings(t, {
        llmsFullTxt: true,
        productionAddresses: ["https://www.acme.example"],
      });
      expect(await cutsListed()).toEqual([]);

      await settings(t, { llmsFullTxt: true, productionAddresses: [] });
      await llmsFullTxtOf(seoContext, SITE, outputs, rules, 1024);
      expect(await fullFileCuts(seoContext)).toHaveLength(1);
      await llmsFullTxtOf(seoContext, SITE, outputs, rules);
      expect(await fullFileCuts(seoContext)).toEqual([]);
    });

    it("previews llms.txt with the choices being edited, before they are saved or llms.txt is on, with every group", async () => {
      const t = await boot(dialect);
      await page(t, "posts", "hello");
      await page(t, "docs", "start");
      await settings(t, { llmsTxt: false });
      if (seoContext === undefined) throw new Error("no SEO plugin context");
      const readRules: ReadRules = (ctx, locale) => readSeoRules(ctx, locale);

      const preview = await aiFilesPreview(
        seoContext,
        SITE,
        {
          groups: [
            { key: "posts", heading: "Writing" },
            { key: "docs", leftOut: true },
          ],
        },
        { readRules }
      );
      expect(headings(preview.preview)).toContain("Writing");
      expect(preview.preview).not.toContain(`${SITE}/docs/start`);
      // Every group is offered, the one left out too, by its own heading.
      expect(preview.groups).toEqual(
        expect.arrayContaining([
          { key: "posts", defaultHeading: "Blog posts", pages: 1 },
          { key: "docs", defaultHeading: "Docs", pages: 1 },
        ])
      );
      // Nothing was saved.
      expect((await rootFile("llms.txt")).status).toBe(404);
    });
  }
);
