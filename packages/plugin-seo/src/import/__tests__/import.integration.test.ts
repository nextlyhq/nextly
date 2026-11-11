/**
 * The import, through Nextly's own request handler, on every configured
 * dialect: a dry run and an apply of each source (an existing field group
 * shaped as Rext's `meta-data` and as nextlyhq.com's `seo` component, the
 * plugin's own group as an earlier version stored it, a Yoast and a Rank
 * Math WordPress export, Rank Math's CSV, and a Payload export).
 *
 * A dry run changes nothing. An apply writes what the dry run showed, into
 * empty places only, leaving a value the same as the automatic one
 * automatic, and refuses once anything changed since. A failure part-way
 * leaves every value as it was. Only whoever holds site-wide SEO
 * (`manage-seo`) may import.
 *
 * nextlyhq.com's component is named `seo`; a type with a field of its own
 * named `seo` cannot take the plugin's group, so here it sits under another
 * name with the same fields.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { rmdir } from "node:fs/promises";
import path from "node:path";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  checkbox,
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
  textarea,
  upload,
} from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import { REDIRECTS_SLUG } from "../../redirects/collection";
import { MANAGE_SEO_PERMISSION } from "../../permissions";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import type { DryRunBody, ImportGroupsBody, ImportSource } from "../contract";

/** Where the media library keeps uploads in a test. */
const UPLOADS = path.resolve(import.meta.dirname, "../../../public");

/** A one-pixel PNG, enough for the media library to store. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/** Rext's `meta-data` component, as its site declares it. */
const META_DATA = defineFieldGroup({
  slug: "meta-data",
  label: { singular: "Search and sharing" },
  fields: [
    text({ name: "seoTitle" }),
    textarea({ name: "seoDescription" }),
    upload({ name: "ogImage", relationTo: "media" }),
    text({ name: "ogTitle" }),
    textarea({ name: "ogDescription" }),
    text({ name: "twitterCard" }),
    text({ name: "keywords" }),
    text({ name: "robotsIndex" }),
  ],
});

/** nextlyhq.com's `seo` component, as its site declares it. */
const PAGE_SEO = defineFieldGroup({
  slug: "page-seo",
  label: { singular: "SEO" },
  fields: [
    text({ name: "metaTitle" }),
    textarea({ name: "metaDescription" }),
    upload({ name: "ogImage", relationTo: "media" }),
    text({ name: "canonicalUrl" }),
    checkbox({ name: "noIndex", defaultValue: false }),
  ],
});

/** The slug of the post whose save is made to fail, while one is. */
let failing: string | undefined;

/** Whether adding a redirect is made to fail. */
let failingRedirect = false;

/** Fails adding a redirect while `failingRedirect` is set. */
const redirectFailure: PluginDefinition = definePlugin({
  name: "@test/failing-redirects",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.hooks.on("beforeCreate", REDIRECTS_SLUG, () => {
      if (failingRedirect) throw new Error("this redirect fails");
    });
  },
});

let current: TestNextly | undefined;
const stored: string[] = [];

afterEach(async () => {
  failing = undefined;
  failingRedirect = false;
  for (const id of stored.splice(0)) {
    await current?.nextly.media.delete({ id });
  }
  await current?.destroy();
  current = undefined;
  const month = new Date();
  for (const folder of [
    `uploads/${String(month.getFullYear())}/${String(month.getMonth() + 1).padStart(2, "0")}`,
    `uploads/${String(month.getFullYear())}`,
    "uploads",
    "",
  ]) {
    await rmdir(path.join(UPLOADS, folder)).catch(() => undefined);
  }
});

const PLUGIN = ["plugins", "@nextlyhq", "plugin-seo"];

