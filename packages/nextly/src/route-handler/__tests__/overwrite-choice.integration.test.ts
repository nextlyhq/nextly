/**
 * An update may choose to overwrite: `_overwrite: true` beside the `_rev` it
 * read, on every door an update comes in by. It is applied whatever the
 * current version, needs no permission beyond the update, is never stored,
 * and is recorded in the document's history as an `overwritten` event, naming
 * whose changes it replaced when the version it gave was out of date.
 *
 * Each door shapes its own request, so the choice can be lost in any one of
 * them while the services honour it: a projection that drops unknown keys, a
 * per-document rebuild in a bulk write, or a second write path that never
 * records the event. So every door is driven here, and the history is read
 * back through the document's history read (`contentEvents.list`), the one
 * every surface uses, rather than from the table.
 *
 * @module route-handler/__tests__/overwrite-choice.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { grantPublic } from "../../__tests__/helpers/public-role";
import { defineCollection, defineSingle, text } from "../../config";
import type { ContentEventSubject } from "../../domains/content-events/record";
import { definePlugin } from "../../plugins/plugin-context";
import type { PluginRouteContext } from "../../plugins/routes/route-types";
import type { ServiceOpts } from "../../plugins/service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import type { CollectionsHandler } from "../../services/collections-handler";

/** No content history: a save records no event of its own. */
const NOTES = "ow_notes";
/** Content history on: a save records a version and a `saved` event. */
const LOGGED = "ow_logged";
/** Translated, so a save writes one language's row. */
const DOCS = "ow_docs";
/** Translated, with a status every language can be moved to at once. */
const PAGES = "ow_pages";
const SETTINGS = "ow_settings";

const ANA = { id: "user-ow-ana", name: "Ana", email: "ana@ow.test" };
const BEN = { id: "user-ow-ben", name: "Ben", email: "ben@ow.test" };
const CLEO = { id: "user-ow-cleo", name: "Cleo", email: "cleo@ow.test" };

let services: PluginRouteContext["services"]["collections"] | undefined;

const probe = definePlugin({
  name: "overwrite-choice-probe",
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    services = ctx.services.collections;
  },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
});

