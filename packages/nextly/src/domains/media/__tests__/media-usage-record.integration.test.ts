/**
 * The stored record of which media items content uses, on every dialect: it
 * is written in the transaction of each write that changes a document, by
 * field and language; it goes with a deleted document and a deleted item;
 * a write that fails leaves it as it was; the rebuild command rebuilds the
 * same record from the content; and one item's uses are read from it in one
 * query.
 *
 * A document here refers to items in every way content can: an upload field
 * (one id, and a list of ids), a translated rich-text image, a group and a
 * repeater holding uploads, a field group holding one, a block document's
 * `assets.mediaIds`, a Single's upload, and an email template's attachment
 * and `<img>`.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";
import { inspect } from "node:util";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  json,
  repeater,
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
import { MEDIA_USAGE_TABLE } from "../../../schemas/media-usage/table-name";
import type { LanguageRegistry } from "../../i18n/language-registry";
import { LanguageSettingsService } from "../../i18n/services/language-settings-service";
import type { MediaType } from "../../../types/media";
import { mediaCategoryOf } from "../media-categories";
import {
  listMediaUsage,
  MEDIA_USAGE_RECORDED_KEY,
} from "../usage/media-usage-store";
import { reindexMediaUsage } from "../usage/reindex-usage";

type Doc = Record<string, unknown>;

/**
 * Set to make the next rewrite of a template's usage fail, as a database
 * error part way through it would; otherwise the record is written as ever.
 */
const templateUsage = vi.hoisted(() => ({ failNext: false }));
vi.mock("../usage/email-template-usage", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../usage/email-template-usage")>();
  return {
    ...actual,
    recordEmailTemplateUsage: (
      ...args: Parameters<typeof actual.recordEmailTemplateUsage>
    ) => {
      if (templateUsage.failNext) {
        templateUsage.failNext = false;
        return Promise.reject(new Error("the usage write failed"));
      }
      return actual.recordEmailTemplateUsage(...args);
    },
  };
});

const OPEN = {
  create: () => true,
  read: () => true,
  update: () => true,
  delete: () => true,
  publish: () => true,
  unpublish: () => true,
};

/** Six items, each with an address a rich-text image can name. */
const ITEMS = Array.from({ length: 6 }, (_, i) => ({
  id: randomUUID(),
  url: `/uploads/2026/10/usage-${i}.png`,
}));
const [A, B, C, D, E, F] = ITEMS;

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

/** A block document listing the items it uses. */
function blockDocument(mediaIds: string[]): Doc {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [],
    assets: { mediaIds },
  };
}

/** Every kind of file the library names. */
const MEDIA_CATEGORIES: readonly MediaType[] = [
  "image",
  "video",
  "audio",
  "document",
  "other",
];

/** One stored row, as `kind slug document field locale item`. */
type UsageLine = string;

function line(row: Doc): UsageLine {
  const read = (property: string, column: string): string =>
    String(row[property] ?? row[column] ?? "");
  return [
    read("subjectKind", "subject_kind"),
    read("subjectSlug", "subject_slug"),
    read("documentId", "document_id"),
    read("fieldPath", "field_path"),
    read("locale", "locale") || "-",
    read("mediaId", "media_id"),
  ].join(" ");
}

async function recorded(t: TestNextly): Promise<UsageLine[]> {
  const rows = await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {});
  return rows.map(line).sort();
}

/** The lines one document has in the record. */
async function recordedFor(
  t: TestNextly,
  kind: string,
  slug: string,
  documentId: string
): Promise<UsageLine[]> {
  const prefix = `${kind} ${slug} ${documentId} `;
  return (await recorded(t)).filter(l => l.startsWith(prefix));
}

function expected(
  kind: string,
  slug: string,
  documentId: string,
  uses: Array<[field: string, locale: string, mediaId: string]>
): UsageLine[] {
  return uses
    .map(([field, locale, mediaId]) =>
      [kind, slug, documentId, field, locale || "-", mediaId].join(" ")
    )
    .sort();
}

