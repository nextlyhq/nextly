/**
 * A field rewrite changes one field of an entry on its live copy and on every
 * pending draft that holds it, in one transaction, without publishing, and
 * only from the version the caller read: each draft stays a draft, an entry
 * saved since is refused with nothing changed, and history records one
 * rewrite naming who made it and why, never an overwrite.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, password, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

/** Drafts kept apart from the live row, with save hooks that note each call. */
const PAGES = "rwpages";
/** A publish lifecycle and no drafts. */
const PLAIN = "rwplain";
/** Translated, with drafts. */
const LOCALIZED = "rwlpages";
/** A person may update and publish only the entries they own. */
const OWNED = "rwowned";
/** Versions kept, and a password stored on the row. */
const SECRET = "rwsecret";
const PLUGIN = "@test/rewriter";
const REASON = "Layout 'Wide' was deleted";
const EDITOR = { id: "rw-editor" };

let current: TestNextly | undefined;
/** Each save hook call the collection under test saw, by stage. */
let hookCalls: string[] = [];
/** The context the test plugin was started with. */
let pluginCtx: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  pluginCtx = undefined;
});

async function boot(
  dialect: TestDialect,
  localized = false
): Promise<TestNextly> {
  hookCalls = [];
  const note = (stage: string) => () => {
    hookCalls.push(stage);
  };
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: PAGES,
        status: true,
        versions: { drafts: true },
        hooks: {
          beforeChange: [note("beforeChange")],
          afterChange: [note("afterChange")],
        },
        fields: [
          text({ name: "title" }),
          text({ name: "layout", maxLength: 12 }),
        ],
      }),
      defineCollection({
        slug: PLAIN,
        status: true,
        fields: [text({ name: "layout" })],
      }),
      defineCollection({
        slug: OWNED,
        status: true,
        access: {
          read: () => true,
          update: ({ user }) => ({ owner: { equals: user?.id ?? "" } }),
          publish: ({ user }) => ({ owner: { equals: user?.id ?? "" } }),
        },
        fields: [text({ name: "owner" }), text({ name: "layout" })],
      }),
      defineCollection({
        slug: SECRET,
        status: true,
        versions: true,
        fields: [text({ name: "layout" }), password({ name: "secret" })],
      }),
      ...(localized
        ? [
            defineCollection({
              slug: LOCALIZED,
              localized: true,
              status: true,
              versions: { drafts: true },
              fields: [
                text({ name: "title", localized: true }),
                // Shared by every language: fields of a translated
                // collection are translated unless they say otherwise.
                text({ name: "layout", localized: false }),
              ],
            }),
          ]
        : []),
    ],
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          pluginCtx = ctx;
        },
      }),
    ],
    ...(localized
      ? { localization: { locales: ["en", "de"], defaultLocale: "en" } }
      : {}),
  });
  return current;
}

