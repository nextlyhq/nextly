/**
 * A plugin's conditional write and its stored read, on every configured
 * dialect.
 *
 * The write is judged inside its own transaction, under the entry's row lock,
 * so these race it against an author's save in both commit orders with a
 * seam that pauses one writer INSIDE its transaction, after its writes and
 * before its commit, and lets it commit only once the other writer has
 * entered its own transaction: by then that writer has done everything it
 * does before its transaction opens, so a check made there would have seen
 * the paused writer's change uncommitted. No sleeps decide the order.
 *
 * - The author commits first: the conditional write refuses with a conflict
 *   and changes nothing, on the live row, on the working draft, and for a
 *   publish when a draft appeared that its writer did not see.
 * - The conditional write commits first: it lands, and the author's save
 *   lands after it.
 *
 * The stored read returns what is stored whatever a collection's or a
 * field's `afterRead` hook does to an ordinary read, for the live row, the
 * working draft and a language; and both are judged by the caller's access.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { AsyncLocalStorage } from "node:async_hooks";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { grantTo } from "../../__tests__/fixtures/permission-holders";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import type { CollectionConfig } from "../../collections/config/define-collection";
import { storedValueHash } from "../../domains/collections/services/stored-field-read";
import { untilSomeoneWaitsOnALock } from "../../domains/versions/__tests__/helpers/lock-wait";
import { NextlyError } from "../../errors";
import type { PluginStoredValue } from "../contributions";
import { definePlugin } from "../plugin-context";
import type { PluginRouteIdentity } from "../routes/route-types";
import {
  readStoredFields,
  updateIfUnchanged,
  type PluginConditionalUpdate,
  type PluginStoredDocument,
  type PluginStoredFieldsRequest,
  type PluginStoredIdentity,
} from "../stored-fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

/** A plugin field type stored as JSON, as a blocks field is. */
const DOC_TYPE = {
  type: "doc",
  storage: "json",
  component: "@test/doc/admin#Doc",
} as const;

/** What the read hooks below put in place of the stored values. */
const HIDDEN = { hiddenBy: "afterRead" };

/** Which writer an async chain belongs to, for the transaction seam. */
type Writer = "author" | "plugin";
const writerOf = new AsyncLocalStorage<Writer>();

/**
 * Every seam's release, run after each test: a writer that failed before its
 * transaction never releases the paused one, which would otherwise hold its
 * lock (on SQLite, the one writer) through every test after it.
 */
const releases: (() => void)[] = [];

/**
 * Pauses `pausing`'s first transaction after its callback, holding its lock,
 * until `releasing` enters a transaction of its own. Records, for each
 * writer, whether its first transaction took a row lock: the content write's
 * transaction does, so the seam is shown to sit in the write itself.
 */
/** Whether a transaction's options make it a read-only snapshot. */
function isSnapshot(rest: readonly unknown[]): boolean {
  return (rest[0] as { readOnly?: boolean } | undefined)?.readOnly === true;
}

function raceSeam(
  t: TestNextly,
  pausing: Writer,
  releasing: Writer,
  dialect: TestDialect
) {
  const adapter = t.adapter as unknown as {
    transaction<T>(
      work: (tx: {
        lockRow(table: string, id: string): Promise<void>;
      }) => Promise<T>,
      ...rest: unknown[]
    ): Promise<T>;
  };
  const original = adapter.transaction.bind(adapter);
  const locked = new Map<Writer, boolean>();
  let letCommit = (): void => undefined;
  const mayCommit = new Promise<void>(resolve => {
    letCommit = resolve;
  });
  releases.push(() => letCommit());
  let signalPaused = (): void => undefined;
  const paused = new Promise<void>(resolve => {
    signalPaused = resolve;
  });
  const state = { paused: false, released: false };
  const release = () => {
    state.released = true;
    letCommit();
  };
  /** The writer whose first write transaction this is, now claimed; else none. */
  const firstWriteOf = (): Writer | undefined => {
    const who = writerOf.getStore();
    if (who === undefined || locked.has(who)) return undefined;
    locked.set(who, false);
    return who;
  };
  /** Records that `who`'s first write transaction took a row lock. */
  const watchLock = (
    who: Writer,
    tx: { lockRow(table: string, id: string): Promise<void> }
  ) => {
    const lockRow = tx.lockRow.bind(tx);
    tx.lockRow = async (table, id) => {
      locked.set(who, true);
      return lockRow(table, id);
    };
  };
  /** Holds the pausing writer's transaction open, after its work, until released. */
  const pauseAfter = async <T>(who: Writer, out: T): Promise<T> => {
    if (who === pausing) {
      state.paused = true;
      signalPaused();
      await mayCommit;
    }
    return out;
  };
  vi.spyOn(adapter, "transaction").mockImplementation((work, ...rest) => {
    // A read-only transaction (a stored read's snapshot) is not the write the
    // seam is about, and passes through. On SQLite it still waits behind the
    // paused writer, which holds the database's one writer, so there the
    // releasing writer's snapshot is the earliest it can go on: it releases.
    if (isSnapshot(rest)) {
      if (dialect === "sqlite" && writerOf.getStore() === releasing) release();
      return original(work, ...rest);
    }
    const who = firstWriteOf();
    if (who === undefined) return original(work, ...rest);
    // Released on entry, before queueing: SQLite runs one transaction at a
    // time, so the released writer must commit for this one to start.
    if (who === releasing) release();
    return original(
      async tx => {
        watchLock(who, tx);
        return pauseAfter(who, await work(tx));
      },
      ...rest
    );
  });
  return { paused, locked, state, letCommit };
}

/**
 * Pauses the plugin's first write transaction twice: before it begins, after
 * the write has looked for the Single and found none, so another writer can
 * create it; and inside it, right after its first read of the Single's own
 * table (the read that adopts a row another writer created), so a competing
 * write can run before the write reaches its row lock. Records when, after
 * that read, the author's chain asks for a transaction of its own.
 */
function adoptSeam(t: TestNextly) {
  const adapter = t.adapter as unknown as {
    transaction<T>(
      work: (tx: {
        select(table: string, options: unknown): Promise<unknown[]>;
      }) => Promise<T>,
      ...rest: unknown[]
    ): Promise<T>;
  };
  const original = adapter.transaction.bind(adapter);
  const gate = () => {
    let open = (): void => undefined;
    const opened = new Promise<void>(resolve => {
      open = resolve;
    });
    releases.push(() => open());
    return { opened, open };
  };
  const reached = { start: gate(), read: gate(), authorAsked: gate() };
  const proceed = { begin: gate(), lock: gate() };
  const seen = { claimed: false, adopted: false, read: false };
  vi.spyOn(adapter, "transaction").mockImplementation((work, ...rest) => {
    // Any transaction the author's chain asks for once the plugin's write
    // holds what it read, a conditional write's stored-read snapshot among
    // them: on SQLite each waits behind the held write.
    if (writerOf.getStore() === "author" && seen.read) {
      reached.authorAsked.open();
    }
    if (isSnapshot(rest)) return original(work, ...rest);
    if (writerOf.getStore() !== "plugin" || seen.claimed) {
      return original(work, ...rest);
    }
    seen.claimed = true;
    reached.start.open();
    return proceed.begin.opened.then(() =>
      original(
        async tx => {
          const select = tx.select.bind(tx);
          tx.select = async (table, options) => {
            const rows = await select(table, options);
            if (!seen.read && table.startsWith("single_")) {
              seen.read = true;
              seen.adopted = rows.length > 0;
              reached.read.open();
              await proceed.lock.opened;
            }
            return rows;
          };
          return work(tx);
        },
        ...rest
      )
    );
  });
  return {
    atStart: reached.start.opened,
    afterRead: reached.read.opened,
    authorAsked: reached.authorAsked.opened,
    begin: proceed.begin.open,
    lock: proceed.lock.open,
    seen,
  };
}

