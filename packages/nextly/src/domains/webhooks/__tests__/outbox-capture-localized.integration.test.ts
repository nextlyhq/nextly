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
import { NextlyError } from "../../../errors";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
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
 * Create the companion table (with per-locale `_status`) through the SAME
 * production DDL path a migration uses — derive the spec from the collection,
 * then the create-only companion statement — so the fixture cannot drift from
 * the real localized schema.
 */
async function migrate(t: TestNextly): Promise<void> {
  const spec = deriveCompanionSpec({
    slug: "pages",
    fields: [
      { name: "title", type: "text", localized: false },
      { name: "heading", type: "text", localized: true },
    ],
    dialect: t.adapter.dialect,
    defaultLocale: "en",
    collectionLocalized: true,
    status: true,
  });
  if (!spec)
    throw NextlyError.internal({
      logContext: { reason: "missing-companion-spec", collection: "pages" },
    });
  if (await t.adapter.tableExists(spec.companionTable)) return;
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(buildCompanionCreateOnlySql(spec));
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

  it("identifies which translation the event describes", async () => {
    // Without the locale, an English and a German write to the same entry
    // produce indistinguishable events carrying different values, so a receiver
    // cannot tell which translation changed.
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "Deutsch" }
    );
    const id = (created.data as { id: string }).id;
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "en",
        overrideAccess: true,
      },
      { heading: "English" }
    );

    const rows = await t.adapter.select<EventRow>("nextly_events");
    const createdEvent = rows.find(r => r.type === "entry.created");
    const updatedEvent = rows.find(r => r.type === "entry.updated");
    expect(envelopeOf(createdEvent!).resource).toMatchObject({ locale: "de" });
    expect(envelopeOf(updatedEvent!).resource).toMatchObject({ locale: "en" });
  });

  it("reports a brand-new translation as the draft it was written as", async () => {
    // Translating into a locale for the first time creates the companion row,
    // so `_status` lands on the column default. Reporting the main row's status
    // instead would tell receivers the new translation is already published.
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "English", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Content-only write into a locale that has no companion row yet.
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { heading: "Deutsch" }
    );

    const envelope = await updatedEnvelope(t);
    expect(envelope.resource).toMatchObject({ locale: "de" });
    expect(envelope.data.status).toBe("draft");
  });

  it("reports the locale's own status on a content-only translation update", async () => {
    // The German row is a draft under a published entry. A content-only German
    // edit must report German's status, not the main row's.
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "English", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Establish a German draft, then edit its content without touching status.
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { heading: "Entwurf", status: "draft" }
    );
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { heading: "Entwurf 2" }
    );

    const rows = await t.adapter.select<EventRow>("nextly_events");
    const updates = rows.filter(r => r.type === "entry.updated");
    const last = envelopeOf(updates[updates.length - 1]);
    expect(last.data.heading).toBe("Entwurf 2");
    expect(last.data.status).toBe("draft");
    // Status did not move, so it must not appear as a change.
    expect(last.changedFields).not.toContain("status");
  });

  it("indexes the version with the same status its snapshot records", async () => {
    // The version row's `status` column drives history filters. If it reports
    // the main row while the snapshot it stores says otherwise, a localized
    // draft is listed as a published version of itself.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          localized: true,
          status: true,
          versions: true,
          fields: [
            text({ name: "title", localized: false }),
            text({ name: "heading" }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const t = current;
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "English", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { heading: "Deutsch" }
    );

    const versions = await t.adapter.select<{
      status: string;
      snapshot: unknown;
    }>("nextly_versions");
    const latest = versions[versions.length - 1];
    const snapshot = (
      typeof latest.snapshot === "string"
        ? JSON.parse(latest.snapshot)
        : latest.snapshot
    ) as { status?: string };
    expect(snapshot.status).toBe("draft");
    // The indexed status must agree with the document it indexes.
    expect(latest.status).toBe(snapshot.status);
  });

  it("leaves the status alone when a shared-field update writes no locale row", async () => {
    // `title` is not translatable, so this update has no companion columns to
    // write and no locale row is created. Reporting the companion default then
    // would invent a draft the write never committed.
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "English", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Shared field only, into a locale that has no companion row.
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
    expect(envelope.data.title).toBe("T2");
    // No locale row exists, so the entry's own status stands.
    expect(envelope.data.status).toBe("published");
    expect(envelope.changedFields).not.toContain("status");
  });

  it("indexes a localized create with the status it committed", async () => {
    // The explicit status moves to the companion, so the main row keeps its
    // table default. The version must be indexed with the committed value, or
    // history lists a draft whose snapshot says published.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          localized: true,
          status: true,
          versions: true,
          fields: [
            text({ name: "title", localized: false }),
            text({ name: "heading" }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const t = current;
    await migrate(t);

    await handlerOf(t).createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "Deutsch", status: "published" }
    );

    const versions = await t.adapter.select<{
      status: string;
      snapshot: unknown;
    }>("nextly_versions");
    const latest = versions[versions.length - 1];
    const snapshot = (
      typeof latest.snapshot === "string"
        ? JSON.parse(latest.snapshot)
        : latest.snapshot
    ) as { status?: string };
    expect(snapshot.status).toBe("published");
    expect(latest.status).toBe(snapshot.status);
  });

  it("records the per-locale status a create committed, not the main-row default", async () => {
    const t = await boot();
    await migrate(t);

    // Creating in a non-default locale with an explicit status moves it to the
    // companion and strips it from the main insert, which leaves the main row
    // carrying the column default.
    await handlerOf(t).createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "H", status: "published" }
    );

    const rows = await t.adapter.select<EventRow>("nextly_events");
    const created = rows.find(r => r.type === "entry.created");
    expect(created).toBeDefined();
    expect(envelopeOf(created!).data.status).toBe("published");
  });

  it("carries the default locale's translatable values in the delete payload", async () => {
    // Translatable fields live only in the companion table, so a delete snapshot
    // built from the main row alone would omit `heading`. The event must merge
    // the default locale's companion values, matching create/update.
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "English heading" }
    );
    const id = (created.data as { id: string }).id;

    await h.deleteEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });

    const rows = await t.adapter.select<EventRow>("nextly_events");
    const deleted = rows.find(r => r.type === "entry.deleted");
    expect(deleted).toBeDefined();
    const envelope = envelopeOf(deleted!);
    expect(envelope.data.title).toBe("T");
    // The localized field, sourced from the companion rather than absent.
    expect(envelope.data.heading).toBe("English heading");
    // The payload carries the default locale's values, so the event says so —
    // otherwise a receiver cannot tell which translation it represents.
    expect(envelope.resource).toMatchObject({ locale: "en" });
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
