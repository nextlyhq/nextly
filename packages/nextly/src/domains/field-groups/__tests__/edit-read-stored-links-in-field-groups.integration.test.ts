/**
 * The edit read gives every stored link inside a field group, and a save of
 * it keeps them.
 *
 * A field group's relationship and upload fields are populated like any
 * other, so a populated read leaves out a related row or a media item the
 * caller may not read. The admin edits a document by saving the whole form
 * back, so it also reads at `depth=0`, which answers with the ids as stored,
 * inside a single field group, a repeatable one and a dynamic zone alike. A
 * hidden link and a link to a deleted row must read the same there, as they do
 * at the top level.
 *
 * Each save below is the one the admin makes: the `depth=0` read, as the same
 * caller, sent back with whatever the user removed taken out. The stored value
 * is read back as the system, so the assertion sees what was written rather
 * than what this caller is shown. Run on every configured dialect.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
  upload,
} from "../../../config";
import { getDialectTables } from "../../../database/index";
import {
  readFieldGroupType,
  writeFieldGroupType,
} from "../../../field-group-type";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { AccessControlFunction } from "../../../shared/types/access";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Doc = Record<string, unknown>;

/** Admits only the caller named `permitted`. */
const readableByPermitted: AccessControlFunction = ({ user }) =>
  user?.id === "permitted";

/** A field group instance of the named type, as a dynamic zone stores one. */
function typed(type: string, data: Doc): Doc {
  const instance: Doc = { ...data };
  writeFieldGroupType(instance, type);
  return instance;
}

interface Fixture {
  t: TestNextly;
  handler: CollectionsHandler;
  /** Holds read-pages and nothing else: notes and media are hidden from them. */
  editor: string;
  refId: string;
  pages: [string, string];
  /** Two notes the editor cannot read, and one since deleted. */
  notes: [string, string];
  deletedNote: string;
  media: string;
}

/** The fields of a `card`: every kind of link a field group can hold. */
const CARD_LINKS = ["notes", "mixed", "image"] as const;

/**
 * `card` holds a to-many relationship to `notes`, a multi-collection one with
 * a hidden link between two readable ones, and an upload; `quote` a to-one
 * relationship. `refs` and the `homepage` Single carry a `card`, and a dynamic
 * zone of both; `refs` also a repeatable `card`.
 */
async function boot(dialect: TestDialect): Promise<Fixture> {
  const title = text({ name: "title" });
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [
          text({ name: "heading" }),
          relationship({ name: "notes", relationTo: "notes", hasMany: true }),
          relationship({
            name: "mixed",
            relationTo: ["pages", "notes"],
            hasMany: true,
          }),
          upload({ name: "image", relationTo: "media" }),
        ],
      }),
      defineFieldGroup({
        slug: "quote",
        fields: [relationship({ name: "note", relationTo: "notes" })],
      }),
    ],
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
          fieldGroup({ name: "card", component: "card" }),
          fieldGroup({ name: "cards", component: "card", repeatable: true }),
          fieldGroup({
            name: "blocks",
            components: ["card", "quote"],
            repeatable: true,
          }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "homepage",
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "card", component: "card" }),
          fieldGroup({
            name: "blocks",
            components: ["card", "quote"],
            repeatable: true,
          }),
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
  const media = "media-1";
  await db.insert(tables.media).values({
    id: media,
    filename: "media-1.png",
    originalFilename: "media-1.png",
    mimeType: "image/png",
    size: 1,
    url: "/uploads/media-1.png",
    uploadedAt: new Date(),
    updatedAt: new Date(),
  });

  const make = async (collectionName: string, data: Doc) =>
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
  const deletedNote = await make("notes", { title: "Deleted note" });

  const card = (heading: string): Doc => ({
    heading,
    notes: [notes[1], notes[0], deletedNote],
    mixed: [
      { relationTo: "pages", value: pages[0] },
      { relationTo: "notes", value: notes[0] },
      { relationTo: "pages", value: pages[1] },
    ],
    image: media,
  });
  const blocks = [
    typed("card", card("In a zone")),
    typed("quote", { note: notes[0] }),
  ];
  const refId = await make("refs", {
    name: "parent",
    card: card("Single"),
    cards: [card("Row one"), card("Row two")],
    blocks,
  });
  await t
    .getService("singleEntryService")
    .update(
      "homepage",
      { headline: "Welcome", card: card("Single"), blocks },
      { overrideAccess: true }
    );
  const deleted = await handler.deleteEntry({
    collectionName: "notes",
    entryId: deletedNote,
    overrideAccess: true,
  });
  expect(deleted.success).toBe(true);

  return { t, handler, editor, refId, pages, notes, deletedNote, media };
}

/** A non-repeatable field group may be read as one instance or a list of one. */
function instance(value: unknown): Doc {
  const one = Array.isArray(value) ? (value[0] as unknown) : value;
  expect(one).toBeTypeOf("object");
  return one as Doc;
}

