/**
 * Outbox capture on localized collection writes.
 *
 * Translatable values and the per-locale status live in the companion
 * `_locales` table, not the main row. A snapshot built from the main row alone
 * therefore misreports both: `previous` would omit every localized field that
 * `data` carries, and a per-locale publish would record the stale main-row
 * status. These suites pin both halves.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { WebhookEvent } from "../types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  type: string;
  payload: unknown;
}

function envelopeOf(row: EventRow): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

async function updatedEnvelope(handle: TestNextly): Promise<WebhookEvent> {
  const rows = await handle.adapter.select<EventRow>("nextly_events");
  const updated = rows.find(r => r.type === "entry.updated");
  expect(updated).toBeDefined();
  return envelopeOf(updated!);
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        fields: [
          text({ name: "title", localized: false }),
          text({ name: "heading" }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/**
 * Create the companion table (with per-locale `_status`). The localized column
 * is deliberately left on the main table: a fully-migrated collection hits a
 * separate, pre-existing `updateEntry` limitation that is unrelated to what
 * these tests cover.
 */
async function migrate(t: TestNextly): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "_status" text NOT NULL DEFAULT \'draft\', "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
}

function handlerOf(t: TestNextly): CollectionsHandler {
  return t.getService<CollectionsHandler>("collectionsHandler");
}

describe("webhook outbox capture, localized (integration)", () => {
  it("carries localized fields in `previous` so an untouched translation is not reported as changed", async () => {
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "German heading" }
    );
    const id = (created.data as { id: string }).id;

    // Change only the non-localized field. The German heading is untouched.
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { title: "T2" }
    );

    const envelope = await updatedEnvelope(t);
    expect(envelope.previous).not.toBeNull();
    // Sourced from the companion, not the main row, so it holds the real prior
    // translation rather than being absent.
    expect(envelope.previous?.heading).toBe("German heading");
    expect(envelope.changedFields).toContain("title");
    // The bug this pins: an absent `previous.heading` made every untouched
    // translation look changed, firing changed-field filters on the wrong writes.
    expect(envelope.changedFields).not.toContain("heading");
  });

  it("keeps the old translation in `previous` when a localized field does change", async () => {
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "before" }
    );
    const id = (created.data as { id: string }).id;

    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { heading: "after" }
    );

    const envelope = await updatedEnvelope(t);
    expect(envelope.previous?.heading).toBe("before");
    expect(envelope.data.heading).toBe("after");
    expect(envelope.changedFields).toContain("heading");
  });

  it("reports the per-locale status the write committed, not the stale main-row status", async () => {
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "H" }
    );
    const id = (created.data as { id: string }).id;

    // A non-default-locale status write moves `status` into the companion
    // `_status` and strips it from the main update payload.
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { status: "published" }
    );

    const envelope = await updatedEnvelope(t);
    expect(envelope.data.status).toBe("published");
    expect(envelope.changedFields).toContain("status");
  });
});
