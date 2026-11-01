/**
 * Where an item is used, read over the admin's media route on every dialect:
 * one item used by an upload field, a rich-text image, a block document and
 * an email template is listed once per document, with the fields that use it
 * and the languages that do; a reader who may not read one collection is
 * told how many of its documents use the item, and nothing else about them.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaHandlers } from "../../../api/media-handlers";
import {
  defineCollection,
  json,
  richText,
  text,
  upload,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";

type Doc = Record<string, unknown>;

const ITEM = { id: randomUUID(), url: "/uploads/2026/10/uses-logo.png" };

/** A rich-text value showing one image, by its address. */
function imageText(url: string): Doc {
  return {
    root: {
      type: "root",
      version: 1,
      children: [{ type: "image", version: 1, src: url, altText: "" }],
    },
  };
}

/** The ids of these seeded grants, seeding the system ones first. */
async function grantIds(t: TestNextly, slugs: string[]): Promise<string[]> {
  const nextly = t.nextly as unknown as {
    permissions: {
      find: (a: { page: number; limit: number }) => Promise<{
        items: { id: string; slug: string }[];
        meta: { hasNext: boolean };
      }>;
    };
  };
  await (
    t.getService("permissionSeedService") as {
      seedSystemPermissions: () => Promise<unknown>;
    }
  ).seedSystemPermissions();
  const seeded: { id: string; slug: string }[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await nextly.permissions.find({ page, limit: 100 });
    seeded.push(...listed.items);
    if (!listed.meta.hasNext) break;
  }
  return slugs.map(slug => {
    const found = seeded.find(p => p.slug === slug);
    expect(found, `\`${slug}\` must be seeded`).toBeDefined();
    return found!.id;
  });
}

