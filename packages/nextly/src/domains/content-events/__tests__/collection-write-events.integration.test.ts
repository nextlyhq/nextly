/**
 * A collection document's write paths record its history, on every dialect:
 * its creation, each save that records a version, each publish and unpublish,
 * and its deletion, each with who made it, in the write's own transaction.
 * A person is named by the name the request carried, an API key by its own
 * name, and the system by none. Publishing every language is one event that
 * names them.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  id: string;
  subjectId: string;
  kind: string;
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  fromState: string | null;
  toState: string | null;
  versionNo: number | null;
  payload: unknown;
}

const ANA = { id: "user-ana", name: "Ana", email: "ana@x.test", role: "admin" };

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        versions: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "translated",
        localized: true,
        status: true,
        versions: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await current.adapter.insert("api_keys", {
    id: "key-ci",
    name: "CI key",
    keyHash: "a".repeat(64),
    keyPrefix: "nx_test",
    tokenType: "full-access",
    userId: ANA.id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const handler = current.getService("collectionsHandler");
  /** This document's events, oldest first, by their time-ordered ids. */
  const eventsOf = async (id: string) =>
    (await current!.adapter.select<EventRow>("nextly_content_events"))
      .filter(row => row.subjectId === id)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  const partsOf = async (eventId: string) =>
    (
      await current!.adapter.select<{ eventId: string; part: string }>(
        "nextly_content_event_parts"
      )
    )
      .filter(row => row.eventId === eventId)
      .map(row => row.part)
      .sort();
  return { handler, eventsOf, partsOf };
}

describe.each(getConfiguredTestDialects())(
  "a collection document's history events (integration, %s)",
  dialect => {
    it("records creation, a save, a publish, an unpublish and deletion, each by the person who made it", async () => {
      const t = await boot(dialect);
      const as = { overrideAccess: true, user: ANA };
      const created = await t.handler.createEntry(
        { collectionName: "posts", ...as },
        { title: "a", status: "draft" }
      );
      const id = (created.data as { id: string }).id;
      await t.handler.updateEntry(
        { collectionName: "posts", entryId: id, ...as },
        { title: "b" }
      );
      await t.handler.updateEntry(
        { collectionName: "posts", entryId: id, ...as },
        { status: "published" }
      );
      await t.handler.updateEntry(
        { collectionName: "posts", entryId: id, ...as },
        { status: "draft" }
      );
      await t.handler.deleteEntry({
        collectionName: "posts",
        entryId: id,
        ...as,
      });

      const events = await t.eventsOf(id);
      expect(
        events.map(e => ({
          kind: e.kind,
          from: e.fromState,
          to: e.toState,
        }))
      ).toEqual([
        { kind: "created", from: null, to: "draft" },
        { kind: "saved", from: null, to: "draft" },
        // The publish saves a version too, then is the publish.
        { kind: "saved", from: null, to: "published" },
        { kind: "published", from: "draft", to: "published" },
        { kind: "saved", from: null, to: "draft" },
        { kind: "unpublished", from: "published", to: "draft" },
        { kind: "deleted", from: null, to: null },
      ]);
      for (const event of events) {
        expect(event).toMatchObject({
          actorKind: "person",
          actorId: ANA.id,
          actorName: "Ana",
        });
      }
      // Each save names the version it recorded; the creation its first.
      const saves = events.filter(e => e.kind === "saved");
      expect(saves.every(e => typeof e.versionNo === "number")).toBe(true);
      expect(events[0]?.versionNo).toBe(1);
    }, 120_000);

    it("records no save for a save that changed nothing", async () => {
      const t = await boot(dialect);
      const as = { overrideAccess: true, user: ANA };
      const created = await t.handler.createEntry(
        { collectionName: "posts", ...as },
        { title: "a", status: "draft" }
      );
      const id = (created.data as { id: string }).id;
      await t.handler.updateEntry(
        { collectionName: "posts", entryId: id, ...as },
        { title: "a" }
      );

      expect((await t.eventsOf(id)).map(e => e.kind)).toEqual(["created"]);
    }, 120_000);

    it("names an API key by its own name, and the system by none", async () => {
      const t = await boot(dialect);
      const byKey = await t.handler.createEntry(
        {
          collectionName: "posts",
          overrideAccess: true,
          actor: { type: "apiKey", id: "key-ci" },
        },
        { title: "by key", status: "draft" }
      );
      const bySystem = await t.handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "by system", status: "draft" }
      );

      const [keyEvent] = await t.eventsOf((byKey.data as { id: string }).id);
      expect(keyEvent).toMatchObject({
        kind: "created",
        actorKind: "apiKey",
        actorId: "key-ci",
        // The key's own name, not its owner's.
        actorName: "CI key",
      });
      const [systemEvent] = await t.eventsOf(
        (bySystem.data as { id: string }).id
      );
      expect(systemEvent).toMatchObject({
        kind: "created",
        actorKind: "system",
        actorId: null,
        actorName: null,
      });
    }, 120_000);

    it("records publishing every language as one event naming the languages it moved", async () => {
      const t = await boot(dialect);
      const as = { overrideAccess: true, user: ANA };
      const created = await t.handler.createEntry(
        { collectionName: "translated", locale: "en", ...as },
        { title: "hello" }
      );
      const id = (created.data as { id: string }).id;
      await t.handler.updateEntry(
        { collectionName: "translated", entryId: id, locale: "es", ...as },
        { title: "hola" }
      );
      const published = await t.handler.publishAllLocales({
        collectionName: "translated",
        entryId: id,
        ...as,
      });
      expect(published.success).toBe(true);

      const publishes = (await t.eventsOf(id)).filter(
        e => e.kind === "published"
      );
      expect(publishes).toHaveLength(1);
      expect(await t.partsOf(publishes[0]!.id)).toEqual(["en", "es"]);
      expect(publishes[0]).toMatchObject({ toState: "published" });
    }, 120_000);

    it("refuses a save while the record's table is missing, saving nothing", async () => {
      const t = await boot(dialect);
      const as = { overrideAccess: true, user: ANA };
      const created = await t.handler.createEntry(
        { collectionName: "posts", ...as },
        { title: "kept", status: "draft" }
      );
      const id = (created.data as { id: string }).id;
      // An install that has not migrated since the record arrived.
      await current!.adapter.executeQuery("DROP TABLE nextly_content_events");

      let refusal: unknown;
      const result = await t.handler
        .updateEntry(
          { collectionName: "posts", entryId: id, ...as },
          { title: "lost" }
        )
        .catch(error => {
          refusal = error;
          return undefined;
        });

      // Told what to do, whichever way the service reports a failed write.
      const said =
        refusal instanceof Error
          ? (refusal as { publicMessage?: string }).publicMessage
          : (result as { message?: string } | undefined)?.message;
      expect(said).toBe(
        "The database needs updating before content can be saved. Run `nextly migrate`."
      );
      // The change rolled back with its event.
      const read = await t.handler.getEntry({
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
      });
      expect((read.data as { title?: string }).title).toBe("kept");
    }, 120_000);
  }
);