describe.each(getConfiguredTestDialects())(
  "the media usage record (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: {
          locales: ["en", "es"],
          defaultLocale: "en",
          fallback: false,
        },
        fieldGroups: [
          defineFieldGroup({
            slug: "usagehero",
            fields: [
              text({ name: "heading" }),
              upload({ name: "image", relationTo: "media" }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "usageposts",
            localized: true,
            status: true,
            versions: { drafts: true },
            access: OPEN,
            fields: [
              text({ name: "title" }),
              upload({ name: "cover", relationTo: "media" }),
              upload({ name: "gallery", relationTo: "media", hasMany: true }),
              richText({ name: "body", localized: true }),
              group({
                name: "card",
                fields: [upload({ name: "photo", relationTo: "media" })],
              }),
              repeater({
                name: "items",
                fields: [upload({ name: "photo", relationTo: "media" })],
              }),
              fieldGroup({ name: "hero", component: "usagehero" }),
              json({ name: "layout" }),
            ],
          }),
          defineCollection({
            slug: "usagenotes",
            access: OPEN,
            fields: [
              text({ name: "title" }),
              upload({ name: "image", relationTo: "media" }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "usagesite",
            access: { read: () => true, update: () => true },
            fields: [upload({ name: "logo", relationTo: "media" })],
          }),
        ],
      });
      for (const item of ITEMS) {
        await t.adapter.insert("media", {
          id: item.id,
          filename: item.url.slice("/uploads/".length),
          originalFilename: "usage.png",
          mimeType: "image/png",
          size: 1,
          url: item.url,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    afterAll(async () => {
      await t?.destroy();
    });

    const handler = () => t.getService("collectionsHandler");

    async function createPost(data: Doc, locale = "en"): Promise<string> {
      const created = await handler().createEntry(
        { collectionName: "usageposts", overrideAccess: true, locale },
        data
      );
      const id = (created.data as { id?: unknown } | undefined)?.id;
      if (typeof id !== "string") {
        throw new Error(`no id from create: ${JSON.stringify(created)}`);
      }
      return id;
    }

    async function updatePost(
      id: string,
      data: Doc,
      locale = "en"
    ): Promise<void> {
      const updated = await handler().updateEntry(
        {
          collectionName: "usageposts",
          entryId: id,
          overrideAccess: true,
          locale,
        },
        data
      );
      expect(updated).toMatchObject({ success: true });
    }

    it("records every item a new entry uses, by field and language", async () => {
      const id = await createPost({
        title: "One",
        cover: A.id,
        gallery: [B.id, C.id],
        body: imageText(D.url),
        card: { photo: E.id },
        items: [{ photo: F.id }, { photo: A.id }],
        hero: { heading: "Hi", image: B.id },
        layout: blockDocument([C.id]),
      });

      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [
          ["cover", "", A.id],
          ["gallery", "", B.id],
          ["gallery", "", C.id],
          ["body", "en", D.id],
          ["card.photo", "", E.id],
          ["items.photo", "", F.id],
          ["items.photo", "", A.id],
          ["hero.image", "", B.id],
          ["layout", "", C.id],
        ])
      );
    });

    it("keeps each language's uses apart, and replaces what an update changes", async () => {
      const id = await createPost({ title: "Two", body: imageText(A.url) });
      await updatePost(id, { body: imageText(B.url) }, "es");

      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [
          ["body", "en", A.id],
          ["body", "es", B.id],
        ])
      );

      // An update that changes one field replaces only what that field used.
      await updatePost(id, { cover: C.id, body: imageText(D.url) });
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [
          ["cover", "", C.id],
          ["body", "en", D.id],
          ["body", "es", B.id],
        ])
      );

      // Emptied, the field uses nothing.
      await updatePost(id, { cover: null });
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [
          ["body", "en", D.id],
          ["body", "es", B.id],
        ])
      );
    });

    it("records nothing for an address or an id that is not a media item", async () => {
      const id = await createPost({
        title: "Three",
        cover: randomUUID(),
        body: imageText("https://example.com/elsewhere.png"),
      });

      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual([]);
    });

    it("records a write through the transaction API, and a write that fails leaves the record as it was", async () => {
      const id = await createPost({ title: "Four", cover: A.id });
      const entries = handler().getEntryService();

      await t.adapter.transaction(tx =>
        entries.updateEntryInTransaction(
          tx as never,
          { collectionName: "usageposts", entryId: id, overrideAccess: true },
          { cover: B.id }
        )
      );
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [["cover", "", B.id]])
      );

      // The update writes the record inside the transaction, which then
      // fails: both go.
      await expect(
        t.adapter.transaction(async tx => {
          await entries.updateEntryInTransaction(
            tx as never,
            {
              collectionName: "usageposts",
              entryId: id,
              overrideAccess: true,
            },
            { cover: C.id }
          );
          throw new Error("the write after it failed");
        })
      ).rejects.toThrow("the write after it failed");
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [["cover", "", B.id]])
      );
    });

    it("counts a held draft's items once it is published, and not before", async () => {
      const id = await createPost({
        title: "Five",
        cover: A.id,
        status: "published",
      });
      // Published, so this edit is held as a working draft.
      await updatePost(id, { cover: B.id });
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [["cover", "", A.id]])
      );

      // Publishing it puts the draft live.
      await updatePost(id, { status: "published" });
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [["cover", "", B.id]])
      );

      // Publishing or unpublishing every language moves no content here, so
      // the document still uses what it holds.
      const published = await handler().publishAllLocales({
        collectionName: "usageposts",
        entryId: id,
        overrideAccess: true,
      });
      expect(published).toMatchObject({ success: true });
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [["cover", "", B.id]])
      );
      const unpublished = await handler().unpublishAllLocales({
        collectionName: "usageposts",
        entryId: id,
        overrideAccess: true,
      });
      expect(unpublished).toMatchObject({ success: true });
      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual(
        expected("collection", "usageposts", id, [["cover", "", B.id]])
      );
    });

    it("forgets a deleted entry's uses", async () => {
      const id = await createPost({ title: "Six", cover: A.id });
      const deleted = await handler().deleteEntry({
        collectionName: "usageposts",
        entryId: id,
        overrideAccess: true,
      });
      expect(deleted).toMatchObject({ success: true });

      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual([]);
    });

    it("records a Single's uses, under the Single alone", async () => {
      await t.nextly.updateSingle({
        slug: "usagesite",
        data: { logo: A.id },
        overrideAccess: true,
      });
      expect(await recordedFor(t, "single", "usagesite", "")).toEqual(
        expected("single", "usagesite", "", [["logo", "", A.id]])
      );

      await t.nextly.updateSingle({
        slug: "usagesite",
        data: { logo: B.id },
        overrideAccess: true,
      });
      expect(await recordedFor(t, "single", "usagesite", "")).toEqual(
        expected("single", "usagesite", "", [["logo", "", B.id]])
      );
    });

    it("records an email template's attachment and image, and forgets a deleted one", async () => {
      const templates = t.getService("emailTemplateService");
      const created = await templates.createTemplate({
        name: "Usage",
        slug: `usage-${dialect}`,
        subject: "Hello",
        htmlContent: `<p>Hi</p><img alt="" src="${A.url}">`,
        attachments: [{ mediaId: B.id }],
      });
      expect(await recordedFor(t, "email-template", "", created.id)).toEqual(
        expected("email-template", "", created.id, [
          ["attachments", "", B.id],
          ["htmlContent", "", A.id],
        ])
      );

      await templates.updateTemplate(created.id, {
        htmlContent: `<p>Hi</p><img src='${C.url}' alt="">`,
      });
      expect(await recordedFor(t, "email-template", "", created.id)).toEqual(
        expected("email-template", "", created.id, [
          ["attachments", "", B.id],
          ["htmlContent", "", C.id],
        ])
      );

      await templates.deleteTemplate(created.id);
      expect(await recordedFor(t, "email-template", "", created.id)).toEqual(
        []
      );
    });

    it("reads one item's uses from the record alone, in one query", async () => {
      const id = await createPost({ title: "Seven", cover: E.id });
      // Every statement the read makes, by the table it reads.
      const read: string[] = [];
      const counting = {
        select: <T>(
          table: string,
          options?: Parameters<TestNextly["adapter"]["select"]>[1]
        ): Promise<T[]> => {
          read.push(table);
          return t.adapter.select<T>(table, options);
        },
      };

      const uses = await listMediaUsage(counting, E.id);

      expect(read).toEqual([MEDIA_USAGE_TABLE]);
      expect(uses).toContainEqual({
        mediaId: E.id,
        subjectKind: "collection",
        subjectSlug: "usageposts",
        documentId: id,
        fieldPath: "cover",
        locale: "",
      });
    });

    it("rebuilds the same record from the stored content", async () => {
      // A document in another collection, so the rebuild reads more than one.
      await handler().createEntry(
        { collectionName: "usagenotes", overrideAccess: true },
        { title: "Note", image: F.id }
      );
      const before = await recorded(t);
      expect(before.length).toBeGreaterThan(5);

      await t.adapter.delete(MEDIA_USAGE_TABLE, {
        and: [{ column: "id", op: "IS NOT NULL" }],
      });
      expect(await recorded(t)).toEqual([]);

      const result = await reindexMediaUsage({
        adapter: t.adapter,
        collections: {
          slugs: async () => ["usageposts", "usagenotes"],
          rebuild: slug =>
            t.getService("collectionService").rebuildMediaUsage(slug),
        },
        singles: {
          slugs: async () => ["usagesite"],
          rebuild: slug =>
            t.getService("singleEntryService").rebuildMediaUsage(slug),
        },
        meta: t.getService("metaService"),
      });

      expect(await recorded(t)).toEqual(before);
      expect(result.rows).toBe(before.length);
      expect(
        await t.getService("metaService").get(MEDIA_USAGE_RECORDED_KEY)
      ).not.toBeNull();
    });

    it("forgets an item's uses when the item is deleted", async () => {
      const item = { id: randomUUID(), url: "/uploads/2026/10/gone.png" };
      await t.adapter.insert("media", {
        id: item.id,
        filename: "2026/10/gone.png",
        originalFilename: "gone.png",
        mimeType: "image/png",
        size: 1,
        url: item.url,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });
      const id = await createPost({ title: "Eight", cover: item.id });
      expect(await recordedFor(t, "collection", "usageposts", id)).toHaveLength(
        1
      );

      await t.adapter.delete("media", {
        and: [{ column: "id", op: "=", value: item.id }],
      });

      expect(await recordedFor(t, "collection", "usageposts", id)).toEqual([]);
    });

    // Last in this suite: it deletes a collection the cases above write to.
    it("forgets every use by a deleted collection's entries, and keeps every other", async () => {
      await handler().createEntry(
        { collectionName: "usagenotes", overrideAccess: true },
        { title: "Gone with its collection", image: F.id }
      );
      const before = await recorded(t);
      const ofNotes = (l: string) => l.startsWith("collection usagenotes ");
      expect(before.filter(ofNotes).length).toBeGreaterThan(0);
      const others = before.filter(l => !ofNotes(l));
      expect(others.length).toBeGreaterThan(0);

      await t
        .getService("collectionRegistryService")
        .deleteCollection("usagenotes", { force: true });

      expect(await recorded(t)).toEqual(others);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the media library's counts and pages, from the database (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const FOLDER = randomUUID();
    const OTHER = randomUUID();
    /** The folder's five images, oldest first, two with alt text. */
    const inFolder = Array.from({ length: 5 }, (_, i) => ({
      id: randomUUID(),
      name: `photo-${i}.png`,
      alt: i < 2 ? "described" : i === 2 ? "  " : null,
    }));
    const used = randomUUID();

    async function insertItem(item: {
      id: string;
      name: string;
      mimeType?: string;
      alt?: string | null;
      folderId?: string | null;
      at?: Date;
    }): Promise<void> {
      await t.adapter.insert("media", {
        id: item.id,
        filename: `2026/10/${item.name}`,
        originalFilename: item.name,
        mimeType: item.mimeType ?? "image/png",
        size: 1,
        url: `/uploads/2026/10/${item.id}-${item.name}`,
        altText: item.alt ?? null,
        folderId: item.folderId ?? null,
        uploadedAt: item.at ?? new Date(),
        updatedAt: new Date(),
      });
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "countnotes",
            access: OPEN,
            fields: [upload({ name: "image", relationTo: "media" })],
          }),
        ],
      });
      await t.adapter.insert("users", {
        id: "count-owner",
        email: "count-owner@test.local",
      });
      for (const [id, name] of [
        [FOLDER, "Photos"],
        [OTHER, "Files"],
      ]) {
        await t.adapter.insert("media_folders", {
          id,
          name,
          createdBy: "count-owner",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      for (const [i, item] of inFolder.entries()) {
        await insertItem({
          ...item,
          folderId: FOLDER,
          at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)),
        });
      }
      // In no folder: an image with no alt text, which a note uses, and a
      // document, which needs none.
      await insertItem({ id: used, name: "used.png" });
      await insertItem({
        id: randomUUID(),
        name: "terms.pdf",
        mimeType: "application/pdf",
      });
      // In the other folder: one image with no alt text.
      await insertItem({
        id: randomUUID(),
        name: "other.png",
        folderId: OTHER,
      });
      const note = await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "countnotes", overrideAccess: true },
          { image: used }
        );
      expect(note).toMatchObject({ success: true });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    const media = () => t.getService("mediaService");

    it("counts every folder's items and each view's in one statement", async () => {
      await t.getService("metaService").set(MEDIA_USAGE_RECORDED_KEY, {
        rebuiltAt: new Date().toISOString(),
      });
      // Asked once first, so the usage table's presence is remembered and
      // the statements counted below are the counting itself.
      await media().countLibrary({});
      let statements = 0;
      const original = t.adapter.getDrizzle.bind(t.adapter);
      const counting = (...args: Parameters<typeof original>) => {
        const db = original(...args) as object;
        return new Proxy(db, {
          get(target, property, receiver) {
            if (property === "select") statements += 1;
            const value: unknown = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      };
      t.adapter.getDrizzle = counting as typeof t.adapter.getDrizzle;
      let counts;
      try {
        counts = await media().countLibrary({});
      } finally {
        t.adapter.getDrizzle = original as typeof t.adapter.getDrizzle;
      }

      expect(statements).toBe(1);
      expect(counts).toEqual({
        all: 8,
        // The two images in no folder or the other folder with none, and the
        // folder's blank one and its two with none; never the document.
        missingAltText: 5,
        unused: 7,
        usageRecorded: true,
        root: 2,
        folders: { [FOLDER]: 5, [OTHER]: 1 },
      });
    });

    it("says the record is still being built until it has been rebuilt", async () => {
      await t.getService("metaService").delete(MEDIA_USAGE_RECORDED_KEY);

      expect(await media().countLibrary({})).toMatchObject({
        usageRecorded: false,
      });
    });

    it("pages a folder's items in the database, sorted and narrowed there", async () => {
      const page = (query: Record<string, unknown>) =>
        media().getFolderContents(FOLDER, {}, query);

      const second = await page({
        page: 2,
        limit: 2,
        sortBy: "uploadedAt",
        sortOrder: "asc",
      });
      expect(second.files.map(file => file.id)).toEqual([
        inFolder[2].id,
        inFolder[3].id,
      ]);
      expect(second.meta).toEqual({
        total: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
      });

      // The last page holds what is left.
      const last = await page({ page: 3, limit: 2, sortOrder: "asc" });
      expect(last.files.map(file => file.id)).toEqual([inFolder[4].id]);

      // A search narrows the count as well as the page.
      const searched = await page({ search: "PHOTO-1" });
      expect(searched.files.map(file => file.id)).toEqual([inFolder[1].id]);
      expect(searched.meta.total).toBe(1);

      // The items in no folder are the root's, paged the same way.
      const root = await media().getFolderContents(null, {}, { limit: 1 });
      expect(root.files).toHaveLength(1);
      expect(root.meta).toMatchObject({ total: 2, totalPages: 2 });
    });

    it("lists each view's items across every folder, as its count counts them", async () => {
      const missing = await media().listMedia(
        { view: "missing-alt", limit: 100 },
        {}
      );
      expect(missing.pagination.total).toBe(5);
      expect(missing.data.map(file => file.id)).not.toContain(inFolder[0].id);

      const unused = await media().listMedia(
        { view: "unused", limit: 100 },
        {}
      );
      expect(unused.pagination.total).toBe(7);
      expect(unused.data.map(file => file.id)).not.toContain(used);
    });

    // Last in this suite: it adds items the counts above do not expect. A
    // kind of file is the one the library shows each item as: a PDF, an
    // office file and any text are documents, and what no kind names is
    // other.
    it("narrows to each kind of file as the library names it", async () => {
      const csv = randomUUID();
      const sheet = randomUUID();
      const zip = randomUUID();
      await insertItem({ id: csv, name: "list.csv", mimeType: "text/csv" });
      await insertItem({
        id: sheet,
        name: "sums.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      await insertItem({
        id: zip,
        name: "all.zip",
        mimeType: "application/zip",
      });
      const ofType = async (type: MediaType) =>
        (await media().listMedia({ type, limit: 100 }, {})).data
          .map(file => file.originalFilename)
          .sort();

      expect(await ofType("document")).toEqual([
        "list.csv",
        "sums.xlsx",
        "terms.pdf",
      ]);
      expect(await ofType("other")).toEqual(["all.zip"]);
      expect(await ofType("image")).toHaveLength(7);
      // Each kind holds exactly the items the library shows as that kind,
      // and together they hold every item.
      let counted = 0;
      for (const type of MEDIA_CATEGORIES) {
        const files = (await media().listMedia({ type, limit: 100 }, {})).data;
        for (const file of files) {
          expect(mediaCategoryOf(file.mimeType)).toBe(type);
        }
        counted += files.length;
      }
      expect(counted).toBe(
        (await media().listMedia({ limit: 100 }, {})).pagination.total
      );
      // A folder's page narrows the same way.
      const root = await media().getFolderContents(
        null,
        {},
        { type: "document", limit: 100 }
      );
      expect(root.meta.total).toBe(3);
    });
  }
);

/** A field name of 45 characters, the `n`th of its kind. */
const longName = (n: number): string => `level${n}${"x".repeat(39)}`;

/** Upload fields `photoone` and `phototwo`, `depth` groups deep. */
function deepGroups(depth: number): ReturnType<typeof group> {
  let fields: Parameters<typeof group>[0]["fields"] = [
    upload({ name: "photoone", relationTo: "media" }),
    upload({ name: "phototwo", relationTo: "media" }),
  ];
  for (let level = depth; level >= 2; level--) {
    fields = [group({ name: longName(level), fields })];
  }
  return group({ name: longName(1), fields });
}

/** The value `deepGroups(depth)` stores, holding `one` and `two`. */
function deepValue(depth: number, one: string, two: string): Doc {
  let value: Doc = { photoone: one, phototwo: two };
  for (let level = depth; level >= 2; level--) {
    value = { [longName(level)]: value };
  }
  return value;
}

describe.each(getConfiguredTestDialects())(
  "the media usage record at the edges of what content holds (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    /** More items than one statement may name on SQLite, 7 columns a row. */
    const MANY = Array.from({ length: 160 }, (_, i) => ({
      id: randomUUID(),
      url: `/uploads/2026/10/many-${i}.png`,
    }));
    const [P, Q] = MANY;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: {
          locales: ["en", "es"],
          defaultLocale: "en",
          fallback: false,
        },
        fieldGroups: [
          // Translated, with a value every language shares.
          defineFieldGroup({
            slug: "usagepromo",
            localized: true,
            fields: [
              text({ name: "caption" }),
              upload({ name: "image", relationTo: "media" }),
              richText({ name: "blurb" }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "usagewide",
            access: OPEN,
            fields: [
              upload({ name: "gallery", relationTo: "media", hasMany: true }),
              deepGroups(6),
              json({ name: "fonts" }),
            ],
          }),
          defineCollection({
            slug: "usagepromos",
            access: OPEN,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "promo", component: "usagepromo" }),
            ],
          }),
        ],
      });
      for (const item of MANY) {
        await t.adapter.insert("media", {
          id: item.id,
          filename: item.url.slice("/uploads/".length),
          originalFilename: "many.png",
          mimeType: "image/png",
          size: 1,
          url: item.url,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    afterAll(async () => {
      await t?.destroy();
    });

    const handler = () => t.getService("collectionsHandler");

    async function create(collectionName: string, data: Doc): Promise<string> {
      const created = await handler().createEntry(
        { collectionName, overrideAccess: true, locale: "en" },
        data
      );
      const id = (created.data as { id?: unknown } | undefined)?.id;
      if (typeof id !== "string") {
        throw new Error(`no id from create: ${JSON.stringify(created)}`);
      }
      return id;
    }

    /**
     * Runs `work` with SQLite refusing a statement that binds more values
     * than the adapter says one may, as SQLite built with its long-standing
     * default of 999 does; the one the tests run on allows far more, so a
     * statement past the advertised limit would pass unseen. Elsewhere the
     * advertised limit is what the database enforces.
     */
    async function withAdvertisedParameterLimit<T>(
      work: () => Promise<T>
    ): Promise<T> {
      if (dialect !== "sqlite") return work();
      const limit = t.adapter.getCapabilities().maxParamsPerQuery;
      const connection = (
        t.adapter as unknown as {
          db: { prepare(sql: string): unknown } | null;
        }
      ).db;
      if (!connection) throw new Error("no SQLite connection to watch");
      const prepare = connection.prepare;
      connection.prepare = function (this: unknown, sql: string) {
        const bound = (sql.match(/\?/g) ?? []).length;
        if (bound > limit) throw new Error("too many SQL variables");
        return prepare.call(this, sql);
      };
      try {
        return await work();
      } finally {
        connection.prepare = prepare;
      }
    }

    it("records a document using more items than one statement may name", async () => {
      // The instrument refuses what it should: a lookup past the limit.
      if (dialect === "sqlite") {
        const refused: unknown = await withAdvertisedParameterLimit(() =>
          t.adapter.select("media", {
            where: {
              and: [
                {
                  column: "id",
                  op: "IN",
                  value: Array.from({ length: 1000 }, () => randomUUID()),
                },
              ],
            },
          })
        ).then(
          () => null,
          (error: unknown) => error
        );
        expect(inspect(refused, { depth: 5 })).toContain(
          "too many SQL variables"
        );
      }

      const id = await withAdvertisedParameterLimit(() =>
        create("usagewide", { gallery: MANY.map(item => item.id) })
      );
      const all = expected(
        "collection",
        "usagewide",
        id,
        MANY.map(item => ["gallery", "", item.id])
      );
      expect(await recordedFor(t, "collection", "usagewide", id)).toEqual(all);

      // The rebuild writes them the same way.
      await t.adapter.delete(MEDIA_USAGE_TABLE, {
        and: [{ column: "documentId", op: "=", value: id }],
      });
      await withAdvertisedParameterLimit(() =>
        t.getService("collectionService").rebuildMediaUsage("usagewide")
      );
      expect(await recordedFor(t, "collection", "usagewide", id)).toEqual(all);
    });

    // Six groups of 45-character names put the uploads' paths past the 255
    // characters MySQL's column holds; two paths that differ only past it
    // must stay two rows.
    it("records a field nested past the stored path's length, each field apart", async () => {
      const id = await create("usagewide", {
        [longName(1)]: deepValue(6, P.id, Q.id),
      });

      const rows = await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {
        where: { and: [{ column: "documentId", op: "=", value: id }] },
      });
      const paths = rows
        .map(row => String(row.fieldPath ?? row.field_path))
        .sort();
      const full = (name: string) =>
        [1, 2, 3, 4, 5, 6].map(longName).concat(name).join(".");
      expect(full("photoone").length).toBeGreaterThan(255);
      expect(paths).toHaveLength(2);
      expect(new Set(paths).size).toBe(2);
      for (const path of paths) {
        expect(path.length).toBeLessThanOrEqual(255);
        // As much of the path as fits is kept, readable.
        expect(full("photoone").startsWith(path.slice(0, 200))).toBe(true);
      }
      expect(
        rows.map(row => String(row.mediaId ?? row.media_id)).sort()
      ).toEqual([P.id, Q.id].sort());
    });

    // A translated field group's untranslated fields hold one value every
    // language reads: it is used once, by no language in particular.
    it("records a translated field group's shared upload once, and its translated text by language", async () => {
      const id = await create("usagepromos", {
        title: "Promo",
        promo: { caption: "Hi", image: P.id, blurb: imageText(Q.url) },
      });

      expect(await recordedFor(t, "collection", "usagepromos", id)).toEqual(
        expected("collection", "usagepromos", id, [
          ["promo.image", "", P.id],
          ["promo.blurb", "en", Q.id],
        ])
      );
    });

    // Content may name an item by its media route, as a Page Builder font
    // face does, or by its address made absolute against the site, as an
    // email's image must: either is a use.
    it("records an item named by its media route or by an absolute address", async () => {
      const id = await create("usagewide", {
        fonts: [{ family: "Brand", src: [{ url: `/api/media/${P.id}/raw` }] }],
      });
      expect(await recordedFor(t, "collection", "usagewide", id)).toEqual(
        expected("collection", "usagewide", id, [["fonts", "", P.id]])
      );

      const template = await t
        .getService("emailTemplateService")
        .createTemplate({
          name: "Absolute",
          slug: `usage-absolute-${dialect}`,
          subject: "Hello",
          htmlContent: `<img src="https://site.test${Q.url}">`,
        });
      expect(await recordedFor(t, "email-template", "", template.id)).toEqual(
        expected("email-template", "", template.id, [["htmlContent", "", Q.id]])
      );
    });

    // A template written while the calling flow has a transaction open keeps
    // its usage record beside it: when the record cannot be written, neither
    // is the template. The flow's transaction is the adapter's answer alone
    // here, so the service takes the path it takes inside one without a
    // transaction's own rollback undoing the write for it.
    it("leaves a template and its record as they were when the record fails inside a caller's transaction", async () => {
      const templates = t.getService("emailTemplateService");
      const created = await templates.createTemplate({
        name: "In a flow",
        slug: `usage-flow-${dialect}`,
        subject: "Hello",
        htmlContent: `<img src="${P.url}">`,
      });
      const recordBefore = await recordedFor(
        t,
        "email-template",
        "",
        created.id
      );
      expect(recordBefore).toEqual(
        expected("email-template", "", created.id, [["htmlContent", "", P.id]])
      );

      const inFlow = vi
        .spyOn(t.adapter, "transactionOpenInFlow")
        .mockReturnValue(true);
      templateUsage.failNext = true;
      try {
        await expect(
          templates.updateTemplate(created.id, {
            htmlContent: `<img src="${Q.url}">`,
          })
        ).rejects.toThrow();
      } finally {
        inFlow.mockRestore();
      }
      // The failure was the record's, not one before it.
      expect(templateUsage.failNext).toBe(false);

      expect((await templates.getTemplate(created.id)).htmlContent).toBe(
        `<img src="${P.url}">`
      );
      expect(await recordedFor(t, "email-template", "", created.id)).toEqual(
        recordBefore
      );
    });

    /**
     * Resolves once another statement on this database waits for a lock, or
     * after five seconds. MySQL lists a statement blocked on a row lock in
     * neither `INNODB_TRX` nor `LOCK WAIT`, so there a statement still
     * running after a full second is the wait.
     */
    async function untilAnotherWaitsOnALock(): Promise<boolean> {
      const probe =
        dialect === "postgresql"
          ? `SELECT count(*)::int AS n FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'`
          : `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST
             WHERE DB = DATABASE() AND ID <> CONNECTION_ID()
               AND COMMAND = 'Query' AND TIME >= 1`;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const rows = await t.adapter.executeQuery<{ n: number | string }>(
          probe
        );
        if (Number(rows[0]?.n ?? 0) > 0) return true;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return false;
    }

    // A rebuild reading an entry while a write to it is open waits for the
    // write, then records what the write committed. SQLite runs one write
    // transaction at a time, so there the two cannot overlap at all.
    it.skipIf(dialect === "sqlite")(
      "rebuilds an entry being written as the write leaves it",
      async () => {
        const id = await create("usagewide", { gallery: [P.id] });
        const entries = handler().getEntryService();

        let entered!: () => void;
        const inWrite = new Promise<void>(resolve => (entered = resolve));
        let release!: () => void;
        const held = new Promise<void>(resolve => (release = resolve));
        const write = t.adapter.transaction(async tx => {
          await entries.updateEntryInTransaction(
            tx as never,
            { collectionName: "usagewide", entryId: id, overrideAccess: true },
            { gallery: [Q.id] }
          );
          entered();
          await held;
        });
        await inWrite;

        const rebuild = t
          .getService("collectionService")
          .rebuildMediaUsage("usagewide");
        const waited = await untilAnotherWaitsOnALock();
        release();
        await write;
        await rebuild;

        expect(waited).toBe(true);
        expect(await recordedFor(t, "collection", "usagewide", id)).toEqual(
          expected("collection", "usagewide", id, [["gallery", "", Q.id]])
        );
      },
      30_000
    );
  }
);

