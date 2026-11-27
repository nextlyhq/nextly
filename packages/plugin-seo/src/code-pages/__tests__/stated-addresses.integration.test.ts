/**
 * Pages built in code a site states in the plugin's `codeAddresses`, on
 * every configured dialect:
 *
 * - a route with no `generateStaticParams`, whose pages render on demand,
 *   is listed in the sitemap from the params the site states, without any
 *   of its pages having rendered, and params missing a part list nothing;
 * - a page built in code is copied from the Markdown the site states for
 *   its route, with the plugin's front matter, and never rendered to make
 *   it, whether the build or the options named the page.
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
import { createDynamicHandlers, createNextlyProxy } from "nextly/runtime";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { seoMetadata } from "../metadata";

const SITE = "https://acme.example";

/**
 * A production build of a site whose product pages render on demand, with
 * no `generateStaticParams`, and whose docs the build rendered; shipped
 * without its prerender manifest.
 */
const BUILD = mkdtempSync(join(tmpdir(), "seo-stated-"));
mkdirSync(join(BUILD, "server"), { recursive: true });
writeFileSync(
  join(BUILD, "server/app-paths-manifest.json"),
  JSON.stringify({
    "/(site)/products/[slug]/page": "app/(site)/products/[slug]/page.js",
    "/docs/[[...slug]]/page": "app/docs/[[...slug]]/page.js",
  })
);
writeFileSync(join(BUILD, "BUILD_ID"), "stated-build\n");

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  delete process.env.NEXT_PHASE;
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(BUILD, { recursive: true, force: true });
});

/** The site booted with its products and docs stated in the options. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    plugins: [
      seoPlugin({
        collections: [],
        baseUrl: SITE,
        nextBuildDir: BUILD,
        codeAddresses: {
          // The last names no slug: it lists no page.
          "/products/[slug]": async () => [
            { slug: "anvil" },
            { slug: "rocket skates" },
            {},
          ],
          "/docs/[[...slug]]": {
            markdown: ({ params }) =>
              `# ${[params.slug ?? []].flat().join(" / ") || "Docs"}\n\nWritten for readers.`,
          },
        },
      }),
    ],
  });
  await lastCatchUp();
  await current.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: {
      _overwrite: true,
      siteName: "Acme",
      productionAddresses: [SITE],
      plainTextCopies: true,
      llmsTxt: true,
    },
  });
  return current;
}

/** The sitemap's addresses. */
async function listed(): Promise<string[]> {
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/sitemap.xml`),
    { params: Promise.resolve({ params: ["sitemap.xml"] }) }
  );
  const body = await response.text();
  return [...body.matchAll(/<url><loc>([^<]*)<\/loc>/g)].map(
    match => match[1] ?? ""
  );
}

/** The site's Proxy, as an app wires it. */
const proxy = createNextlyProxy({} as SanitizedNextlyConfig, {
  start: async () => undefined,
  next: () => () => new Response("the page", { status: 200 }),
});

async function ask(path: string) {
  const response = await proxy(new Request(`${SITE}${path}`));
  return {
    type: response?.headers.get("content-type") ?? null,
    body: (await response?.text()) ?? "",
  };
}

describe.each(getConfiguredTestDialects())(
  "pages stated in codeAddresses (%s)",
  dialect => {
    it("lists a route's pages from the params the options state, none of them rendered", async () => {
      await boot(dialect);

      const products = (await listed()).filter(loc =>
        loc.startsWith(`${SITE}/products`)
      );

      expect(products.sort()).toEqual([
        `${SITE}/products/anvil`,
        `${SITE}/products/rocket%20skates`,
      ]);
    });

    it("copies a page built in code from the Markdown its route's options give, never rendering it", async () => {
      await boot(dialect);
      // The build rendered the docs page, recording it.
      process.env.NEXT_PHASE = "phase-production-build";
      await seoMetadata("/docs/guides/start", {
        metadata: { title: "Start here", description: "The first steps." },
      });
      delete process.env.NEXT_PHASE;
      // The page as its server renders it, which a copy must not be made from.
      const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<main><p>Rendered</p></main>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      );

      const copy = await ask("/docs/guides/start.md");

      expect(copy.type).toBe("text/markdown; charset=utf-8");
      expect(copy.body).toMatch(/^---\ntitle: "Start here[^"]*"\n/);
      expect(copy.body).toContain(`\nurl: ${SITE}/docs/guides/start\n`);
      expect(copy.body).toContain(
        "---\n\n# guides / start\n\nWritten for readers.\n"
      );
      expect(fetched).not.toHaveBeenCalled();
      // llms.txt links the copy, as it links every copied page.
      const llms = await (
        await createDynamicHandlers().GET(
          new Request(`${SITE}/admin/api/llms.txt`),
          { params: Promise.resolve({ params: ["llms.txt"] }) }
        )
      ).text();
      expect(llms).toContain(`(${SITE}/docs/guides/start.md)`);
    });
  }
);
