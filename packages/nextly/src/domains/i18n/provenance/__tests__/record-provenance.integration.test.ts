/**
 * Every write of a document's translated values records where each value came from, per field and
 * language, on every dialect: a value in the default language is its own source; another is a
 * person's, an integration's or an import's by who wrote it, or what the write claims (a machine
 * translation with its engine, a copy from another language), and keeps the fingerprint of its
 * source's value then. `agent` is a claim only an API key or a plugin-defined person may make.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../../config";
import { container } from "../../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../../../collections/services/collection-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";
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
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
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
  sourceLocale: string | null;
  sourceFingerprint: string | null;
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
      sourceLocale: row.sourceLocale,
      sourceFingerprint: row.sourceFingerprint,
    });
  }
  return out;
}

/** A save of `data` in `locale`, as the actor given. */
async function save(
  id: string,
  locale: string,
  data: Record<string, unknown>,
  as: { user?: string; apiKey?: string } = { user: "ann" },
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
      })) as { item: { id: string } };
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
      })) as { item: { id: string } };
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

      await save(id, "fr", {
        title: "Hola",
        _provenance: { title: { origin: "copy", sourceLocale: "es" } },
      });
      expect((await rowsOf(id)).fr).toEqual([
        expect.objectContaining({
          origin: "copy",
          sourceLocale: "es",
          sourceFingerprint: valueFingerprint("Hola"),
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
      })) as { item: { id: string } };
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
      })) as { item: { id: string } };
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
      })) as { item: { id: string } };
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
      })) as { item: { id: string } };
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
  }
);