describe.each(getConfiguredTestDialects())(
  "the media usage record of a language removed in Settings (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let settings: LanguageSettingsService;
    const [G, H] = [
      { id: randomUUID(), url: "/uploads/2026/10/kept-en.png" },
      { id: randomUUID(), url: "/uploads/2026/10/kept-fr.png" },
    ];

    beforeAll(async () => {
      // No `localization` block: the languages are the ones Settings stores.
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        fieldGroups: [
          defineFieldGroup({
            slug: "usagekept",
            localized: true,
            fields: [text({ name: "caption" }), richText({ name: "blurb" })],
          }),
        ],
        collections: [
          defineCollection({
            slug: "usagekeptposts",
            access: OPEN,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "promo", component: "usagekept" }),
            ],
          }),
        ],
      });
      settings = new LanguageSettingsService(
        t.adapter,
        t.getService("languageRegistry") as LanguageRegistry
      );
      for (const item of [G, H]) {
        await t.adapter.insert("media", {
          id: item.id,
          filename: item.url.slice("/uploads/".length),
          originalFilename: "kept.png",
          mimeType: "image/png",
          size: 1,
          url: item.url,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    afterAll(async () => {
      await t?.destroy();
    });

    // Removing a language keeps its content, so adding it again brings it
    // back: what that content uses stays in the record through a save of
    // another language and through a rebuild, or the Unused view would offer
    // its items for deletion.
    it("keeps a removed language's field-group uses through another save and a rebuild", async () => {
      await settings.change({ kind: "add", code: "fr", label: "French" });
      const entries = t.getService("collectionsHandler").getEntryService();
      const created = await entries.createEntry(
        {
          collectionName: "usagekeptposts",
          overrideAccess: true,
          locale: "en",
        },
        { title: "Kept", promo: { caption: "Hi", blurb: imageText(G.url) } }
      );
      const id = String((created.data as { id: unknown }).id);
      const french = await entries.updateEntry(
        {
          collectionName: "usagekeptposts",
          entryId: id,
          overrideAccess: true,
          locale: "fr",
        },
        { promo: { caption: "Salut", blurb: imageText(H.url) } }
      );
      expect(french.success, JSON.stringify(french)).toBe(true);
      const both = expected("collection", "usagekeptposts", id, [
        ["promo.blurb", "en", G.id],
        ["promo.blurb", "fr", H.id],
      ]);
      expect(await recordedFor(t, "collection", "usagekeptposts", id)).toEqual(
        both
      );

      await settings.change({ kind: "remove", code: "fr" });

      // A save in the language still active rewrites the entry's record.
      const saved = await entries.updateEntry(
        {
          collectionName: "usagekeptposts",
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "Kept, saved again" }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(await recordedFor(t, "collection", "usagekeptposts", id)).toEqual(
        both
      );

      await t.adapter.delete(MEDIA_USAGE_TABLE, {
        and: [{ column: "documentId", op: "=", value: id }],
      });
      await t
        .getService("collectionService")
        .rebuildMediaUsage("usagekeptposts");
      expect(await recordedFor(t, "collection", "usagekeptposts", id)).toEqual(
        both
      );
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a media item a user's avatar or a logo keeps (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const SITE = "https://site.test";
    /** Kept by an avatar, the email logo, the site's logo and its dark one. */
    const [avatar, brand, siteLogo, darkLogo, loose] = Array.from(
      { length: 5 },
      (_, i) => ({
        id: randomUUID(),
        url: `/uploads/2026/10/kept_${i}.png`,
      })
    );

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [],
      });
      for (const item of [avatar, brand, siteLogo, darkLogo, loose]) {
        await t.adapter.insert("media", {
          id: item.id,
          filename: item.url.slice("/uploads/".length),
          originalFilename: "kept.png",
          mimeType: "image/png",
          size: 1,
          url: item.url,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        });
      }
      await t.getService("metaService").set(MEDIA_USAGE_RECORDED_KEY, {
        rebuiltAt: new Date().toISOString(),
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    const media = () => t.getService("mediaService");

    async function unusedIds(): Promise<string[]> {
      const listed = await media().listMedia(
        { view: "unused", limit: 100 },
        {}
      );
      expect(listed.pagination.total).toBe(listed.data.length);
      return listed.data.map(file => file.id).sort();
    }

    // None of these is a document the usage record covers, so the view
    // asks them itself: a person may delete what it lists.
    it("never lists or counts an item an avatar or a logo keeps as unused", async () => {
      // Kept by nothing yet, every item is unused: the view reaches them.
      expect(await unusedIds()).toEqual(
        [avatar, brand, siteLogo, darkLogo, loose].map(i => i.id).sort()
      );
      expect((await media().countLibrary({})).unused).toBe(5);

      // An avatar keeps the address as the library gave it out.
      await t.adapter.insert("users", {
        id: `avatar-${dialect}`,
        email: `avatar-${dialect}@test.local`,
        image: avatar.url,
      });
      // The email logo keeps it made absolute against the site.
      await t.adapter.insert("email_brand", {
        id: "default",
        logoUrl: `${SITE}${brand.url}`,
        updatedAt: new Date(),
      });
      // The site's logos, typed in as addresses.
      await t
        .getService("generalSettingsService")
        .updateSettings({ logoUrl: `${SITE}${siteLogo.url}` });
      await t.adapter.update(
        "site_settings",
        { logoUrlDark: `${SITE}${darkLogo.url}` },
        { and: [{ column: "id", op: "IS NOT NULL" }] }
      );

      expect(await unusedIds()).toEqual([loose.id]);
      expect((await media().countLibrary({})).unused).toBe(1);
    });
  }
);