/** The links a field group instance holds, by field. */
function linksOf(value: unknown, fields: readonly string[] = CARD_LINKS): Doc {
  const doc = instance(value);
  return Object.fromEntries(fields.map(name => [name, doc[name]]));
}

/** Every link in a document's field groups, keyed by where it is. */
function allLinks(doc: Doc): Doc {
  const rows = (value: unknown) => (Array.isArray(value) ? value : []) as Doc[];
  return {
    card: linksOf(doc.card),
    cards: rows(doc.cards).map(row => linksOf(row)),
    blocks: rows(doc.blocks).map(row =>
      readFieldGroupType(row) === "quote"
        ? { quote: linksOf(row, ["note"]) }
        : { card: linksOf(row) }
    ),
  };
}

async function readRef(fx: Fixture, caller: Doc, depth: number): Promise<Doc> {
  const result = await fx.handler.getEntry({
    collectionName: "refs",
    entryId: fx.refId,
    depth,
    ...caller,
  });
  expect(result.success).toBe(true);
  return result.data as Doc;
}

const asEditor = (fx: Fixture): Doc => ({
  user: { id: fx.editor },
  routeAuthorized: true,
});
const asSystem: Doc = { overrideAccess: true };

async function saveRef(fx: Fixture, data: Doc): Promise<void> {
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

async function readHomepage(
  fx: Fixture,
  caller: Doc,
  depth: number
): Promise<Doc> {
  const result = await fx.t
    .getService("singleEntryService")
    .get("homepage", { depth, ...caller });
  expect(result.success).toBe(true);
  return result.data as Doc;
}

async function saveHomepage(fx: Fixture, data: Doc): Promise<void> {
  const result = await fx.t
    .getService("singleEntryService")
    .update("homepage", data, {
      user: { id: fx.editor },
      routeAuthorized: true,
    });
  expect(result.success).toBe(true);
}

describe.each(getConfiguredTestDialects())(
  "the edit read gives every stored link inside a field group, and a save keeps them (%s)",
  (dialect: TestDialect) => {
    it("withholds the hidden rows from the populated read, so the fixture reaches the mechanism", async () => {
      const fx = await boot(dialect);
      const shown = JSON.stringify(await readRef(fx, asEditor(fx), 2));
      expect(shown).toContain("Page one");
      expect(shown).not.toContain("Note one");
      expect(shown).not.toContain("media-1.png");
    });

    it("names a hidden link exactly as a link to a deleted row, inside a field group", async () => {
      const fx = await boot(dialect);
      const card = instance((await readRef(fx, asEditor(fx), 0)).card);
      expect(card.notes).toEqual([fx.notes[1], fx.notes[0], fx.deletedNote]);
      expect(card.image).toBe(fx.media);
    });

    it("keeps an entry's hidden links in a field group, a repeatable one and a dynamic zone, in order, on a save", async () => {
      const fx = await boot(dialect);
      const before = allLinks(await readRef(fx, asSystem, 0));
      const read = await readRef(fx, asEditor(fx), 0);
      await saveRef(fx, {
        name: "renamed",
        card: read.card,
        cards: read.cards,
        blocks: read.blocks,
      });
      const after = await readRef(fx, asSystem, 0);
      expect(after.name).toBe("renamed");
      expect(allLinks(after)).toEqual(before);
      expect(instance(after.card).mixed).toEqual([
        { relationTo: "pages", value: fx.pages[0] },
        { relationTo: "notes", value: fx.notes[0] },
        { relationTo: "pages", value: fx.pages[1] },
      ]);
    });

    it("keeps a Single's hidden links in a field group and a dynamic zone, in order, on a save", async () => {
      const fx = await boot(dialect);
      const before = await readHomepage(fx, asSystem, 0);
      const read = await readHomepage(fx, asEditor(fx), 0);
      await saveHomepage(fx, {
        headline: "Changed",
        card: read.card,
        blocks: read.blocks,
      });
      const after = await readHomepage(fx, asSystem, 0);
      expect(after.headline).toBe("Changed");
      expect(linksOf(after.card)).toEqual(linksOf(before.card));
      expect(
        (after.blocks as Doc[]).map(row => readFieldGroupType(row))
      ).toEqual(["card", "quote"]);
      expect(linksOf((after.blocks as Doc[])[1], ["note"])).toEqual({
        note: fx.notes[0],
      });
    });

    it("drops the hidden links a save removes, inside field groups", async () => {
      const fx = await boot(dialect);
      const read = await readRef(fx, asEditor(fx), 0);
      const card = instance(read.card);
      await saveRef(fx, {
        card: { ...card, notes: [fx.notes[1]], image: null },
        // The quote, whose only link is hidden, is removed from the zone.
        blocks: (read.blocks as Doc[]).filter(
          row => readFieldGroupType(row) !== "quote"
        ),
      });
      const after = await readRef(fx, asSystem, 0);
      expect(instance(after.card).notes).toEqual([fx.notes[1]]);
      expect(instance(after.card).image ?? null).toBeNull();
      expect(
        (after.blocks as Doc[]).map(row => readFieldGroupType(row))
      ).toEqual(["card"]);
    });
  }
);
