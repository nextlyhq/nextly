/**
 * On every configured dialect: a Single SEO is added to is a content type
 * of bulk edit and of the import, its one page read and written as the
 * person asking, at the version they read; and what a page's route supplies
 * in code, recorded as its head is answered, is what the SEO tab, bulk edit
 * and the problem list show for it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type {
  PageMetadataInput,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
  textarea,
} from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import type {
  BulkRowsBody,
  BulkSaveBody,
  BulkTypesBody,
} from "../../bulk/contract";
import type { DryRunBody, ImportGroupsBody } from "../../import/contract";
import { MANAGE_SEO_PERMISSION } from "../../permissions";
import { seoPlugin } from "../../plugin";
import { checkSite, problemList, type Reader } from "../../problems/check";
import { readSeoRules } from "../../settings/rules";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import { structuredDataFromSettings } from "../../settings/structured-data-rules";
import { noSocialCardRules } from "../../social/card";
import { rulesFromOptions } from "../../structured-data/rules";
import type { SeoTabContext } from "../../tab/contract";

/** Rext's `meta-data` component, as its site declares it. */
const META_DATA = defineFieldGroup({
  slug: "meta-data",
  label: { singular: "Search and sharing" },
  fields: [text({ name: "seoTitle" }), textarea({ name: "seoDescription" })],
});

let current: TestNextly | undefined;

/** Whether a save of a post is made to fail, for a failure part-way through. */
let failingPosts = false;

afterEach(async () => {
  failingPosts = false;
  await current?.destroy();
  current = undefined;
});

const PLUGIN = ["plugins", "@nextlyhq", "plugin-seo"];

/** One request to a plugin route through core's handler, as `key`. */
async function call(
  key: string,
  method: "GET" | "POST",
  route: string,
  body?: unknown
): Promise<Response> {
  const [pathname, query] = route.split("?");
  const segments = [...PLUGIN, ...(pathname ?? "").split("/").filter(Boolean)];
  const handlers = createDynamicHandlers();
  const request = new Request(
    `https://admin.example/api/${segments.join("/")}${query ? `?${query}` : ""}`,
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

/** A route's answer, read as JSON once its status is 200. */
async function ok<T>(response: Promise<Response>): Promise<T> {
  const answered = await response;
  expect(answered.status, await answered.clone().text()).toBe(200);
  return (await answered.json()) as T;
}

async function boot(dialect: TestDialect) {
  const seen: { ctx?: PluginContext } = {};
  const plugin = seoPlugin({
    collections: ["posts"],
    singles: ["home"],
    sitemap: false,
  });
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    // Every permission the plugins declare, manage-seo among them.
    seedPublic: true,
    plugins: [
      {
        ...plugin,
        init(ctx) {
          seen.ctx = ctx;
          return plugin.init?.(ctx);
        },
      },
    ],
    fieldGroups: [META_DATA],
    collections: [
      defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          fieldGroup({ name: "metaData", component: "meta-data" }),
        ],
        publicAddress: "/blog/{slug}",
        hooks: {
          beforeChange: [
            ({ data }) => {
              if (failingPosts) throw new Error("this save fails");
              return data;
            },
          ],
        },
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        label: { singular: "Home page" },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "metaData", component: "meta-data" }),
        ],
        publicAddress: "/",
      }),
    ],
  });
  current = t;
  const ctx = seen.ctx;
  if (ctx === undefined) throw new Error("the SEO plugin never started");
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: { _overwrite: true, siteName: "Rext AI" },
  });
  // Made as the other suites make their staff, through the call's `data`.
  const users = t.nextly.users as unknown as {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  const owner = await users.create({
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
    const tag = String(Math.random()).slice(2, 8);
    const role = await t.nextly.roles.create({
      data: {
        name: `Role ${tag}`,
        slug: `r-${tag}`,
        permissionIds: slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) throw new Error(`${slug} is not seeded`);
          return found.id;
        }),
      },
    });
    const { key } = await keys.createApiKey(String(owner.item.id), {
      name: `key ${tag}`,
      tokenType: "role-based",
      roleId: String(role.item.id),
      expiresIn: "unlimited",
    });
    return key;
  }
  const content = ["read-posts", "update-posts", "read-home", "update-home"];
  // The page-metadata provider the plugin contributes, as core asks it.
  const services = plugin.contributes?.services as Record<
    string,
    (context: PluginContext) => PageMetadataResolver
  >;
  const provider = services.pageMetadata(ctx);
  return {
    t,
    ctx,
    answer: (input: PageMetadataInput) => provider.resolve(input),
    editor: await keyHolding(content),
    importer: await keyHolding([...content, MANAGE_SEO_PERMISSION]),
    reader: await keyHolding(["read-posts", "read-home"]),
  };
}