const OPEN = {
  read: () => true,
  create: () => true,
  update: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    plugins: [probe],
    collections: [
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
      defineCollection({
        slug: LOGGED,
        versions: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: DOCS,
        localized: true,
        access: OPEN,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note", localized: false }),
        ],
      }),
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        access: OPEN,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({ slug: SETTINGS, fields: [text({ name: "notice" })] }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  const now = new Date();
  for (const person of [ANA, BEN, CLEO]) {
    await current.adapter.insert("users", {
      ...person,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return current;
}

type Doc = Record<string, unknown>;
const SYSTEM: ServiceOpts = { as: "system" };

/** The document a Direct API or REST answer carries. */
const docOf = (answer: unknown): Doc => {
  const value = answer as { item?: Doc } & Doc;
  return value.item ?? value;
};

async function create(t: TestNextly, slug: string, data: Doc): Promise<Doc> {
  return docOf(
    await t.nextly.create({ collection: slug as never, data } as never)
  );
}

/** A save by `who`, trusted, carrying the version it read. */
async function saveAs(
  t: TestNextly,
  who: typeof ANA,
  slug: string,
  id: string,
  data: Doc,
  locale?: string
): Promise<Doc> {
  return docOf(
    await t.nextly.update({
      collection: slug as never,
      id,
      data,
      user: { id: who.id },
      ...(locale ? { locale } : {}),
    } as never)
  );
}

/** One REST call: its status and its JSON. */
async function rest(
  method: "GET" | "POST" | "PATCH",
  path: string[],
  body?: Doc,
  key?: string
): Promise<{ status: number; json: Doc }> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(`http://localhost/api/${path.join("/")}`, {
      method,
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

type Answer = {
  success?: boolean;
  code?: string;
  json?: {
    error?: { code?: string };
    items?: unknown[];
    errors?: { code?: string }[];
  };
};

/**
 * The error code a REST answer refuses with, or undefined when it applied. A
 * bulk route answers each document apart: refused only when no document was
 * applied, so one that slipped through still reads as applied.
 */
function restRefusal(json: Answer["json"]): string | undefined {
  if (json?.error?.code) return json.error.code;
  if (!json?.errors?.length || json.items?.length) return undefined;
  return json.errors[0]?.code ?? "FAILED";
}

/** The error code a refused call carries, whichever door refused it. */
async function refusalOf(call: () => Promise<unknown>): Promise<string> {
  let answer: Answer;
  try {
    answer = (await call()) as Answer;
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
  const fromService = answer?.success === false ? answer.code : undefined;
  return restRefusal(answer?.json) ?? fromService ?? "applied";
}

/**
 * A full-access API key of a super-admin: the bulk routes take a signed-in
 * caller, never a visitor.
 */
async function adminKey(t: TestNextly): Promise<string> {
  const admin = await superAdminUser(t, "user-ow-admin");
  const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(admin, {
    name: "bulk",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  return key;
}

/** A stored row, read raw: the oracle for what was written. */
async function stored(t: TestNextly, slug: string, id: string): Promise<Doc> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const read = await handler.getEntry({
    collectionName: slug,
    entryId: id,
    overrideAccess: true,
  });
  return (read as { data: Doc }).data;
}

const subjectOf = (slug: string, id: string): ContentEventSubject => ({
  kind: "collection",
  slug,
  id,
});

/** The document's history, newest first, as every surface reads it. */
async function historyOf(t: TestNextly, subject: ContentEventSubject) {
  return (await t.nextly.contentEvents.list({ subject, limit: 100 })).items;
}

async function overwritesOf(t: TestNextly, subject: ContentEventSubject) {
  return (await historyOf(t, subject)).filter(e => e.kind === "overwritten");
}

/** A note Ben has saved since its first version, so version "1" is out of date. */
async function noteBenChanged(t: TestNextly, slug = NOTES) {
  const created = await create(t, slug, { title: "first" });
  const id = String(created.id);
  await saveAs(t, BEN, slug, id, { title: "Ben's", _rev: "1" });
  return id;
}

describe.each(getConfiguredTestDialects())(
  "an update that chooses to overwrite (%s)",
  dialect => {
    it("applies an overwrite from an out-of-date version through REST, the Direct API and the plugin service", async () => {
      const t = await boot(dialect);
      await grantPublic(t, [`read-${NOTES}`, `update-${NOTES}`]);

      // REST, from version "1" after Ben's save made it "2".
      const id = await noteBenChanged(t);
      const viaRest = await rest(
        "PATCH",
        ["collections", NOTES, "entries", id],
        {
          title: "by REST",
          _rev: "1",
          _overwrite: true,
        }
      );
      expect(viaRest.status, JSON.stringify(viaRest.json)).toBe(200);
      expect((await stored(t, NOTES, id)).title).toBe("by REST");

      // The Direct API, from a version two saves old.
      const viaDirect = docOf(
        await t.nextly.update({
          collection: NOTES as never,
          id,
          data: { title: "by Direct", _rev: "1", _overwrite: true },
        } as never)
      );
      expect(viaDirect.title).toBe("by Direct");

      // The plugin service, the same.
      const viaPlugin = (
        await services!.updateEntry(
          NOTES,
          id,
          { title: "by plugin", _rev: "2", _overwrite: true },
          SYSTEM
        )
      ).item as unknown as Doc;
      expect(viaPlugin.title).toBe("by plugin");

      // Never stored, and never handed back as if it were a field.
      const row = await stored(t, NOTES, id);
      expect(row.title).toBe("by plugin");
      expect(row).not.toHaveProperty("_overwrite");
      for (const answer of [viaRest.json, viaDirect, viaPlugin]) {
        expect(docOf(answer)).not.toHaveProperty("_overwrite");
      }

      // A Single, through REST and the Direct API (plugins update no Single).
      await t.nextly.updateSingle({
        slug: SETTINGS as never,
        data: { notice: "Ben's" },
        user: { id: BEN.id },
      } as never);
      await grantPublic(t, [`read-${SETTINGS}`, `update-${SETTINGS}`]);
      const singleRest = await rest("PATCH", ["singles", SETTINGS], {
        notice: "by REST",
        _rev: "1",
        _overwrite: true,
      });
      expect(singleRest.status, JSON.stringify(singleRest.json)).toBe(200);
      const singleDirect = docOf(
        await t.nextly.updateSingle({
          slug: SETTINGS as never,
          data: { notice: "by Direct", _rev: "1", _overwrite: true },
        } as never)
      );
      expect(singleDirect.notice).toBe("by Direct");
      expect(singleDirect).not.toHaveProperty("_overwrite");
      // Both recorded in the Single's history, the first naming Ben.
      const singleOverwrites = (
        await historyOf(t, {
          kind: "single",
          slug: SETTINGS,
          id: String(singleDirect.id),
        })
      ).filter(e => e.kind === "overwritten");
      expect(singleOverwrites.map(e => e.payload)).toEqual([
        expect.objectContaining({ given: "stale" }),
        expect.objectContaining({
          given: "stale",
          replaced: expect.objectContaining({ kind: "person", id: BEN.id }),
        }),
      ]);
    }, 120_000);

    it("the three surfaces accept the same overwrite name from a caller holding only the update permission", async () => {
      const t = await boot(dialect);
      // REST: a visitor whose role holds only the update.
      await grantPublic(t, [`update-${NOTES}`]);
      const id = await noteBenChanged(t);
      const viaRest = await rest(
        "PATCH",
        ["collections", NOTES, "entries", id],
        {
          title: "visitor",
          _rev: "1",
          _overwrite: true,
        }
      );
      expect(viaRest.status, JSON.stringify(viaRest.json)).toBe(200);

      // The Direct API and the plugin service: a person who may only update.
      await userWhoMay(t, "user-ow-updater", "update", [NOTES]);
      await t.nextly.update({
        collection: NOTES as never,
        id,
        data: { title: "updater, direct", _rev: "1", _overwrite: true },
        user: { id: "user-ow-updater" },
        overrideAccess: false,
      } as never);
      expect((await stored(t, NOTES, id)).title).toBe("updater, direct");
      await services!.updateEntry(
        NOTES,
        id,
        { title: "updater, plugin", _rev: "1", _overwrite: true },
        { as: "user", user: { id: "user-ow-updater" } as never }
      );
      expect((await stored(t, NOTES, id)).title).toBe("updater, plugin");
    }, 120_000);

    it("refuses a caller without the update permission before anything is written or recorded", async () => {
      const t = await boot(dialect);
      await userWhoMay(t, "user-ow-reader", "read", [NOTES]);
      const id = await noteBenChanged(t);

      const code = await refusalOf(() =>
        t.nextly.update({
          collection: NOTES as never,
          id,
          data: { title: "reader", _rev: "1", _overwrite: true },
          user: { id: "user-ow-reader" },
          overrideAccess: false,
        } as never)
      );

      expect(code).toBe("FORBIDDEN");
      expect((await stored(t, NOTES, id)).title).toBe("Ben's");
      expect(await overwritesOf(t, subjectOf(NOTES, id))).toEqual([]);
    }, 120_000);

    it("records the overwrite in history, naming whose changes it replaced", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);

      await saveAs(t, ANA, NOTES, id, {
        title: "Ana's",
        _rev: "1",
        _overwrite: true,
      });

      // Recorded though this collection keeps no versions: every overwrite is.
      const [event, ...more] = await overwritesOf(t, subjectOf(NOTES, id));
      expect(more).toEqual([]);
      expect(event).toMatchObject({
        actorKind: "person",
        actorId: ANA.id,
        payload: {
          given: "stale",
          replaced: { kind: "person", id: BEN.id, principalKind: null },
          replacedName: "Ben",
        },
      });
    }, 120_000);

    it("records an overwrite with no version as an overwrite naming no one", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);

      await saveAs(t, ANA, NOTES, id, { title: "Ana's", _overwrite: true });

      const [event] = await overwritesOf(t, subjectOf(NOTES, id));
      expect(event).toMatchObject({
        actorId: ANA.id,
        payload: { given: "none", replaced: null },
      });
      expect((await stored(t, NOTES, id)).title).toBe("Ana's");
    }, 120_000);

    it("records an overwrite from the current version, naming no one", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);

      await saveAs(t, ANA, NOTES, id, {
        title: "Ana's",
        _rev: "2",
        _overwrite: true,
      });

      const [event, ...more] = await overwritesOf(t, subjectOf(NOTES, id));
      expect(more).toEqual([]);
      expect(event).toMatchObject({
        payload: { given: "current", replaced: null },
      });
    }, 120_000);

    it("keeps the version and the overwrite as two rows where content history is on", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t, LOGGED);

      await saveAs(t, ANA, LOGGED, id, {
        title: "Ana's",
        _rev: "1",
        _overwrite: true,
      });

      const history = await historyOf(t, subjectOf(LOGGED, id));
      const byAna = history.filter(e => e.actorId === ANA.id).map(e => e.kind);
      expect(byAna.sort()).toEqual(["overwritten", "saved"]);
    }, 120_000);

    it("names whoever changed the language the save writes", async () => {
      const t = await boot(dialect);
      const id = String((await create(t, DOCS, { title: "en", note: "n" })).id);
      // Cleo writes Spanish; Ben then changes only English, which a Spanish
      // save is not judged against.
      await saveAs(t, CLEO, DOCS, id, { title: "es", _rev: "1.es:0" }, "es");
      const read = docOf(
        await t.nextly.findByID({
          collection: DOCS as never,
          id,
          locale: "es",
        } as never)
      );
      const fromCleo = String(read._rev);
      await saveAs(t, CLEO, DOCS, id, { title: "es 2", _rev: fromCleo }, "es");

      await saveAs(
        t,
        ANA,
        DOCS,
        id,
        { title: "Ana's es", _rev: fromCleo, _overwrite: true },
        "es"
      );

      const [event] = await overwritesOf(t, subjectOf(DOCS, id));
      expect(event).toMatchObject({
        payload: { replaced: { kind: "person", id: CLEO.id } },
      });
    }, 120_000);

    it("names whoever changed another language when an overwrite moves every language", async () => {
      const t = await boot(dialect);
      const id = String((await create(t, PAGES, { title: "en" })).id);
      await saveAs(t, CLEO, PAGES, id, { title: "es", _overwrite: true }, "es");
      // Read as every language, then Cleo changes only Spanish again.
      const every = String(
        docOf(
          await t.nextly.findByID({
            collection: PAGES as never,
            id,
            locale: "*",
          } as never)
        )._rev
      );
      await saveAs(t, CLEO, PAGES, id, { title: "es 2", _rev: every }, "es");

      await saveAs(
        t,
        ANA,
        PAGES,
        id,
        { status: "published", _rev: every, _overwrite: true },
        "*"
      );

      // The sweep moved Spanish too, so the record reads every language's row
      // as it stood before the write, not only the one a save would write.
      const [event] = await overwritesOf(t, subjectOf(PAGES, id));
      expect(event).toMatchObject({
        actorId: ANA.id,
        payload: {
          given: "stale",
          replaced: { kind: "person", id: CLEO.id },
        },
      });
    }, 120_000);

    it("names no one when the person whose changes it replaced has no account any more", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);
      await t.adapter.delete("users", {
        and: [{ column: "id", op: "=", value: BEN.id }],
      });

      await saveAs(t, ANA, NOTES, id, {
        title: "Ana's",
        _rev: "1",
        _overwrite: true,
      });

      const [event] = await overwritesOf(t, subjectOf(NOTES, id));
      // The id stays with the event; no name was ever copied into it.
      expect(event?.payload).toMatchObject({
        replaced: { kind: "person", id: BEN.id },
        replacedName: null,
      });
    }, 120_000);

    it("refuses an out-of-date version when the choice is false, as when it is absent", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);

      const code = await refusalOf(() =>
        saveAs(t, ANA, NOTES, id, {
          title: "Ana's",
          _rev: "1",
          _overwrite: false,
        })
      );

      expect(code).toBe("STALE_VERSION");
      expect((await stored(t, NOTES, id)).title).toBe("Ben's");
    }, 120_000);

    it("refuses any value other than true or false on every surface, writing and recording nothing", async () => {
      const t = await boot(dialect);
      await grantPublic(t, [
        `read-${NOTES}`,
        `update-${NOTES}`,
        `read-${SETTINGS}`,
        `update-${SETTINGS}`,
      ]);
      const id = await noteBenChanged(t);
      const other = String((await create(t, NOTES, { title: "other" })).id);
      const key = await adminKey(t);
      const bad = { title: "never", _overwrite: "yes" };

      const answers = {
        rest: await refusalOf(() =>
          rest("PATCH", ["collections", NOTES, "entries", id], bad)
        ),
        direct: await refusalOf(() =>
          t.nextly.update({
            collection: NOTES as never,
            id,
            data: bad,
          } as never)
        ),
        plugin: await refusalOf(() =>
          services!.updateEntry(NOTES, id, bad, SYSTEM)
        ),
        batch: await refusalOf(async () => {
          const result = (await services!.updateMany(
            NOTES,
            [{ id, data: bad }],
            SYSTEM
          )) as unknown as { failed?: number; errors?: { code?: string }[] };
          return result.failed
            ? { success: false, code: result.errors?.[0]?.code ?? "FAILED" }
            : result;
        }),
        bulkByIds: await refusalOf(() =>
          rest(
            "POST",
            ["collections", NOTES, "entries", "bulk-update"],
            { ids: [id, other], data: bad },
            key
          )
        ),
        bulkByQuery: await refusalOf(() =>
          rest(
            "PATCH",
            ["collections", NOTES, "entries"],
            { where: { id: { in: [id, other] } }, data: bad },
            key
          )
        ),
        single: await refusalOf(() =>
          rest("PATCH", ["singles", SETTINGS], {
            notice: "never",
            _overwrite: 1,
          })
        ),
      };

      // Refused as the client's mistake on every door, never silently ignored.
      for (const [door, code] of Object.entries(answers)) {
        expect(code, door).toBe("VALIDATION_ERROR");
      }
      expect((await stored(t, NOTES, id)).title).toBe("Ben's");
      expect((await stored(t, NOTES, other)).title).toBe("other");
      expect(await overwritesOf(t, subjectOf(NOTES, id))).toEqual([]);
    }, 120_000);

    it("overwrites each document of a bulk update by ids and by query, recording each naming no one", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const a = await noteBenChanged(t);
      const b = await noteBenChanged(t);

      const byIds = await rest(
        "POST",
        ["collections", NOTES, "entries", "bulk-update"],
        { ids: [a, b], data: { title: "by ids", _overwrite: true } },
        key
      );
      expect(byIds.status, JSON.stringify(byIds.json)).toBeLessThan(300);
      const byQuery = await rest(
        "PATCH",
        ["collections", NOTES, "entries"],
        {
          where: { id: { in: [a, b] } },
          data: { title: "by query", _overwrite: true },
        },
        key
      );
      expect(byQuery.status, JSON.stringify(byQuery.json)).toBeLessThan(300);

      for (const id of [a, b]) {
        expect((await stored(t, NOTES, id)).title).toBe("by query");
        const events = await overwritesOf(t, subjectOf(NOTES, id));
        expect(events.map(e => e.payload)).toEqual([
          expect.objectContaining({ given: "none", replaced: null }),
          expect.objectContaining({ given: "none", replaced: null }),
        ]);
      }
    }, 120_000);

    it("judges each document of a batch on its own choice", async () => {
      const t = await boot(dialect);
      const overwritten = await noteBenChanged(t);
      const refused = await noteBenChanged(t);

      const result = (await services!.updateMany(
        NOTES,
        [
          {
            id: overwritten,
            data: { title: "batch", _rev: "1", _overwrite: true },
          },
          { id: refused, data: { title: "batch", _rev: "1" } },
        ],
        { ...SYSTEM, user: { id: ANA.id } as never }
      )) as unknown as { failed?: number };

      expect(result.failed).toBe(1);
      expect((await stored(t, NOTES, overwritten)).title).toBe("batch");
      expect((await stored(t, NOTES, refused)).title).toBe("Ben's");
      const [event] = await overwritesOf(t, subjectOf(NOTES, overwritten));
      expect(event?.payload).toMatchObject({
        replaced: { kind: "person", id: BEN.id },
      });
      expect(await overwritesOf(t, subjectOf(NOTES, refused))).toEqual([]);
    }, 120_000);

    it("records an overwrite made inside a plugin's own transaction on that transaction", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);

      // On SQLite a write to the pool waits behind the open transaction, so
      // an event written anywhere but the caller's transaction never returns.
      await services!.withTransaction(async tx => {
        await services!.updateEntryInTransaction(
          tx,
          NOTES,
          id,
          { title: "in tx", _rev: "1", _overwrite: true },
          { ...SYSTEM, user: { id: ANA.id } as never }
        );
      });

      expect((await stored(t, NOTES, id)).title).toBe("in tx");
      const [event] = await overwritesOf(t, subjectOf(NOTES, id));
      expect(event?.payload).toMatchObject({
        replaced: { kind: "person", id: BEN.id },
      });
    }, 60_000);

    it("refuses the save when its overwrite cannot be recorded, writing nothing", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);
      // An install that has not migrated since the record arrived. A plain
      // save of a collection without versions records nothing, so it still
      // goes through; only the overwrite needs the table.
      await t.adapter.executeQuery("DROP TABLE nextly_content_events");
      await saveAs(t, BEN, NOTES, id, { title: "Ben again", _rev: "2" });

      const code = await refusalOf(() =>
        saveAs(t, ANA, NOTES, id, {
          title: "Ana's",
          _rev: "1",
          _overwrite: true,
        })
      );

      expect(code).not.toBe("applied");
      expect((await stored(t, NOTES, id)).title).toBe("Ben again");
    }, 120_000);

    it("applies two overwrites from one out-of-date version, the later naming the earlier", async () => {
      const t = await boot(dialect);
      const id = await noteBenChanged(t);

      await Promise.all(
        [ANA, CLEO].map(who =>
          saveAs(t, who, NOTES, id, {
            title: `${who.name}'s`,
            _rev: "1",
            _overwrite: true,
          })
        )
      );

      // Newest first: whichever landed second replaced the first one's save.
      const [later, earlier] = await overwritesOf(t, subjectOf(NOTES, id));
      expect(earlier?.payload).toMatchObject({
        replaced: { kind: "person", id: BEN.id },
      });
      expect(later?.payload).toMatchObject({
        replaced: { kind: "person", id: earlier?.actorId },
      });
      expect((await stored(t, NOTES, id)).title).toBe(
        later?.actorId === ANA.id ? "Ana's" : "Cleo's"
      );
    }, 120_000);
  }
);
