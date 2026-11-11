/**
 * On every configured dialect, with the Page Builder and the SEO plugin both
 * installed: a template's rule is what every page it draws is served, a
 * change to the rule changes two pages that use it, and the template panel's
 * preview for each page is the head the page is served.
 *
 * The page's head is asked of the site's one content route
 * (`createContentPage`, with the Page Builder's own provider), which hands
 * the SEO plugin the design's values as it serves the page. The preview is
 * the SEO plugin's template route, asked as an editor is, with the design
 * as edited.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createContentPage } from "@nextlyhq/blocks-react/next";
import { pageBuilder, pageBuilderContent } from "@nextlyhq/plugin-page-builder";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import { resolveOrder } from "../../resolver/order";
import type { TemplateContext } from "../contract";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A posts template whose own metadata is `rule`. */
function design(rule: Record<string, unknown>) {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [],
    settings: { seo: rule },
  };
}

const FIRST_RULE = { title: [{ $bind: "title" }, " | Field Notes"] };
const SECOND_RULE = {
  title: ["Read: ", { $bind: "title" }],
  description: ["A post called ", { $bind: "title" }, "."],
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    // The Public role seeded, so a visitor may read the published templates
    // and posts the content route serves.
    seedPublic: true,
    plugins: [
      pageBuilder({ templates: { addresses: { posts: "/blog" } } }),
      seoPlugin({ collections: ["posts"], sitemap: false }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug", unique: true })],
      }),
    ],
  });
  return current;
}

/** An API key whose role reads posts, as an editor's does. */
async function readerKey(t: TestNextly): Promise<string> {
  const direct = t.nextly as unknown as {
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
  };
  const owner = await direct.users.create({
    data: {
      email: "editor@example.com",
      password: "Password123!",
      name: "Editor",
      isActive: true,
    },
  });
  const seeded = await direct.permissions.find({ limit: 500 });
  const read = seeded.items.find(item => item.slug === "read-posts");
  if (read === undefined) throw new Error("read-posts is not seeded");
  const role = await direct.roles.create({
    data: {
      name: "Template reader",
      slug: "template-reader",
      permissionIds: [read.id],
    },
  });
  const keys = t.getService("apiKeyService") as unknown as {
    createApiKey(
      userId: string,
      input: Record<string, unknown>
    ): Promise<{ key: string }>;
  };
  return (
    await keys.createApiKey(owner.item.id, {
      name: "editor",
      tokenType: "role-based",
      roleId: role.item.id,
      expiresIn: "unlimited",
    })
  ).key;
}

/** The template panel's preview of `document` with the post `id`. */
async function previewed(
  key: string,
  id: string,
  document: unknown
): Promise<{ title?: string; description?: string }> {
  const segments = ["plugins", "@nextlyhq", "plugin-seo", "template"];
  const response = await createDynamicHandlers().POST(
    new Request(`https://admin.example/api/${segments.join("/")}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ collection: "posts", entryId: id, document }),
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const context = (await response.json()) as TemplateContext;
  const levels = context.previewed?.levels;
  if (levels === undefined) throw new Error("no page was previewed");
  // As the panel shows it: the rule's answer, before the page's own text.
  const answer = resolveOrder({ ...levels, page: {} });
  return {
    ...(answer.title === undefined ? {} : { title: answer.title.value }),
    ...(answer.description === undefined
      ? {}
      : { description: answer.description.value }),
  };
}

/** The head the post at `/blog/<slug>` is served. */
async function served(
  t: TestNextly,
  slug: string
): Promise<{ title?: string; description?: string }> {
  const route = createContentPage({
    ...pageBuilderContent({ nextly: t.nextly as never }),
    pages: {
      collections: ["pages"],
      field: "content",
      nextly: t.nextly as never,
    },
  });
  const metadata = (await route.generateMetadata({
    params: { slug: ["blog", slug] },
  })) as { title?: unknown; description?: unknown };
  const title =
    typeof metadata.title === "string"
      ? metadata.title
      : (metadata.title as { absolute?: string } | undefined)?.absolute;
  return {
    ...(title === undefined ? {} : { title }),
    ...(typeof metadata.description === "string"
      ? { description: metadata.description }
      : {}),
  };
}

describe.each(getConfiguredTestDialects())(
  "a template's SEO rule, on the pages it draws (%s)",
  dialect => {
    it("is served on two pages, changes on both with the rule, and is what the panel previews", async () => {
      const t = await boot(dialect);
      const ids: string[] = [];
      for (const [title, slug] of [
        ["Hello world", "hello"],
        ["Second post", "second"],
      ]) {
        const created = await t.nextly.create({
          collection: "posts",
          data: { title, slug, status: "published" },
        });
        ids.push(String((created as { item: { id: unknown } }).item.id));
      }
      const template = await t.nextly.create({
        collection: "templates",
        data: {
          title: "Posts",
          collection: "posts",
          content: design(FIRST_RULE),
          status: "published",
        },
        overrideAccess: true,
      });
      const templateId = String(
        (template as { item: { id: unknown } }).item.id
      );
      const key = await readerKey(t);

      expect((await served(t, "hello")).title).toBe(
        "Hello world | Field Notes"
      );
      expect((await served(t, "second")).title).toBe(
        "Second post | Field Notes"
      );
      expect(await previewed(key, ids[0]!, design(FIRST_RULE))).toMatchObject(
        await served(t, "hello")
      );

      // The panel's preview of a changed rule, before it is saved, is what
      // each page is served once it is.
      const before = {
        hello: await previewed(key, ids[0]!, design(SECOND_RULE)),
        second: await previewed(key, ids[1]!, design(SECOND_RULE)),
      };
      await t.nextly.update({
        collection: "templates",
        id: templateId,
        data: {
          content: design(SECOND_RULE),
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const hello = await served(t, "hello");
      const second = await served(t, "second");
      expect(hello).toEqual({
        title: "Read: Hello world",
        description: "A post called Hello world.",
      });
      expect(second).toEqual({
        title: "Read: Second post",
        description: "A post called Second post.",
      });
      expect(before).toEqual({ hello, second });
    });
  }
);