function entries(t: TestNextly): CollectionEntryService {
  return (
    t.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService();
}

type Doc = Record<string, unknown> & {
  _rev?: string;
  _isWorkingDraft?: boolean;
};

/** The entry as visitors are served it, or as its editor reads it (`draft`). */
async function read(
  t: TestNextly,
  collection: string,
  id: string,
  options: { draft?: boolean; locale?: string } = {}
): Promise<Doc> {
  const result = await entries(t).getEntry({
    collectionName: collection,
    entryId: id,
    overrideAccess: true,
    ...(options.draft ? { includeWorkingDraft: true } : {}),
    ...(options.locale === undefined
      ? {}
      : { locale: options.locale, fallbackLocale: false }),
  });
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result.data as Doc;
}

async function create(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const result = await entries(t).createEntry(
    { collectionName: collection, overrideAccess: true },
    data
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  return (result.data as { id: string }).id;
}

/** An ordinary save, as an editor's: held as the draft of a published entry. */
async function save(
  t: TestNextly,
  collection: string,
  id: string,
  data: Record<string, unknown>,
  locale?: string
): Promise<void> {
  const result = await entries(t).updateEntry(
    {
      collectionName: collection,
      entryId: id,
      overrideAccess: true,
      ...(locale === undefined ? {} : { locale }),
    },
    { _overwrite: true, ...data }
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
}

async function events(
  t: TestNextly,
  collection: string,
  id: string
): Promise<Array<Record<string, unknown>>> {
  const { items } = await t.nextly.contentEvents.list({
    subject: { kind: "collection", slug: collection, id },
  } as never);
  return items as unknown as Array<Record<string, unknown>>;
}

const kinds = async (t: TestNextly, collection: string, id: string) =>
  (await events(t, collection, id)).map(event => event.kind);

describe.each(getConfiguredTestDialects())("a field rewrite (%s)", dialect => {
  it("changes the live copy and the draft, and the draft stays a draft", async () => {
    const t = await boot(dialect);
    const id = await create(t, PAGES, {
      title: "Live",
      layout: "wide",
      status: "published",
    });
    await save(t, PAGES, id, { title: "Unfinished" });
    // POPULATION CONTROL: the edit is held, not live.
    expect((await read(t, PAGES, id)).title).toBe("Live");
    const version = (await read(t, PAGES, id))._rev as string;
    const before = (await events(t, PAGES, id)).length;
    // POPULATION CONTROL: the save hooks are wired, and an ordinary save
    // runs them.
    expect(hookCalls).toContain("beforeChange");
    hookCalls = [];

    const done = await t.nextly.rewriteField({
      collection: PAGES,
      id,
      field: "layout",
      expectedVersion: version,
      set: { value: "narrow" },
      reason: REASON,
    });

    expect(done.item.copies).toEqual([
      { form: "live", locale: null },
      { form: "draft", locale: null },
    ]);
    const live = await read(t, PAGES, id);
    expect(live).toMatchObject({
      layout: "narrow",
      title: "Live",
      status: "published",
    });
    const draft = await read(t, PAGES, id, { draft: true });
    expect(draft).toMatchObject({
      layout: "narrow",
      title: "Unfinished",
      _isWorkingDraft: true,
    });
    // No save hook ran for the rewrite.
    expect(hookCalls).toEqual([]);
    // One event, of its own kind, and nothing recorded as an overwrite.
    const history = await events(t, PAGES, id);
    const added = history.slice(0, history.length - before);
    expect(added.map(e => e.kind)).toEqual(["field-rewritten"]);
    expect(added[0]).toMatchObject({
      note: REASON,
      payload: { field: "layout", copies: ["live", "draft"] },
    });
    // The version returned is the one the entry is at now.
    expect(live._rev).toBe(done.item.version);
  });

  it("changes the live copy alone where no draft waits, and records the update event", async () => {
    const t = await boot(dialect);
    const id = await create(t, PAGES, { layout: "wide", status: "published" });
    const version = (await read(t, PAGES, id))._rev as string;
    const result = await entries(t).rewriteField({
      request: {
        collection: PAGES,
        id,
        field: "layout",
        expectedVersion: version,
        set: { value: "narrow" },
        reason: REASON,
      },
      overrideAccess: true,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.data?.copies).toEqual([{ form: "live", locale: null }]);
    expect(result.eventRecorded).toBe(true);
    expect((await read(t, PAGES, id)).layout).toBe("narrow");
  });

  it("changes the live copy of a collection that keeps no drafts", async () => {
    const t = await boot(dialect);
    const id = await create(t, PLAIN, { layout: "wide", status: "published" });
    const version = (await read(t, PLAIN, id))._rev as string;
    const done = await t.nextly.rewriteField({
      collection: PLAIN,
      id,
      field: "layout",
      expectedVersion: version,
      set: { value: "narrow" },
      reason: REASON,
    });
    expect(done.item.copies).toEqual([{ form: "live", locale: null }]);
    expect((await read(t, PLAIN, id)).layout).toBe("narrow");
  });

  it("refuses a rewrite from a version an author's save has moved past, changing nothing", async () => {
    const t = await boot(dialect);
    const id = await create(t, PAGES, { layout: "wide", status: "published" });
    const readAt = (await read(t, PAGES, id))._rev as string;
    // An author saves the draft between the read and the rewrite.
    await save(t, PAGES, id, { title: "Author's edit" });

    await expect(
      t.nextly.rewriteField({
        collection: PAGES,
        id,
        field: "layout",
        expectedVersion: readAt,
        set: { value: "narrow" },
        reason: REASON,
      })
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect((await read(t, PAGES, id)).layout).toBe("wide");
    expect(await read(t, PAGES, id, { draft: true })).toMatchObject({
      layout: "wide",
      title: "Author's edit",
    });
    expect(await kinds(t, PAGES, id)).not.toContain("field-rewritten");
  });

  it("takes the version it returned, and refuses the one before it", async () => {
    const t = await boot(dialect);
    const id = await create(t, PAGES, { layout: "a", status: "published" });
    const first = (await read(t, PAGES, id))._rev as string;
    const args = {
      collection: PAGES,
      id,
      field: "layout",
      reason: REASON,
    };
    const done = await t.nextly.rewriteField({
      ...args,
      expectedVersion: first,
      set: { value: "b" },
    });
    await t.nextly.rewriteField({
      ...args,
      expectedVersion: done.item.version,
      set: { value: "c" },
    });
    await expect(
      t.nextly.rewriteField({
        ...args,
        expectedVersion: first,
        set: { value: "d" },
      })
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect((await read(t, PAGES, id)).layout).toBe("c");
  });

  it("computes each copy's value from its own", async () => {
    const t = await boot(dialect);
    const id = await create(t, PAGES, { layout: "wide", status: "published" });
    await save(t, PAGES, id, { layout: "full" });
    const version = (await read(t, PAGES, id))._rev as string;
    await t.nextly.rewriteField({
      collection: PAGES,
      id,
      field: "layout",
      expectedVersion: version,
      set: { from: current => `${String(current)}-x` },
      reason: REASON,
    });
    expect((await read(t, PAGES, id)).layout).toBe("wide-x");
    expect((await read(t, PAGES, id, { draft: true })).layout).toBe("full-x");
  });

  it("refuses a value the field's own check refuses on one copy, changing none", async () => {
    const t = await boot(dialect);
    const id = await create(t, PAGES, { layout: "wide", status: "published" });
    // The draft's longer value takes the rewrite past the field's length.
    await save(t, PAGES, id, { layout: "a-long-one" });
    const version = (await read(t, PAGES, id))._rev as string;
    await expect(
      t.nextly.rewriteField({
        collection: PAGES,
        id,
        field: "layout",
        expectedVersion: version,
        set: { from: current => `${String(current)}-xx` },
        reason: REASON,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await read(t, PAGES, id)).layout).toBe("wide");
    expect((await read(t, PAGES, id, { draft: true })).layout).toBe(
      "a-long-one"
    );
  });

  it("needs a person's permission to update and to publish", async () => {
    const t = await boot(dialect);
    await userWhoMay(t, EDITOR.id, "update", [PAGES]);
    await grantTo(t, EDITOR.id, "read", [PAGES]);
    const id = await create(t, PAGES, { layout: "wide", status: "published" });
    const asEditor = new Nextly({
      overrideAccess: false,
      user: { id: EDITOR.id } as never,
    });
    const rewrite = async (value: string) =>
      asEditor.rewriteField({
        collection: PAGES,
        id,
        field: "layout",
        expectedVersion: (await read(t, PAGES, id))._rev as string,
        set: { value },
        reason: REASON,
        overrideAccess: false,
        user: { id: EDITOR.id } as never,
      });
    // Update alone does not reach the live copy.
    await expect(rewrite("narrow")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await read(t, PAGES, id)).layout).toBe("wide");
    await grantTo(t, EDITOR.id, "publish", [PAGES]);
    await rewrite("narrow");
    expect((await read(t, PAGES, id)).layout).toBe("narrow");
  });

  it("matches a filtered publish rule, and refuses a rewrite that moves the entry out of it", async () => {
    const t = await boot(dialect);
    await userWhoMay(t, EDITOR.id, "read", [OWNED]);
    await grantTo(t, EDITOR.id, "update", [OWNED]);
    await grantTo(t, EDITOR.id, "publish", [OWNED]);
    const id = await create(t, OWNED, {
      owner: EDITOR.id,
      layout: "wide",
      status: "published",
    });
    const asEditor = new Nextly({
      overrideAccess: false,
      user: { id: EDITOR.id } as never,
    });
    const rewrite = async (field: string, value: string) =>
      asEditor.rewriteField({
        collection: OWNED,
        id,
        field,
        expectedVersion: (await read(t, OWNED, id))._rev as string,
        set: { value },
        reason: REASON,
        overrideAccess: false,
        user: { id: EDITOR.id } as never,
      });
    // The entry is theirs, so both rules' filters match it.
    await rewrite("layout", "narrow");
    expect((await read(t, OWNED, id)).layout).toBe("narrow");
    // Handing the entry to someone else would move it out of both.
    await expect(rewrite("owner", "someone-else")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await read(t, OWNED, id)).owner).toBe(EDITOR.id);
  });

  it("records no password in the version it captures", async () => {
    const t = await boot(dialect);
    const id = await create(t, SECRET, {
      layout: "wide",
      secret: "hunter22-secret",
      status: "published",
    });
    await t.nextly.rewriteField({
      collection: SECRET,
      id,
      field: "layout",
      expectedVersion: (await read(t, SECRET, id))._rev as string,
      set: { value: "narrow" },
      reason: REASON,
    });
    const { items } = await t.nextly.versions.list({
      collection: SECRET,
      id,
    } as never);
    const newest = items[0] as { versionNo: number };
    const version = await t.nextly.versions.get({
      collection: SECRET,
      id,
      versionNo: newest.versionNo,
    } as never);
    const snapshot = (
      typeof version.snapshot === "string"
        ? JSON.parse(version.snapshot)
        : version.snapshot
    ) as Record<string, unknown>;
    // POPULATION CONTROL: this is the rewrite's version.
    expect(snapshot.layout).toBe("narrow");
    expect(snapshot.secret ?? null).toBeNull();
  });

  it("names the plugin that made it, from its own identity", async () => {
    const t = await boot(dialect);
    const id = await create(t, PAGES, { layout: "wide", status: "published" });
    const version = (await read(t, PAGES, id))._rev as string;
    expect(pluginCtx).toBeDefined();
    await pluginCtx!.services.collections.rewriteField({
      collection: PAGES,
      id,
      field: "layout",
      expectedVersion: version,
      set: { value: "narrow" },
      reason: REASON,
    });
    const rewrite = (await events(t, PAGES, id)).find(
      e => e.kind === "field-rewritten"
    );
    expect(rewrite).toMatchObject({
      actorKind: "plugin",
      actorName: PLUGIN,
      note: REASON,
    });
  });
});

describe.each(getConfiguredTestDialects())(
  "a field rewrite of a translated entry (%s)",
  dialect => {
    /** Published in both languages, with a pending draft in each. */
    async function withDrafts(t: TestNextly): Promise<string> {
      const id = await create(t, LOCALIZED, {
        title: "EN",
        layout: "wide",
        status: "published",
      });
      await save(t, LOCALIZED, id, { title: "DE", status: "published" }, "de");
      await save(t, LOCALIZED, id, { title: "EN draft" }, "en");
      await save(t, LOCALIZED, id, { title: "DE draft" }, "de");
      return id;
    }

    it("changes a shared field in every language's draft, and a draft published later keeps it", async () => {
      const t = await boot(dialect, true);
      const id = await withDrafts(t);
      const version = (await read(t, LOCALIZED, id, { locale: "en" }))
        ._rev as string;
      const done = await t.nextly.rewriteField({
        collection: LOCALIZED,
        id,
        field: "layout",
        expectedVersion: version,
        set: { value: "narrow" },
        reason: REASON,
      });
      expect(
        done.item.copies.map(c => `${c.form}:${c.locale ?? ""}`).sort()
      ).toEqual(["draft:de", "draft:en", "live:"]);
      for (const locale of ["en", "de"]) {
        const draft = await read(t, LOCALIZED, id, { draft: true, locale });
        expect(draft.layout).toBe("narrow");
        expect(draft.title).toBe(locale === "en" ? "EN draft" : "DE draft");
      }
      // Publishing one language's draft puts its own values live, and the
      // rewritten shared value stays.
      await save(t, LOCALIZED, id, { status: "published" }, "de");
      const live = await read(t, LOCALIZED, id, { locale: "de" });
      expect(live).toMatchObject({ layout: "narrow", title: "DE draft" });
    });

    it("publishes a draft's own rewritten edit of a shared field, rather than refusing it", async () => {
      const t = await boot(dialect, true);
      const id = await withDrafts(t);
      // The German draft edits the shared field itself.
      await save(t, LOCALIZED, id, { layout: "full" }, "de");
      const version = (await read(t, LOCALIZED, id, { locale: "en" }))
        ._rev as string;
      await t.nextly.rewriteField({
        collection: LOCALIZED,
        id,
        field: "layout",
        expectedVersion: version,
        set: { from: current => `${String(current)}-x` },
        reason: REASON,
      });
      expect((await read(t, LOCALIZED, id, { locale: "en" })).layout).toBe(
        "wide-x"
      );
      await save(t, LOCALIZED, id, { status: "published" }, "de");
      expect((await read(t, LOCALIZED, id, { locale: "de" })).layout).toBe(
        "full-x"
      );
    });

    it("refuses a language the site does not configure", async () => {
      const t = await boot(dialect, true);
      const id = await withDrafts(t);
      await expect(
        t.nextly.rewriteField({
          collection: LOCALIZED,
          id,
          field: "title",
          locale: "fr",
          expectedVersion: (await read(t, LOCALIZED, id, { locale: "en" }))
            ._rev as string,
          set: { value: "Bonjour" },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect((await read(t, LOCALIZED, id, { locale: "en" })).title).toBe("EN");
    });

    it("refuses a translated rewrite from a read of another language", async () => {
      const t = await boot(dialect, true);
      const id = await withDrafts(t);
      const englishRead = (await read(t, LOCALIZED, id, { locale: "en" }))
        ._rev as string;
      await expect(
        t.nextly.rewriteField({
          collection: LOCALIZED,
          id,
          field: "title",
          locale: "de",
          expectedVersion: englishRead,
          set: { value: "Neu" },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect((await read(t, LOCALIZED, id, { locale: "de" })).title).toBe("DE");
    });

    it("changes a translated field in the named language only", async () => {
      const t = await boot(dialect, true);
      const id = await withDrafts(t);
      const version = (await read(t, LOCALIZED, id, { locale: "de" }))
        ._rev as string;
      const done = await t.nextly.rewriteField({
        collection: LOCALIZED,
        id,
        field: "title",
        locale: "de",
        expectedVersion: version,
        set: { from: current => `${String(current)}!` },
        reason: REASON,
      });
      expect(done.item.copies).toEqual([
        { form: "live", locale: "de" },
        { form: "draft", locale: "de" },
      ]);
      expect((await read(t, LOCALIZED, id, { locale: "de" })).title).toBe(
        "DE!"
      );
      expect(
        (await read(t, LOCALIZED, id, { draft: true, locale: "de" })).title
      ).toBe("DE draft!");
      expect((await read(t, LOCALIZED, id, { locale: "en" })).title).toBe("EN");
      expect(
        (await read(t, LOCALIZED, id, { draft: true, locale: "en" })).title
      ).toBe("EN draft");
    });
  }
);
