/**
 * Pages with no entry behind them, on every configured dialect: a page built
 * in code that calls `seoMetadata` for its address is served what a person
 * set for that address, through the same order of who wins as every page;
 * the Pages and addresses list names every public address the site knows
 * of, from its entries, its static routes and the addresses a dynamic route
 * declared, marking a route that does not call the function; and the
 * sitemap lists a connected page that search engines may index.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { seoPlugin } from "../../plugin";
import type { SiteAddress } from "../contract";
import { seoMetadata } from "../metadata";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const PAGES = "seocp_pages";
const LOCALIZED = "seocp_localized";
const SITE = "https://acme.example";
const PLUGIN = "@nextlyhq/plugin-seo";
const CSRF = "c".repeat(64);

/**
 * A production build of a site with three pages built in code and a route
 * declaring two more, besides the content route serving its entries.
 */
const BUILD = mkdtempSync(join(tmpdir(), "seo-code-pages-"));
mkdirSync(join(BUILD, "server"), { recursive: true });
writeFileSync(
  join(BUILD, "server/app-paths-manifest.json"),
  JSON.stringify({
    "/(site)/pricing/page": "app/(site)/pricing/page.js",
    "/(site)/contact/page": "app/(site)/contact/page.js",
    "/(site)/thank-you/page": "app/(site)/thank-you/page.js",
    "/(site)/integrations/[name]/page":
      "app/(site)/integrations/[name]/page.js",
    "/(site)/[...slug]/page": "app/(site)/[...slug]/page.js",
    "/admin/[[...params]]/page": "app/admin/[[...params]]/page.js",
  })
);
writeFileSync(
  join(BUILD, "prerender-manifest.json"),
  JSON.stringify({
    version: 4,
    routes: {
      "/pricing": { srcRoute: "/pricing" },
      "/integrations/wordpress": { srcRoute: "/integrations/[name]" },
      "/integrations/webflow": { srcRoute: "/integrations/[name]" },
      "/about": { srcRoute: "/[...slug]" },
    },
  })
);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  delete process.env.NEXT_PHASE;
});

afterAll(() => {
  rmSync(BUILD, { recursive: true, force: true });
});

