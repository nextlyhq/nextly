/**
 * Rewriting a site's stored references leaves no stored value pointing at an
 * id or an address the map moves, and puts the new one where each old one
 * was.
 *
 * The site holds old ids and addresses in every place content stores a
 * reference: a collection's row (to-one, to-many and multi-collection
 * relationships, uploads, rich text, a block document, a group, a
 * repeater), a field group and a dynamic zone, a Single, a translated value,
 * a many-to-many junction, the version the write recorded, a version and a
 * release member of a moved entry, and an instance whose parent moved. One
 * to-many value also holds a dangling id: one the map does not name and no
 * row has.
 *
 * What separates a rewrite that reaches every place from one that misses a
 * table is a search of every stored value: every row of every table the
 * database has is read and searched for each old id and address, before the
 * rewrite (where each must be found, in exactly the tables seeded) and after
 * it (where none may be). The only rows the search passes over are the plain
 * rows the junction's foreign keys need the old ids to have, which hold
 * nothing but their own identity. Run on every configured dialect.
 */
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  json,
  relationship,
  repeater,
  richText,
  text,
  upload,
} from "../../../../config";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../../schemas/versions/types";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { writeFieldGroupType } from "../../../field-groups/storage/field-group-type-key";
import { releaseMemberKey } from "../../../releases/release-member-key";
import {
  RELEASE_MEMBERS_TABLE,
  RELEASES_TABLE,
} from "../../../releases/release-tables";
import {
  junctionLinkColumnsOf,
  junctionTableTo,
} from "../../../schema/services/field-column-descriptor";
import { workingDraftKey } from "../../../versions/working-draft-key";
import { describeStoredContent } from "../describe-stored-content";
import type { ReferenceMap } from "../reference-map";
import {
  rewriteStoredReferences,
  type StoredContentSite,
} from "../rewrite-stored-references";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Doc = Record<string, unknown>;

/**
 * The tables that hold an old value as a record of something that already
 * happened, not as content, and which the rewrite leaves as they are. The
 * seeding writes reach both, so the search before the rewrite must find old
 * values in them too; any other table that holds one is a place the rewrite
 * misses.
 */
const KEPT_AS_RECORDED = new Map([
  // The outbox of content changes: what each write sent, or will send, to
  // webhooks, which a rewrite must not make say something else.
  ["nextly_events", "a log of the writes"],
  // The source text a translation was made from, named by a fingerprint of
  // that very value: a copy of what the value was, not a link to follow.
  ["nextly_translation_sources", "a past value, named by its fingerprint"],
]);

/** `n` fresh ids. */
const ids = (n: number): string[] => Array.from({ length: n }, randomUUID);

/** A field group instance of the named type, as a dynamic zone stores one. */
function typed(type: string, data: Doc): Doc {
  const instance: Doc = { ...data };
  writeFieldGroupType(instance, type);
  return instance;
}

/** Every old id and address, and what the map makes of it. */
interface Moves {
  posts: string[];
  pages: string[];
  media: string[];
  tags: string[];
  article: string;
  doc: string;
  address: string;
}

interface Fixture {
  t: TestNextly;
  handler: CollectionsHandler;
  site: StoredContentSite;
  map: ReferenceMap;
  old: Moves;
  moved: Moves;
  /** Each old value, by the new value it becomes. */
  substitutions: ReadonlyArray<[string, string]>;
  /** An id the map does not name and no row has. */
  dangling: string;
  docId: string;
  articleId: string;
  guideId: string;
  docData: Doc;
  homeData: Doc;
  /** The tables seeded with an old id or address. */
  seededTables: string[];
  /** The rows the search passes over, by table: plain rows the junction needs. */
  plainRows: ReadonlyMap<string, ReadonlySet<string>>;
  ids: { version: string; member: string; orphan: string };
  tables: { card: string; junction: string };
}

const TAG_FIELD = {
  name: "tags",
  type: "relationship",
  options: { relationType: "manyToMany", target: "tags" },
};

