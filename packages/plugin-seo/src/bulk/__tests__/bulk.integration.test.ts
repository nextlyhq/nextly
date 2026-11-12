/**
 * The bulk edit routes, through Nextly's own request handler, on every
 * configured dialect: a content type's pages with what was typed and what
 * is automatic, a save of several pages in one step, a save refused as a
 * whole when one page was saved by someone else since it was read, and a
 * reader who may not change the type refused.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, password, text, textarea } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import type { BulkRowsBody, BulkSaveBody, BulkTypesBody } from "../contract";

let current: TestNextly | undefined;

afterEach(async () => {
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

async function boot(dialect: TestDialect) {
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    plugins: [seoPlugin({ collections: ["posts"], sitemap: false })],
    collections: [
      defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Blog posts" },
        status: true,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          textarea({ name: "excerpt" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  current = t;
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: { _overwrite: true, siteName: "Rext AI" },
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
  return {
    t,
    editor: await keyHolding(["read-posts", "update-posts"]),
    reader: await keyHolding(["read-posts"]),
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

/** Every post's stored `seo` group, by slug. */
async function seoBySlug(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: "posts",
    limit: 100,
    overrideAccess: true,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[]).map(item => [
      String(item.slug),
      (item.seo ?? {}) as Record<string, unknown>,
    ])
  );
}

/** The posts' rows as the table reads them. */
async function rows(key: string): Promise<BulkRowsBody> {
  const response = await call(key, "GET", "/bulk/rows?type=posts");
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as BulkRowsBody;
}