/** A signed-in person holding exactly `permissions`, or every one. */
async function personWith(
  t: TestNextly,
  name: string,
  permissions: readonly string[] | "all"
): Promise<string> {
  const stored = await t.nextly.permissions.find({ limit: 1000 });
  const ids =
    permissions === "all"
      ? []
      : permissions.map(slug => {
          const found = stored.items.find(p => p.slug === slug);
          if (found === undefined) throw new Error(`no permission ${slug}`);
          return String(found.id);
        });
  const roles =
    ids.length === 0
      ? []
      : [
          String(
            (
              await t.nextly.roles.create({
                data: { name, slug: `seocp-${name}`, permissionIds: ids },
              })
            ).item.id
          ),
        ];
  const created = await t.nextly.users.create({
    email: `${name}@example.com`,
    password: "Password123!",
    data: { name, isActive: true, roles },
  });
  const token = await signAccessToken(
    buildClaims({
      userId: String(created.item.id),
      email: `${name}@example.com`,
      name,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** The addresses the screen lists, as `cookie`. */
async function addressesFor(cookie: string) {
  const segments = ["plugins", ...PLUGIN.split("/"), "pages"];
  const res = await createDynamicHandlers().GET(
    new Request(`${SITE}/api/${segments.join("/")}`, {
      headers: { cookie },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  if (!res.ok) return { status: res.status, items: undefined };
  const body = (await res.json()) as { items: SiteAddress[] };
  return { status: res.status, items: body.items };
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

describe.each(getConfiguredTestDialects())(
  "pages with no entry (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      current = await createTestNextly({
        dialect,
        plugins: [
          seoPlugin({
            collections: [PAGES],
            baseUrl: SITE,
            nextBuildDir: BUILD,
          }),
        ],
        collections: [
          defineCollection({
            slug: PAGES,
            labels: { singular: "Page", plural: "Pages" },
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/{slug}",
          }),
        ],
      });
      await lastCatchUp();
      await current.nextly.create({
        collection: PAGES,
        data: { title: "About us", slug: "about", status: "published" },
      });
      return current;
    }

    /** Saves `body` for a page with no entry, as `cookie`. */
    async function save(cookie: string, body: Record<string, unknown>) {
      const segments = ["plugins", ...PLUGIN.split("/"), "pages", "seo"];
      const res = await createDynamicHandlers().POST(
        new Request(`${SITE}/api/${segments.join("/")}`, {
          method: "POST",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: SITE,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: segments }) }
      );
      return res.status;
    }

    const typed = (path: string, values: Record<string, unknown> = {}) => ({
      path,
      title: "",
      description: "",
      hidden: false,
      ...values,
    });

    it("serves what a person set for the address over the route's code, field by field, at the page's own address", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      const code = {
        metadata: {
          title: "Pricing in code",
          description: "Plans, described in code.",
          keywords: ["plans"],
        },
      };

      const before = await seoMetadata("/pricing", code);
      expect(before.title).toBe("Pricing in code");
      expect(before.description).toBe("Plans, described in code.");
      expect(before.alternates?.canonical).toBe("/pricing");
      expect(before.robots).toMatchObject({ index: true });

      expect(
        await save(owner, typed("/pricing", { title: "Plans and prices" }))
      ).toBe(200);
      const after = await seoMetadata("/pricing", code);

      expect(after.title).toBe("Plans and prices");
      expect(after.description).toBe("Plans, described in code.");
      expect(after.alternates?.canonical).toBe("/pricing");
      // What the answer does not speak to stays as the route set it.
      expect(after.keywords).toEqual(["plans"]);
    });

    it("hides a page from search only as the screen says, whatever its code says", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      const code = { metadata: { robots: { index: false, follow: false } } };

      expect((await seoMetadata("/contact", code)).robots).toMatchObject({
        index: true,
      });

      await save(owner, typed("/contact", { hidden: true }));

      expect((await seoMetadata("/contact", code)).robots).toMatchObject({
        index: false,
      });
    });

    it("titles a page with nothing set by the site's pattern and the page's name", async () => {
      const t = await boot();
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: { _overwrite: true, siteName: "Acme" },
      });

      expect((await seoMetadata("/thank-you")).title).toBe("Thank you | Acme");
      expect((await seoMetadata("/thank-you", { name: "Thanks" })).title).toBe(
        "Thanks | Acme"
      );
    });

    it("lists every public address, marking the routes that do not call the function", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      await seoMetadata("/contact", { metadata: { title: "Contact us" } });
      await seoMetadata("/integrations/webflow", {
        metadata: {
          openGraph: {
            images: [{ url: "https://cdn.example/webflow.png", width: 1200 }],
          },
        },
      });

      const { status, items } = await addressesFor(owner);

      expect(status).toBe(200);
      expect(
        items?.map(({ path, source, from, standing }) => ({
          path,
          source,
          from,
          standing,
        }))
      ).toEqual([
        { path: "/about", source: "entry", from: "Pages", standing: "listed" },
        {
          path: "/contact",
          source: "built",
          from: "app/(site)/contact/page",
          standing: "listed",
        },
        {
          path: "/integrations/webflow",
          source: "dynamic",
          from: "app/(site)/integrations/[name]/page",
          standing: "listed",
        },
        {
          path: "/integrations/wordpress",
          source: "dynamic",
          from: "app/(site)/integrations/[name]/page",
          standing: "not-connected",
        },
        {
          path: "/pricing",
          source: "built",
          from: "app/(site)/pricing/page",
          standing: "not-connected",
        },
        {
          path: "/thank-you",
          source: "built",
          from: "app/(site)/thank-you/page",
          standing: "not-connected",
        },
      ]);
      const contact = items?.find(item => item.path === "/contact");
      expect(contact?.title).toBe("Contact us");
      expect(contact?.canonical).toBe(`${SITE}/contact`);
      expect(contact?.seo?.automatic.title).toEqual({
        value: "Contact us",
        from: "code",
      });
      // The share image the route's code gave, as the page's head serves it.
      expect(
        items?.find(item => item.path === "/integrations/webflow")?.seo?.image
      ).toEqual({
        url: "https://cdn.example/webflow.png",
        width: 1200,
        from: "code",
      });
      // The image the page falls back to without one chosen: the same.
      expect(
        items?.find(item => item.path === "/integrations/webflow")?.seo
          ?.automatic.image
      ).toEqual({
        url: "https://cdn.example/webflow.png",
        width: 1200,
        from: "code",
      });
      expect(items?.find(item => item.path === "/about")?.entry).toMatchObject({
        kind: "collection",
        slug: PAGES,
      });
    });

    it("records nothing for an address the site does not know of, but does while the site is built", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");

      await seoMetadata("/made-up");
      expect(
        (await t.nextly.find({ collection: "nx_seo_code_pages" })).items
      ).toEqual([]);

      process.env.NEXT_PHASE = "phase-production-build";
      await seoMetadata("/thank-you");

      const { items } = await addressesFor(owner);
      expect(items?.find(item => item.path === "/thank-you")?.standing).toBe(
        "listed"
      );
    });

    it("saves only a page built in code, and only for whoever may change the SEO settings", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      const reader = await personWith(t, "reader", [
        `read-${SEO_SETTINGS_SLUG}`,
      ]);

      // An entry's SEO is set on the entry; an address no route serves has
      // none to set.
      expect(await save(owner, typed("/about", { title: "No" }))).toBe(400);
      expect(await save(owner, typed("/nowhere", { title: "No" }))).toBe(400);
      expect(await save(owner, { path: "/pricing" })).toBe(400);
      expect(await save(reader, typed("/pricing", { title: "No" }))).toBe(403);
      expect((await addressesFor(reader)).status).toBe(200);

      expect(
        (await seoMetadata("/pricing", { metadata: { title: "Pricing" } }))
          .title
      ).toBe("Pricing");
    });

    it("lists a connected page in the sitemap, and leaves out one hidden or not connected", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      await seoMetadata("/contact");
      await seoMetadata("/thank-you");
      await save(owner, typed("/thank-you", { hidden: true }));

      const locs = await listed();

      expect(locs).toContain(`${SITE}/about`);
      expect(locs).toContain(`${SITE}/contact`);
      expect(locs).not.toContain(`${SITE}/thank-you`);
      expect(locs).not.toContain(`${SITE}/pricing`);
    });

    it("leaves an address an entry holds to the entry, hidden from search or not", async () => {
      const t = await boot();
      const owner = await personWith(t, "owner", "all");
      await t.nextly.create({
        collection: PAGES,
        data: {
          title: "Pricing page",
          slug: "pricing",
          status: "published",
          seo: { noindex: true },
        },
      });
      // The build rendered the route at the same address, and it called.
      process.env.NEXT_PHASE = "phase-production-build";
      await seoMetadata("/pricing");

      expect(await listed()).not.toContain(`${SITE}/pricing`);
      const { items } = await addressesFor(owner);
      expect(
        items
          ?.filter(item => item.path === "/pricing")
          .map(({ source, standing }) => ({ source, standing }))
      ).toEqual([{ source: "entry", standing: "hidden" }]);
    });
  }
);