/** The Home page Single's stored document, as the system reads it. */
async function home(t: TestNextly): Promise<Record<string, unknown>> {
  return (await t.nextly.findSingle({
    slug: "home",
    overrideAccess: true,
    depth: 0,
  })) as Record<string, unknown>;
}

const HOME = "single:home";

describe.each(getConfiguredTestDialects())(
  "Singles in bulk edit and the import (%s)",
  dialect => {
    it("lists a Single as a type with one page, and saves it at the version read", async () => {
      const { t, editor, reader } = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "home",
        data: { _overwrite: true, title: "Welcome" },
      });

      const { types } = await ok<BulkTypesBody>(
        call(editor, "GET", "/bulk/types")
      );
      expect(types.find(type => type.slug === HOME)).toEqual({
        slug: HOME,
        label: "Home page",
        singular: "Home page",
        total: 1,
        titlePattern: "{Title} | {Site name}",
        drafts: false,
      });

      const read = await ok<BulkRowsBody>(
        call(editor, "GET", `/bulk/rows?type=${encodeURIComponent(HOME)}`)
      );
      expect(read).toMatchObject({ type: HOME, total: 1, more: false });
      expect(read.rows).toHaveLength(1);
      const [row] = read.rows;
      expect(row).toMatchObject({
        label: "Welcome",
        path: "/",
        title: "",
        autoTitle: "Welcome | Rext AI",
        editable: true,
      });

      // Someone who may only read the Single sees it read-only and is refused.
      const asReader = await ok<BulkRowsBody>(
        call(reader, "GET", `/bulk/rows?type=${encodeURIComponent(HOME)}`)
      );
      expect(asReader.rows[0]?.editable).toBe(false);
      const refused = await call(reader, "POST", "/bulk/save", {
        type: HOME,
        changes: [{ id: row?.id, rev: row?.rev, title: "Not theirs" }],
      });
      expect(refused.status).toBe(403);

      const saved = await ok<BulkSaveBody>(
        call(editor, "POST", "/bulk/save", {
          type: HOME,
          changes: [{ id: row?.id, rev: row?.rev, title: "Rext AI, home" }],
        })
      );
      expect(saved.saved).toBe(1);
      expect((await home(t)).seo).toMatchObject({ metaTitle: "Rext AI, home" });

      // The version read before that save is out of date now.
      const stale = await call(editor, "POST", "/bulk/save", {
        type: HOME,
        changes: [{ id: row?.id, rev: row?.rev, title: "Over it" }],
      });
      expect(stale.status).toBe(409);
      expect((await home(t)).seo).toMatchObject({ metaTitle: "Rext AI, home" });
    });

    it("finds a Single's field group, and dry-runs and applies it beside a collection's", async () => {
      const { t, importer } = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "home",
        data: {
          _overwrite: true,
          title: "Welcome",
          metaData: {
            seoTitle: "AI article writer for SEO | Rext AI",
            seoDescription: "Rext AI writes in your brand voice.",
          },
        },
      });
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Surfer vs Rext",
          slug: "surfer",
          metaData: { seoTitle: "Surfer SEO vs Rext AI" },
        },
      });

      const { groups } = await ok<ImportGroupsBody>(
        call(importer, "GET", "/import/groups")
      );
      const group = groups.find(each => each.field === "metaData");
      expect(group?.types.map(type => type.slug).sort()).toEqual(
        ["posts", HOME].sort()
      );
      expect(group?.pages).toBe(2);

      const source = {
        kind: "group",
        field: "metaData",
        map: { seoTitle: "title", seoDescription: "description" },
      } as const;
      const dry = await ok<DryRunBody>(
        call(importer, "POST", "/import/dry-run", { source })
      );
      expect(dry).toMatchObject({ checked: 2, pages: 2 });
      // Nothing has changed yet.
      expect((await home(t)).seo ?? {}).not.toHaveProperty(
        "metaTitle",
        "AI article writer for SEO | Rext AI"
      );

      await ok(
        call(importer, "POST", "/import/apply", { source, plan: dry.plan })
      );
      expect((await home(t)).seo).toMatchObject({
        metaTitle: "AI article writer for SEO | Rext AI",
        metaDescription: "Rext AI writes in your brand voice.",
      });
      const { items } = await t.nextly.find({
        collection: "posts",
        overrideAccess: true,
        depth: 0,
      });
      expect((items[0] as { seo?: unknown }).seo).toMatchObject({
        metaTitle: "Surfer SEO vs Rext AI",
      });
    });

    it("puts the Single back as it was when a later save of the import fails", async () => {
      const { t, importer } = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "home",
        data: {
          _overwrite: true,
          title: "Welcome",
          seo: { metaDescription: "Typed before" },
          metaData: { seoTitle: "AI article writer for SEO | Rext AI" },
        },
      });
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Surfer vs Rext",
          slug: "surfer",
          metaData: { seoTitle: "Surfer SEO vs Rext AI" },
        },
      });
      const source = {
        kind: "group",
        field: "metaData",
        map: { seoTitle: "title" },
      } as const;
      const dry = await ok<DryRunBody>(
        call(importer, "POST", "/import/dry-run", { source })
      );
      expect(dry.pages).toBe(2);

      failingPosts = true;
      const applied = await call(importer, "POST", "/import/apply", {
        source,
        plan: dry.plan,
      });
      expect(applied.status).not.toBe(200);
      const seo = (await home(t)).seo as Record<string, unknown>;
      expect(seo.metaTitle ?? "").toBe("");
      expect(seo.metaDescription).toBe("Typed before");
    });
  }
);