/** An API key of a role holding exactly these grants, for a plain user. */
async function keyWith(t: TestNextly, grants: string[]): Promise<string> {
  const userId = await seedPlainAuthor(t);
  const slug = `uses-reader-${randomUUID().slice(0, 8)}`;
  const role = await (
    t.nextly as unknown as {
      roles: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    }
  ).roles.create({
    data: { name: slug, slug, permissionIds: await grantIds(t, grants) },
  });
  await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
    userId,
    role.item.id
  );
  const apiKeys = t.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(userId, {
    name: slug,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

/** `GET /admin/api/media/:id/usage` as the holder of `key`. */
async function usageOf(
  key: string,
  mediaId: string
): Promise<{ status: number; json: Doc }> {
  const path = [mediaId, "usage"];
  const res = await createMediaHandlers({ requireAuth: true }).GET(
    new Request(`http://localhost/admin/api/media/${path.join("/")}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

describe.each(getConfiguredTestDialects())(
  "where a media item is used (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let postId: string;
    let secretId: string;
    let templateId: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: {
          locales: ["en", "es"],
          defaultLocale: "en",
          fallback: false,
        },
        collections: [
          defineCollection({
            slug: "usesposts",
            labels: { singular: "Post", plural: "Posts" },
            localized: true,
            fields: [
              text({ name: "title" }),
              upload({ name: "cover", relationTo: "media" }),
              richText({ name: "body", localized: true }),
              json({ name: "layout" }),
            ],
          }),
          // Readable in every language but Spanish.
          defineCollection({
            slug: "usesguides",
            labels: { singular: "Guide", plural: "Guides" },
            localized: true,
            access: { read: ({ locale }) => locale !== "es" },
            fields: [
              text({ name: "title" }),
              richText({ name: "body", localized: true }),
            ],
          }),
          // Readable in every language but English, the default one.
          defineCollection({
            slug: "usesnotes",
            labels: { singular: "Note", plural: "Notes" },
            localized: true,
            access: { read: ({ locale }) => locale !== "en" },
            fields: [
              text({ name: "title" }),
              richText({ name: "body", localized: true }),
            ],
          }),
          defineCollection({
            slug: "usessecrets",
            labels: { singular: "Secret", plural: "Secrets" },
            fields: [
              text({ name: "title" }),
              upload({ name: "image", relationTo: "media" }),
            ],
          }),
          // One field read only with a grant no reader in this file holds.
          defineCollection({
            slug: "usesprivate",
            labels: { singular: "Profile", plural: "Profiles" },
            fields: [
              text({ name: "title" }),
              upload({ name: "image", relationTo: "media" }),
              upload({
                name: "privateImage",
                relationTo: "media",
                access: {
                  read: ({ permissions }) =>
                    permissions.includes("read-private-images"),
                },
              }),
            ],
          }),
        ],
      });
      await t.adapter.insert("media", {
        id: ITEM.id,
        filename: ITEM.url.slice("/uploads/".length),
        originalFilename: "logo.png",
        mimeType: "image/png",
        size: 1,
        url: ITEM.url,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });

      const handler = t.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "usesposts", overrideAccess: true, locale: "en" },
        {
          title: "Launch",
          cover: ITEM.id,
          body: imageText(ITEM.url),
          // A block document, which lists the items it uses.
          layout: {
            formatVersion: 1,
            kind: "page",
            nodes: [],
            assets: { mediaIds: [ITEM.id] },
          },
        }
      );
      postId = String((created.data as { id?: unknown }).id);
      const secret = await handler.createEntry(
        { collectionName: "usessecrets", overrideAccess: true },
        { title: "Hidden", image: ITEM.id }
      );
      secretId = String((secret.data as { id?: unknown }).id);

      const template = await t
        .getService("emailTemplateService")
        .createTemplate({
          name: "Welcome",
          slug: `uses-welcome-${dialect}`,
          subject: "Hello",
          htmlContent: "<p>Hi</p>",
          attachments: [{ mediaId: ITEM.id }],
        });
      templateId = template.id;
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("lists every document using the item, with its fields and languages", async () => {
      const key = await keyWith(t, [
        "read-media",
        "read-usesposts",
        "read-usessecrets",
        "read-email-templates",
      ]);
      const { status, json: body } = await usageOf(key, ITEM.id);

      expect(status).toBe(200);
      expect(body.items).toEqual([
        {
          kind: "collection",
          slug: "usesposts",
          documentId: postId,
          title: "Launch",
          owner: "Posts",
          fields: [
            // The translated rich text uses it in English alone.
            {
              path: "body",
              locales: ["en"],
              byAddress: true,
              showsPreviousFile: false,
            },
            {
              path: "cover",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
            {
              path: "layout",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
          ],
        },
        {
          kind: "collection",
          slug: "usessecrets",
          documentId: secretId,
          title: "Hidden",
          owner: "Secrets",
          fields: [
            {
              path: "image",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
          ],
        },
        {
          kind: "email-template",
          slug: "",
          documentId: templateId,
          title: "Welcome",
          owner: "Email templates",
          fields: [
            {
              path: "attachments",
              locales: [],
              byAddress: false,
              showsPreviousFile: false,
            },
          ],
        },
      ]);
      expect(body.meta).not.toHaveProperty("hidden");
    });

    // A reader may read a document and still not one of its fields: Used in
    // tells them neither that field's name nor that it uses the item, as a
    // read of the document withholds its value.
    it("tells only the fields a field read rule lets the reader read", async () => {
      const handler = t.getService("collectionsHandler");
      const both = await handler.createEntry(
        { collectionName: "usesprivate", overrideAccess: true },
        { title: "Both", image: ITEM.id, privateImage: ITEM.id }
      );
      const bothId = String((both.data as { id?: unknown }).id);
      const only = await handler.createEntry(
        { collectionName: "usesprivate", overrideAccess: true },
        { title: "Only private", privateImage: ITEM.id }
      );
      const onlyId = String((only.data as { id?: unknown }).id);
      const key = await keyWith(t, ["read-media", "read-usesprivate"]);
      try {
        // As an ordinary read of the documents shows them to this reader.
        const read = await createMediaHandlers({ requireAuth: true }).GET(
          new Request(`http://localhost/admin/api/media/${ITEM.id}/usage`, {
            headers: { authorization: `Bearer ${key}` },
          }),
          { params: Promise.resolve({ path: [ITEM.id, "usage"] }) }
        );
        const body = (await read.json()) as Doc;

        const items = (body.items as Doc[]).filter(
          item => item.slug === "usesprivate"
        );
        expect(items).toEqual([
          expect.objectContaining({
            documentId: bothId,
            fields: [
              {
                path: "image",
                locales: [],
                byAddress: false,
                showsPreviousFile: false,
              },
            ],
          }),
        ]);
        expect(JSON.stringify(body)).not.toContain("privateImage");
        expect(JSON.stringify(body)).not.toContain(onlyId);
        // The document using it only there is counted, never named.
        expect(
          (body.meta as { hidden?: Doc[] }).hidden?.find(
            scope => scope.scopeSlug === "usesprivate"
          )
        ).toMatchObject({ count: 1 });
      } finally {
        for (const entryId of [bothId, onlyId]) {
          await handler.deleteEntry({
            collectionName: "usesprivate",
            entryId,
            overrideAccess: true,
          });
        }
      }
    });

    it("counts the documents a reader may not read, naming none of them", async () => {
      const key = await keyWith(t, ["read-media", "read-usesposts"]);
      const { status, json: body } = await usageOf(key, ITEM.id);

      expect(status).toBe(200);
      expect(
        (body.items as Doc[]).map(item => [item.slug, item.documentId])
      ).toEqual([["usesposts", postId]]);
      expect((body.meta as Doc).hidden).toEqual([
        { scopeKind: "collection", scopeSlug: "usessecrets", count: 1 },
        { scopeKind: "email-template", scopeSlug: "", count: 1 },
      ]);
      const sent = JSON.stringify(body);
      expect(sent).not.toContain(secretId);
      expect(sent).not.toContain("Hidden");
      expect(sent).not.toContain("Welcome");
    });

    /**
     * An entry of `collection` whose rich text names `url` in each of
     * `languages`, its id.
     */
    async function translatedUse(
      collection: string,
      url: string,
      languages: string[]
    ): Promise<string> {
      const handler = t.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: collection, overrideAccess: true, locale: "en" },
        {
          title: `${collection} entry`,
          ...(languages.includes("en") ? { body: imageText(url) } : {}),
        }
      );
      const id = String((created.data as { id?: unknown }).id);
      for (const language of languages.filter(code => code !== "en")) {
        await handler.updateEntry(
          {
            collectionName: collection,
            entryId: id,
            overrideAccess: true,
            locale: language,
          },
          { title: `${collection} ${language}`, body: imageText(url) }
        );
      }
      return id;
    }

    it("tells each language's use only where the reader may read the document in that language", async () => {
      const item = {
        id: randomUUID(),
        url: `/uploads/2026/10/${randomUUID()}.png`,
      };
      await t.adapter.insert("media", {
        id: item.id,
        filename: item.url.slice("/uploads/".length),
        originalFilename: "per-language.png",
        mimeType: "image/png",
        size: 1,
        url: item.url,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });
      // Used in English and Spanish, readable in English alone.
      const guide = await translatedUse("usesguides", item.url, ["en", "es"]);
      // Used in Spanish alone, which is refused.
      const spanishGuide = await translatedUse("usesguides", item.url, ["es"]);
      // Used in Spanish alone, readable in Spanish though not in English.
      const note = await translatedUse("usesnotes", item.url, ["es"]);
      const key = await keyWith(t, [
        "read-media",
        "read-usesguides",
        "read-usesnotes",
      ]);

      const { status, json: body } = await usageOf(key, item.id);

      expect(status).toBe(200);
      const told = (body.items as Doc[]).map(use => [
        use.documentId,
        (use.fields as Array<{ path: string; locales: string[] }>).map(
          field => [field.path, field.locales]
        ),
      ]);
      expect(told).toEqual([
        [guide, [["body", ["en"]]]],
        [note, [["body", ["es"]]]],
      ]);
      expect((body.meta as Doc).hidden).toEqual([
        { scopeKind: "collection", scopeSlug: "usesguides", count: 1 },
      ]);
      // Nothing of the refused translation is sent.
      expect(JSON.stringify(body)).not.toContain(spanishGuide);
    });

    it("refuses a caller who may not read media, and answers an unknown item as not found", async () => {
      const noMedia = await keyWith(t, ["read-usesposts"]);
      expect((await usageOf(noMedia, ITEM.id)).status).toBe(403);

      const reader = await keyWith(t, ["read-media"]);
      expect((await usageOf(reader, randomUUID())).status).toBe(404);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "where a media item is used, before the usage table exists (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeAll(async () => {
      // Its own install, so the table's presence is asked afresh: once
      // found, an install remembers it.
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      await t.adapter.insert("media", {
        id: ITEM.id,
        filename: ITEM.url.slice("/uploads/".length),
        originalFilename: "logo.png",
        mimeType: "image/png",
        size: 1,
        url: ITEM.url,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });
      // As on a site that has not run the migration creating it.
      await t.adapter.executeQuery("DROP TABLE nextly_media_usage");
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("answers no uses, with the record unbuilt, rather than failing", async () => {
      const reader = await keyWith(t, ["read-media"]);

      const answer = await usageOf(reader, ITEM.id);

      expect(answer.status).toBe(200);
      expect(answer.json.items).toEqual([]);
      expect(answer.json.meta).toMatchObject({
        total: 0,
        usageRecorded: false,
      });
    });
  }
);
