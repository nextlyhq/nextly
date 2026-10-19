/**
 * The edit read gives every stored link, and a save of it keeps them.
 *
 * A populated read leaves out a related row or a media item the caller may not
 * read, and a to-many value then has nothing at that position. The admin edits
 * a document by saving the whole form back, so it also reads the document at
 * `depth=0`, which answers with the ids as stored, and keeps every link the
 * user did not remove. That read must name a hidden link exactly as it names a
 * link to a row that no longer exists, or the editor could tell the two apart.
 *
 * Each save below is the one the admin makes: the `depth=0` read, as the same
 * caller, sent back with whatever the user removed taken out. The stored value
 * is then read back as the system, so the assertion sees what was written
 * rather than what this caller is shown. Run on every configured dialect.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineSingle,
  relationship,
  text,
  upload,
} from "../../../config";
import { getDialectTables } from "../../../database/index";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Admits only the caller named `permitted`. */
const readableByPermitted = ({ user }: { user?: { id?: string } }): boolean =>
  user?.id === "permitted";

interface Fixture {
  t: TestNextly;
  handler: CollectionsHandler;
  /** Holds read-pages and nothing else: notes and media are hidden from them. */
  editor: string;
  refId: string;
  pages: [string, string];
  notes: [string, string];
  /** A page that existed when it was linked and has since been deleted. */
  deletedPage: string;
  media: [string, string];
}

/**
 * `pages` is readable through a grant, `notes` through a rule that refuses the
 * editor, and media through a grant the editor does not hold. `refs` and the
 * `homepage` Single link to each kind, to-one and to-many.
 */
