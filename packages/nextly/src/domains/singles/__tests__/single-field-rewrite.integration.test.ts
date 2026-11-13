/**
 * A field rewrite reaches a Single as it reaches a collection entry: one field
 * changed on the Single's live copy and on every pending draft that holds it,
 * in one transaction, without publishing, and only from the version the
 * caller read. Each draft stays a draft, a Single saved since is refused with
 * nothing changed, and history records one rewrite naming who made it and
 * why, never an overwrite.
 *
 * The cases repeat the entry suite's (`field-rewrite.integration.test.ts`),
 * through the same request shape: `{ single, field, ... }` beside
 * `{ collection, id, ... }`.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import {
  recordTransactionEscapes,
  takeTransactionEscapes,
} from "../../../__tests__/transaction-escapes";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  password,
  relationship,
  repeater,
  text,
} from "../../../config";
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
import type { SingleEntryService } from "../services/single-entry-service";

/** Drafts kept apart from the live row, with save hooks that note each call. */
const SITE = "rwsite";
/** A publish lifecycle and no drafts. */
const PLAIN = "rwplainsite";
/** Translated, with drafts. */
const LOCALIZED = "rwlsite";
/** Versions kept, and a password stored on the row and inside a group. */
const SECRET = "rwsecretsite";
/** No translations of its own, versions kept, and a translated field group. */
const BANNERED = "rwbannersite";
const BANNER = "rwsitebanner";
/** Translated, with drafts, and no translated field that must hold a value. */
const BLANKABLE = "rwblanksite";
/** What the Single under test relates to. */
const TARGETS = "rwtargets";
/** A field group, placed inside a group of the Single under test. */
const HERO = "rwsitehero";
const PLUGIN = "@test/single-rewriter";
const REASON = "Layout 'Wide' was deleted";
const EDITOR = { id: "rw-single-editor" };