/** One request to a plugin route through core's handler, as `key`. */
async function call(
  key: string,
  method: "GET" | "POST",
  route: string,
  body?: unknown
): Promise<Response> {
  const segments = [...PLUGIN, ...route.split("/").filter(Boolean)];
  const handlers = createDynamicHandlers();
  const request = new Request(
    `https://admin.example/api/${segments.join("/")}`,
    {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
  const context = { params: Promise.resolve({ params: segments }) };
  return method === "GET"
    ? handlers.GET(request, context)
    : handlers.POST(request, context);
}

interface Staff {
  importer: string;
  editorOnly: string;
}

async function boot(
  dialect: TestDialect
): Promise<{ t: TestNextly; staff: Staff }> {
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    // Every permission the plugins declare, manage-seo among them.
    seedPublic: true,
    plugins: [
      seoPlugin({ collections: ["posts", "pages"], sitemap: false }),
      redirectFailure,
    ],
    fieldGroups: [META_DATA, PAGE_SEO],
    collections: [
      defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        status: true,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          textarea({ name: "excerpt" }),
          fieldGroup({ name: "metaData", component: "meta-data" }),
        ],
        publicAddress: "/blog/{slug}",
        hooks: {
          // A save made to fail, for a failure part-way through an import.
          beforeChange: [
            ({ data, originalData }) => {
              const slug = (originalData as { slug?: unknown } | undefined)
                ?.slug;
              if (failing !== undefined && slug === failing) {
                throw new Error("this save fails");
              }
              return data;
            },
          ],
        },
      }),
      defineCollection({
        slug: "pages",
        labels: { singular: "Page", plural: "Pages" },
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          fieldGroup({ name: "pageSeo", component: "page-seo" }),
        ],
        publicAddress: "/{slug}",
      }),
    ],
  });
  current = t;
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: {
      _overwrite: true,
      siteName: "Rext AI",
      separator: "|",
      productionAddresses: ["https://nextlyhq.com"],
    },
  });
  const owner = await t.nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  const seeded = await t.nextly.permissions.find({ limit: 500 });
  const keys = t.getService("apiKeyService") as unknown as {
    createApiKey(
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ): Promise<{ key: string }>;
  };
  async function keyHolding(slugs: string[]): Promise<string> {
    const ids = slugs.map(slug => {
      const found = seeded.items.find(item => item.slug === slug);
      if (found === undefined) throw new Error(`${slug} is not seeded`);
      return found.id;
    });
    const role = await t.nextly.roles.create({
      data: {
        name: `Role ${String(Math.random()).slice(2, 8)}`,
        slug: `r-${slugs.length}-${String(Math.random()).slice(2, 8)}`,
        permissionIds: ids,
      },
    });
    const { key } = await keys.createApiKey(String(owner.item.id), {
      name: `key ${slugs.join(" ")}`,
      tokenType: "role-based",
      roleId: String(role.item.id),
      expiresIn: "unlimited",
    });
    return key;
  }
  const content = ["read-posts", "update-posts", "read-pages", "update-pages"];
  return {
    t,
    staff: {
      importer: await keyHolding([...content, MANAGE_SEO_PERMISSION]),
      editorOnly: await keyHolding(content),
    },
  };
}

/** A post, published. */
async function post(
  t: TestNextly,
  data: Record<string, unknown>
): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { status: "published", ...data },
  });
  return String(created.item.id);
}

/** A page. */
async function page(
  t: TestNextly,
  data: Record<string, unknown>
): Promise<string> {
  const created = await t.nextly.create({ collection: "pages", data });
  return String(created.item.id);
}

/** Every page's stored `seo` group, by slug. */
async function seoBySlug(
  t: TestNextly,
  collection: "posts" | "pages"
): Promise<Record<string, Record<string, unknown>>> {
  const { items } = await t.nextly.find({
    collection,
    limit: 100,
    overrideAccess: true,
    depth: 0,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[]).map(item => [
      String(item.slug),
      (item.seo ?? {}) as Record<string, unknown>,
    ])
  );
}

/** How many redirects are stored. */
async function redirectCount(t: TestNextly): Promise<number> {
  const { items } = await t.nextly.find({
    collection: REDIRECTS_SLUG,
    limit: 100,
    overrideAccess: true,
  });
  return items.length;
}