/**
 * What a competing write did once started while the seam holds the plugin's
 * write: it `settled`, nothing having held it back, or it is `waiting` on a
 * lock the held write took. On SQLite, where the held write holds the
 * database, asking for a transaction of its own is waiting. Fails the test when it does
 * neither in time, rather than taking either for granted.
 */
async function competingProgress(
  t: TestNextly,
  dialect: TestDialect,
  seam: ReturnType<typeof adoptSeam>,
  competing: Promise<unknown>
): Promise<"settled" | "waiting"> {
  const waiting = (
    dialect === "sqlite"
      ? seam.authorAsked
      : untilSomeoneWaitsOnALock(t.adapter, dialect)
  ).then(() => "waiting" as const);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("the competing write never progressed")),
      10_000
    );
  });
  // Whichever loses the race settles later, unobserved.
  waiting.catch(() => undefined);
  timeout.catch(() => undefined);
  try {
    return await Promise.race([
      competing.then(() => "settled" as const),
      waiting,
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The error a promise rejected with. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe.each(getConfiguredTestDialects())(
  "a plugin's conditional write and stored read (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let editor: PluginRouteIdentity;
    let reader: PluginRouteIdentity;
    let stranger: PluginRouteIdentity;
    let owner: PluginRouteIdentity;

    beforeAll(async () => {
      const plugin = definePlugin({
        name: "@test/stored-fields",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { fieldTypes: [DOC_TYPE] },
        init(ctx) {
          // A site's collection-level read hook that removes a field from
          // every ordinary read.
          for (const slug of ["hooked", "worded"]) {
            ctx.hooks.on("afterRead", slug, hook => {
              const strip = (row: unknown) =>
                typeof row === "object" && row !== null
                  ? { ...row, extra: HIDDEN }
                  : row;
              return Array.isArray(hook.data)
                ? hook.data.map(strip)
                : strip(hook.data);
            });
          }
        },
      });
      // A field-level read hook that replaces the field's value.
      const hiddenBody = {
        name: "body",
        type: "doc",
        hooks: { afterRead: [() => HIDDEN] },
      };
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [plugin],
        collections: [
          {
            slug: "pages",
            fields: [
              { name: "title", type: "text" },
              { name: "body", type: "doc" },
            ],
          } as unknown as CollectionConfig,
          {
            slug: "drafted",
            status: true,
            versions: { drafts: true },
            fields: [
              { name: "title", type: "text" },
              { name: "body", type: "doc" },
            ],
          } as unknown as CollectionConfig,
          {
            slug: "hooked",
            status: true,
            versions: { drafts: true },
            fields: [
              hiddenBody,
              { name: "extra", type: "doc" },
              { name: "secret", type: "doc", access: { read: () => true } },
              { name: "title", type: "text" },
            ],
          } as unknown as CollectionConfig,
          {
            slug: "worded",
            localized: true,
            fields: [
              { ...hiddenBody, localized: true },
              { name: "note", type: "doc", localized: true },
              { name: "extra", type: "doc" },
            ],
          } as unknown as CollectionConfig,
          {
            // A read rule closing German alone, as a site with a language
            // its translators have not released might write one.
            slug: "germanless",
            localized: true,
            access: {
              read: ({ locales }: { locales: readonly string[] }) =>
                !locales.includes("de"),
            },
            fields: [{ name: "body", type: "doc", localized: true }],
          } as unknown as CollectionConfig,
          {
            // A lifecycle with no working drafts: an entry is draft until it
            // is published, and its live row is that draft.
            slug: "staged",
            status: true,
            fields: [{ name: "body", type: "doc" }],
          } as unknown as CollectionConfig,
          {
            // A lifecycle kept per language: a translation has its own state.
            slug: "stagedwords",
            localized: true,
            status: true,
            fields: [{ name: "body", type: "doc", localized: true }],
          } as unknown as CollectionConfig,
          {
            // A field laid out in a group with no name, inside a named group:
            // stored in the named group's value, at the level the nameless
            // group sits in.
            slug: "laidout",
            fields: [
              {
                name: "outer",
                type: "group",
                fields: [
                  { type: "group", fields: [{ name: "body", type: "doc" }] },
                ],
              },
            ],
          } as unknown as CollectionConfig,
          {
            // A field every reader is refused by its own read rule, and a
            // built-in field stored as JSON.
            slug: "guarded",
            fields: [
              { name: "body", type: "doc", access: { read: () => false } },
              {
                name: "rows",
                type: "repeater",
                fields: [{ name: "body", type: "doc" }],
              },
            ],
          } as unknown as CollectionConfig,
          {
            slug: "grouped",
            fields: [
              {
                name: "hero",
                type: "group",
                fields: [
                  { name: "body", type: "doc" },
                  { name: "aside", type: "doc" },
                ],
              },
            ],
          } as unknown as CollectionConfig,
        ],
        singles: [
          {
            slug: "site",
            fields: [{ name: "body", type: "doc" }],
          } as never,
          // Never stored before the test that writes each: a first write
          // inserts the row, with the field's default, in its own transaction.
          ...["firstwrite", "firstrace"].map(
            slug =>
              ({
                slug,
                fields: [
                  { name: "body", type: "doc", defaultValue: { v: "default" } },
                ],
              }) as never
          ),
          // Created by another writer while a conditional write is under way,
          // with the field it expects left unset.
          ...["adoptrace", "adoptcontrol", "firstpair"].map(
            slug =>
              ({
                slug,
                fields: [
                  { name: "body", type: "doc" },
                  { name: "note", type: "doc" },
                ],
              }) as never
          ),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const users = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
      };
      const person = async (name: string) =>
        (
          await users.users.create({
            email: `${name}@example.com`,
            password: "Password123!",
            data: { name, isActive: true },
          })
        ).item.id;
      // The install's first account holds super-admin; the others are judged
      // by what they are granted.
      owner = { user: { id: await person("owner") } };
      const content = [
        "pages",
        "drafted",
        "hooked",
        "worded",
        "germanless",
        "grouped",
        "guarded",
        "staged",
        "stagedwords",
      ];
      const editorId = await person("editor");
      for (const action of ["read", "update", "publish"]) {
        await grantTo(t, editorId, action, content);
      }
      const readerId = await person("reader");
      await grantTo(t, readerId, "read", content);
      const strangerId = await person("stranger");
      editor = { user: { id: editorId } };
      reader = { user: { id: readerId } };
      stranger = { user: { id: strangerId } };
    }, 120_000);

    afterEach(() => {
      for (const release of releases.splice(0)) release();
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    async function created(
      collection: string,
      data: Record<string, unknown>
    ): Promise<string> {
      const result = await t.nextly.create({
        collection,
        data,
        overrideAccess: true,
      } as never);
      return String((result.item as { id: unknown }).id);
    }

    /** The author's save, made as the editor in the author's chain. */
    function authorSaves(
      collection: string,
      id: string,
      data: Record<string, unknown>
    ): Promise<unknown> {
      return writerOf.run("author", () =>
        t.nextly.update({
          collection,
          id,
          data: { ...data, _overwrite: true },
          user: editor.user,
          overrideAccess: false,
        } as never)
      );
    }

    /** One field as the stored read returns it, read as the editor. */
    async function stored(
      document: PluginStoredDocument,
      field: string,
      form: "published" | "draft",
      locale?: string
    ): Promise<PluginStoredValue> {
      const read = await readStoredFields(editor, {
        ...document,
        fields: [field],
        form,
        ...(locale === undefined ? {} : { locale }),
      });
      if (read.kind !== "found") throw new Error("expected a stored entry");
      const value = read.values[field];
      if (value === undefined) throw new Error(`no value for ${field}`);
      return value;
    }

    /** The hash of a field as the stored read returns it. */
    async function hashOf(
      document: PluginStoredDocument,
      field: string,
      form: "published" | "draft"
    ): Promise<string> {
      return storedValueHash(await stored(document, field, form));
    }

    describe("the live row", () => {
      it("refuses the conditional write and changes nothing when the author's save commits first", async () => {
        const id = await created("pages", { title: "t", body: { v: 0 } });
        const page = { collection: "pages", id };
        const hash = await hashOf(page, "body", "published");

        const seam = raceSeam(t, "author", "plugin", dialect);
        const author = authorSaves("pages", id, { body: { v: "author" } });
        await Promise.race([seam.paused, author.catch(() => undefined)]);
        const refusal = await rejectionOf(
          writerOf.run("plugin", () =>
            updateIfUnchanged(editor, {
              ...page,
              data: { body: { v: "plugin" } },
              expect: { field: "body", form: "published", hash },
            })
          )
        );
        seam.letCommit();
        await author;

        expect(seam.state).toEqual({ paused: true, released: true });
        expect(seam.locked.get("author")).toBe(true);
        expect(seam.locked.get("plugin")).toBe(true);
        expect(NextlyError.isCode(refusal, "CONFLICT")).toBe(true);
        expect(await stored(page, "body", "published")).toEqual({
          kind: "value",
          value: { v: "author" },
        });
      });

      it("lands the conditional write when it commits first, and the author's save after it", async () => {
        const id = await created("pages", { title: "t", body: { v: 0 } });
        const page = { collection: "pages", id };
        const hash = await hashOf(page, "body", "published");

        const seam = raceSeam(t, "plugin", "author", dialect);
        const plugin = writerOf.run("plugin", () =>
          updateIfUnchanged(editor, {
            ...page,
            data: { body: { v: "plugin" } },
            expect: { field: "body", form: "published", hash },
          })
        );
        await Promise.race([seam.paused, plugin.catch(() => undefined)]);
        await authorSaves("pages", id, { title: "author" }).finally(
          seam.letCommit
        );
        await plugin;

        expect(seam.state).toEqual({ paused: true, released: true });
        expect(seam.locked.get("plugin")).toBe(true);
        expect(seam.locked.get("author")).toBe(true);
        expect(await stored(page, "body", "published")).toEqual({
          kind: "value",
          value: { v: "plugin" },
        });
        const row = (await t.nextly.findByID({
          collection: "pages",
          id,
          overrideAccess: true,
        } as never)) as { title?: unknown };
        expect(row.title).toBe("author");
      });
    });

    describe("the working draft", () => {
      /** A published entry holding a pending working draft of `body`. */
      async function publishedWithDraft(): Promise<string> {
        const id = await created("drafted", {
          title: "t",
          body: { v: "live" },
          status: "published",
        });
        await t.nextly.update({
          collection: "drafted",
          id,
          data: { body: { v: "draft" }, _overwrite: true },
          overrideAccess: true,
        } as never);
        return id;
      }

      it("refuses a conditional save of the draft when the author's draft save commits first", async () => {
        const id = await publishedWithDraft();
        const entry = { collection: "drafted", id };
        expect(await stored(entry, "body", "draft")).toEqual({
          kind: "value",
          value: { v: "draft" },
        });
        const hash = await hashOf(entry, "body", "draft");

        const seam = raceSeam(t, "author", "plugin", dialect);
        const author = authorSaves("drafted", id, { body: { v: "author" } });
        await Promise.race([seam.paused, author.catch(() => undefined)]);
        const refusal = await rejectionOf(
          writerOf.run("plugin", () =>
            updateIfUnchanged(editor, {
              ...entry,
              data: { body: { v: "plugin" } },
              expect: { field: "body", form: "draft", hash },
            })
          )
        );
        seam.letCommit();
        await author;

        expect(seam.state).toEqual({ paused: true, released: true });
        expect(NextlyError.isCode(refusal, "CONFLICT")).toBe(true);
        expect(await stored(entry, "body", "draft")).toEqual({
          kind: "value",
          value: { v: "author" },
        });
        expect(await stored(entry, "body", "published")).toEqual({
          kind: "value",
          value: { v: "live" },
        });
      });

      it("lands a conditional save of the draft that commits first, and the author's draft save after it", async () => {
        const id = await publishedWithDraft();
        const entry = { collection: "drafted", id };
        const hash = await hashOf(entry, "body", "draft");

        const seam = raceSeam(t, "plugin", "author", dialect);
        const plugin = writerOf.run("plugin", () =>
          updateIfUnchanged(editor, {
            ...entry,
            data: { body: { v: "plugin" } },
            expect: { field: "body", form: "draft", hash },
          })
        );
        await Promise.race([seam.paused, plugin.catch(() => undefined)]);
        await authorSaves("drafted", id, { title: "author" }).finally(
          seam.letCommit
        );
        await plugin;

        expect(seam.state).toEqual({ paused: true, released: true });
        expect(await stored(entry, "body", "draft")).toEqual({
          kind: "value",
          value: { v: "plugin" },
        });
        const pending = (await t.nextly.findByID({
          collection: "drafted",
          id,
          draft: true,
          overrideAccess: true,
        } as never)) as { title?: unknown };
        expect(pending.title).toBe("author");
        expect(await stored(entry, "body", "published")).toEqual({
          kind: "value",
          value: { v: "live" },
        });
      });

      it("refuses a conditional publish when the author's draft appeared first, whatever the field holds", async () => {
        const id = await created("drafted", {
          title: "t",
          body: { v: "live" },
          status: "published",
        });
        const entry = { collection: "drafted", id };
        const hash = await hashOf(entry, "body", "published");

        // The author's draft leaves `body` alone, so the live hash still holds.
        const seam = raceSeam(t, "author", "plugin", dialect);
        const author = authorSaves("drafted", id, { title: "draft title" });
        await Promise.race([seam.paused, author.catch(() => undefined)]);
        const refusal = await rejectionOf(
          writerOf.run("plugin", () =>
            updateIfUnchanged(editor, {
              ...entry,
              data: { body: { v: "plugin" }, status: "published" },
              expect: {
                field: "body",
                form: "published",
                hash,
                noPendingDraft: true,
              },
            })
          )
        );
        seam.letCommit();
        await author;

        expect(seam.state).toEqual({ paused: true, released: true });
        expect(NextlyError.isCode(refusal, "CONFLICT")).toBe(true);
        expect(await hashOf(entry, "body", "published")).toBe(hash);
        const live = (await t.nextly.findByID({
          collection: "drafted",
          id,
          overrideAccess: true,
        } as never)) as { title?: unknown };
        expect(live.title).toBe("t");
      });

      it("publishes when no draft is pending and the live value is the one read", async () => {
        const id = await created("drafted", {
          title: "t",
          body: { v: "live" },
          status: "published",
        });
        const entry = { collection: "drafted", id };
        const hash = await hashOf(entry, "body", "published");
        await updateIfUnchanged(editor, {
          ...entry,
          data: { body: { v: "plugin" }, status: "published" },
          expect: {
            field: "body",
            form: "published",
            hash,
            noPendingDraft: true,
          },
        });
        expect(await stored(entry, "body", "published")).toEqual({
          kind: "value",
          value: { v: "plugin" },
        });
      });
    });

    describe("a Single", () => {
      it("refuses a conditional write to a Single whose value changed since it was read, and lands one that did not", async () => {
        await t.nextly.updateSingle({
          slug: "site",
          data: { body: { v: 0 }, _overwrite: true },
          overrideAccess: true,
        } as never);
        const site = { single: "site" };
        const read = await readStoredFields(owner, {
          ...site,
          fields: ["body"],
          form: "published",
        });
        if (read.kind !== "found") throw new Error("expected the Single");
        const hash = await storedValueHash(
          read.values.body ?? { kind: "absent" }
        );

        await t.nextly.updateSingle({
          slug: "site",
          data: { body: { v: "author" }, _overwrite: true },
          overrideAccess: true,
        } as never);
        const refusal = await rejectionOf(
          updateIfUnchanged(owner, {
            ...site,
            data: { body: { v: "plugin" } },
            expect: { field: "body", form: "published", hash },
          })
        );
        expect(NextlyError.isCode(refusal, "CONFLICT")).toBe(true);

        const now = await readStoredFields(owner, {
          ...site,
          fields: ["body"],
          form: "published",
        });
        if (now.kind !== "found") throw new Error("expected the Single");
        expect(now.values.body).toEqual({
          kind: "value",
          value: { v: "author" },
        });
        await updateIfUnchanged(owner, {
          ...site,
          data: { body: { v: "plugin" } },
          expect: {
            field: "body",
            form: "published",
            hash: await storedValueHash(now.values.body ?? { kind: "absent" }),
          },
        });
        const after = await readStoredFields(owner, {
          ...site,
          fields: ["body"],
          form: "published",
        });
        expect(after).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "plugin" } } },
        });
      });
    });

    describe("a Single never stored", () => {
      /** The Single's body as the stored read returns it, read as the owner. */
      const bodyOf = (single: string) =>
        readStoredFields(owner, {
          single,
          fields: ["body"],
          form: "published",
        });

      it("lands a first conditional write expecting absent, though the write inserts the field's default first", async () => {
        expect(await bodyOf("firstwrite")).toEqual({ kind: "absent" });

        await updateIfUnchanged(owner, {
          single: "firstwrite",
          data: { body: { v: "plugin" } },
          expect: {
            field: "body",
            form: "published",
            hash: await storedValueHash({ kind: "absent" }),
          },
        });
        expect(await bodyOf("firstwrite")).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "plugin" } } },
        });
      });

      it("refuses one expecting absent once another first write has committed since the read", async () => {
        expect(await bodyOf("firstrace")).toEqual({ kind: "absent" });
        await t.nextly.updateSingle({
          slug: "firstrace",
          data: { body: { v: "author" }, _overwrite: true },
          overrideAccess: true,
        } as never);

        const refusal = await rejectionOf(
          updateIfUnchanged(owner, {
            single: "firstrace",
            data: { body: { v: "plugin" } },
            expect: {
              field: "body",
              form: "published",
              hash: await storedValueHash({ kind: "absent" }),
            },
          })
        );
        expect(NextlyError.isCode(refusal, "CONFLICT")).toBe(true);
        expect(await bodyOf("firstrace")).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "author" } } },
        });
      });
    });

    describe("a Single another writer creates during the write", () => {
      /** The Single's body as the stored read returns it, read as the owner. */
      const bodyOf = (single: string) =>
        readStoredFields(owner, {
          single,
          fields: ["body"],
          form: "published",
        });

      /** As another writer: a save of the Single, judged by no expectation. */
      const authorSavesSingle = (slug: string, data: Record<string, unknown>) =>
        writerOf.run("author", () =>
          t.nextly.updateSingle({
            slug,
            data: { ...data, _overwrite: true },
            overrideAccess: true,
          } as never)
        );

      /**
       * The plugin's conditional write expecting the body absent, as its read
       * found it, paused so that another writer creates the Single first and
       * the write adopts that row. Settles to "landed" or to its error.
       */
      async function adoptingWrite(slug: string) {
        expect(await bodyOf(slug)).toEqual({ kind: "absent" });
        const hash = await storedValueHash({ kind: "absent" });
        const seam = adoptSeam(t);
        const write = writerOf
          .run("plugin", () =>
            updateIfUnchanged(owner, {
              single: slug,
              data: { body: { v: "plugin" } },
              expect: { field: "body", form: "published", hash },
            })
          )
          .then(
            () => "landed" as const,
            (error: unknown) => error
          );
        await seam.atStart;
        await authorSavesSingle(slug, { note: { v: "created" } });
        seam.begin();
        await seam.afterRead;
        expect(seam.seen.adopted).toBe(true);
        return { seam, write };
      }

      it("loses no change another writer makes to the Single the write adopted before its row lock", async () => {
        const { seam, write } = await adoptingWrite("adoptrace");
        // The other writer changes the field the write expects, while the
        // write holds the row its first read locked.
        const edit = authorSavesSingle("adoptrace", {
          body: { v: "author" },
        }).then(
          () => "saved" as const,
          (error: unknown) => error
        );
        const progress = await competingProgress(t, dialect, seam, edit);
        seam.lock();
        const outcome = await write;

        // The edit waited on the lock the write took with its first read, so
        // the write landed first and the edit after it, the value kept.
        expect(progress).toBe("waiting");
        expect(outcome).toBe("landed");
        expect(await edit).toBe("saved");
        expect(await bodyOf("adoptrace")).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "author" } } },
        });
      });

      it("lands one of two first conditional writes to a never-stored Single, and refuses the other with a conflict", async () => {
        expect(await bodyOf("firstpair")).toEqual({ kind: "absent" });
        const hash = await storedValueHash({ kind: "absent" });
        const conditional = (writer: Writer, v: string) =>
          writerOf
            .run(writer, () =>
              updateIfUnchanged(owner, {
                single: "firstpair",
                data: { body: { v } },
                expect: { field: "body", form: "published", hash },
              })
            )
            .then(
              () => "landed" as const,
              (error: unknown) => error
            );
        const seam = adoptSeam(t);
        seam.begin();
        const first = conditional("plugin", "first");
        await seam.afterRead;
        expect(seam.seen.adopted).toBe(false);
        // A second first write, also expecting the Single absent, while the
        // first holds what its first read locked.
        const second = conditional("author", "second");
        const progress = await competingProgress(t, dialect, seam, second);
        seam.lock();

        expect(progress).toBe("waiting");
        expect(await first).toBe("landed");
        expect(NextlyError.isCode(await second, "CONFLICT")).toBe(true);
        expect(await bodyOf("firstpair")).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "first" } } },
        });
        // One row: the second neither inserted a row of its own nor lost one.
        const rows = await t.adapter.executeQuery<{ n: number | string }>(
          "SELECT COUNT(*) AS n FROM single_firstpair"
        );
        expect(Number(rows[0]?.n)).toBe(1);
      });

      it("lands a write that adopts a Single another writer created with the field it expects still unset", async () => {
        const { seam, write } = await adoptingWrite("adoptcontrol");
        seam.lock();
        expect(await write).toBe("landed");
        expect(await bodyOf("adoptcontrol")).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "plugin" } } },
        });
      });
    });

    describe("the stored read", () => {
      it("returns the live row and the working draft as stored, whatever the read hooks do", async () => {
        const id = await created("hooked", {
          title: "t",
          body: { v: "live" },
          extra: { e: "live" },
          status: "published",
        });
        await t.nextly.update({
          collection: "hooked",
          id,
          data: {
            body: { v: "draft" },
            extra: { e: "draft" },
            _overwrite: true,
          },
          overrideAccess: true,
        } as never);
        const entry = { collection: "hooked", id };

        // The control: an ordinary read is reshaped by both hooks.
        const ordinary = (await t.nextly.findByID({
          collection: "hooked",
          id,
          overrideAccess: true,
        } as never)) as Record<string, unknown>;
        expect(ordinary.body).toEqual(HIDDEN);
        expect(ordinary.extra).toEqual(HIDDEN);

        expect(
          await readStoredFields(editor, {
            ...entry,
            fields: ["body", "extra"],
            form: "published",
          })
        ).toEqual({
          kind: "found",
          values: {
            body: { kind: "value", value: { v: "live" } },
            extra: { kind: "value", value: { e: "live" } },
          },
        });
        expect(
          await readStoredFields(editor, {
            ...entry,
            fields: ["body", "extra"],
            form: "draft",
          })
        ).toEqual({
          kind: "found",
          values: {
            body: { kind: "value", value: { v: "draft" } },
            extra: { kind: "value", value: { e: "draft" } },
          },
        });
      });

      it("returns each language as stored, whatever the read hooks do", async () => {
        const id = await created("worded", {
          body: { v: "en" },
          extra: { e: "shared" },
        });
        await t.nextly.update({
          collection: "worded",
          id,
          locale: "de",
          data: { body: { v: "de" }, _overwrite: true },
          overrideAccess: true,
        } as never);
        const entry = { collection: "worded", id };

        const ordinary = (await t.nextly.findByID({
          collection: "worded",
          id,
          locale: "de",
          overrideAccess: true,
        } as never)) as Record<string, unknown>;
        expect(ordinary.body).toEqual(HIDDEN);

        for (const [locale, body] of [
          ["en", { v: "en" }],
          ["de", { v: "de" }],
        ] as const) {
          expect(
            await readStoredFields(editor, {
              ...entry,
              fields: ["body", "extra"],
              form: "published",
              locale,
            })
          ).toEqual({
            kind: "found",
            values: {
              body: { kind: "value", value: body },
              extra: { kind: "value", value: { e: "shared" } },
            },
          });
        }
      });

      it("returns only the fields asked for, and refuses one a read rule governs or of a built-in type", async () => {
        const id = await created("hooked", {
          title: "t",
          body: { v: "live" },
          extra: { e: "live" },
          secret: { s: 1 },
        });
        const entry = { collection: "hooked", id };
        expect(
          await readStoredFields(editor, {
            ...entry,
            fields: ["extra"],
            form: "published",
          })
        ).toEqual({
          kind: "found",
          values: { extra: { kind: "value", value: { e: "live" } } },
        });
        for (const field of ["secret", "title"]) {
          const refusal = await rejectionOf(
            readStoredFields(editor, {
              ...entry,
              fields: [field],
              form: "published",
            })
          );
          expect(NextlyError.isCode(refusal, "INVALID_INPUT")).toBe(true);
        }
      });
    });

    describe("languages and groups", () => {
      it("reads a field laid out in a group with no name inside a named group, from that group's stored value", async () => {
        const id = await created("laidout", {
          outer: { body: { v: "laid" } },
        });
        const read = await readStoredFields(owner, {
          collection: "laidout",
          id,
          fields: ["outer.body"],
          form: "published",
        });
        expect(read).toEqual({
          kind: "found",
          values: { "outer.body": { kind: "value", value: { v: "laid" } } },
        });
      });

      it("judges the stored read in the language it reads, refusing one a read rule closes", async () => {
        const id = await created("germanless", { body: { v: "en" } });
        await t.nextly.update({
          collection: "germanless",
          id,
          locale: "de",
          data: { body: { v: "de" }, _overwrite: true },
          overrideAccess: true,
        } as never);
        const entry = { collection: "germanless", id };
        const asked = {
          ...entry,
          fields: ["body"],
          form: "published",
        } as const;

        // The control: the same person reads the language the rule leaves open.
        expect(
          await readStoredFields(editor, { ...asked, locale: "en" })
        ).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "en" } } },
        });
        expect(
          NextlyError.isForbidden(
            await rejectionOf(
              readStoredFields(editor, { ...asked, locale: "de" })
            )
          )
        ).toBe(true);
        // A conditional write in the closed language reads it first, so it is
        // refused too, and the German value stays as it was.
        const refusal = await rejectionOf(
          updateIfUnchanged(editor, {
            ...entry,
            locale: "de",
            data: { body: { v: "plugin" } },
            expect: {
              field: "body",
              form: "published",
              hash: await storedValueHash({
                kind: "value",
                value: { v: "de" },
              }),
            },
          })
        );
        expect(NextlyError.isForbidden(refusal)).toBe(true);
        const german = (await t.nextly.findByID({
          collection: "germanless",
          id,
          locale: "de",
          fallbackLocale: false,
          overrideAccess: true,
        } as never)) as { body?: unknown };
        expect(german.body).toEqual({ v: "de" });
      });

      it("refuses an expectation on a field inside a group, and writes nothing", async () => {
        const id = await created("grouped", {
          hero: { body: { v: 0 }, aside: { a: "author" } },
        });
        const entry = { collection: "grouped", id };
        // The stored read reaches the field; only the write refuses it.
        const read = await readStoredFields(editor, {
          ...entry,
          fields: ["hero.body"],
          form: "published",
        });
        if (read.kind !== "found") throw new Error("expected the entry");
        const hash = await storedValueHash(
          read.values["hero.body"] ?? { kind: "absent" }
        );

        const refusal = await rejectionOf(
          updateIfUnchanged(editor, {
            ...entry,
            data: { hero: { body: { v: "plugin" } } },
            expect: { field: "hero.body", form: "published", hash },
          })
        );
        expect(NextlyError.isCode(refusal, "INVALID_INPUT")).toBe(true);
        expect(
          await readStoredFields(editor, {
            ...entry,
            fields: ["hero.body", "hero.aside"],
            form: "published",
          })
        ).toEqual({
          kind: "found",
          values: {
            "hero.body": { kind: "value", value: { v: 0 } },
            "hero.aside": { kind: "value", value: { a: "author" } },
          },
        });
      });

      it("reads every field kept per language from one query of its language row", async () => {
        const id = await created("worded", {
          body: { v: "en" },
          note: { n: "en" },
          extra: { e: "shared" },
        });
        await t.nextly.update({
          collection: "worded",
          id,
          locale: "de",
          data: { body: { v: "de" }, note: { n: "de" }, _overwrite: true },
          overrideAccess: true,
        } as never);
        const entry = { collection: "worded", id };
        // Every select on a Drizzle executor the read is handed: the pool's,
        // and the one its snapshot transaction hands it.
        let selects = 0;
        const counted = (db: object) =>
          new Proxy(db, {
            get(target, property, receiver) {
              const value: unknown = Reflect.get(target, property, receiver);
              if (property !== "select" || typeof value !== "function") {
                return value;
              }
              return (...args: unknown[]) => {
                selects += 1;
                return (value as (...a: unknown[]) => unknown).apply(
                  target,
                  args
                );
              };
            },
          });
        const adapter = t.adapter as unknown as {
          getDrizzle(...a: unknown[]): object;
          transaction<T>(
            work: (tx: { getDrizzle(...a: unknown[]): object }) => Promise<T>,
            ...rest: unknown[]
          ): Promise<T>;
        };
        const getDrizzle = adapter.getDrizzle.bind(adapter);
        vi.spyOn(adapter, "getDrizzle").mockImplementation((...a) =>
          counted(getDrizzle(...a))
        );
        const transaction = adapter.transaction.bind(adapter);
        vi.spyOn(adapter, "transaction").mockImplementation((work, ...rest) =>
          transaction(
            tx => {
              const txDrizzle = tx.getDrizzle.bind(tx);
              tx.getDrizzle = (...a) => counted(txDrizzle(...a));
              return work(tx);
            },
            ...rest
          )
        );
        const countFor = async (fields: string[]) => {
          selects = 0;
          const read = await readStoredFields(editor, {
            ...entry,
            fields,
            form: "published",
            locale: "de",
          });
          return { read, count: selects };
        };
        // Once to settle what a first read resolves and remembers.
        await countFor(["body", "note", "extra"]);

        const shared = await countFor(["extra"]);
        const one = await countFor(["body", "extra"]);
        const two = await countFor(["body", "note", "extra"]);
        // A field kept per language costs one query of the language row, and a
        // second such field costs nothing more.
        expect(one.count).toBe(shared.count + 1);
        expect(two.count).toBe(one.count);
        expect(two.read).toEqual({
          kind: "found",
          values: {
            body: { kind: "value", value: { v: "de" } },
            note: { kind: "value", value: { n: "de" } },
            extra: { kind: "value", value: { e: "shared" } },
          },
        });
      });
    });

    describe("lifecycle", () => {
      it("answers a live row an ordinary read would not show its reader as absent", async () => {
        const draftOnly = await created("staged", {
          body: { v: "unreleased" },
          status: "draft",
        });
        const published = await created("staged", {
          body: { v: "released" },
          status: "published",
        });
        const ask = (id: string) =>
          ({
            collection: "staged",
            id,
            fields: ["body"],
            form: "published",
          }) as const;

        // A reader who may not update sees the published entry and not the
        // draft, as their ordinary read would; an editor sees both.
        expect(await readStoredFields(reader, ask(published))).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "released" } } },
        });
        expect(await readStoredFields(reader, ask(draftOnly))).toEqual({
          kind: "absent",
        });
        expect(await readStoredFields(editor, ask(draftOnly))).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "unreleased" } } },
        });
      });

      it("judges a translation by its own state, not the live row's", async () => {
        const id = await created("stagedwords", {
          body: { v: "en" },
          status: "published",
        });
        await t.nextly.update({
          collection: "stagedwords",
          id,
          locale: "de",
          data: { body: { v: "de" }, status: "draft", _overwrite: true },
          overrideAccess: true,
        } as never);
        const ask = (locale: string) =>
          ({
            collection: "stagedwords",
            id,
            fields: ["body"],
            form: "published",
            locale,
          }) as const;

        expect(await readStoredFields(reader, ask("en"))).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "en" } } },
        });
        expect(await readStoredFields(reader, ask("de"))).toEqual({
          kind: "absent",
        });
        expect(await readStoredFields(editor, ask("de"))).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "de" } } },
        });
      });
    });

    describe("one snapshot, one language", () => {
      it("never shows a reader a value committed as a draft between its row's state and its language row", async () => {
        const id = await created("stagedwords", {
          body: { v: "published" },
          status: "published",
        });
        const adapter = t.adapter as unknown as {
          select(table: string, ...rest: unknown[]): Promise<unknown>;
          transaction<T>(
            work: (tx: {
              select(table: string, ...rest: unknown[]): Promise<unknown>;
            }) => Promise<T>,
            ...rest: unknown[]
          ): Promise<T>;
        };
        // The author's save of a new value as a draft, made once the reader
        // has read the main row's state and before it reads the language row.
        // On SQLite the reader's transaction holds the one writer, so the
        // save can only begin there, and commits after the read.
        let interleaved = false;
        let save: Promise<unknown> = Promise.resolve();
        // Captured here, before the read begins, so the save runs as its own
        // flow rather than inside the reader's transaction.
        const outside = AsyncLocalStorage.snapshot();
        let letEnter = (): void => undefined;
        const saveEntered = new Promise<void>(resolve => {
          letEnter = resolve;
        });
        const interleave = async () => {
          if (interleaved) return;
          interleaved = true;
          save = outside(() =>
            writerOf.run("author", () =>
              t.nextly.update({
                collection: "stagedwords",
                id,
                data: {
                  body: { v: "draft" },
                  status: "draft",
                  _overwrite: true,
                },
                overrideAccess: true,
              } as never)
            )
          );
          await (dialect === "sqlite"
            ? Promise.race([saveEntered, save])
            : save);
        };
        const mainRow = (table: string) =>
          table.endsWith("stagedwords") && !table.includes("locales");
        const select = adapter.select.bind(adapter);
        vi.spyOn(adapter, "select").mockImplementation(
          async (table, ...rest) => {
            const out = await select(table, ...rest);
            if (writerOf.getStore() === "plugin" && mainRow(table)) {
              await interleave();
            }
            return out;
          }
        );
        const transaction = adapter.transaction.bind(adapter);
        vi.spyOn(adapter, "transaction").mockImplementation((work, ...rest) => {
          const who = writerOf.getStore();
          if (who === "author") letEnter();
          return transaction(
            async tx => {
              if (who === "plugin") {
                const txSelect = tx.select.bind(tx);
                tx.select = async (table, ...more) => {
                  const out = await txSelect(table, ...more);
                  if (mainRow(table)) await interleave();
                  return out;
                };
              }
              return work(tx);
            },
            ...rest
          );
        });

        const read = await writerOf.run("plugin", () =>
          readStoredFields(reader, {
            collection: "stagedwords",
            id,
            fields: ["body"],
            form: "published",
          })
        );
        letEnter();
        await save;
        vi.restoreAllMocks();

        expect(interleaved).toBe(true);
        expect(read).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "published" } } },
        });
        // The control: the save did land, and its draft is hidden from them.
        expect(
          await readStoredFields(reader, {
            collection: "stagedwords",
            id,
            fields: ["body"],
            form: "published",
          })
        ).toEqual({ kind: "absent" });
      });

      it("reads the language an unknown code resolves to, and refuses a selector", async () => {
        const id = await created("worded", { body: { v: "en" } });
        await t.nextly.update({
          collection: "worded",
          id,
          locale: "de",
          data: { body: { v: "de" }, _overwrite: true },
          overrideAccess: true,
        } as never);
        const entry = { collection: "worded", id };
        const asked = {
          ...entry,
          fields: ["body"],
          form: "published",
        } as const;

        // A language the site does not configure resolves to its default, as
        // an ordinary read resolves it, and that language's value is read.
        expect(
          await readStoredFields(editor, { ...asked, locale: "xx" })
        ).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "en" } } },
        });
        expect(
          await readStoredFields(editor, { ...asked, locale: "de" })
        ).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "de" } } },
        });
        for (const locale of ["all", "*"]) {
          expect(
            NextlyError.isCode(
              await rejectionOf(readStoredFields(editor, { ...asked, locale })),
              "INVALID_INPUT"
            )
          ).toBe(true);
        }
        const refusal = await rejectionOf(
          updateIfUnchanged(editor, {
            ...entry,
            locale: "all",
            data: { body: { v: "plugin" } },
            expect: {
              field: "body",
              form: "published",
              hash: await storedValueHash({
                kind: "value",
                value: { v: "en" },
              }),
            },
          })
        );
        expect(NextlyError.isCode(refusal, "INVALID_INPUT")).toBe(true);
      });
    });

    describe("the document named", () => {
      it("refuses a request naming both an entry and a Single, and writes neither", async () => {
        const id = await created("pages", { title: "t", body: { v: 0 } });
        await t.nextly.updateSingle({
          slug: "site",
          data: { body: { v: "site" }, _overwrite: true },
          overrideAccess: true,
        } as never);
        // Plain JavaScript, or an object passed on unchecked, can name both.
        const both = {
          collection: "pages",
          id,
          single: "site",
        } as unknown as PluginStoredDocument;

        const read = await rejectionOf(
          readStoredFields(owner, {
            ...both,
            fields: ["body"],
            form: "published",
          })
        );
        expect(NextlyError.isCode(read, "INVALID_INPUT")).toBe(true);
        // The expectation matches the Single, so a write that chose it would land.
        const write = await rejectionOf(
          updateIfUnchanged(owner, {
            ...both,
            data: { body: { v: "plugin" } },
            expect: {
              field: "body",
              form: "published",
              hash: await storedValueHash({
                kind: "value",
                value: { v: "site" },
              }),
            },
          })
        );
        expect(NextlyError.isCode(write, "INVALID_INPUT")).toBe(true);
        expect(
          await readStoredFields(owner, {
            single: "site",
            fields: ["body"],
            form: "published",
          })
        ).toEqual({
          kind: "found",
          values: { body: { kind: "value", value: { v: "site" } } },
        });
        expect(
          await stored({ collection: "pages", id }, "body", "published")
        ).toEqual({
          kind: "value",
          value: { v: 0 },
        });
      });
    });

    describe("the form named", () => {
      it("refuses a stored read or a conditional write naming no form or one it does not know, and shows or writes nothing", async () => {
        const id = await created("staged", {
          body: { v: "unreleased" },
          status: "draft",
        });
        const entry = { collection: "staged", id };
        // Never published: a reader who may not update is not shown it.
        expect(
          await readStoredFields(reader, {
            ...entry,
            fields: ["body"],
            form: "published",
          })
        ).toEqual({ kind: "absent" });
        const hash = await storedValueHash({
          kind: "value",
          value: { v: "unreleased" },
        });

        // Plain JavaScript, or an object passed on unchecked, can name any
        // form, or none.
        for (const form of [{ form: "anything" }, {}]) {
          const read = await rejectionOf(
            readStoredFields(reader, {
              ...entry,
              fields: ["body"],
              ...form,
            } as unknown as PluginStoredFieldsRequest)
          );
          expect(NextlyError.isCode(read, "INVALID_INPUT")).toBe(true);
          expect((read as Error).message).toMatch(/^A stored read names/);

          // Refused by the write's own boundary, not only by the read it makes.
          const write = await rejectionOf(
            updateIfUnchanged(editor, {
              ...entry,
              data: { body: { v: "plugin" } },
              expect: { field: "body", hash, ...form },
            } as unknown as PluginConditionalUpdate)
          );
          expect(NextlyError.isCode(write, "INVALID_INPUT")).toBe(true);
          expect((write as Error).message).toMatch(
            /^A conditional write names/
          );
        }
        expect(await stored(entry, "body", "published")).toEqual({
          kind: "value",
          value: { v: "unreleased" },
        });
      });
    });

    describe("the system", () => {
      /** The system: trusted server code, judged as `overrideAccess: true`. */
      const SYSTEM = { overrideAccess: true } as const;

      it("shows the system a never-published entry and its draft form, which a read-only person is not shown", async () => {
        const id = await created("staged", {
          body: { v: "unreleased" },
          status: "draft",
        });
        const asked = {
          collection: "staged",
          id,
          fields: ["body"],
        } as const;
        // A draft never published: no public state, and no working draft,
        // which this lifecycle keeps none of.
        const found = {
          kind: "found",
          values: { body: { kind: "value", value: { v: "unreleased" } } },
          live: { publicState: null, workingDraft: false },
        };

        expect(
          await readStoredFields(reader, { ...asked, form: "published" })
        ).toEqual({ kind: "absent" });
        expect(
          NextlyError.isForbidden(
            await rejectionOf(
              readStoredFields(reader, { ...asked, form: "draft" })
            )
          )
        ).toBe(true);
        expect(
          await readStoredFields(SYSTEM, { ...asked, form: "published" })
        ).toEqual(found);
        expect(
          await readStoredFields(SYSTEM, { ...asked, form: "draft" })
        ).toEqual(found);
      });

      it("reads and writes as the system a field a read rule governs and a built-in JSON field, which a person is refused", async () => {
        const id = await created("guarded", {
          body: { v: 0 },
          rows: [{ body: { v: "row" } }],
        });
        const entry = { collection: "guarded", id };
        for (const field of ["body", "rows"]) {
          const refusal = await rejectionOf(
            readStoredFields(editor, {
              ...entry,
              fields: [field],
              form: "published",
            })
          );
          expect(NextlyError.isCode(refusal, "INVALID_INPUT")).toBe(true);
        }

        const read = await readStoredFields(SYSTEM, {
          ...entry,
          fields: ["body", "rows"],
          form: "published",
        });
        expect(read).toMatchObject({
          kind: "found",
          values: {
            body: { kind: "value", value: { v: 0 } },
            rows: { kind: "value", value: [{ body: { v: "row" } }] },
          },
        });

        await updateIfUnchanged(SYSTEM, {
          ...entry,
          data: { body: { v: 1 } },
          expect: {
            field: "body",
            form: "published",
            hash: await storedValueHash({ kind: "value", value: { v: 0 } }),
          },
        });
        expect(
          await readStoredFields(SYSTEM, {
            ...entry,
            fields: ["body"],
            form: "published",
          })
        ).toMatchObject({
          values: { body: { kind: "value", value: { v: 1 } } },
        });
        const personWrite = await rejectionOf(
          updateIfUnchanged(editor, {
            ...entry,
            data: { body: { v: 2 } },
            expect: {
              field: "body",
              form: "published",
              hash: await storedValueHash({ kind: "value", value: { v: 1 } }),
            },
          })
        );
        expect(NextlyError.isCode(personWrite, "INVALID_INPUT")).toBe(true);
      });

      it("tells the system the live row's public state and whether a working draft is pending, and a person neither", async () => {
        const id = await created("drafted", {
          title: "t",
          body: { v: "live" },
          status: "published",
        });
        const asked = {
          collection: "drafted",
          id,
          fields: ["body"],
          form: "published",
        } as const;
        expect(await readStoredFields(SYSTEM, asked)).toMatchObject({
          kind: "found",
          live: { publicState: "published", workingDraft: false },
        });
        // A save that does not publish: a working draft over the live row.
        await t.nextly.update({
          collection: "drafted",
          id,
          data: { body: { v: "draft" } },
          overrideAccess: true,
        } as never);
        expect(await readStoredFields(SYSTEM, asked)).toMatchObject({
          kind: "found",
          values: { body: { kind: "value", value: { v: "live" } } },
          live: { publicState: "published", workingDraft: true },
        });
        const staged = await created("staged", {
          body: { v: 1 },
          status: "draft",
        });
        expect(
          await readStoredFields(SYSTEM, {
            collection: "staged",
            id: staged,
            fields: ["body"],
            form: "published",
          })
        ).toMatchObject({ live: { publicState: null, workingDraft: false } });

        const asPerson = await readStoredFields(editor, asked);
        expect(asPerson.kind).toBe("found");
        expect("live" in asPerson).toBe(false);
      });

      it("lands a system conditional write whose field is unchanged", async () => {
        const id = await created("pages", { title: "t", body: { v: 0 } });
        const page = { collection: "pages", id };
        const read = await readStoredFields(SYSTEM, {
          ...page,
          fields: ["body"],
          form: "published",
        });
        if (read.kind !== "found") throw new Error("expected the entry");

        await updateIfUnchanged(SYSTEM, {
          ...page,
          data: { body: { v: "system" } },
          expect: {
            field: "body",
            form: "published",
            hash: await storedValueHash(read.values.body ?? { kind: "absent" }),
          },
        });
        expect(await stored(page, "body", "published")).toEqual({
          kind: "value",
          value: { v: "system" },
        });
      });

      it("refuses a stale system conditional write with a conflict, and changes nothing", async () => {
        const id = await created("pages", { title: "t", body: { v: 0 } });
        const page = { collection: "pages", id };
        const hash = await storedValueHash({ kind: "value", value: { v: 0 } });
        await t.nextly.update({
          collection: "pages",
          id,
          data: { body: { v: "author" } },
          overrideAccess: true,
        } as never);

        const refusal = await rejectionOf(
          updateIfUnchanged(SYSTEM, {
            ...page,
            data: { body: { v: "system" } },
            expect: { field: "body", form: "published", hash },
          })
        );
        expect(NextlyError.isCode(refusal, "CONFLICT")).toBe(true);
        expect(await stored(page, "body", "published")).toEqual({
          kind: "value",
          value: { v: "author" },
        });
      });

      it("refuses an identity that is neither a route's caller nor the system, and writes nothing", async () => {
        const id = await created("pages", { title: "t", body: { v: 0 } });
        const page = { collection: "pages", id };
        const hash = await storedValueHash({ kind: "value", value: { v: 0 } });
        // Plain JavaScript, or an object passed on unchecked, can carry any.
        const junk: unknown[] = [
          { overrideAccess: false },
          { overrideAccess: true, user: owner.user },
          { ...owner, overrideAccess: false },
          { ...owner, overrideAccess: true },
          {},
          "system",
        ];
        for (const identity of junk) {
          const read = await rejectionOf(
            readStoredFields(identity as PluginStoredIdentity, {
              ...page,
              fields: ["body"],
              form: "published",
            })
          );
          expect(NextlyError.isCode(read, "INVALID_INPUT")).toBe(true);
          const write = await rejectionOf(
            updateIfUnchanged(identity as PluginStoredIdentity, {
              ...page,
              data: { body: { v: "junk" } },
              expect: { field: "body", form: "published", hash },
            })
          );
          expect(NextlyError.isCode(write, "INVALID_INPUT")).toBe(true);
        }
        expect(await stored(page, "body", "published")).toEqual({
          kind: "value",
          value: { v: 0 },
        });
      });
    });

    describe("access", () => {
      it("refuses the conditional write to a person who may read but not update, and changes nothing", async () => {
        const id = await created("pages", { title: "t", body: { v: 0 } });
        const page = { collection: "pages", id };
        const read = await readStoredFields(reader, {
          ...page,
          fields: ["body"],
          form: "published",
        });
        if (read.kind !== "found") throw new Error("expected the entry");
        const hash = await storedValueHash(
          read.values.body ?? { kind: "absent" }
        );

        const refusal = await rejectionOf(
          updateIfUnchanged(reader, {
            ...page,
            data: { body: { v: "plugin" } },
            expect: { field: "body", form: "published", hash },
          })
        );
        expect(NextlyError.isForbidden(refusal)).toBe(true);
        expect(await stored(page, "body", "published")).toEqual({
          kind: "value",
          value: { v: 0 },
        });
      });

      it("refuses the stored read to a person who may not read, and the draft form to one who may not update", async () => {
        const id = await created("drafted", {
          title: "t",
          body: { v: "live" },
          status: "published",
        });
        const entry = { collection: "drafted", id };
        const asked = {
          ...entry,
          fields: ["body"],
          form: "published",
        } as const;

        expect(await readStoredFields(reader, asked)).toMatchObject({
          kind: "found",
        });
        expect(
          NextlyError.isForbidden(
            await rejectionOf(readStoredFields(stranger, asked))
          )
        ).toBe(true);
        expect(
          NextlyError.isForbidden(
            await rejectionOf(
              readStoredFields(reader, { ...asked, form: "draft" })
            )
          )
        ).toBe(true);
      });
    });
  }
);