let current: TestNextly | undefined;
/** Each save hook call the Single under test saw, by stage. */
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
  const note =
    (stage: string) =>
    ({ data }: { data?: unknown }) => {
      hookCalls.push(stage);
      return data;
    };
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: TARGETS, fields: [text({ name: "title" })] }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        status: true,
        versions: { drafts: true },
        hooks: {
          beforeChange: [note("beforeChange")],
          afterChange: [note("afterChange")],
        },
        fields: [
          text({ name: "title" }),
          text({ name: "layout", maxLength: 12 }),
          repeater({ name: "items", fields: [text({ name: "label" })] }),
          relationship({ name: "featured", relationTo: TARGETS }),
          group({
            name: "box",
            fields: [fieldGroup({ name: "hero", component: HERO })],
          }),
        ],
      }),
      defineSingle({
        slug: PLAIN,
        status: true,
        fields: [text({ name: "layout" })],
      }),
      defineSingle({
        slug: SECRET,
        status: true,
        versions: true,
        fields: [
          text({ name: "layout" }),
          password({ name: "secret" }),
          group({ name: "login", fields: [password({ name: "pin" })] }),
        ],
      }),
      ...(localized
        ? [
            defineSingle({
              slug: BLANKABLE,
              localized: true,
              status: true,
              versions: { drafts: true },
              fields: [
                text({ name: "tagline", localized: true }),
                text({ name: "layout", localized: false }),
              ],
            }),
            defineSingle({
              slug: BANNERED,
              status: true,
              versions: true,
              fields: [
                text({ name: "layout" }),
                fieldGroup({ name: "banner", component: BANNER }),
              ],
            }),
            defineSingle({
              slug: LOCALIZED,
              localized: true,
              status: true,
              versions: { drafts: true },
              fields: [
                text({ name: "title", localized: true, required: true }),
                text({ name: "layout", localized: false }),
              ],
            }),
          ]
        : []),
    ],
    fieldGroups: [
      defineFieldGroup({ slug: HERO, fields: [text({ name: "heading" })] }),
      ...(localized
        ? [
            defineFieldGroup({
              slug: BANNER,
              localized: true,
              fields: [text({ name: "words" })],
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
  // A PostgreSQL or MySQL leg that silently booted SQLite proves nothing.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

type Doc = Record<string, unknown> & {
  _rev?: string;
  _isWorkingDraft?: boolean;
};

/** The Single as visitors are served it, or as its editor reads it (`draft`). */
async function read(
  t: TestNextly,
  slug: string,
  options: { draft?: boolean; locale?: string } = {}
): Promise<Doc> {
  const result = await singlesOf(t).get(slug, {
    overrideAccess: true,
    ...(options.draft ? { includeWorkingDraft: true, status: "all" } : {}),
    ...(options.locale === undefined
      ? {}
      : { locale: options.locale, fallbackLocale: false }),
  } as never);
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result.data as Doc;
}

/** An ordinary save, as an editor's: held as the draft of a published Single. */
async function save(
  t: TestNextly,
  slug: string,
  data: Record<string, unknown>,
  locale?: string
): Promise<void> {
  const result = await singlesOf(t).update(
    slug,
    { _overwrite: true, ...data },
    { overrideAccess: true, ...(locale === undefined ? {} : { locale }) }
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
}

async function events(
  t: TestNextly,
  slug: string
): Promise<Array<Record<string, unknown>>> {
  const id = (await read(t, slug)).id as string;
  const { items } = await t.nextly.contentEvents.list({
    subject: { kind: "single", slug, id },
  } as never);
  return items as unknown as Array<Record<string, unknown>>;
}

const kinds = async (t: TestNextly, slug: string) =>
  (await events(t, slug)).map(event => event.kind);

const versionOf = async (t: TestNextly, slug: string, locale?: string) =>
  (await read(t, slug, locale === undefined ? {} : { locale }))._rev as string;

describe.each(getConfiguredTestDialects())(
  "a field rewrite of a Single (%s)",
  dialect => {
    it("changes the live copy and the draft, and the draft stays a draft", async () => {
      const t = await boot(dialect);
      await save(t, SITE, {
        title: "Live",
        layout: "wide",
        status: "published",
      });
      await save(t, SITE, { title: "Unfinished" });
      // POPULATION CONTROL: the edit is held, not live.
      expect((await read(t, SITE)).title).toBe("Live");
      const version = await versionOf(t, SITE);
      const before = (await events(t, SITE)).length;
      // POPULATION CONTROL: the save hooks are wired, and an ordinary save
      // runs them.
      expect(hookCalls).toContain("beforeChange");
      hookCalls = [];

      const done = await t.nextly.rewriteField({
        single: SITE,
        field: "layout",
        expectedVersion: version,
        set: { value: "narrow" },
        reason: REASON,
      });

      expect(done.item.copies).toEqual([
        { form: "live", locale: null },
        { form: "draft", locale: null },
      ]);
      const live = await read(t, SITE);
      expect(live).toMatchObject({
        layout: "narrow",
        title: "Live",
        status: "published",
      });
      const draft = await read(t, SITE, { draft: true });
      expect(draft).toMatchObject({
        layout: "narrow",
        title: "Unfinished",
        _isWorkingDraft: true,
      });
      // No save hook ran for the rewrite.
      expect(hookCalls).toEqual([]);
      // One event, of its own kind, and nothing recorded as an overwrite.
      const history = await events(t, SITE);
      const added = history.slice(0, history.length - before);
      expect(added.map(e => e.kind)).toEqual(["field-rewritten"]);
      expect(added[0]).toMatchObject({
        note: REASON,
        payload: { field: "layout", copies: ["live", "draft"] },
      });
      // The version returned is the one the Single is at now.
      expect(live._rev).toBe(done.item.version);
    });

    it("reads nothing off its own transaction", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      await save(t, SITE, { title: "Unfinished" });
      const version = await versionOf(t, SITE);
      // What the boot and the saves above left is theirs, recorded as the
      // setup file records every test's.
      recordTransactionEscapes(
        takeTransactionEscapes(),
        expect.getState().testPath
      );
      await t.nextly.rewriteField({
        single: SITE,
        field: "layout",
        expectedVersion: version,
        set: { value: "narrow" },
        reason: REASON,
      });
      // Every escape, accepted or not: on PostgreSQL and MySQL a read on the
      // pool runs outside the rewrite's transaction. SQLite reports none.
      const escapes = takeTransactionEscapes();
      recordTransactionEscapes(escapes, expect.getState().testPath);
      expect(
        escapes.map(escape => escape.key),
        escapes.map(escape => escape.stack).join("\n\n")
      ).toEqual([]);
    });

    it("changes the live copy alone where no draft waits, and records the update event", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      const result = await singlesOf(t).rewriteField({
        request: {
          single: SITE,
          field: "layout",
          expectedVersion: await versionOf(t, SITE),
          set: { value: "narrow" },
          reason: REASON,
        },
        overrideAccess: true,
      });
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(result.data?.copies).toEqual([{ form: "live", locale: null }]);
      expect(result.eventRecorded).toBe(true);
      expect(result.revalidationIntent).toBeDefined();
      expect((await read(t, SITE)).layout).toBe("narrow");
    });

    it("leaves the live copy, its date and its events alone where only a draft's value moves", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      await save(t, SITE, { layout: "retired" });
      const before = await read(t, SITE);
      const result = await singlesOf(t).rewriteField({
        request: {
          single: SITE,
          field: "layout",
          expectedVersion: before._rev as string,
          set: {
            from: current => (current === "retired" ? "narrow" : current),
          },
          reason: REASON,
        },
        overrideAccess: true,
      });
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(result.data?.copies).toEqual([{ form: "draft", locale: null }]);
      // No public event and no revalidation: the live copy did not change.
      expect(result.eventRecorded).toBe(false);
      expect(result.revalidationIntent).toBeUndefined();
      const live = await read(t, SITE);
      expect(live.layout).toBe("wide");
      expect(live.updatedAt).toEqual(before.updatedAt);
      expect((await read(t, SITE, { draft: true })).layout).toBe("narrow");
      // The version still moved, so a save from the older read is refused.
      expect(live._rev).not.toBe(before._rev);
    });

    it("gives a draft's new repeater rows their ids, as a save does", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      await save(t, SITE, { items: [{ label: "old" }] });
      await t.nextly.rewriteField({
        single: SITE,
        field: "items",
        expectedVersion: await versionOf(t, SITE),
        set: {
          from: (current, copy) =>
            copy.form === "draft" ? [{ label: "a" }, { label: "b" }] : current,
        },
        reason: REASON,
      });
      const rows = (await read(t, SITE, { draft: true })).items as Array<{
        id?: unknown;
        label?: unknown;
      }>;
      expect(rows.map(r => r.label)).toEqual(["a", "b"]);
      for (const row of rows) expect(typeof row.id).toBe("string");
      expect(new Set(rows.map(r => r.id)).size).toBe(2);
    });

    it("stores a populated reference in the draft as the id it stands for", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: TARGETS,
        data: { title: "Target" },
      });
      const target = String(created.item.id);
      await save(t, SITE, { layout: "wide", status: "published" });
      await save(t, SITE, { title: "Unfinished" });
      await t.nextly.rewriteField({
        single: SITE,
        field: "featured",
        expectedVersion: await versionOf(t, SITE),
        // As a read at depth serves it: the whole related row.
        set: { value: { id: target, title: "Target" } },
        reason: REASON,
      });
      const rows = await t.adapter.select<{ snapshot: unknown }>(
        "nextly_versions",
        {
          where: {
            and: [
              { column: "scopeKind", op: "=", value: "single" },
              { column: "scopeSlug", op: "=", value: SITE },
              { column: "isAutosave", op: "=", value: false },
              { column: "versionNo", op: "IS NULL" },
            ],
          },
        }
      );
      // POPULATION CONTROL: the Single's one working draft.
      expect(rows).toHaveLength(1);
      const draft = (
        typeof rows[0].snapshot === "string"
          ? JSON.parse(rows[0].snapshot)
          : rows[0].snapshot
      ) as Record<string, unknown>;
      expect(draft.title).toBe("Unfinished");
      expect(draft.featured).toBe(target);
    });

    it("changes nothing where a populated reference names the id stored", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: TARGETS,
        data: { title: "Target" },
      });
      const target = String(created.item.id);
      await save(t, SITE, { featured: target, status: "published" });
      const before = await versionOf(t, SITE);
      const done = await t.nextly.rewriteField({
        single: SITE,
        field: "featured",
        expectedVersion: before,
        set: { value: { id: target, title: "Target" } },
        reason: REASON,
      });
      expect(done.item.copies).toEqual([]);
      expect(await versionOf(t, SITE)).toBe(before);
      expect(await kinds(t, SITE)).not.toContain("field-rewritten");
    });

    it("refuses a group holding a field group, whose own rules a value swap doesn't judge", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      await expect(
        t.nextly.rewriteField({
          single: SITE,
          field: "box",
          expectedVersion: await versionOf(t, SITE),
          set: { value: { hero: { heading: "Hi" } } },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("changes the live copy of a Single that keeps no drafts", async () => {
      const t = await boot(dialect);
      await save(t, PLAIN, { layout: "wide", status: "published" });
      const done = await t.nextly.rewriteField({
        single: PLAIN,
        field: "layout",
        expectedVersion: await versionOf(t, PLAIN),
        set: { value: "narrow" },
        reason: REASON,
      });
      expect(done.item.copies).toEqual([{ form: "live", locale: null }]);
      expect((await read(t, PLAIN)).layout).toBe("narrow");
    });

    it("refuses a rewrite from a version an author's save has moved past, changing nothing", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      const readAt = await versionOf(t, SITE);
      // An author saves the draft between the read and the rewrite.
      await save(t, SITE, { title: "Author's edit" });

      await expect(
        t.nextly.rewriteField({
          single: SITE,
          field: "layout",
          expectedVersion: readAt,
          set: { value: "narrow" },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "STALE_VERSION" });
      expect((await read(t, SITE)).layout).toBe("wide");
      expect(await read(t, SITE, { draft: true })).toMatchObject({
        layout: "wide",
        title: "Author's edit",
      });
      expect(await kinds(t, SITE)).not.toContain("field-rewritten");
    });

    it("takes the version it returned, and refuses the one before it", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "a", status: "published" });
      const first = await versionOf(t, SITE);
      const args = { single: SITE, field: "layout", reason: REASON };
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
      expect((await read(t, SITE)).layout).toBe("c");
    });

    it("computes each copy's value from its own", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      await save(t, SITE, { layout: "full" });
      await t.nextly.rewriteField({
        single: SITE,
        field: "layout",
        expectedVersion: await versionOf(t, SITE),
        set: { from: current => `${String(current)}-x` },
        reason: REASON,
      });
      expect((await read(t, SITE)).layout).toBe("wide-x");
      expect((await read(t, SITE, { draft: true })).layout).toBe("full-x");
    });

    it("refuses a value the field's own check refuses on one copy, changing none", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      // The draft's longer value takes the rewrite past the field's length.
      await save(t, SITE, { layout: "a-long-one" });
      await expect(
        t.nextly.rewriteField({
          single: SITE,
          field: "layout",
          expectedVersion: await versionOf(t, SITE),
          set: { from: current => `${String(current)}-xx` },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect((await read(t, SITE)).layout).toBe("wide");
      expect((await read(t, SITE, { draft: true })).layout).toBe("a-long-one");
    });

    it("refuses a field the system keeps, naming it, before reading the Single", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      await expect(
        t.nextly.rewriteField({
          single: SITE,
          field: "status",
          expectedVersion: await versionOf(t, SITE),
          set: { value: "draft" },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect((await read(t, SITE)).status).toBe("published");
    });

    it("refuses a group holding a password, which a read gives without it", async () => {
      const t = await boot(dialect);
      await save(t, SECRET, {
        layout: "wide",
        login: { pin: "1234-secret" },
        status: "published",
      });
      await expect(
        t.nextly.rewriteField({
          single: SECRET,
          field: "login",
          expectedVersion: await versionOf(t, SECRET),
          set: { value: { pin: "plain" } },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      // POPULATION CONTROL: the Single's other fields can be rewritten.
      await t.nextly.rewriteField({
        single: SECRET,
        field: "layout",
        expectedVersion: await versionOf(t, SECRET),
        set: { value: "narrow" },
        reason: REASON,
      });
    });

    it("needs a person's permission to update and to publish", async () => {
      const t = await boot(dialect);
      await userWhoMay(t, EDITOR.id, "update", [SITE]);
      await grantTo(t, EDITOR.id, "read", [SITE]);
      await save(t, SITE, { layout: "wide", status: "published" });
      const asEditor = new Nextly({
        overrideAccess: false,
        user: { id: EDITOR.id } as never,
      });
      const rewrite = async (value: string) =>
        asEditor.rewriteField({
          single: SITE,
          field: "layout",
          expectedVersion: await versionOf(t, SITE),
          set: { value },
          reason: REASON,
          overrideAccess: false,
          user: { id: EDITOR.id } as never,
        });
      // Update alone does not reach the live copy.
      await expect(rewrite("narrow")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await read(t, SITE)).layout).toBe("wide");
      await grantTo(t, EDITOR.id, "publish", [SITE]);
      await rewrite("narrow");
      expect((await read(t, SITE)).layout).toBe("narrow");
    });

    it("records no password in the version it captures", async () => {
      const t = await boot(dialect);
      await save(t, SECRET, {
        layout: "wide",
        secret: "hunter22-secret",
        status: "published",
      });
      await t.nextly.rewriteField({
        single: SECRET,
        field: "layout",
        expectedVersion: await versionOf(t, SECRET),
        set: { value: "narrow" },
        reason: REASON,
      });
      const { items } = await t.nextly.versions.list({
        single: SECRET,
      } as never);
      const newest = items[0] as { versionNo: number };
      const version = await t.nextly.versions.get({
        single: SECRET,
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

    it("names the person a trusted rewrite is made for", async () => {
      const t = await boot(dialect);
      await userWhoMay(t, EDITOR.id, "read", [SITE]);
      await save(t, SITE, { layout: "wide", status: "published" });
      await t.nextly.rewriteField({
        single: SITE,
        field: "layout",
        expectedVersion: await versionOf(t, SITE),
        set: { value: "narrow" },
        reason: REASON,
        user: { id: EDITOR.id } as never,
      });
      const rewrite = (await events(t, SITE)).find(
        e => e.kind === "field-rewritten"
      );
      expect(rewrite).toMatchObject({
        actorKind: "person",
        actorId: EDITOR.id,
      });
    });

    it("names the plugin that made it, from its own identity", async () => {
      const t = await boot(dialect);
      await save(t, SITE, { layout: "wide", status: "published" });
      const version = await versionOf(t, SITE);
      expect(pluginCtx).toBeDefined();
      await pluginCtx!.services.collections.rewriteField({
        single: SITE,
        field: "layout",
        expectedVersion: version,
        set: { value: "narrow" },
        reason: REASON,
      });
      expect((await read(t, SITE)).layout).toBe("narrow");
      const rewrite = (await events(t, SITE)).find(
        e => e.kind === "field-rewritten"
      );
      expect(rewrite).toMatchObject({
        actorKind: "plugin",
        actorName: PLUGIN,
        note: REASON,
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a field rewrite of a translated Single (%s)",
  dialect => {
    /** Published in both languages, with a pending draft in each. */
    async function withDrafts(t: TestNextly): Promise<void> {
      await save(
        t,
        LOCALIZED,
        { title: "EN", layout: "wide", status: "published" },
        "en"
      );
      await save(t, LOCALIZED, { title: "DE", status: "published" }, "de");
      await save(t, LOCALIZED, { title: "EN draft" }, "en");
      await save(t, LOCALIZED, { title: "DE draft" }, "de");
    }

    it("changes a shared field in every language's draft, and a draft published later keeps it", async () => {
      const t = await boot(dialect, true);
      await withDrafts(t);
      const done = await t.nextly.rewriteField({
        single: LOCALIZED,
        field: "layout",
        expectedVersion: await versionOf(t, LOCALIZED, "en"),
        set: { value: "narrow" },
        reason: REASON,
      });
      expect(
        done.item.copies.map(c => `${c.form}:${c.locale ?? ""}`).sort()
      ).toEqual(["draft:de", "draft:en", "live:"]);
      for (const locale of ["en", "de"]) {
        const draft = await read(t, LOCALIZED, { draft: true, locale });
        expect(draft.layout).toBe("narrow");
        expect(draft.title).toBe(locale === "en" ? "EN draft" : "DE draft");
      }
      // Publishing one language's draft puts its own values live, and the
      // rewritten shared value stays.
      await save(t, LOCALIZED, { status: "published" }, "de");
      const live = await read(t, LOCALIZED, { locale: "de" });
      expect(live).toMatchObject({ layout: "narrow", title: "DE draft" });
    });

    it("publishes a draft's own rewritten edit of a shared field, rather than refusing it", async () => {
      const t = await boot(dialect, true);
      await withDrafts(t);
      // The German draft edits the shared field itself.
      await save(t, LOCALIZED, { layout: "full" }, "de");
      await t.nextly.rewriteField({
        single: LOCALIZED,
        field: "layout",
        expectedVersion: await versionOf(t, LOCALIZED, "en"),
        set: { from: current => `${String(current)}-x` },
        reason: REASON,
      });
      expect((await read(t, LOCALIZED, { locale: "en" })).layout).toBe(
        "wide-x"
      );
      await save(t, LOCALIZED, { status: "published" }, "de");
      expect((await read(t, LOCALIZED, { locale: "de" })).layout).toBe(
        "full-x"
      );
    });

    it("records a translation's own status with its rewrite", async () => {
      const t = await boot(dialect, true);
      await save(
        t,
        LOCALIZED,
        { title: "EN", layout: "wide", status: "published" },
        "en"
      );
      // German exists as a draft translation of a published Single.
      await save(t, LOCALIZED, { title: "DE", status: "draft" }, "de");
      await t.nextly.rewriteField({
        single: LOCALIZED,
        field: "title",
        locale: "de",
        expectedVersion: await versionOf(t, LOCALIZED, "de"),
        set: { value: "DE neu" },
        reason: REASON,
      });
      const { items } = await t.nextly.versions.list({
        single: LOCALIZED,
        locale: "de",
      } as never);
      const newest = items[0] as { versionNo: number; status?: string };
      const version = await t.nextly.versions.get({
        single: LOCALIZED,
        versionNo: newest.versionNo,
      } as never);
      const snapshot = (
        typeof version.snapshot === "string"
          ? JSON.parse(version.snapshot)
          : version.snapshot
      ) as Record<string, unknown>;
      // POPULATION CONTROL: the newest German version is the rewrite's.
      expect(snapshot.title).toBe("DE neu");
      expect(newest.status).toBe("draft");
    });

    it("records the language a Single's translated field group was captured in", async () => {
      const t = await boot(dialect, true);
      await save(t, BANNERED, {
        layout: "wide",
        banner: { words: "Hello" },
        status: "published",
      });
      await t.nextly.rewriteField({
        single: BANNERED,
        field: "layout",
        expectedVersion: await versionOf(t, BANNERED),
        set: { value: "narrow" },
        reason: REASON,
      });
      const { items } = await t.nextly.versions.list({
        single: BANNERED,
      } as never);
      const newest = items[0] as { versionNo: number; locale?: string | null };
      const version = await t.nextly.versions.get({
        single: BANNERED,
        versionNo: newest.versionNo,
      } as never);
      const snapshot = (
        typeof version.snapshot === "string"
          ? JSON.parse(version.snapshot)
          : version.snapshot
      ) as Record<string, unknown>;
      // POPULATION CONTROL: the newest version is the rewrite's, and holds
      // the field group as read in the default language.
      expect(snapshot.layout).toBe("narrow");
      expect(snapshot.banner).toMatchObject({ words: "Hello" });
      expect(newest.locale).toBe("en");
    });

    it("records a shared rewrite in the default language where its translation row is blank", async () => {
      const t = await boot(dialect, true);
      // English's row is written with its one translated value blank.
      await save(
        t,
        BLANKABLE,
        { layout: "wide", tagline: null, status: "published" },
        "en"
      );
      // POPULATION CONTROL: the translation row holds no value.
      expect(
        (await read(t, BLANKABLE, { locale: "en" })).tagline ?? null
      ).toBeNull();
      await t.nextly.rewriteField({
        single: BLANKABLE,
        field: "layout",
        expectedVersion: await versionOf(t, BLANKABLE, "en"),
        set: { value: "narrow" },
        reason: REASON,
      });
      const { items } = await t.nextly.versions.list({
        single: BLANKABLE,
      } as never);
      const newest = items[0] as { versionNo: number; locale?: string | null };
      const version = await t.nextly.versions.get({
        single: BLANKABLE,
        versionNo: newest.versionNo,
      } as never);
      const snapshot = (
        typeof version.snapshot === "string"
          ? JSON.parse(version.snapshot)
          : version.snapshot
      ) as Record<string, unknown>;
      // POPULATION CONTROL: the newest version is the rewrite's.
      expect(snapshot.layout).toBe("narrow");
      expect(newest.locale).toBe("en");
    });

    it("leaves another language's read current when only a translation's live value moves", async () => {
      const t = await boot(dialect, true);
      await save(
        t,
        LOCALIZED,
        { title: "EN", layout: "wide", status: "published" },
        "en"
      );
      await save(t, LOCALIZED, { title: "DE", status: "published" }, "de");
      const englishRead = await versionOf(t, LOCALIZED, "en");
      const done = await t.nextly.rewriteField({
        single: LOCALIZED,
        field: "title",
        locale: "de",
        expectedVersion: await versionOf(t, LOCALIZED, "de"),
        set: { value: "DE neu" },
        reason: REASON,
      });
      // POPULATION CONTROL: German's live copy alone changed.
      expect(done.item.copies).toEqual([{ form: "live", locale: "de" }]);
      await t.nextly.rewriteField({
        single: LOCALIZED,
        field: "title",
        locale: "en",
        expectedVersion: englishRead,
        set: { value: "EN neu" },
        reason: REASON,
      });
      expect((await read(t, LOCALIZED, { locale: "en" })).title).toBe("EN neu");
    });

    it("lets another language leave a required translated field blank, as an update does", async () => {
      const t = await boot(dialect, true);
      await withDrafts(t);
      const rewrite = async (locale: string) =>
        t.nextly.rewriteField({
          single: LOCALIZED,
          field: "title",
          locale,
          expectedVersion: await versionOf(t, LOCALIZED, locale),
          set: { value: null },
          reason: REASON,
        });
      // The default language must keep its value.
      await expect(rewrite("en")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      await rewrite("de");
      expect(
        (await read(t, LOCALIZED, { locale: "de" })).title ?? null
      ).toBeNull();
    });

    it("refuses a language the site does not configure", async () => {
      const t = await boot(dialect, true);
      await withDrafts(t);
      await expect(
        t.nextly.rewriteField({
          single: LOCALIZED,
          field: "title",
          locale: "fr",
          expectedVersion: await versionOf(t, LOCALIZED, "en"),
          set: { value: "Bonjour" },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect((await read(t, LOCALIZED, { locale: "en" })).title).toBe("EN");
    });

    it("refuses a translated rewrite from a read of another language", async () => {
      const t = await boot(dialect, true);
      await withDrafts(t);
      const englishRead = await versionOf(t, LOCALIZED, "en");
      await expect(
        t.nextly.rewriteField({
          single: LOCALIZED,
          field: "title",
          locale: "de",
          expectedVersion: englishRead,
          set: { value: "Neu" },
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect((await read(t, LOCALIZED, { locale: "de" })).title).toBe("DE");
    });

    it("keeps a draft publishable when the live shared value moves under its own different value", async () => {
      const t = await boot(dialect, true);
      await withDrafts(t);
      // The German draft holds its own layout, which the rewrite leaves.
      await save(t, LOCALIZED, { layout: "full" }, "de");
      const done = await t.nextly.rewriteField({
        single: LOCALIZED,
        field: "layout",
        expectedVersion: await versionOf(t, LOCALIZED, "en"),
        set: { from: current => (current === "wide" ? "narrow" : current) },
        reason: REASON,
      });
      expect(done.item.copies).toContainEqual({ form: "live", locale: null });
      expect(done.item.copies).not.toContainEqual({
        form: "draft",
        locale: "de",
      });
      await save(t, LOCALIZED, { status: "published" }, "de");
      expect((await read(t, LOCALIZED, { locale: "de" })).layout).toBe("full");
    });

    it("changes a translated field in the named language only", async () => {
      const t = await boot(dialect, true);
      await withDrafts(t);
      const done = await t.nextly.rewriteField({
        single: LOCALIZED,
        field: "title",
        locale: "de",
        expectedVersion: await versionOf(t, LOCALIZED, "de"),
        set: { from: current => `${String(current)}!` },
        reason: REASON,
      });
      expect(done.item.copies).toEqual([
        { form: "live", locale: "de" },
        { form: "draft", locale: "de" },
      ]);
      expect((await read(t, LOCALIZED, { locale: "de" })).title).toBe("DE!");
      expect(
        (await read(t, LOCALIZED, { draft: true, locale: "de" })).title
      ).toBe("DE draft!");
      expect((await read(t, LOCALIZED, { locale: "en" })).title).toBe("EN");
      expect(
        (await read(t, LOCALIZED, { draft: true, locale: "en" })).title
      ).toBe("EN draft");
    });
  }
);