/** A dry run of `source`, as `key`. */
async function dryRun(key: string, source: ImportSource): Promise<DryRunBody> {
  const response = await call(key, "POST", "/import/dry-run", { source });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as DryRunBody;
}

/** The apply of the dry run `plan`, as `key`. */
function apply(key: string, source: ImportSource, plan: string) {
  return call(key, "POST", "/import/apply", { source, plan });
}

/** A WordPress export of `items`, each with its stored values. */
function wordPressExport(
  items: {
    title: string;
    link: string;
    slug: string;
    meta: Record<string, string>;
    type?: string;
  }[]
): string {
  const item = (each: (typeof items)[number]) => `
    <item>
      <title><![CDATA[${each.title}]]></title>
      <link>${each.link}</link>
      <wp:post_name><![CDATA[${each.slug}]]></wp:post_name>
      <wp:status><![CDATA[publish]]></wp:status>
      <wp:post_type><![CDATA[${each.type ?? "post"}]]></wp:post_type>
      ${Object.entries(each.meta)
        .map(
          ([key, value]) =>
            `<wp:postmeta><wp:meta_key><![CDATA[${key}]]></wp:meta_key><wp:meta_value><![CDATA[${value}]]></wp:meta_value></wp:postmeta>`
        )
        .join("\n")}
    </item>`;
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Old blog</title>
    ${items.map(item).join("\n")}
  </channel>
</rss>`;
}

const META_MAP = {
  seoTitle: "title",
  seoDescription: "description",
  ogImage: "image",
  ogTitle: "socialTitle",
  ogDescription: "socialDescription",
  twitterCard: "skip",
  keywords: "skip",
  robotsIndex: "shown",
} as const;

describe.each(getConfiguredTestDialects())("the SEO import (%s)", dialect => {
  it("finds Rext's meta-data group with how many pages fill each field, matched for a person to check", async () => {
    const { t, staff } = await boot(dialect);
    await post(t, {
      title: "Surfer vs Rext",
      slug: "surfer",
      metaData: { seoTitle: "Surfer SEO vs Rext AI", keywords: "seo" },
    });
    await post(t, { title: "Jasper vs Rext", slug: "jasper" });

    const response = await call(staff.importer, "GET", "/import/groups");
    expect(response.status, await response.clone().text()).toBe(200);
    const { groups } = (await response.json()) as ImportGroupsBody;
    const meta = groups.find(group => group.field === "metaData");
    expect(meta?.types.map(type => type.slug)).toEqual(["posts"]);
    expect(meta?.pages).toBe(2);
    const fields = Object.fromEntries(
      (meta?.fields ?? []).map(field => [field.name, field])
    );
    expect(fields.seoTitle).toMatchObject({ filled: 1, suggested: "title" });
    expect(fields.seoDescription).toMatchObject({
      filled: 0,
      suggested: "description",
    });
    expect(fields.ogTitle?.suggested).toBe("socialTitle");
    expect(fields.keywords?.suggested).toBe("skip");
    expect(fields.twitterCard?.suggested).toBe("skip");
    expect(fields.robotsIndex?.suggested).toBe("shown");
    // The plugin's own group is offered too, as the earlier plugin's values.
    expect(groups.find(group => group.field === "seo")?.own).toBe(true);
  });

  it("dry-runs and applies Rext's meta-data group, changing nothing until applied", async () => {
    const { t, staff } = await boot(dialect);
    await post(t, {
      title: "Surfer vs Rext",
      slug: "surfer",
      metaData: {
        seoTitle: "Surfer SEO vs Rext AI: which fits",
        seoDescription: "Surfer grades drafts; Rext writes them.",
        ogTitle: "Surfer or Rext?",
        robotsIndex: "noindex",
        keywords: "surfer, rext",
      },
    });
    // The same as the automatic title: left automatic.
    await post(t, {
      title: "Jasper vs Rext",
      slug: "jasper",
      metaData: { seoTitle: "Jasper vs Rext | Rext AI", robotsIndex: "index" },
    });
    // A shared title the same as the title the page shows, which a typed
    // title decides, is left automatic; one the same as only the automatic
    // title, which the typed one replaces, is kept.
    await post(t, {
      title: "Writesonic vs Rext",
      slug: "writesonic",
      seo: { metaTitle: "Writesonic, compared" },
      metaData: {
        ogTitle: "Writesonic, compared",
        ogDescription: "Writesonic vs Rext",
      },
    });
    await post(t, {
      title: "Rytr vs Rext",
      slug: "rytr",
      seo: { metaTitle: "Rytr, compared" },
      metaData: { ogTitle: "Rytr vs Rext | Rext AI" },
    });
    // A title a person already typed in the SEO tab is kept.
    await post(t, {
      title: "Koala vs Rext",
      slug: "koala",
      seo: { metaTitle: "Typed in the tab" },
      metaData: {
        seoTitle: "From the old group",
        seoDescription: "Old description",
      },
    });
    const before = await seoBySlug(t, "posts");
    const source: ImportSource = {
      kind: "group",
      field: "metaData",
      map: META_MAP,
    };

    const dry = await dryRun(staff.importer, source);
    expect(dry).toMatchObject({
      checked: 5,
      fromFile: false,
      pages: 4,
      same: 2,
      kept: 1,
      redirects: 0,
      left: ["twitterCard", "keywords"],
    });
    expect(dry.lines).toEqual(
      expect.arrayContaining([
        { target: "title", from: ["seoTitle"], pages: 1 },
        { target: "description", from: ["seoDescription"], pages: 2 },
        { target: "socialTitle", from: ["ogTitle"], pages: 2 },
        { target: "hidden", from: ["robotsIndex"], pages: 1 },
      ])
    );
    // Nothing has changed yet.
    expect(await seoBySlug(t, "posts")).toEqual(before);

    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status, await applied.clone().text()).toBe(200);
    const after = await seoBySlug(t, "posts");
    expect(after.surfer).toMatchObject({
      metaTitle: "Surfer SEO vs Rext AI: which fits",
      metaDescription: "Surfer grades drafts; Rext writes them.",
      socialTitle: "Surfer or Rext?",
      noindex: true,
    });
    expect(after.jasper?.metaTitle ?? "").toBe("");
    expect(after.jasper?.noindex ?? false).toBe(false);
    expect(after.writesonic?.socialTitle ?? "").toBe("");
    expect(after.writesonic?.socialDescription).toBe("Writesonic vs Rext");
    expect(after.rytr?.socialTitle).toBe("Rytr vs Rext | Rext AI");
    expect(after.koala).toMatchObject({
      metaTitle: "Typed in the tab",
      metaDescription: "Old description",
    });
  });

  it("dry-runs and applies nextlyhq.com's seo group, its canonical and noindex included", async () => {
    const { t, staff } = await boot(dialect);
    await page(t, {
      title: "Pricing",
      slug: "pricing",
      pageSeo: {
        metaTitle: "Nextly pricing",
        metaDescription: "Free and open source.",
        canonicalUrl: "https://nextlyhq.com/pricing-plans",
        noIndex: true,
      },
    });
    // A canonical naming the page's own address, on the site's own origin,
    // says nothing new.
    await page(t, {
      title: "About",
      slug: "about",
      pageSeo: { canonicalUrl: "https://nextlyhq.com/about/" },
    });
    // The same path on another origin, or with a query, is another address.
    await page(t, {
      title: "Elsewhere",
      slug: "elsewhere",
      pageSeo: { canonicalUrl: "https://original.example/elsewhere" },
    });
    await page(t, {
      title: "Edition",
      slug: "edition",
      pageSeo: { canonicalUrl: "/edition?edition=original" },
    });
    const source: ImportSource = {
      kind: "group",
      field: "pageSeo",
      map: {
        metaTitle: "title",
        metaDescription: "description",
        ogImage: "image",
        canonicalUrl: "canonical",
        noIndex: "hidden",
      },
    };
    const dry = await dryRun(staff.importer, source);
    expect(dry).toMatchObject({ checked: 4, pages: 3, same: 1 });

    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status, await applied.clone().text()).toBe(200);
    const after = await seoBySlug(t, "pages");
    expect(after.pricing).toMatchObject({
      metaTitle: "Nextly pricing",
      metaDescription: "Free and open source.",
      canonical: "https://nextlyhq.com/pricing-plans",
      noindex: true,
    });
    expect(after.about?.canonical ?? "").toBe("");
    expect(after.elsewhere?.canonical).toBe(
      "https://original.example/elsewhere"
    );
    expect(after.edition?.canonical).toBe("/edition?edition=original");
  });

  it("makes the earlier plugin's typed values that match the automatic ones automatic, and keeps the rest", async () => {
    const { t, staff } = await boot(dialect);
    await post(t, {
      title: "Surfer vs Rext",
      slug: "surfer",
      seo: {
        metaTitle: "Surfer vs Rext | Rext AI",
        metaDescription: "A description of its own.",
        canonical: "https://rext.ai/elsewhere",
        noindex: true,
      },
    });
    await post(t, {
      title: "Jasper vs Rext",
      slug: "jasper",
      seo: { metaTitle: "A title of its own" },
    });
    const source: ImportSource = { kind: "group", field: "seo", map: {} };
    const dry = await dryRun(staff.importer, source);
    expect(dry).toMatchObject({ pages: 1, same: 1, kept: 0 });

    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status, await applied.clone().text()).toBe(200);
    const after = await seoBySlug(t, "posts");
    expect(after.surfer).toMatchObject({
      metaTitle: "",
      metaDescription: "A description of its own.",
      canonical: "https://rext.ai/elsewhere",
      noindex: true,
    });
    expect(after.jasper?.metaTitle).toBe("A title of its own");
  });

  it("dry-runs and applies a Yoast export, filling in its variables and matching its images", async () => {
    const { t, staff } = await boot(dialect);
    const image = await t.nextly.media.upload({
      file: {
        data: PNG,
        name: "harbour.png",
        mimetype: "image/png",
        size: PNG.length,
      },
    });
    stored.push(String(image.id));
    await post(t, { title: "Surfer vs Rext", slug: "surfer" });
    await post(t, { title: "Jasper vs Rext", slug: "jasper" });
    const xml = wordPressExport([
      {
        title: "Surfer vs Rext",
        link: "https://old.example/blog/surfer/",
        slug: "surfer",
        meta: {
          _yoast_wpseo_title: "%%title%% %%sep%% %%sitename%%",
          _yoast_wpseo_metadesc: "Which one fits your team.",
          "_yoast_wpseo_opengraph-image":
            "https://old.example/wp-content/uploads/2024/01/harbour.png",
          "_yoast_wpseo_meta-robots-noindex": "1",
          _yoast_wpseo_focuskw: "surfer vs rext",
        },
      },
      {
        title: "Jasper vs Rext",
        link: "https://old.example/blog/jasper/",
        slug: "jasper",
        meta: {
          _yoast_wpseo_title: "Jasper or Rext %%sep%% Compared",
          "_yoast_wpseo_opengraph-image": "https://old.example/missing.png",
        },
      },
      {
        title: "Gone",
        link: "https://old.example/blog/gone/",
        slug: "gone",
        meta: { _yoast_wpseo_title: "Gone" },
      },
      {
        title: "A picture",
        link: "https://old.example/picture/",
        slug: "picture",
        type: "attachment",
        meta: {},
      },
    ]);
    const source: ImportSource = {
      kind: "yoast",
      fileName: "export.xml",
      text: xml,
    };
    const before = await seoBySlug(t, "posts");

    const dry = await dryRun(staff.importer, source);
    expect(dry).toMatchObject({
      checked: 3,
      fromFile: true,
      pages: 2,
      same: 1,
    });
    expect(dry.left).toEqual(["focus keyphrase"]);
    expect(dry.warnings.join(" ")).toContain(
      "1 page in the file isn't on this site"
    );
    expect(dry.warnings.join(" ")).toContain(
      "1 share image isn't in the media library"
    );
    expect(await seoBySlug(t, "posts")).toEqual(before);

    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status, await applied.clone().text()).toBe(200);
    const after = await seoBySlug(t, "posts");
    expect(after.surfer).toMatchObject({
      metaDescription: "Which one fits your team.",
      ogImage: String(image.id),
      noindex: true,
    });
    expect(after.surfer?.metaTitle ?? "").toBe("");
    expect(after.jasper?.metaTitle).toBe("Jasper or Rext | Compared");
  });

  it("dry-runs and applies a Rank Math export file", async () => {
    const { t, staff } = await boot(dialect);
    await post(t, { title: "Surfer vs Rext", slug: "surfer" });
    const xml = wordPressExport([
      {
        title: "Surfer vs Rext",
        link: "https://old.example/blog/surfer/",
        slug: "surfer",
        meta: {
          rank_math_title: "%title% %sep% Reviewed",
          rank_math_description: "Rank Math's description.",
          rank_math_robots: 'a:1:{i:0;s:7:"noindex";}',
          rank_math_focus_keyword: "surfer",
        },
      },
    ]);
    const source: ImportSource = {
      kind: "rankMath",
      fileName: "export.xml",
      text: xml,
    };
    const dry = await dryRun(staff.importer, source);
    expect(dry).toMatchObject({ checked: 1, pages: 1 });
    expect(dry.left).toEqual(["focus keyword"]);
    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect((await seoBySlug(t, "posts")).surfer).toMatchObject({
      metaTitle: "Surfer vs Rext | Reviewed",
      metaDescription: "Rank Math's description.",
      noindex: true,
    });
  });

  it("dry-runs and applies Rank Math's CSV, adding the redirect it names through the redirect rules", async () => {
    const { t, staff } = await boot(dialect);
    await post(t, { title: "Surfer vs Rext", slug: "surfer" });
    const csv = [
      "id,slug,url,seo_title,seo_description,robots,focus_keyword,redirect_to,redirect_type",
      '12,surfer,https://old.example/blog/surfer/,"Surfer, compared",Rank Math says so,"index,follow",surfer,,',
      "13,old-post,https://old.example/blog/old-post/,,,,,/blog/surfer,301",
      "14,removed,https://old.example/blog/removed/,,,,,,410",
    ].join("\n");
    const source: ImportSource = {
      kind: "rankMath",
      fileName: "rank-math.csv",
      text: csv,
    };
    const dry = await dryRun(staff.importer, source);
    expect(dry).toMatchObject({ checked: 3, pages: 1, redirects: 1 });
    expect(dry.left).toEqual(["focus keyword"]);
    expect(await redirectCount(t)).toBe(0);

    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect((await seoBySlug(t, "posts")).surfer).toMatchObject({
      metaTitle: "Surfer, compared",
      metaDescription: "Rank Math says so",
    });
    const { items } = await t.nextly.find({
      collection: REDIRECTS_SLUG,
      limit: 10,
      overrideAccess: true,
    });
    expect(items).toEqual([
      expect.objectContaining({
        source: "/blog/old-post",
        target: "/blog/surfer",
        origin: "import",
      }),
    ]);
  });

  it("dry-runs and applies a Payload export", async () => {
    const { t, staff } = await boot(dialect);
    await page(t, { title: "Pricing", slug: "pricing" });
    const json = JSON.stringify({
      docs: [
        {
          id: "65f0",
          title: "Pricing",
          slug: "pricing",
          meta: {
            title: "Pricing that grows with you",
            description: "Plans for every team.",
            image: "65f1a",
          },
        },
      ],
    });
    const source: ImportSource = {
      kind: "payload",
      fileName: "pages.json",
      text: json,
    };
    const dry = await dryRun(staff.importer, source);
    expect(dry).toMatchObject({ checked: 1, pages: 1 });
    expect(dry.warnings.join(" ")).toContain("named only by Payload's id");
    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect((await seoBySlug(t, "pages")).pricing).toMatchObject({
      metaTitle: "Pricing that grows with you",
      metaDescription: "Plans for every team.",
    });
  });

  it("leaves every value as it was when a save fails part-way through", async () => {
    const { t, staff } = await boot(dialect);
    for (const slug of ["first", "second", "third"]) {
      await post(t, {
        title: `Post ${slug}`,
        slug,
        metaData: {
          seoTitle: `Imported ${slug}`,
          seoDescription: `About ${slug}`,
        },
      });
    }
    const source: ImportSource = {
      kind: "group",
      field: "metaData",
      map: META_MAP,
    };
    const dry = await dryRun(staff.importer, source);
    expect(dry.pages).toBe(3);
    const before = await seoBySlug(t, "posts");

    // The second page written refuses its save; the first was already written.
    failing = "second";
    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status).toBeGreaterThanOrEqual(400);
    failing = undefined;
    expect(await seoBySlug(t, "posts")).toEqual(before);

    // A file whose redirect is added after its pages are written, and is
    // refused: the pages written before it are undone with it.
    const csv = [
      "slug,url,seo_title,redirect_to,redirect_type",
      "first,https://old.example/blog/first/,A title from the file,,",
      "old,https://old.example/old/,,/blog/first,301",
    ].join("\n");
    const fileSource: ImportSource = {
      kind: "rankMath",
      fileName: "r.csv",
      text: csv,
    };
    const fileDry = await dryRun(staff.importer, fileSource);
    expect(fileDry).toMatchObject({ pages: 1, redirects: 1 });
    const beforeFile = await seoBySlug(t, "posts");
    failingRedirect = true;
    const refused = await apply(staff.importer, fileSource, fileDry.plan);
    failingRedirect = false;
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await seoBySlug(t, "posts")).toEqual(beforeFile);
    expect(await redirectCount(t)).toBe(0);
  });

  it("refuses an apply once a page changed since the dry run, changing nothing", async () => {
    const { t, staff } = await boot(dialect);
    const id = await post(t, {
      title: "Surfer vs Rext",
      slug: "surfer",
      metaData: { seoDescription: "From the group" },
    });
    await post(t, {
      title: "Jasper vs Rext",
      slug: "jasper",
      metaData: { seoDescription: "Also from the group" },
    });
    const source: ImportSource = {
      kind: "group",
      field: "metaData",
      map: META_MAP,
    };
    const dry = await dryRun(staff.importer, source);
    await t.nextly.update({
      collection: "posts",
      id,
      data: { excerpt: "Edited since", _overwrite: true },
    });
    const before = await seoBySlug(t, "posts");
    const applied = await apply(staff.importer, source, dry.plan);
    expect(applied.status).toBe(409);
    expect(await seoBySlug(t, "posts")).toEqual(before);
  });

  it("refuses anyone without site-wide SEO", async () => {
    const { staff } = await boot(dialect);
    const source: ImportSource = {
      kind: "group",
      field: "metaData",
      map: META_MAP,
    };
    expect((await call(staff.editorOnly, "GET", "/import/groups")).status).toBe(
      403
    );
    const dry = await call(staff.editorOnly, "POST", "/import/dry-run", {
      source,
    });
    expect(dry.status).toBe(403);
    const applied = await call(staff.editorOnly, "POST", "/import/apply", {
      source,
      plan: "x",
    });
    expect(applied.status).toBe(403);
  });
});
