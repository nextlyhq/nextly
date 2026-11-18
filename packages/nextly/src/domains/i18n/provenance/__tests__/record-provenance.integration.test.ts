/**
 * Every write of a document's translated values records where each value came from, per field and
 * language, on every dialect: a value in the default language is its own source; another is a
 * person's, an integration's or an import's by who wrote it, or what the write claims (a machine
 * translation with its engine, a copy from another language), and keeps the fingerprint of its
 * source's value then. `agent` is a claim only an API key or a plugin-defined person may make.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  date,
  defineCollection,
  defineSingle,
  json,
  repeater,
  text,
} from "../../../../config";
import { container } from "../../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../../../collections/services/collection-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { SingleEntryService } from "../../../../services/singles/single-entry-service";
import { SOURCE_FINGERPRINT_MOVED } from "../../../../schemas/translation-provenance";
import { teardownEntityI18n } from "../../migration/teardown-entity-i18n";
import { valueFingerprint } from "../record-provenance";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
      // Drafts: a save over a live language is held as its working draft.
      defineCollection({
        slug: "notes",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "summary", localized: true }),
        ],
      }),
      // Values a store reshapes: a date, and a JSON value.
      defineCollection({
        slug: "events",
        localized: true,
        fields: [
          date({ name: "startsOn", localized: true }),
          json({ name: "meta", localized: true }),
        ],
      }),
      // Drafts of a structure per language: a held change to its rows goes live with a publish.
      defineCollection({
        slug: "playlists",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          repeater({
            name: "tracks",
            localized: true,
            fields: [text({ name: "label" })],
          }),
        ],
      }),
      // A translated field named like a member every object inherits.
      defineCollection({
        slug: "glossary",
        localized: true,
        fields: [text({ name: "constructor", localized: true })],
      }),
      // A structure per language: each language holds its own rows.
      defineCollection({
        slug: "menus",
        localized: true,
        fields: [
          repeater({
            name: "items",
            localized: true,
            fields: [text({ name: "label" })],
          }),
        ],
      }),
    ],
    singles: [
      // Drafts on a Single: a publish over a held draft may give values of its own.
      defineSingle({
        slug: "ticker",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "headline", localized: true })],
      }),
      defineSingle({
        slug: "banner",
        localized: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
  });
  return t;
}

interface Row {
  locale: string;
  partState: string;
  fieldPath: string;
  valueFingerprint: string;
  origin: string;
  engine: string | null;
  actorKind: string | null;
  actorId: string | null;
  actorPrincipalKind: string | null;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
  originRowId: string | null;
}

/** The provenance rows of one document, by language, live rows before draft ones. */
async function rowsOf(
  id: string,
  scope: { kind: string; slug: string } = { kind: "collection", slug: "posts" }
): Promise<Record<string, Row[]>> {
  const rows = await t!.adapter.select<
    Row & { entryId: string; scopeKind: string; scopeSlug: string }
  >("nextly_translation_provenance");
  const out: Record<string, Row[]> = {};
  const mine = rows
    .filter(
      r =>
        r.entryId === id &&
        r.scopeKind === scope.kind &&
        r.scopeSlug === scope.slug
    )
    .sort((a, b) => a.partState.localeCompare(b.partState) * -1);
  for (const row of mine) {
    (out[row.locale] ??= []).push({
      locale: row.locale,
      partState: row.partState,
      fieldPath: row.fieldPath,
      valueFingerprint: row.valueFingerprint,
      origin: row.origin,
      engine: row.engine,
      actorKind: row.actorKind,
      actorId: row.actorId,
      actorPrincipalKind: row.actorPrincipalKind,
      sourceLocale: row.sourceLocale,
      sourceFingerprint: row.sourceFingerprint,
      originRowId: row.originRowId,
    });
  }
  return out;
}