describe.each(getConfiguredTestDialects())("bulk edit (%s)", dialect => {
  it("lists the types, and each page with what was typed and what is automatic", async () => {
    const { t, editor } = await boot(dialect);
    await post(t, {
      title: "Surfer vs Rext",
      slug: "surfer",
      excerpt: "Which fits your workflow.",
      seo: { metaTitle: "Typed title", canonical: "https://rext.ai/x" },
    });
    await post(t, { title: "Jasper vs Rext", slug: "jasper" });

    const types = await call(editor, "GET", "/bulk/types");
    expect(types.status, await types.clone().text()).toBe(200);
    expect(((await types.json()) as BulkTypesBody).types).toEqual([
      {
        slug: "posts",
        label: "Blog posts",
        singular: "Post",
        total: 2,
        titlePattern: "{Title} | {Site name}",
        drafts: false,
      },
    ]);

    const read = await rows(editor);
    expect(read).toMatchObject({ type: "posts", total: 2, more: false });
    const byLabel = Object.fromEntries(read.rows.map(row => [row.label, row]));
    expect(byLabel["Surfer vs Rext"]).toMatchObject({
      path: "/blog/surfer",
      title: "Typed title",
      description: "",
      autoTitle: "Surfer vs Rext | Rext AI",
      autoDescription: "Which fits your workflow.",
    });
    expect(byLabel["Jasper vs Rext"]).toMatchObject({
      title: "",
      autoTitle: "Jasper vs Rext | Rext AI",
    });
    expect(typeof byLabel["Jasper vs Rext"]?.rev).toBe("string");
  });

  it("saves every change in one step, keeping the group's other values", async () => {
    const { t, editor } = await boot(dialect);
    await post(t, {
      title: "Surfer vs Rext",
      slug: "surfer",
      seo: { metaTitle: "Old", canonical: "https://rext.ai/x", noindex: true },
    });
    await post(t, { title: "Jasper vs Rext", slug: "jasper" });
    const read = await rows(editor);
    const surfer = read.rows.find(row => row.label === "Surfer vs Rext");
    const jasper = read.rows.find(row => row.label === "Jasper vs Rext");

    const response = await call(editor, "POST", "/bulk/save", {
      type: "posts",
      changes: [
        {
          id: surfer?.id,
          rev: surfer?.rev,
          title: "",
          description: "New description",
        },
        { id: jasper?.id, rev: jasper?.rev, title: "Jasper, compared" },
      ],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as BulkSaveBody & { message: string };
    expect(body.saved).toBe(2);
    expect(body.message).toBe("Saved 2 pages.");

    const after = await seoBySlug(t);
    expect(after.surfer).toMatchObject({
      metaTitle: "",
      metaDescription: "New description",
      canonical: "https://rext.ai/x",
      noindex: true,
    });
    expect(after.jasper).toMatchObject({ metaTitle: "Jasper, compared" });
  });

  it("saves nothing when one page was saved by someone else since it was read", async () => {
    const { t, editor } = await boot(dialect);
    await post(t, { title: "Surfer vs Rext", slug: "surfer" });
    const jasperId = await post(t, { title: "Jasper vs Rext", slug: "jasper" });
    const read = await rows(editor);
    await t.nextly.update({
      collection: "posts",
      id: jasperId,
      data: { excerpt: "Edited elsewhere", _overwrite: true },
    });
    const before = await seoBySlug(t);

    // Surfer comes first, so its change is written before Jasper's is refused.
    const ordered = [...read.rows].sort((a, b) =>
      a.label === "Surfer vs Rext" ? -1 : b.label === "Surfer vs Rext" ? 1 : 0
    );
    const response = await call(editor, "POST", "/bulk/save", {
      type: "posts",
      changes: ordered.map(row => ({
        id: row.id,
        rev: row.rev,
        title: `New ${row.label}`,
      })),
    });
    expect(response.status).toBe(409);
    const answer = (await response.json()) as { error: { message: string } };
    expect(answer.error.message).toContain(
      "“Jasper vs Rext” was saved by someone else"
    );
    expect(await seoBySlug(t)).toEqual(before);
  });

  it("refuses a change naming no version, and a page that is not a number", async () => {
    const { t, editor } = await boot(dialect);
    const id = await post(t, { title: "Surfer vs Rext", slug: "surfer" });
    const response = await call(editor, "POST", "/bulk/save", {
      type: "posts",
      changes: [{ id, title: "No version" }],
    });
    expect(response.status).toBe(400);
    expect((await seoBySlug(t)).surfer?.metaTitle ?? "").toBe("");
    const odd = await call(editor, "GET", "/bulk/rows?type=posts&page=1.5");
    expect(odd.status).toBe(400);
  });

  it("refuses a save from someone who may not change the type", async () => {
    const { t, reader } = await boot(dialect);
    const id = await post(t, { title: "Surfer vs Rext", slug: "surfer" });
    const response = await call(reader, "POST", "/bulk/save", {
      type: "posts",
      changes: [{ id, title: "Not allowed" }],
    });
    expect(response.status).toBe(403);
    expect((await seoBySlug(t)).surfer?.metaTitle ?? "").toBe("");
  });
});

describe.each(getConfiguredTestDialects())(
  "bulk edit on a translated site, and a type keeping drafts (%s)",
  dialect => {
    async function bootTranslated() {
      const t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        plugins: [
          seoPlugin({
            collections: ["posts", "drafts", "secured"],
            sitemap: false,
          }),
        ],
        collections: [
          defineCollection({
            slug: "posts",
            localized: true,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
          defineCollection({
            slug: "drafts",
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/notes/{slug}",
          }),
          // Asks for drafts, but holds a password, so core keeps none.
          defineCollection({
            slug: "secured",
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              text({ name: "slug" }),
              password({ name: "secret" }),
            ],
            publicAddress: "/secured/{slug}",
          }),
        ],
      });
      current = t;
      const owner = await t.nextly.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const keys = t.getService("apiKeyService") as unknown as {
        createApiKey(
          userId: string,
          input: { name: string; tokenType: string; expiresIn: string }
        ): Promise<{ key: string }>;
      };
      // The owner's own key: the site's first person may do anything.
      const { key } = await keys.createApiKey(String(owner.item.id), {
        name: "owner key",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      return { t, key };
    }

    it("reads and saves in the default language, and refuses another", async () => {
      const { t, key } = await bootTranslated();
      const created = await t.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Harbour", slug: "harbour" },
      });
      const id = String(created.item.id);
      const german = await call(key, "GET", "/bulk/rows?type=posts&locale=de");
      expect(german.status).toBe(400);
      const saved = await call(key, "POST", "/bulk/save", {
        type: "posts",
        locale: "de",
        changes: [{ id, title: "Hafen" }],
      });
      expect(saved.status).toBe(400);
      const english = await call(key, "GET", "/bulk/rows?type=posts&locale=en");
      expect(english.status, await english.clone().text()).toBe(200);
    });

    it("shows the pages of a type keeping drafts read-only, and saves none", async () => {
      const { t, key } = await bootTranslated();
      const created = await t.nextly.create({
        collection: "drafts",
        data: { title: "Note", slug: "note", status: "published" },
      });
      const id = String(created.item.id);
      const types = (await (
        await call(key, "GET", "/bulk/types")
      ).json()) as BulkTypesBody;
      expect(types.types.find(type => type.slug === "drafts")?.drafts).toBe(
        true
      );
      const read = await call(key, "GET", "/bulk/rows?type=drafts");
      const rows = ((await read.json()) as BulkRowsBody).rows;
      expect(rows.find(row => row.id === id)?.editable).toBe(false);
      const saved = await call(key, "POST", "/bulk/save", {
        type: "drafts",
        changes: [{ id, title: "Changed" }],
      });
      expect(saved.status).toBe(403);

      // A type that asks for drafts but cannot keep them saves as any other.
      const secured = await t.nextly.create({
        collection: "secured",
        data: { title: "Vault", slug: "vault", status: "published" },
      });
      const securedRows = (
        (await (
          await call(key, "GET", "/bulk/rows?type=secured")
        ).json()) as BulkRowsBody
      ).rows;
      expect(
        securedRows.find(row => row.id === String(secured.item.id))?.editable
      ).toBe(true);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "bulk edit where a field of the site's own SEO group refuses a change (%s)",
  dialect => {
    it("saves nothing, rather than answer for a title the field kept out", async () => {
      const t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [
          seoPlugin({
            collections: ["posts"],
            sitemap: false,
            // The title may never be changed; the description may.
            fields: [
              text({ name: "metaTitle", access: { update: () => false } }),
              textarea({ name: "metaDescription" }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });
      current = t;
      const owner = await t.nextly.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const keys = t.getService("apiKeyService") as unknown as {
        createApiKey(
          userId: string,
          input: { name: string; tokenType: string; expiresIn: string }
        ): Promise<{ key: string }>;
      };
      const { key } = await keys.createApiKey(String(owner.item.id), {
        name: "owner key",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      await post(t, { title: "Surfer", slug: "surfer" });
      await post(t, { title: "Jasper", slug: "jasper" });
      const read = (await (
        await call(key, "GET", "/bulk/rows?type=posts")
      ).json()) as BulkRowsBody;
      const surfer = read.rows.find(row => row.label === "Surfer");
      const jasper = read.rows.find(row => row.label === "Jasper");
      const before = await seoBySlug(t);
      const response = await call(key, "POST", "/bulk/save", {
        type: "posts",
        changes: [
          { id: surfer?.id, rev: surfer?.rev, description: "Allowed" },
          { id: jasper?.id, rev: jasper?.rev, title: "Not allowed" },
        ],
      });
      expect(response.status).toBe(403);
      expect(await seoBySlug(t)).toEqual(before);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "bulk edit where a field of the site's own SEO group can't be read (%s)",
  dialect => {
    it("saves a field it can't read, keeps another, and names no hidden title", async () => {
      const t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [
          seoPlugin({
            collections: ["posts"],
            sitemap: false,
            // The title and canonical may be changed but never read.
            fields: [
              text({ name: "metaTitle", access: { read: () => false } }),
              text({ name: "canonical", access: { read: () => false } }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            fields: [
              // A page's name the editor may not read either.
              text({ name: "title", access: { read: () => false } }),
              text({ name: "slug" }),
            ],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });
      current = t;
      const owner = await t.nextly.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await t.nextly.permissions.find({ limit: 500 });
      const role = await t.nextly.roles.create({
        data: {
          name: "Editor here",
          slug: "editor-here",
          permissionIds: ["read-posts", "update-posts"].map(slug => {
            const found = seeded.items.find(item => item.slug === slug);
            if (found === undefined) throw new Error(`${slug} is not seeded`);
            return found.id;
          }),
        },
      });
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
      const { key } = await keys.createApiKey(String(owner.item.id), {
        name: "editor key",
        tokenType: "role-based",
        roleId: String(role.item.id),
        expiresIn: "unlimited",
      });
      await post(t, {
        title: "Surfer",
        slug: "surfer",
        seo: { canonical: "https://rext.ai/original" },
      });
      const read = (await (
        await call(key, "GET", "/bulk/rows?type=posts")
      ).json()) as BulkRowsBody;
      const [surfer] = read.rows;
      const response = await call(key, "POST", "/bulk/save", {
        type: "posts",
        changes: [
          { id: surfer?.id, rev: surfer?.rev, title: "Surfer, compared" },
        ],
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await seoBySlug(t)).surfer).toMatchObject({
        metaTitle: "Surfer, compared",
        canonical: "https://rext.ai/original",
      });
      // Saved again from the old version: refused, naming no hidden title.
      const stale = await call(key, "POST", "/bulk/save", {
        type: "posts",
        changes: [{ id: surfer?.id, rev: surfer?.rev, title: "Again" }],
      });
      expect(stale.status).toBe(409);
      expect(await stale.text()).not.toContain("Surfer");
    });
  }
);
