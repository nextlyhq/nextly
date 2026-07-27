/**
 * Webhook capture state-space matrix for collection entries.
 *
 * The per-behaviour capture rules are proven in the focused suites
 * (`outbox-capture`, `outbox-capture-localized`, `status-events`,
 * `singles-outbox`, `media-outbox`). This file is the consolidated grid: one
 * table-driven pass over (locale × write path → expected events) so any single
 * cell regressing fails loudly and visibly, and it closes the thin cells the
 * focused suites left — entry publish / unpublish / status_changed on a
 * NON-DEFAULT locale, which only singles previously exercised.
 *
 * Recording is endpoint-gated in production; the test harness defaults the gate
 * open (`webhookAuditEnabled: true`), so no endpoint registration is needed.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
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

const COLLECTION = "posts";

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        localized: true,
        status: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/** Create the `_locales` companion through the production DDL path. */
async function migrate(t: TestNextly): Promise<void> {
  const spec = deriveCompanionSpec({
    slug: COLLECTION,
    fields: [{ name: "title", type: "text", localized: true }],
    dialect: t.adapter.dialect,
    defaultLocale: "en",
    collectionLocalized: true,
    status: true,
  });
  if (!spec) {
    throw NextlyError.internal({
      logContext: { reason: "missing-companion-spec", collection: COLLECTION },
    });
  }
  if (await t.adapter.tableExists(spec.companionTable)) return;
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(buildCompanionCreateOnlySql(spec));
}

function handlerOf(t: TestNextly): CollectionsHandler {
  return t.getService<CollectionsHandler>("collectionsHandler");
}

type Op =
  | { op: "create"; data: Record<string, unknown> }
  | { op: "update"; data: Record<string, unknown> }
  | { op: "delete" };

interface Cell {
  label: string;
  locale: "en" | "de";
  ops: Op[];
  /** Event types that MUST be captured. */
  present: string[];
  /** Subset of `present` that must carry `resource.locale === locale`. */
  localeChecked?: string[];
  /** Event types that must NOT be captured. */
  absent?: string[];
}

const CELLS: Cell[] = [
  {
    label: "default locale / create (draft)",
    locale: "en",
    ops: [{ op: "create", data: { title: "a", status: "draft" } }],
    present: ["entry.created"],
    absent: ["entry.published", "entry.status_changed"],
  },
  {
    label: "default locale / create-as-published",
    locale: "en",
    ops: [{ op: "create", data: { title: "a", status: "published" } }],
    present: ["entry.created", "entry.published"],
    // A first publish is a transition from nothing, not a status_changed.
    absent: ["entry.status_changed"],
  },
  {
    label: "default locale / update (content)",
    locale: "en",
    ops: [
      { op: "create", data: { title: "a", status: "draft" } },
      { op: "update", data: { title: "b" } },
    ],
    present: ["entry.updated"],
  },
  {
    label: "default locale / publish",
    locale: "en",
    ops: [
      { op: "create", data: { title: "a", status: "draft" } },
      { op: "update", data: { status: "published" } },
    ],
    present: ["entry.published", "entry.status_changed"],
  },
  {
    label: "default locale / unpublish",
    locale: "en",
    ops: [
      { op: "create", data: { title: "a", status: "published" } },
      { op: "update", data: { status: "draft" } },
    ],
    present: ["entry.unpublished", "entry.status_changed"],
  },
  {
    label: "default locale / delete",
    locale: "en",
    ops: [
      { op: "create", data: { title: "a", status: "draft" } },
      { op: "delete" },
    ],
    present: ["entry.deleted"],
  },
  {
    label: "non-default locale / create (draft)",
    locale: "de",
    ops: [{ op: "create", data: { title: "a", status: "draft" } }],
    present: ["entry.created"],
    localeChecked: ["entry.created"],
  },
  {
    label: "non-default locale / update (content)",
    locale: "de",
    ops: [
      { op: "create", data: { title: "a", status: "draft" } },
      { op: "update", data: { title: "b" } },
    ],
    present: ["entry.updated"],
    localeChecked: ["entry.updated"],
  },
  {
    label: "non-default locale / publish",
    locale: "de",
    ops: [
      { op: "create", data: { title: "a", status: "draft" } },
      { op: "update", data: { status: "published" } },
    ],
    present: ["entry.published", "entry.status_changed"],
    localeChecked: ["entry.published"],
  },
  {
    label: "non-default locale / unpublish",
    locale: "de",
    ops: [
      { op: "create", data: { title: "a", status: "published" } },
      { op: "update", data: { status: "draft" } },
    ],
    present: ["entry.unpublished", "entry.status_changed"],
    localeChecked: ["entry.unpublished"],
  },
];

describe("webhook capture matrix — collection entries (integration)", () => {
  it.each(CELLS)("$label", async cell => {
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);

    let entryId: string | undefined;
    for (const op of cell.ops) {
      if (op.op === "create") {
        const created = await h.createEntry(
          {
            collectionName: COLLECTION,
            locale: cell.locale,
            overrideAccess: true,
          },
          op.data
        );
        entryId = (created.data as { id: string }).id;
      } else if (op.op === "update") {
        await h.updateEntry(
          {
            collectionName: COLLECTION,
            entryId: entryId!,
            locale: cell.locale,
            overrideAccess: true,
          },
          op.data
        );
      } else {
        await h.deleteEntry({
          collectionName: COLLECTION,
          entryId: entryId!,
          overrideAccess: true,
        });
      }
    }

    const rows = await t.adapter.select<EventRow>("nextly_events");
    const byType = (type: string) => rows.filter(r => r.type === type);

    for (const type of cell.present) {
      const matches = byType(type);
      expect(matches.length, `${cell.label}: expected ${type}`).toBeGreaterThan(
        0
      );
      if (cell.localeChecked?.includes(type)) {
        const hasLocale = matches.some(
          r => envelopeOf(r).resource.locale === cell.locale
        );
        expect(
          hasLocale,
          `${cell.label}: ${type} should carry resource.locale=${cell.locale}`
        ).toBe(true);
      }
    }

    for (const type of cell.absent ?? []) {
      expect(byType(type).length, `${cell.label}: forbid ${type}`).toBe(0);
    }
  });

  it("records nothing for a collection with webhooks disabled", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "silent",
          status: true,
          webhooks: false,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const h = handlerOf(current);

    await h.createEntry(
      { collectionName: "silent", overrideAccess: true },
      { title: "a", status: "published" }
    );

    const rows = await current.adapter.select<EventRow>("nextly_events");
    expect(rows).toHaveLength(0);
  });
});