/** A reader of every page, for the problem list. */
const everything: Reader = {
  pages: async pages => new Set(pages.map(page => `${page.type}:${page.id}`)),
  readsType: () => true,
  seesRedirects: true,
  count: async () => 0,
};

describe.each(getConfiguredTestDialects())(
  "values from the page's code (%s)",
  dialect => {
    it("shows what a page's route supplied as its head was answered, in the tab, bulk edit and the problem list", async () => {
      const { t, ctx, answer, editor } = await boot(dialect);
      const created = await t.nextly.create({
        collection: "posts",
        data: { title: "Pricing", slug: "pricing" },
      });
      const post = created.item as Record<string, unknown>;
      await t.nextly.updateSingle({
        slug: "home",
        data: { _overwrite: true, title: "Welcome" },
      });
      await lastCatchUp();
      const checks = {
        targets: ["posts"],
        singles: ["home"],
        readers: {
          readRules: readSeoRules,
          readStructuredDataRules: structuredDataFromSettings(
            rulesFromOptions(undefined, undefined)
          ),
          readSocialCardRules: noSocialCardRules,
        },
      };
      const noDescription = async () => {
        await checkSite(ctx, checks);
        const list = await problemList(ctx, checks, everything);
        return list.problems
          .filter(problem => problem.kind === "noDescription")
          .map(problem => problem.subject.type);
      };
      // Before any route answered, the pages have no description at all.
      expect((await noDescription()).sort()).toEqual(["posts", HOME].sort());

      // The routes answer their heads with values of their own.
      await answer({
        source: { kind: "entry", collection: "posts", entry: post },
        code: {
          title: "Plans and pricing",
          description: "Every plan, side by side.",
        },
        derived: {},
      });
      await answer({
        source: { kind: "single", slug: "home", document: await home(t) },
        code: { title: "AI article writer for SEO", description: "Home." },
        derived: {},
      });
      // A later page of a list is that page's own, and is not kept.
      await answer({
        path: "/page/2",
        source: { kind: "single", slug: "home", document: await home(t) },
        code: { title: "Page 2", description: "Older." },
        derived: {},
      });

      const tab = await ok<SeoTabContext>(
        call(editor, "POST", "/resolve", {
          kind: "collection",
          slug: "posts",
          id: String(post.id),
          document: { title: "Pricing", slug: "pricing" },
        })
      );
      expect(tab.levels.code).toEqual({
        title: "Plans and pricing",
        description: "Every plan, side by side.",
      });
      const singleTab = await ok<SeoTabContext>(
        call(editor, "POST", "/resolve", {
          kind: "single",
          slug: "home",
          document: { title: "Welcome" },
        })
      );
      expect(singleTab.levels.code.title).toBe("AI article writer for SEO");

      const posts = await ok<BulkRowsBody>(
        call(editor, "GET", "/bulk/rows?type=posts")
      );
      expect(posts.rows[0]).toMatchObject({
        autoTitle: "Plans and pricing",
        autoDescription: "Every plan, side by side.",
      });
      const homeRows = await ok<BulkRowsBody>(
        call(editor, "GET", `/bulk/rows?type=${encodeURIComponent(HOME)}`)
      );
      expect(homeRows.rows[0]).toMatchObject({
        autoTitle: "AI article writer for SEO",
        autoDescription: "Home.",
      });

      expect(await noDescription()).toEqual([]);

      // A route that stops supplying a value no longer shows one.
      await answer({
        source: { kind: "entry", collection: "posts", entry: post },
        code: { title: "Plans and pricing" },
        derived: {},
      });
      const again = await ok<BulkRowsBody>(
        call(editor, "GET", "/bulk/rows?type=posts")
      );
      expect(again.rows[0]?.autoDescription).toBeUndefined();
    });
  }
);