/**
 * A site in English and German, each language under its own prefix, whose
 * catch-all route declared each page's address in each language.
 */
const LANGUAGE_BUILD = mkdtempSync(join(tmpdir(), "seo-code-pages-de-"));
mkdirSync(join(LANGUAGE_BUILD, "server"), { recursive: true });
writeFileSync(
  join(LANGUAGE_BUILD, "server/app-paths-manifest.json"),
  JSON.stringify({
    "/[locale]/[...slug]/page": "app/[locale]/[...slug]/page.js",
    "/(site)/pricing/page": "app/(site)/pricing/page.js",
  })
);
writeFileSync(
  join(LANGUAGE_BUILD, "prerender-manifest.json"),
  JSON.stringify({
    version: 4,
    routes: {
      "/en/about": { srcRoute: "/[locale]/[...slug]" },
      "/de/pricing": { srcRoute: "/[locale]/[...slug]" },
    },
  })
);

afterAll(() => {
  rmSync(LANGUAGE_BUILD, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "pages with no entry on a site in several languages (%s)",
  (dialect: TestDialect) => {
    it("lists each published translation as its entry, in its language, and leaves a page built in code at another language's path its own", async () => {
      const t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        languageAddresses: { by: "prefix" },
        plugins: [
          seoPlugin({
            collections: [LOCALIZED],
            baseUrl: SITE,
            nextBuildDir: LANGUAGE_BUILD,
          }),
        ],
        collections: [
          defineCollection({
            slug: LOCALIZED,
            localized: true,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "slug", localized: true }),
              text({ name: "title", localized: true }),
            ],
            publicAddress: "/{slug}",
          }),
        ],
      });
      current = t;
      const about = await t.nextly.create({
        collection: LOCALIZED,
        locale: "en",
        data: { slug: "about", title: "About us", status: "published" },
      });
      await t.nextly.update({
        collection: LOCALIZED,
        id: String(about.item.id),
        locale: "de",
        data: {
          slug: "pricing",
          title: "Über uns",
          status: "published",
          _overwrite: true,
        },
      });
      await lastCatchUp();
      const owner = await personWith(t, "owner", "all");

      // The page built in code at the root's /pricing, which the German
      // translation's /de/pricing does not hold.
      process.env.NEXT_PHASE = "phase-production-build";
      await seoMetadata("/pricing");

      const { items } = await addressesFor(owner);

      expect(
        items?.map(({ path, name, source, entry }) => ({
          path,
          name,
          source,
          locale: entry?.locale,
        }))
      ).toEqual([
        {
          path: "/about",
          name: "About us",
          source: "entry",
          locale: undefined,
        },
        {
          path: "/de/pricing",
          name: "Über uns",
          source: "entry",
          locale: "de",
        },
        {
          path: "/pricing",
          name: "Pricing",
          source: "built",
          locale: undefined,
        },
      ]);
      expect(await listed()).toContain(`${SITE}/pricing`);
    });
  }
);
