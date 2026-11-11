/**
 * The SEO tab's route, through core's request handler, with a real API key per
 * role, against a real database: it answers an editor every level of the
 * order for the document as typed, without what they typed in its `seo`
 * group, and the tab's answer worked out from those levels is the page's own
 * answer; a reader who may not edit the type is refused.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text, textarea } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import { resolveOrder } from "../../resolver/order";
import { resolveSeo } from "../../resolver/provider";
import type { SeoTabContext } from "../contract";
import { typedPageLevel } from "../typed";

/** The Direct API calls this suite makes its staff with. */
interface Direct {
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  permissions: {
    find(args: {
      limit: number;
    }): Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string }>;
}

const SEGMENTS = ["plugins", "@nextlyhq", "plugin-seo", "resolve"];

/** One request to the route through core's handler, as `key`. */
async function resolve(key: string, body: unknown): Promise<Response> {
  const handlers = createDynamicHandlers();
  return handlers.POST(
    new Request(`https://admin.example/api/${SEGMENTS.join("/")}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: SEGMENTS }) }
  );
}

/** A post as an author has typed it and not saved it. */
const TYPED_POST = {
  title: "Surfer SEO vs Rext AI",
  slug: "surfer-vs-rext",
  excerpt: "Surfer grades drafts; Rext writes them with sources.",
  seo: {
    metaTitle: "Typed title",
    socialDescription: "Typed for sharing",
    noindex: true,
    canonical: "https://rext.ai/blog/original",
  },
};

describe.each(getConfiguredTestDialects())(
  "the SEO tab's route (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let ctx: PluginContext | undefined;
    let editor = "";
    let creator = "";
    let reader = "";
    let singleEditor = "";

    beforeAll(async () => {
      const probe = definePlugin({
        name: "@test/seo-tab-probe",
        version: "0.0.0",
        nextly: ">=0.0.0",
        init(context) {
          ctx = context;
        },
      });
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [
          seoPlugin({
            collections: ["posts"],
            singles: ["homepage"],
            sitemap: false,
          }),
          probe,
        ],
        collections: [
          defineCollection({
            slug: "posts",
            labels: { singular: "Blog post", plural: "Blog posts" },
            fields: [
              text({ name: "title" }),
              text({ name: "slug" }),
              textarea({ name: "excerpt", label: "Summary" }),
            ],
            publicAddress: "/blog/{slug}",
          }),
        ],
        singles: [
          defineSingle({
            slug: "homepage",
            label: { singular: "Homepage" },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const direct = t.nextly as unknown as Direct;
      const owner = await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 500 });
      const keys = t.getService("apiKeyService") as unknown as ApiKeys;
      async function keyHolding(slugs: string[]): Promise<string> {
        const ids = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) {
            throw new Error(`${slug} is not seeded, so a role grants nothing`);
          }
          return found.id;
        });
        const role = await direct.roles.create({
          data: {
            name: `Role ${slugs.join(" ")}`,
            slug: `r-${slugs.join("-")}`,
            permissionIds: ids,
          },
        });
        const { key } = await keys.createApiKey(owner.item.id, {
          name: `key ${slugs.join(" ")}`,
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        });
        return key;
      }
      editor = await keyHolding(["read-posts", "update-posts"]);
      creator = await keyHolding(["read-posts", "create-posts"]);
      reader = await keyHolding(["read-posts"]);
      singleEditor = await keyHolding(["read-homepage", "update-homepage"]);
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("answers an editor every level for the post as typed, leaving out what they typed", async () => {
      const response = await resolve(editor, {
        kind: "collection",
        slug: "posts",
        locale: null,
        document: TYPED_POST,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const answer = (await response.json()) as SeoTabContext;

      expect(answer.levels.page).toEqual({});
      expect(answer.levels.content.title).toEqual({
        value: "Surfer SEO vs Rext AI",
        field: "title",
      });
      expect(answer.levels.content.description).toEqual({
        value: TYPED_POST.excerpt,
        field: "excerpt",
      });
      // The address the post would have with the slug as typed.
      expect(answer.levels.address).toBe("/blog/surfer-vs-rext");
      expect(answer.typeLabel).toBe("Blog post");
      expect(answer.fieldLabels).toEqual({
        title: "Title",
        excerpt: "Summary",
      });
      // The group's fields, and the page's structured data, since the group
      // holds its type.
      expect(answer.fields).toContain("structuredDataType");
      expect(answer.structuredData?.chosen).toBe("automatic");
      expect(answer.structuredData?.offered.length).toBeGreaterThan(1);
      expect(answer.site).toEqual({
        origin: "https://admin.example",
        hosts: ["admin.example"],
      });
    });

    it("gives the tab the page's own answer once what was typed is put on top", async () => {
      const response = await resolve(editor, {
        kind: "collection",
        slug: "posts",
        document: TYPED_POST,
      });
      const { levels } = (await response.json()) as SeoTabContext;
      if (ctx === undefined) throw new Error("the probe was not started");

      const served = await resolveSeo(ctx, {
        source: { kind: "entry", collection: "posts", entry: TYPED_POST },
        code: {},
        derived: {},
      });
      const tab = resolveOrder({
        ...levels,
        page: typedPageLevel(TYPED_POST.seo),
      });

      expect(tab).toEqual(served);
      expect(tab.title).toEqual({ value: "Typed title", from: "page" });
      expect(tab.robots.value.index).toBe(false);
    });

    it("answers someone who may create posts, as on a new post's page", async () => {
      const response = await resolve(creator, {
        kind: "collection",
        slug: "posts",
        document: { title: "Draft" },
      });
      expect(response.status).toBe(200);
      const answer = (await response.json()) as SeoTabContext;
      expect(answer.levels.content.title?.value).toBe("Draft");
      // No slug typed yet, so no address to credit.
      expect(answer.levels.address).toBeUndefined();
    });

    it("answers for a Single the plugin extends, to someone who may update it", async () => {
      const response = await resolve(singleEditor, {
        kind: "single",
        slug: "homepage",
        document: { title: "Welcome" },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const answer = (await response.json()) as SeoTabContext;
      expect(answer.typeLabel).toBe("Homepage");
      expect(answer.levels.content.title?.value).toBe("Welcome");
    });

    it("refuses a reader who may not edit the type, and a type the plugin does not extend", async () => {
      const refused = await resolve(reader, {
        kind: "collection",
        slug: "posts",
        document: TYPED_POST,
      });
      expect(refused.status).toBe(403);
      expect(await refused.text()).not.toContain("Surfer");

      const elsewhere = await resolve(editor, {
        kind: "single",
        slug: "posts",
        document: {},
      });
      expect(elsewhere.status).toBe(404);

      const malformed = await resolve(editor, { kind: "page", slug: "posts" });
      expect(malformed.status).toBe(400);
    });
  }
);