async function boot(dialect: TestDialect): Promise<Fixture> {
  const title = text({ name: "title" });
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [
      defineCollection({ slug: "pages", fields: [title] }),
      defineCollection({
        slug: "notes",
        access: { read: readableByPermitted },
        fields: [title],
      }),
      defineCollection({
        slug: "refs",
        access: { read: () => true },
        fields: [
          text({ name: "name" }),
          relationship({ name: "note", relationTo: "notes" }),
          relationship({ name: "gone", relationTo: "pages" }),
          relationship({
            name: "mixed",
            relationTo: ["pages", "notes"],
            hasMany: true,
          }),
          relationship({ name: "notes", relationTo: "notes", hasMany: true }),
          upload({ name: "image", relationTo: "media" }),
          upload({ name: "gallery", relationTo: "media", hasMany: true }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "homepage",
        fields: [
          text({ name: "headline" }),
          relationship({ name: "featured", relationTo: "notes" }),
          relationship({
            name: "picks",
            relationTo: ["pages", "notes"],
            hasMany: true,
          }),
          upload({ name: "logo", relationTo: "media" }),
          upload({ name: "gallery", relationTo: "media", hasMany: true }),
        ],
      }),
    ],
  });
  const t = current;
  const handler = t.getService("collectionsHandler") as CollectionsHandler;

  const tables = getDialectTables();
  const db = t.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  };
  const permission = await t.nextly.permissions.create({
    data: {
      action: "read",
      resource: "pages",
      name: "Read pages",
      slug: "read-pages",
    },
  });
  const role = await t.nextly.roles.create({
    data: {
      name: "Page reader",
      slug: "page-reader",
      permissionIds: [permission.item.id],
    },
  });
  const editor = "user-editor";
  await db.insert(tables.users).values({
    id: editor,
    email: "editor@example.com",
    name: "Editor",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(tables.userRoles).values({
    id: "user-role-editor",
    userId: editor,
    roleId: String(role.item.id),
    createdAt: new Date(),
  });
  for (const id of ["media-1", "media-2"]) {
    await db.insert(tables.media).values({
      id,
      filename: `${id}.png`,
      originalFilename: `${id}.png`,
      mimeType: "image/png",
      size: 1,
      url: `/uploads/${id}.png`,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const make = async (collectionName: string, data: Record<string, unknown>) =>
    String(
      (
        (
          await handler.createEntry(
            { collectionName, overrideAccess: true },
            data
          )
        ).data as { id: string }
      ).id
    );
  const pages: [string, string] = [
    await make("pages", { title: "Page one" }),
    await make("pages", { title: "Page two" }),
  ];
  const notes: [string, string] = [
    await make("notes", { title: "Note one" }),
    await make("notes", { title: "Note two" }),
  ];
  const deletedPage = await make("pages", { title: "Deleted page" });
  const media: [string, string] = ["media-1", "media-2"];

  const refId = await make("refs", {
    name: "parent",
    note: notes[0],
    gone: deletedPage,
    // A hidden link between two readable ones.
    mixed: [
      { relationTo: "pages", value: pages[0] },
      { relationTo: "notes", value: notes[0] },
      { relationTo: "pages", value: pages[1] },
    ],
    notes: [notes[1], notes[0]],
    image: media[0],
    gallery: [media[1], media[0]],
  });
  await t.getService("singleEntryService").update(
    "homepage",
    {
      headline: "Welcome",
      featured: notes[0],
      picks: [
        { relationTo: "pages", value: pages[0] },
        { relationTo: "notes", value: notes[0] },
        { relationTo: "pages", value: pages[1] },
      ],
      logo: media[0],
      gallery: [media[1], media[0]],
    },
    { overrideAccess: true }
  );
  const deleted = await handler.deleteEntry({
    collectionName: "pages",
    entryId: deletedPage,
    overrideAccess: true,
  });
  expect(deleted.success).toBe(true);

  return { t, handler, editor, refId, pages, notes, deletedPage, media };
}

/** The entry as the admin's edit read gives it to the editor. */
async function editReadRef(fx: Fixture): Promise<Record<string, unknown>> {
  const result = await fx.handler.getEntry({
    collectionName: "refs",
    entryId: fx.refId,
    depth: 0,
    user: { id: fx.editor },
    routeAuthorized: true,
  });
  expect(result.success).toBe(true);
  return result.data as Record<string, unknown>;
}

/** The entry as stored, read as the system. */
async function storedRef(fx: Fixture): Promise<Record<string, unknown>> {
  const result = await fx.handler.getEntry({
    collectionName: "refs",
    entryId: fx.refId,
    depth: 0,
    overrideAccess: true,
  });
  expect(result.success).toBe(true);
  return result.data as Record<string, unknown>;
}

/** The editor's save of the entry. */
async function saveRef(
  fx: Fixture,
  data: Record<string, unknown>
): Promise<void> {
  const result = await fx.handler.updateEntry(
    {
      collectionName: "refs",
      entryId: fx.refId,
      user: { id: fx.editor },
      routeAuthorized: true,
    },
    data
  );
  expect(result.success).toBe(true);
}

/** The Single as the admin's edit read gives it to the editor. */
async function editReadHomepage(fx: Fixture): Promise<Record<string, unknown>> {
  const result = await fx.t.getService("singleEntryService").get("homepage", {
    depth: 0,
    user: { id: fx.editor },
    routeAuthorized: true,
  });
  expect(result.success).toBe(true);
  return result.data as Record<string, unknown>;
}

/** The Single as stored, read as the system. */
async function storedHomepage(fx: Fixture): Promise<Record<string, unknown>> {
  const result = await fx.t
    .getService("singleEntryService")
    .get("homepage", { depth: 0, overrideAccess: true });
  expect(result.success).toBe(true);
  return result.data as Record<string, unknown>;
}

/** The editor's save of the Single. */
async function saveHomepage(
  fx: Fixture,
  data: Record<string, unknown>
): Promise<void> {
  const result = await fx.t
    .getService("singleEntryService")
    .update("homepage", data, {
      user: { id: fx.editor },
      routeAuthorized: true,
    });
  expect(result.success).toBe(true);
}

/** The fields a save sends back, as the edit read gave them. */
function linksOf(
  doc: Record<string, unknown>,
  names: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(names.map(name => [name, doc[name]]));
}

const REF_LINKS = ["note", "gone", "mixed", "notes", "image", "gallery"];
const HOMEPAGE_LINKS = ["featured", "picks", "logo", "gallery"];

describe.each(getConfiguredTestDialects())(
  "the edit read gives every stored link, and a save keeps them (%s)",
  (dialect: TestDialect) => {
    it("withholds the hidden rows from the populated read, so the fixture reaches the mechanism", async () => {
      const fx = await boot(dialect);
      const populated = await fx.handler.getEntry({
        collectionName: "refs",
        entryId: fx.refId,
        depth: 1,
        user: { id: fx.editor },
        routeAuthorized: true,
      });
      const data = populated.data as Record<string, unknown>;
      const shown = JSON.stringify(data);
      expect(shown).toContain("Page one");
      expect(shown).not.toContain("Note one");
      expect(shown).not.toContain("media-1.png");
      expect(data.mixed as unknown[]).toHaveLength(2);
    });

    it("names a hidden link exactly as a link to a deleted row, on an entry", async () => {
      const fx = await boot(dialect);
      const read = await editReadRef(fx);
      expect(read.note).toBe(fx.notes[0]);
      expect(read.gone).toBe(fx.deletedPage);
      expect(typeof read.note).toBe(typeof read.gone);
      expect(read.image).toBe(fx.media[0]);
    });

    it("gives a Single's hidden links as their stored ids", async () => {
      const fx = await boot(dialect);
      const read = await editReadHomepage(fx);
      expect(read.featured).toBe(fx.notes[0]);
      expect(read.logo).toBe(fx.media[0]);
      expect(read.gallery).toEqual([fx.media[1], fx.media[0]]);
    });

    it("names a hidden upload exactly as an upload whose media was deleted, on a Single", async () => {
      const fx = await boot(dialect);
      await fx.t
        .getService("singleEntryService")
        .update(
          "homepage",
          { gallery: [fx.media[1], "media-deleted"] },
          { overrideAccess: true }
        );
      const read = await editReadHomepage(fx);
      expect(read.gallery).toEqual([fx.media[1], "media-deleted"]);
    });

    it("keeps an entry's hidden relationship and upload links, in order, on a save", async () => {
      const fx = await boot(dialect);
      const before = await storedRef(fx);
      const read = await editReadRef(fx);
      await saveRef(fx, { name: "renamed", ...linksOf(read, REF_LINKS) });
      const after = await storedRef(fx);
      expect(after.name).toBe("renamed");
      expect(linksOf(after, REF_LINKS)).toEqual(linksOf(before, REF_LINKS));
    });

    it("keeps a hidden link between two readable ones, its order asserted in full", async () => {
      const fx = await boot(dialect);
      const read = await editReadRef(fx);
      await saveRef(fx, { mixed: read.mixed });
      expect((await storedRef(fx)).mixed).toEqual([
        { relationTo: "pages", value: fx.pages[0] },
        { relationTo: "notes", value: fx.notes[0] },
        { relationTo: "pages", value: fx.pages[1] },
      ]);
    });

    it("keeps a Single's hidden relationship and upload links, in order, on a save", async () => {
      const fx = await boot(dialect);
      const before = await storedHomepage(fx);
      const read = await editReadHomepage(fx);
      await saveHomepage(fx, {
        headline: "Changed",
        ...linksOf(read, HOMEPAGE_LINKS),
      });
      const after = await storedHomepage(fx);
      expect(after.headline).toBe("Changed");
      expect(linksOf(after, HOMEPAGE_LINKS)).toEqual(
        linksOf(before, HOMEPAGE_LINKS)
      );
      expect(after.picks).toEqual([
        { relationTo: "pages", value: fx.pages[0] },
        { relationTo: "notes", value: fx.notes[0] },
        { relationTo: "pages", value: fx.pages[1] },
      ]);
      expect(after.gallery).toEqual([fx.media[1], fx.media[0]]);
    });

    it("drops the hidden links a save removes, on an entry", async () => {
      const fx = await boot(dialect);
      const read = await editReadRef(fx);
      await saveRef(fx, {
        note: null,
        mixed: (read.mixed as Array<{ relationTo: string }>).filter(
          link => link.relationTo !== "notes"
        ),
        notes: [fx.notes[1]],
        image: null,
        gallery: [fx.media[1]],
      });
      const after = await storedRef(fx);
      expect(after.note ?? null).toBeNull();
      expect(after.mixed).toEqual([
        { relationTo: "pages", value: fx.pages[0] },
        { relationTo: "pages", value: fx.pages[1] },
      ]);
      expect(after.notes).toEqual([fx.notes[1]]);
      expect(after.image ?? null).toBeNull();
      expect(after.gallery).toEqual([fx.media[1]]);
    });

    it("drops the hidden links a save removes, on a Single", async () => {
      const fx = await boot(dialect);
      const read = await editReadHomepage(fx);
      await saveHomepage(fx, {
        featured: null,
        picks: (read.picks as Array<{ relationTo: string }>).filter(
          link => link.relationTo !== "notes"
        ),
        logo: null,
        gallery: [fx.media[0]],
      });
      const after = await storedHomepage(fx);
      expect(after.featured ?? null).toBeNull();
      expect(after.picks).toEqual([
        { relationTo: "pages", value: fx.pages[0] },
        { relationTo: "pages", value: fx.pages[1] },
      ]);
      expect(after.logo ?? null).toBeNull();
      expect(after.gallery).toEqual([fx.media[0]]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the edit read gives a junction field's stored ids (%s)",
  (dialect: TestDialect) => {
    /**
     * A junction-backed many-to-many field exists only in the Schema Builder's
     * older shape, `options.target`, which the typed helper cannot express. So
     * both collections are seeded as the Builder stores them, and the target
     * is given a read rule that refuses every caller but `permitted`.
     */
    async function bootJunction(): Promise<{
      handler: CollectionsHandler;
      postId: string;
      tagIds: string[];
    }> {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // Both sides as the Builder stores them, in the one boot: a re-boot on
      // a server dialect drops the database the first boot provisioned.
      await seedBuilderCollection(current.adapter, {
        slug: "tags",
        fields: [{ name: "name", type: "text" }],
      });
      await seedBuilderCollection(current.adapter, {
        slug: "posts",
        fields: [
          { name: "name", type: "text" },
          {
            name: "tags",
            type: "relationship",
            options: { relationType: "manyToMany", target: "tags" },
          },
        ],
      });
      // The rule a code-first target would declare, registered as boot
      // registers it, so a caller can be refused the target.
      current
        .getService("rbacAccessControlService")
        .registerCollectionAccess("tags", { read: readableByPermitted });
      const handler =
        current.getService<CollectionsHandler>("collectionsHandler");
      const make = async (
        collectionName: string,
        data: Record<string, unknown>
      ) =>
        String(
          (
            (
              await handler.createEntry(
                { collectionName, overrideAccess: true },
                data
              )
            ).data as { id: string }
          ).id
        );
      const tagIds = [
        await make("tags", { name: "first" }),
        await make("tags", { name: "second" }),
      ];
      const postId = await make("posts", { name: "post", tags: tagIds });
      return { handler, postId, tagIds };
    }

    // A junction keeps no order, so the ids are compared as a set. An absent
    // field fails here, by name, rather than as a TypeError further on.
    const sorted = (ids: unknown): string[] => {
      expect(Array.isArray(ids)).toBe(true);
      return [...(ids as string[])].map(String).sort();
    };

    it("on the single-entry read, for a caller the target refuses", async () => {
      const { handler, postId, tagIds } = await bootJunction();
      const populated = await handler.getEntry({
        collectionName: "posts",
        entryId: postId,
        depth: 1,
        user: { id: "denied" },
        routeAuthorized: true,
      });
      expect((populated.data as { tags?: unknown[] }).tags ?? []).toEqual([]);

      const read = await handler.getEntry({
        collectionName: "posts",
        entryId: postId,
        depth: 0,
        user: { id: "denied" },
        routeAuthorized: true,
      });
      expect(read.success).toBe(true);
      expect(sorted((read.data as { tags?: unknown }).tags)).toEqual(
        sorted(tagIds)
      );
    });

    it("on the list read", async () => {
      const { handler, tagIds } = await bootJunction();
      const list = await handler.listEntries({
        collectionName: "posts",
        depth: 0,
        user: { id: "denied" },
        routeAuthorized: true,
      });
      expect(list.success).toBe(true);
      const docs = (list.data as { docs: Array<{ tags?: unknown }> }).docs;
      expect(docs).toHaveLength(1);
      expect(sorted(docs[0].tags)).toEqual(sorted(tagIds));
    });

    it("keeps the hidden junction links on a save of the edit read", async () => {
      const { handler, postId, tagIds } = await bootJunction();
      const read = await handler.getEntry({
        collectionName: "posts",
        entryId: postId,
        depth: 0,
        user: { id: "denied" },
        routeAuthorized: true,
      });
      const tags = (read.data as { tags?: unknown }).tags;
      const saved = await handler.updateEntry(
        {
          collectionName: "posts",
          entryId: postId,
          user: { id: "denied" },
          routeAuthorized: true,
        },
        { name: "renamed", tags }
      );
      expect(saved.success).toBe(true);
      const after = await handler.getEntry({
        collectionName: "posts",
        entryId: postId,
        depth: 0,
        overrideAccess: true,
      });
      expect(sorted((after.data as { tags?: unknown }).tags)).toEqual(
        sorted(tagIds)
      );
    });
  }
);
