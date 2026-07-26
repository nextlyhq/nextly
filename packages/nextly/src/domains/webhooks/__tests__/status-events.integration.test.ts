/**
 * End-to-end proof that collection status transitions emit the lifecycle
 * webhook events (`entry.published` / `entry.unpublished` / `entry.status_changed`)
 * into the outbox, inside the write transaction. The `nextly_events` row carries
 * the event type in `type` and the full delivery envelope (with the new
 * `statusChange`) in `payload`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  type: string;
  payload: unknown;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

/** Envelope JSON, tolerant of a driver that returns `payload` as text or object. */
function envelopeOf(row: EventRow): Record<string, unknown> {
  return typeof row.payload === "string"
    ? (JSON.parse(row.payload) as Record<string, unknown>)
    : (row.payload as Record<string, unknown>);
}

describe("collection status webhook events (integration)", () => {
  it("create-as-published emits entry.created + entry.published, no status_changed", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const res = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello", status: "published" }
    );
    expect(res.success).toBe(true);

    const rows = await events(current);
    const types = rows.map(r => r.type).sort();
    expect(types).toEqual(["entry.created", "entry.published"]);
    expect(types).not.toContain("entry.status_changed");

    const published = rows.find(r => r.type === "entry.published")!;
    expect(envelopeOf(published).statusChange).toEqual({
      from: null,
      to: "published",
    });
  });

  it("update draft->published emits entry.published + entry.status_changed", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hi", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    const upd = await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { status: "published" }
    );
    expect(upd.success).toBe(true);

    const rows = await events(current);
    const types = rows.map(r => r.type);
    expect(types).toContain("entry.published");
    expect(types).toContain("entry.status_changed");

    const pub = rows.find(r => r.type === "entry.published")!;
    expect(envelopeOf(pub).statusChange).toEqual({
      from: "draft",
      to: "published",
    });
    const changed = rows.find(r => r.type === "entry.status_changed")!;
    expect(envelopeOf(changed).statusChange).toEqual({
      from: "draft",
      to: "published",
    });
  });

  it("update published->draft emits entry.unpublished + entry.status_changed", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hi", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    const upd = await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { status: "draft" }
    );
    expect(upd.success).toBe(true);

    const rows = await events(current);
    // The unpublish transition emits unpublished + status_changed, each carrying
    // the published->draft delta (the create-as-published above also produced an
    // entry.published, with from:null — a different, earlier event).
    const unpub = rows.find(r => r.type === "entry.unpublished")!;
    expect(envelopeOf(unpub).statusChange).toEqual({
      from: "published",
      to: "draft",
    });
    const changed = rows.find(
      r =>
        r.type === "entry.status_changed" &&
        (envelopeOf(r).statusChange as { to?: string }).to === "draft"
    )!;
    expect(envelopeOf(changed).statusChange).toEqual({
      from: "published",
      to: "draft",
    });
    // No unpublish event ever carries a from:draft delta.
    expect(
      rows.some(
        r =>
          r.type === "entry.unpublished" &&
          (envelopeOf(r).statusChange as { from?: string | null }).from ===
            "draft"
      )
    ).toBe(false);
  });

  it("a default-locale status update on a localized collection emits ONE published event", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { title: "hi", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    // Publish the DEFAULT locale: its status lives on BOTH the main row and its
    // companion `_status`, so the naive wiring would emit the transition twice.
    await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "en",
      },
      { status: "published" }
    );

    const published = (await events(current)).filter(
      r => r.type === "entry.published"
    );
    expect(published).toHaveLength(1);
    expect(
      (envelopeOf(published[0]).resource as { locale?: string }).locale
    ).toBe("en");
    // And exactly one status_changed for the transition.
    const changed = (await events(current)).filter(
      r => r.type === "entry.status_changed"
    );
    expect(changed).toHaveLength(1);
  });

  it("a coerced non-string default-locale status update reports the main-row transition in changedFields", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { title: "hi", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // A non-string status is not written to the companion `_status` (only string
    // statuses are), so the DB coerces it onto the main `status` text column and
    // the transition is recorded from the main row. The event document must
    // reflect that coerced value, not the untouched companion status, or a
    // status-filtered endpoint would never match the change.
    await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "en",
      },
      { status: 0 }
    );

    const changed = (await events(current)).find(
      r => r.type === "entry.status_changed"
    )!;
    const envelope = envelopeOf(changed);
    // The coerced string the DB stores for a numeric input is dialect-specific
    // (SQLite yields "0.0"), so assert the transition against the value the DB
    // actually persisted rather than a hardcoded literal: the document status
    // must equal `statusChange.to` (the coerced main-row value), not the stale
    // companion "published", and the change must surface in changedFields.
    const coerced = (envelope.statusChange as { from: string; to: string }).to;
    expect((envelope.statusChange as { from: string }).from).toBe("published");
    expect(coerced).not.toBe("published");
    expect((envelope.data as { status?: unknown }).status).toBe(coerced);
    expect((envelope.previous as { status?: unknown }).status).toBe(
      "published"
    );
    expect(envelope.changedFields).toContain("status");
  });

  it("records the main-row transition when a default-locale write leaves the companion status unchanged", async () => {
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { title: "hi", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Drift the main row from its default companion: a non-string status coerces
    // onto the main `status` column but is never written to the companion, so the
    // companion stays "published" while the main row becomes the coerced value.
    await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "en",
      },
      { status: 0 }
    );
    const coerced = (
      envelopeOf(
        (await events(current)).find(r => r.type === "entry.status_changed")!
      ).statusChange as { to: string }
    ).to;

    // Re-publish the default locale: the main row genuinely transitions (coerced
    // -> published) but the companion rewrite is a no-op (published ->
    // published). Writing the companion must not suppress the real main-row
    // transition.
    await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "en",
      },
      { status: "published" }
    );

    const republish = (await events(current)).find(
      r =>
        r.type === "entry.published" &&
        (envelopeOf(r).statusChange as { from?: string | null }).from ===
          coerced
    );
    expect(republish).toBeDefined();
    expect(envelopeOf(republish!).statusChange).toEqual({
      from: coerced,
      to: "published",
    });
  });

  it("a webhooks:false collection emits no status events on publish", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "leads",
          status: true,
          webhooks: false,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "leads", overrideAccess: true },
      { title: "secret", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "leads", entryId: id, overrideAccess: true },
      { status: "published" }
    );
    // The 001 recording gate short-circuits every recordMutationEvent, including
    // the status events, so an opted-out collection writes nothing at all.
    expect(await events(current)).toHaveLength(0);
  });
});