async function boot(dialect: TestDialect): Promise<Fixture> {
  const title = text({ name: "title" });
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    localization: { locales: ["en", "fr"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [
          text({ name: "heading" }),
          relationship({ name: "cardPosts", relationTo: "posts", hasMany: true }),
          upload({ name: "cardImage", relationTo: "media" }),
        ],
      }),
      defineFieldGroup({
        slug: "quote",
        fields: [relationship({ name: "quotePost", relationTo: "posts" })],
      }),
    ],
    collections: [
      defineCollection({ slug: "posts", fields: [title] }),
      defineCollection({ slug: "pages", fields: [title] }),
      defineCollection({
        slug: "docs",
        // History only: every write records its version.
        versions: { drafts: false },
        fields: [
          title,
          relationship({ name: "author", relationTo: "posts" }),
          relationship({ name: "related", relationTo: "posts", hasMany: true }),
          relationship({ name: "either", relationTo: ["posts", "pages"] }),
          relationship({
            name: "mixed",
            relationTo: ["posts", "pages"],
            hasMany: true,
          }),
          upload({ name: "cover", relationTo: "media" }),
          upload({ name: "gallery", relationTo: "media", hasMany: true }),
          richText({ name: "body" }),
          json({ name: "layout" }),
          group({
            name: "meta",
            fields: [
              relationship({ name: "metaPost", relationTo: "posts" }),
              upload({ name: "metaImage", relationTo: "media" }),
            ],
          }),
          repeater({
            name: "lines",
            fields: [relationship({ name: "rowPost", relationTo: "posts" })],
          }),
          fieldGroup({ name: "card", component: "card" }),
          fieldGroup({
            name: "blocks",
            components: ["card", "quote"],
            repeatable: true,
          }),
        ],
      }),
      defineCollection({
        slug: "guides",
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          upload({ name: "cover", relationTo: "media", localized: true }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        fields: [
          text({ name: "headline" }),
          relationship({ name: "featured", relationTo: "posts" }),
          upload({ name: "logo", relationTo: "media" }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
  });
  const t = current;
  // Both junction sides as the Schema Builder stores them, in the one boot.
  await seedBuilderCollection(t.adapter, {
    slug: "tags",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(t.adapter, {
    slug: "articles",
    fields: [{ name: "name", type: "text" }, TAG_FIELD],
  });
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const make = async (collectionName: string, data: Doc) => {
    const result = await handler.createEntry(
      { collectionName, overrideAccess: true },
      data
    );
    expect(result.success).toBe(true);
    return String((result.data as { id: string }).id);
  };

  const [oldDoc, newDoc, dangling] = ids(3);
  const old: Moves = {
    posts: ids(3),
    pages: ids(1),
    media: ids(4),
    tags: ids(3),
    article: randomUUID(),
    doc: oldDoc,
    address: `/uploads/old-${randomUUID()}.png`,
  };
  const newTags = [
    await make("tags", { name: "new one" }),
    await make("tags", { name: "new two" }),
    await make("tags", { name: "new three" }),
  ];

  // The junction's foreign keys need the rows its old ids name: plain rows,
  // written straight to the table so nothing records them anywhere else.
  const now = new Date();
  for (const [index, id] of old.tags.entries()) {
    await t.adapter.insert("dc_tags", {
      id,
      title: `old tag ${index}`,
      slug: `old-tag-${index}`,
      name: `old tag ${index}`,
      created_at: now,
      updated_at: now,
    });
  }
  await t.adapter.insert("dc_articles", {
    id: old.article,
    title: "old article",
    slug: "old-article",
    name: "old article",
    created_at: now,
    updated_at: now,
  });

  const card = (heading: string, post: string, image: string): Doc => ({
    heading,
    cardPosts: [post, old.posts[2]],
    cardImage: image,
  });
  const docData: Doc = {
    title: "doc",
    author: old.posts[0],
    related: [old.posts[1], dangling, old.posts[0]],
    either: { relationTo: "pages", value: old.pages[0] },
    mixed: [
      { relationTo: "posts", value: old.posts[2] },
      { relationTo: "pages", value: old.pages[0] },
    ],
    cover: old.media[0],
    gallery: [old.media[1], old.media[0]],
    body: {
      root: {
        type: "root",
        children: [
          { type: "image", src: old.address, altText: "hero" },
          { type: "image", src: `/api/media/${old.media[2]}/raw` },
        ],
      },
    },
    layout: {
      formatVersion: 1,
      assets: { mediaIds: [old.media[3]] },
      nodes: [{ id: "node-1", type: "image", props: { src: old.address } }],
    },
    meta: { metaPost: old.posts[1], metaImage: old.media[1] },
    lines: [{ rowPost: old.posts[2] }, { rowPost: old.posts[0] }],
    card: card("single", old.posts[0], old.media[2]),
    blocks: [
      typed("card", card("in a zone", old.posts[1], old.media[3])),
      typed("quote", { quotePost: old.posts[1] }),
    ],
  };
  const docId = await make("docs", docData);
  const articleId = await make("articles", {
    name: "article",
    tags: [old.tags[0], old.tags[1]],
  });
  const homeData: Doc = {
    headline: "Welcome",
    featured: old.posts[0],
    logo: old.media[0],
    card: card("home", old.posts[2], old.media[1]),
  };
  const home = await t
    .getService("singleEntryService")
    .update("home", { ...homeData, _overwrite: true }, { overrideAccess: true });
  expect(home.success).toBe(true);
  const guide = await t.nextly.create({
    collection: "guides",
    locale: "en",
    data: { title: "Guide", cover: old.media[0] },
  });
  const guideId = String(guide.item.id);
  await t.nextly.update({
    collection: "guides",
    id: guideId,
    locale: "fr",
    // The French values are written over the document's only revision.
    data: { title: "Guide fr", cover: old.media[1], _overwrite: true },
  });

  // A junction row written with the old ids on both sides.
  const junction = junctionTableTo("dc_articles", "tags", TAG_FIELD);
  const links = junctionLinkColumnsOf("dc_articles", "tags");
  await t.adapter.transaction(async tx => {
    await tx.runStatement(
      sql`INSERT INTO ${sql.identifier(junction)} (${sql.identifier("id")}, ${sql.identifier(links.sourceColumn)}, ${sql.identifier(links.targetColumn)}) VALUES (${randomUUID()}, ${old.article}, ${old.tags[2]})`
    );
  });

  // A moved entry's version (a working draft, keyed by its id), release
  // member and field-group instance.
  const versionId = randomUUID();
  await t.adapter.insert(VERSIONS_TABLE, {
    id: versionId,
    scopeKind: "collection",
    scopeSlug: "docs",
    entryId: old.doc,
    versionNo: null,
    status: "draft",
    isAutosave: false,
    snapshot: { title: "held", author: old.posts[0], cover: old.media[0] },
    draftKey: workingDraftKey(
      { scopeKind: "collection", scopeSlug: "docs", entryId: old.doc },
      null
    ),
    createdAt: now,
    updatedAt: now,
    revision: 0,
  });
  const releaseId = randomUUID();
  await t.adapter.insert(RELEASES_TABLE, {
    id: releaseId,
    title: "Release",
    description: null,
    scheduledAt: new Date(now.getTime() + 86_400_000),
    timezone: "UTC",
    state: "scheduled",
    publishedAt: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  });
  const memberId = randomUUID();
  const memberRef = {
    scopeKind: "collection" as const,
    scopeSlug: "docs",
    entryId: old.doc,
    locale: null,
  };
  await t.adapter.insert(RELEASE_MEMBERS_TABLE, {
    id: memberId,
    releaseId,
    ...memberRef,
    action: "publish",
    memberKey: releaseMemberKey(releaseId, memberRef),
    createdBy: null,
    createdAt: now,
  });

  const site = await describeStoredContent({
    collections: t.getService("collectionRegistryService"),
    singles: t.getService("singleRegistryService"),
    fieldGroups: t.getService("fieldGroupRegistryService"),
    tableExists: table => t.adapter.tableExists(table),
  });
  const tableOf = (list: StoredContentSite["collections"], slug: string) => {
    const entity = list.find(e => e.slug === slug);
    expect(entity, slug).toBeDefined();
    return entity!;
  };
  const docs = tableOf(site.collections, "docs");
  const guides = tableOf(site.collections, "guides");
  const cardTable = tableOf(site.fieldGroups, "card").table;
  const quoteTable = tableOf(site.fieldGroups, "quote").table;
  const homeTable = tableOf(site.singles, "home").table;
  // The translations table is there and described, so the fixture reaches it.
  expect(guides.translationsTable).toBeDefined();

  const orphanId = randomUUID();
  await t.adapter.insert(cardTable, {
    id: orphanId,
    _parent_id: old.doc,
    _parent_table: docs.table,
    _parent_field: "card",
    _order: 0,
    heading: "instance of a moved entry",
  });

  const moved: Moves = {
    posts: ids(3),
    pages: ids(1),
    media: ids(4),
    tags: newTags,
    article: articleId,
    doc: newDoc,
    address: `/uploads/new-${randomUUID()}.png`,
  };
  const pairs = (from: string[], to: string[]) =>
    new Map(from.map((id, index) => [id, to[index]]));
  const map: ReferenceMap = {
    ids: new Map([
      ["posts", pairs(old.posts, moved.posts)],
      ["pages", pairs(old.pages, moved.pages)],
      ["media", pairs(old.media, moved.media)],
      ["tags", pairs(old.tags, moved.tags)],
      ["articles", pairs([old.article], [moved.article])],
      ["docs", pairs([old.doc], [moved.doc])],
    ]),
    addresses: new Map([[old.address, moved.address]]),
  };
  const flat = (m: Moves) => [
    ...m.posts,
    ...m.pages,
    ...m.media,
    ...m.tags,
    m.article,
    m.doc,
    m.address,
  ];
  const oldFlat = flat(old);
  const newFlat = flat(moved);
  return {
    t,
    handler,
    site,
    map,
    old,
    moved,
    substitutions: oldFlat.map((value, index) => [value, newFlat[index]]),
    dangling,
    docId,
    articleId,
    guideId,
    docData,
    homeData,
    seededTables: [
      docs.table,
      guides.translationsTable!,
      cardTable,
      quoteTable,
      homeTable,
      junction,
      VERSIONS_TABLE,
      RELEASE_MEMBERS_TABLE,
    ].sort(),
    plainRows: new Map([
      ["dc_tags", new Set(old.tags)],
      ["dc_articles", new Set([old.article])],
    ]),
    ids: { version: versionId, member: memberId, orphan: orphanId },
    tables: { card: cardTable, junction },
  };
}

/** Every row of every table the database has, each as searchable text. */
async function everyStoredRow(fx: Fixture): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const table of await fx.t.adapter.listTables()) {
    const rows = await fx.t.adapter.queryStatement<Doc>(
      sql`SELECT * FROM ${sql.identifier(table)}`
    );
    const passedOver = fx.plainRows.get(table);
    out.set(
      table,
      rows
        .filter(row => !passedOver?.has(String(row.id)))
        .map(row =>
          JSON.stringify(row, (_key, value: unknown) =>
            typeof value === "bigint" ? String(value) : value
          )
        )
    );
  }
  return out;
}

/** The tables holding any of `values`, sorted, and what each holds. */
async function tablesHolding(
  fx: Fixture,
  values: readonly string[]
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const [table, rows] of await everyStoredRow(fx)) {
    const held = values.filter(value => rows.some(row => row.includes(value)));
    if (held.length > 0) found.set(table, held);
  }
  return new Map([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** `value` with every old id and address replaced by its new one. */
function moveAll<T>(fx: Fixture, value: T): T {
  let text = JSON.stringify(value);
  for (const [from, to] of fx.substitutions) text = text.split(from).join(to);
  return JSON.parse(text) as T;
}

async function rewrite(fx: Fixture) {
  return fx.t.adapter.transaction(tx =>
    rewriteStoredReferences(
      {
        db: tx,
        site: fx.site,
        maxParamsPerQuery: fx.t.adapter.getCapabilities().maxParamsPerQuery,
      },
      fx.map
    )
  );
}

describe.each(getConfiguredTestDialects())(
  "rewriting a site's stored references (%s)",
  (dialect: TestDialect) => {
    it("leaves no stored value holding an old id or address, and changes exactly the seeded tables", async () => {
      const fx = await boot(dialect);
      const oldValues = fx.substitutions.map(([from]) => from);
      // The search finds every old value before the rewrite, in exactly the
      // tables seeded and the records the writes kept of themselves, so it
      // reaches each place a reference is stored.
      const before = await tablesHolding(fx, oldValues);
      expect([...before.keys()]).toEqual(
        [...fx.seededTables, ...KEPT_AS_RECORDED.keys()].sort()
      );
      expect(new Set([...before.values()].flat())).toEqual(new Set(oldValues));

      const result = await rewrite(fx);

      // Only those records still hold an old value: everything content holds
      // now points at the new ones.
      const after = await tablesHolding(fx, oldValues);
      expect([...after.keys()]).toEqual([...KEPT_AS_RECORDED.keys()].sort());
      expect(Object.keys(result.changedRows).sort()).toEqual(fx.seededTables);
      // A second pass finds nothing left to change.
      expect((await rewrite(fx)).changedRows).toEqual({});
    });

    it("puts each new id and address where the old one was, and keeps a dangling id", async () => {
      const fx = await boot(dialect);
      await rewrite(fx);

      const doc = await fx.handler.getEntry({
        collectionName: "docs",
        entryId: fx.docId,
        depth: 0,
        overrideAccess: true,
      });
      expect(doc.success).toBe(true);
      const read = doc.data as Doc;
      expect(read).toMatchObject(moveAll(fx, fx.docData));
      expect(read.related).toEqual([
        fx.moved.posts[1],
        fx.dangling,
        fx.moved.posts[0],
      ]);

      const home = await fx.t
        .getService("singleEntryService")
        .get("home", { depth: 0, overrideAccess: true });
      expect(home.data as Doc).toMatchObject(moveAll(fx, fx.homeData));

      for (const [locale, cover] of [
        ["en", fx.moved.media[0]],
        ["fr", fx.moved.media[1]],
      ] as const) {
        const guide = await fx.t.nextly.findByID({
          collection: "guides",
          id: fx.guideId,
          locale,
          depth: 0,
        });
        expect((guide as Doc).cover).toBe(cover);
      }

      const article = await fx.handler.getEntry({
        collectionName: "articles",
        entryId: fx.articleId,
        depth: 0,
        overrideAccess: true,
      });
      expect([...((article.data as Doc).tags as string[])].sort()).toEqual(
        [...fx.moved.tags].sort()
      );

      const versions = await fx.t.adapter.select<Doc>(VERSIONS_TABLE, {
        where: { and: [{ column: "scopeSlug", op: "=", value: "docs" }] },
      });
      const recorded = versions.find(v => v.entryId === fx.docId);
      const snapshot = recorded?.snapshot;
      expect(
        typeof snapshot === "string" ? (JSON.parse(snapshot) as Doc) : snapshot
      ).toMatchObject(moveAll(fx, fx.docData));
      const held = versions.find(v => v.id === fx.ids.version);
      expect(held).toMatchObject({
        entryId: fx.moved.doc,
        draftKey: workingDraftKey(
          { scopeKind: "collection", scopeSlug: "docs", entryId: fx.moved.doc },
          null
        ),
      });

      const [member] = await fx.t.adapter.select<Doc>(RELEASE_MEMBERS_TABLE, {
        where: { and: [{ column: "id", op: "=", value: fx.ids.member }] },
      });
      expect(member).toMatchObject({
        entryId: fx.moved.doc,
        memberKey: releaseMemberKey(String(member.releaseId), {
          scopeKind: "collection",
          scopeSlug: "docs",
          entryId: fx.moved.doc,
          locale: null,
        }),
      });

      const [orphan] = await fx.t.adapter.select<Doc>(fx.tables.card, {
        where: { and: [{ column: "id", op: "=", value: fx.ids.orphan }] },
      });
      expect(orphan._parent_id).toBe(fx.moved.doc);
    });
  }
);