/** A save of `data` in `locale`, as the actor given. */
async function save(
  id: string,
  locale: string,
  data: Record<string, unknown>,
  as: {
    user?: string;
    apiKey?: string;
    principal?: { kind: string; id: string };
  } = { user: "ann" },
  collectionName = "posts"
) {
  const handler = container.get<CollectionsHandler>("collectionsHandler");
  return handler.updateEntry(
    {
      collectionName,
      entryId: id,
      overrideAccess: true,
      locale,
      ...(as.user ? { user: { id: as.user } } : {}),
      ...(as.apiKey
        ? { actor: { type: "apiKey" as const, id: as.apiKey } }
        : {}),
      ...(as.principal
        ? { actor: { type: "principal" as const, principal: as.principal } }
        : {}),
    },
    { ...data, _overwrite: true }
  );
}

describe.each(getConfiguredTestDialects())(
  "where each translated value came from (%s)",
  dialect => {
    it("records the default language as its own source, and a translation by who wrote it, with its source's fingerprint", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi", code: "c1" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;

      expect((await save(id, "en", { title: "Hello" })).success).toBe(true);
      expect((await save(id, "es", { title: "Hola" })).success).toBe(true);
      expect(
        (await save(id, "fr", { title: "Salut" }, { apiKey: "key-1" })).success
      ).toBe(true);

      const rows = await rowsOf(id);
      expect(rows.en).toEqual([
        expect.objectContaining({
          partState: "live",
          fieldPath: "title",
          valueFingerprint: valueFingerprint("Hello"),
          origin: "original",
          sourceLocale: null,
          sourceFingerprint: null,
        }),
      ]);
      expect(rows.es).toEqual([
        expect.objectContaining({
          fieldPath: "title",
          valueFingerprint: valueFingerprint("Hola"),
          origin: "person",
          actorKind: "user",
          sourceLocale: "en",
          sourceFingerprint: valueFingerprint("Hello"),
        }),
      ]);
      expect(rows.fr).toEqual([
        expect.objectContaining({
          origin: "integration",
          actorKind: "apiKey",
          sourceFingerprint: valueFingerprint("Hello"),
        }),
      ]);
    });

    it("keeps what a write claims, a machine translation's engine or a copy's language, and refuses an agent claim from a person", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      await save(id, "en", { title: "Hello" });
      await save(id, "es", { title: "Hola" });

      expect(
        (
          await save(id, "fr", {
            title: "Bonjour",
            _provenance: { title: { origin: "machine", engine: "deepl" } },
          })
        ).success
      ).toBe(true);
      expect((await rowsOf(id)).fr).toEqual([
        expect.objectContaining({
          origin: "machine",
          engine: "deepl",
          sourceLocale: "en",
          sourceFingerprint: valueFingerprint("Hello"),
        }),
      ]);

      // A copy names the version of its source it read: made from Spanish as it stands, it keeps
      // that value's fingerprint.
      const spanish = await container
        .get<CollectionsHandler>("collectionsHandler")
        .getEntry({
          collectionName: "posts",
          entryId: id,
          locale: "es",
          overrideAccess: true,
        });
      await save(id, "fr", {
        title: "Hola",
        _provenance: {
          title: {
            origin: "copy",
            sourceLocale: "es",
            sourceRevision: (spanish.data as Record<string, unknown>)._rev,
          },
        },
      });
      expect((await rowsOf(id)).fr).toEqual([
        expect.objectContaining({
          origin: "copy",
          sourceLocale: "es",
          sourceFingerprint: valueFingerprint("Hola"),
        }),
      ]);

      // A copy that doesn't say which version it read can't be shown to be of the source as it
      // is: it keeps the marker that reads as out of date, never a fingerprint of a value.
      await save(id, "fr", {
        title: "Hola",
        _provenance: { title: { origin: "copy", sourceLocale: "es" } },
      });
      expect((await rowsOf(id)).fr).toEqual([
        expect.objectContaining({
          origin: "copy",
          sourceLocale: "es",
          sourceFingerprint: SOURCE_FINGERPRINT_MOVED,
        }),
      ]);

      const refused = await save(id, "fr", {
        title: "Salut",
        _provenance: { title: { origin: "agent" } },
      });
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(400);
      // Refused before anything was written.
      expect((await rowsOf(id)).fr).toEqual([
        expect.objectContaining({ origin: "copy" }),
      ]);
    });
    it("records what a create writes, and a delete takes every row of the document with it", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      expect((await rowsOf(id)).en).toEqual([
        expect.objectContaining({
          partState: "live",
          fieldPath: "title",
          valueFingerprint: valueFingerprint("Hi"),
          origin: "original",
        }),
      ]);
      await save(id, "es", { title: "Hola" });
      expect(Object.keys(await rowsOf(id)).sort()).toEqual(["en", "es"]);

      await t!.nextly.delete({ collection: "posts", id });
      expect(await rowsOf(id)).toEqual({});
    });

    it("records a held save as its language's draft, which a publish puts live and a discard drops", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "notes",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const notes = { kind: "collection", slug: "notes" };
      await save(id, "en", { status: "published" }, undefined, "notes");
      await save(
        id,
        "es",
        { title: "Hola", status: "published" },
        undefined,
        "notes"
      );

      // es is live, so this save is held: the live row stays as it was.
      await save(id, "es", { title: "Hola 2" }, undefined, "notes");
      expect((await rowsOf(id, notes)).es).toEqual([
        expect.objectContaining({
          partState: "live",
          valueFingerprint: valueFingerprint("Hola"),
        }),
        expect.objectContaining({
          partState: "draft",
          valueFingerprint: valueFingerprint("Hola 2"),
          origin: "person",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
      ]);

      await container
        .get<CollectionsHandler>("collectionsHandler")
        .discardWorkingDraftCounted({
          collectionName: "notes",
          version: { _overwrite: true },
          entryId: id,
          locale: "es",
        });
      expect((await rowsOf(id, notes)).es).toEqual([
        expect.objectContaining({
          partState: "live",
          valueFingerprint: valueFingerprint("Hola"),
        }),
      ]);

      // A claim made on a held save is what goes live with it.
      await save(
        id,
        "es",
        {
          title: "Hola 3",
          _provenance: { title: { origin: "machine", engine: "deepl" } },
        },
        undefined,
        "notes"
      );
      await save(id, "es", { status: "published" }, undefined, "notes");
      expect((await rowsOf(id, notes)).es).toEqual([
        expect.objectContaining({
          partState: "live",
          valueFingerprint: valueFingerprint("Hola 3"),
          origin: "machine",
          engine: "deepl",
        }),
      ]);
    });

    it("puts each language's held draft live when every language is published", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "notes",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const notes = { kind: "collection", slug: "notes" };
      await save(id, "en", { status: "published" }, undefined, "notes");
      await save(
        id,
        "es",
        { title: "Hola", status: "published" },
        undefined,
        "notes"
      );
      await save(id, "es", { title: "Hola 2" }, undefined, "notes");

      const handler = container.get<CollectionsHandler>("collectionsHandler");
      expect(
        (
          await handler.publishAllLocales({
            collectionName: "notes",
            entryId: id,
            overrideAccess: true,
            data: { _overwrite: true },
          })
        ).success
      ).toBe(true);
      expect((await rowsOf(id, notes)).es).toEqual([
        expect.objectContaining({
          partState: "live",
          valueFingerprint: valueFingerprint("Hola 2"),
          origin: "person",
        }),
      ]);
    });

    it("records a write made in a caller's transaction", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const service = container.get<CollectionService>("collectionService");
      await service.withTransaction(tx =>
        service.updateEntryInTransaction(
          tx,
          "posts",
          id,
          { title: "Hello", _overwrite: true },
          // Trusted server code, as a plugin's own write is by default.
          { overrideAccess: true }
        )
      );
      expect((await rowsOf(id)).en).toEqual([
        expect.objectContaining({
          valueFingerprint: valueFingerprint("Hello"),
          origin: "original",
        }),
      ]);
    });

    it("records a Single's translated values, by language", async () => {
      await boot(dialect);
      await t!.nextly.updateSingle({
        slug: "banner",
        locale: "en",
        data: { headline: "Sale", _overwrite: true },
      } as never);
      await t!.nextly.updateSingle({
        slug: "banner",
        locale: "es",
        data: {
          headline: "Rebajas",
          _overwrite: true,
          _provenance: { headline: { origin: "machine", engine: "deepl" } },
        },
      } as never);
      const singleId = (
        await t!.adapter.select<{ entryId: string }>(
          "nextly_translation_provenance",
          {
            where: { and: [{ column: "scopeKind", op: "=", value: "single" }] },
          }
        )
      )[0]?.entryId;
      expect(singleId).toBeDefined();
      const rows = await rowsOf(String(singleId), {
        kind: "single",
        slug: "banner",
      });
      expect(rows.en).toEqual([
        expect.objectContaining({
          fieldPath: "headline",
          valueFingerprint: valueFingerprint("Sale"),
          origin: "original",
        }),
      ]);
      expect(rows.es).toEqual([
        expect.objectContaining({
          valueFingerprint: valueFingerprint("Rebajas"),
          origin: "machine",
          engine: "deepl",
          sourceFingerprint: valueFingerprint("Sale"),
        }),
      ]);
    });
    it("records a rewrite of a translated field, which puts its translations out of date", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      await save(id, "es", { title: "Hola" });
      const read = (await t!.nextly.findByID({
        collection: "posts",
        id,
        locale: "en",
      })) as unknown as { _rev: string };

      await t!.nextly.rewriteField({
        collection: "posts",
        id,
        field: "title",
        locale: "en",
        expectedVersion: read._rev,
        set: { value: "Hello" },
        reason: "A renamed product",
      } as never);

      const rows = await rowsOf(id);
      expect(rows.en).toEqual([
        expect.objectContaining({
          valueFingerprint: valueFingerprint("Hello"),
          origin: "original",
        }),
      ]);
      // Spanish was made from "Hi", which is no longer the source's value.
      expect(rows.es).toEqual([
        expect.objectContaining({ sourceFingerprint: valueFingerprint("Hi") }),
      ]);
    });

    it("keeps what a published language's untouched fields recorded when a held change to another field goes live", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "notes",
        locale: "en",
        data: { title: "Hi", summary: "Short" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const notes = { kind: "collection", slug: "notes" };
      await save(id, "en", { status: "published" }, undefined, "notes");
      await save(
        id,
        "es",
        { title: "Hola", summary: "Corto", status: "published" },
        undefined,
        "notes"
      );
      // The source's title moves: Spanish's title is now out of date.
      await save(id, "en", { title: "Hello" }, undefined, "notes");
      await save(id, "en", { status: "published" }, undefined, "notes");

      // A held change to Spanish's summary alone, then published by another.
      await save(id, "es", { summary: "Corto 2" }, undefined, "notes");
      await save(
        id,
        "es",
        { status: "published" },
        { apiKey: "key-1" },
        "notes"
      );

      const title = (await rowsOf(id, notes)).es?.find(
        row => row.fieldPath === "title"
      );
      // Still the person's translation of "Hi": nothing re-made it.
      expect(title).toMatchObject({
        partState: "live",
        valueFingerprint: valueFingerprint("Hola"),
        actorKind: "user",
        sourceFingerprint: valueFingerprint("Hi"),
      });
    });

    it("fingerprints a date and a JSON value as written, not as stored", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "events",
        locale: "en",
        data: { startsOn: "2026-01-01T00:00:00.000Z", meta: { a: 1, b: 2 } },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const events = { kind: "collection", slug: "events" };
      const fingerprintOf = async (field: string) =>
        (await rowsOf(id, events)).en?.find(row => row.fieldPath === field)
          ?.valueFingerprint;

      expect(await fingerprintOf("startsOn")).toBe(
        valueFingerprint("2026-01-01T00:00:00.000Z")
      );
      expect(await fingerprintOf("meta")).toBe(
        valueFingerprint({ a: 1, b: 2 })
      );

      await save(
        id,
        "en",
        { startsOn: "2026-02-01T00:00:00.000Z", meta: { b: 2, a: 1 } },
        undefined,
        "events"
      );
      // Another date is another value; the same object in another key order is not.
      expect(await fingerprintOf("startsOn")).toBe(
        valueFingerprint("2026-02-01T00:00:00.000Z")
      );
      expect(await fingerprintOf("meta")).toBe(
        valueFingerprint({ a: 1, b: 2 })
      );
    });

    it("records a plugin-defined person by kind, never by their id", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      expect(
        (
          await save(
            id,
            "es",
            { title: "Hola" },
            { principal: { kind: "member", id: "m-1@example.com" } }
          )
        ).success
      ).toBe(true);

      const rows = await rowsOf(id);
      expect(rows.es).toEqual([
        expect.objectContaining({
          origin: "person",
          actorKind: "principal",
          actorPrincipalKind: "member",
          actorId: null,
        }),
      ]);
      expect(JSON.stringify(rows)).not.toContain("m-1@example.com");
    });

    it("records which row each row of a structure per language was translated or copied from", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "menus",
        locale: "en",
        data: {
          items: [
            { id: "r1", label: "Home" },
            { id: "r2", label: "About" },
          ],
        },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const menus = { kind: "collection", slug: "menus" };
      const rowOrigins = async (locale: string) =>
        Object.fromEntries(
          ((await rowsOf(id, menus))[locale] ?? [])
            .filter(row => row.fieldPath.startsWith("items#"))
            .map(row => [row.fieldPath, [row.origin, row.originRowId]])
        );

      // A machine translation names the row each of its rows was made from.
      await save(
        id,
        "es",
        {
          items: [
            { id: "s1", label: "Inicio" },
            { id: "s2", label: "Acerca de" },
          ],
          _provenance: {
            items: {
              origin: "machine",
              engine: "deepl",
              rows: { s1: "r1", s2: "r2" },
            },
          },
        },
        undefined,
        "menus"
      );
      expect(await rowOrigins("es")).toEqual({
        "items#s1": ["machine", "r1"],
        "items#s2": ["machine", "r2"],
      });

      // A copy from another language keeps each row as the row it copied.
      await save(
        id,
        "fr",
        {
          items: [
            { id: "r1", label: "Home" },
            { id: "r2", label: "About" },
          ],
          _provenance: { items: { origin: "copy", sourceLocale: "en" } },
        },
        undefined,
        "menus"
      );
      expect(await rowOrigins("fr")).toEqual({
        "items#r1": ["copy", "r1"],
        "items#r2": ["copy", "r2"],
      });

      // A row removed from the language takes its record with it.
      await save(
        id,
        "fr",
        {
          items: [{ id: "r1", label: "Accueil" }],
          _provenance: { items: { origin: "copy", sourceLocale: "en" } },
        },
        undefined,
        "menus"
      );
      expect(await rowOrigins("fr")).toEqual({ "items#r1": ["copy", "r1"] });
    });
    it("reads a write's claims by their own names, never a member every object inherits", async () => {
      // A field or a row named `constructor` has no claim unless the write names one: an object's
      // inherited `constructor` is no claim, so it neither stands in for the field's origin nor
      // for a row's source row.
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "glossary",
        locale: "en",
        data: { constructor: "Builder" },
      })) as unknown as { item: { id: string } };
      const word = created.item.id;
      const saved = await save(
        word,
        "es",
        { constructor: "Constructor" },
        { user: "ann" },
        "glossary"
      );
      expect(saved, JSON.stringify(saved)).toMatchObject({ success: true });
      expect(
        (await rowsOf(word, { kind: "collection", slug: "glossary" })).es
      ).toEqual([
        expect.objectContaining({
          fieldPath: "constructor",
          origin: "person",
          actorKind: "user",
          sourceLocale: "en",
        }),
      ]);

      const menu = (await t!.nextly.create({
        collection: "menus",
        locale: "en",
        data: { items: [{ id: "constructor", label: "Home" }] },
      })) as unknown as { item: { id: string } };
      const translated = await save(
        menu.item.id,
        "es",
        {
          items: [{ id: "constructor", label: "Inicio" }],
          _provenance: { items: { origin: "machine", engine: "e1", rows: {} } },
        },
        { apiKey: "key-1" },
        "menus"
      );
      expect(translated, JSON.stringify(translated)).toMatchObject({
        success: true,
      });
      // The claim names no source row for it, so the row keeps no record of one.
      expect(
        (
          (await rowsOf(menu.item.id, { kind: "collection", slug: "menus" }))
            .es ?? []
        ).map(row => row.fieldPath)
      ).toEqual(["items"]);
    });
    it("refuses a copy from a language that isn't configured, or into the language it copies", async () => {
      // A copy names the language it came from. One the site doesn't have, or the language being
      // written itself, is no source a value can be out of date against: refused before the save
      // writes anything, on a collection and on a Single.
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      for (const sourceLocale of ["de", "es"]) {
        const refused = await save(id, "es", {
          title: "Hola",
          _provenance: { title: { origin: "copy", sourceLocale } },
        });
        expect(refused, JSON.stringify(refused)).toMatchObject({
          success: false,
          statusCode: 400,
        });
      }
      // Nothing was written: the language keeps no value and no record.
      expect((await rowsOf(id)).es).toBeUndefined();

      await t!.nextly.updateSingle({
        slug: "banner",
        locale: "en",
        data: { headline: "Sale", _overwrite: true },
      } as never);
      for (const sourceLocale of ["de", "es"]) {
        await expect(
          t!.nextly.updateSingle({
            slug: "banner",
            locale: "es",
            data: {
              headline: "Rebajas",
              _overwrite: true,
              _provenance: { headline: { origin: "copy", sourceLocale } },
            },
          } as never)
        ).rejects.toMatchObject({ statusCode: 400 });
      }
    });
    it("fingerprints a text value that looks like JSON as the text it is", async () => {
      // Only a JSON-backed field is read back from text: a text field holding `[1, 2]` and then
      // `[1,2]` has changed, so its translations must go out of date.
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "[1, 2]" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const titleFingerprint = async () =>
        (await rowsOf(id)).en?.find(row => row.fieldPath === "title")
          ?.valueFingerprint;
      expect(await titleFingerprint()).toBe(valueFingerprint("[1, 2]"));
      expect((await save(id, "en", { title: "[1,2]" })).success).toBe(true);
      expect(await titleFingerprint()).toBe(valueFingerprint("[1,2]"));
      expect(valueFingerprint("[1,2]")).not.toBe(valueFingerprint("[1, 2]"));
    });
    it("forgets an entity's records when its localization is torn down with it", async () => {
      // Deleting a collection or a Single tears its localization down (`teardownEntityI18n`, on
      // every delete path). Its records go with it, by kind and slug, and no other entity's do:
      // left behind, a later entity of that kind and slug would read a predecessor's origins.
      await boot(dialect);
      const post = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi" },
      })) as unknown as { item: { id: string } };
      expect((await save(post.item.id, "es", { title: "Hola" })).success).toBe(
        true
      );
      const event = (await t!.nextly.create({
        collection: "events",
        locale: "en",
        data: { meta: { a: 1 } },
      })) as unknown as { item: { id: string } };
      expect(Object.keys(await rowsOf(post.item.id))).toEqual(
        expect.arrayContaining(["en", "es"])
      );

      const result = await teardownEntityI18n({
        adapter: t!.adapter as never,
        slug: "posts",
        kind: "collection",
        tableName: "dc_posts",
      });
      expect(result.provenanceRowsPurged).toBe(2);
      expect(await rowsOf(post.item.id)).toEqual({});
      expect(
        (await rowsOf(event.item.id, { kind: "collection", slug: "events" })).en
      ).toHaveLength(1);
    });
    it("records a held draft's changed value when it goes live with no record of its own", async () => {
      // A draft held before origins were recorded has no record. Going live, a field it changed
      // must be recorded as the value now live, not keep the record of the value it replaced; a
      // field it left as it was keeps its record.
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "notes",
        locale: "en",
        data: { title: "Hi", summary: "Short" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const notes = { kind: "collection", slug: "notes" };
      await save(id, "en", { status: "published" }, undefined, "notes");
      await save(
        id,
        "es",
        { title: "Hola", summary: "Corto", status: "published" },
        undefined,
        "notes"
      );
      await save(id, "es", { title: "Hola 2" }, undefined, "notes");
      // As if the draft had been held before recording began.
      await t!.adapter.delete("nextly_translation_provenance", {
        and: [
          { column: "entryId", op: "=", value: id },
          { column: "partState", op: "=", value: "draft" },
        ],
      });

      await save(id, "es", { status: "published" }, undefined, "notes");
      const live = (await rowsOf(id, notes)).es ?? [];
      expect(live.find(row => row.fieldPath === "title")).toMatchObject({
        partState: "live",
        valueFingerprint: valueFingerprint("Hola 2"),
      });
      expect(live.find(row => row.fieldPath === "summary")).toMatchObject({
        partState: "live",
        valueFingerprint: valueFingerprint("Corto"),
      });
    });
    it("forgets a row's record when a published draft no longer has the row", async () => {
      // Spanish was published with rows a and b, each recorded. A held change keeps a alone; once
      // it goes live, b's record goes with b, and a's is the draft's.
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "playlists",
        locale: "en",
        data: {
          tracks: [
            { id: "a", label: "One" },
            { id: "b", label: "Two" },
          ],
        },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const playlists = { kind: "collection", slug: "playlists" };
      await save(id, "en", { status: "published" }, undefined, "playlists");
      const published = await save(
        id,
        "es",
        {
          tracks: [
            { id: "a", label: "Uno" },
            { id: "b", label: "Dos" },
          ],
          status: "published",
          _provenance: {
            tracks: {
              origin: "machine",
              engine: "e1",
              rows: { a: "a", b: "b" },
            },
          },
        },
        { apiKey: "key-1" },
        "playlists"
      );
      expect(published, JSON.stringify(published)).toMatchObject({
        success: true,
      });
      const livePaths = async () =>
        ((await rowsOf(id, playlists)).es ?? [])
          .filter(row => row.partState === "live")
          .map(row => row.fieldPath)
          .sort();
      expect(await livePaths()).toEqual(["tracks", "tracks#a", "tracks#b"]);

      const held = await save(
        id,
        "es",
        {
          tracks: [{ id: "a", label: "Uno" }],
          _provenance: {
            tracks: { origin: "machine", engine: "e1", rows: { a: "a" } },
          },
        },
        { apiKey: "key-1" },
        "playlists"
      );
      expect(held, JSON.stringify(held)).toMatchObject({ success: true });
      const goingLive = await save(
        id,
        "es",
        { status: "published" },
        { apiKey: "key-1" },
        "playlists"
      );
      expect(goingLive, JSON.stringify(goingLive)).toMatchObject({
        success: true,
      });
      expect(await livePaths()).toEqual(["tracks", "tracks#a"]);
    });
    it("records a value a publish gives over its held draft's", async () => {
      // A Single's held draft goes live with a publish that gives a field a value of its own: the
      // published value is that one, and so is the live record, not the draft's it replaced.
      await boot(dialect);
      const singles = container.get<SingleEntryService>("singleEntryService");
      const write = (locale: string, data: Record<string, unknown>) =>
        singles.update(
          "ticker",
          { ...data, _overwrite: true },
          { overrideAccess: true, locale }
        );
      await write("en", { headline: "Hi", status: "published" });
      await write("es", { headline: "Hola", status: "published" });
      await write("es", { headline: "Hola 2" });
      const published = await write("es", {
        headline: "Hola 3",
        status: "published",
      });
      expect(published, JSON.stringify(published)).toMatchObject({
        success: true,
      });
      const spanish = await singles.get("ticker", {
        overrideAccess: true,
        locale: "es",
      });
      expect((spanish.data as Record<string, unknown>).headline).toBe("Hola 3");
      const id = String((spanish.data as Record<string, unknown>).id);
      const liveRows = (
        (await rowsOf(id, { kind: "single", slug: "ticker" })).es ?? []
      ).filter(row => row.partState === "live");
      expect(liveRows, JSON.stringify(liveRows)).toEqual([
        expect.objectContaining({
          fieldPath: "headline",
          valueFingerprint: valueFingerprint("Hola 3"),
        }),
      ]);
    });
  }
);
