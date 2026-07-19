/**
 * Status lifecycle events fired by the write path.
 *
 * The `transitionStatus` seam adds a general `document.statusTransition` event
 * (for workflows) while preserving the specific `published` / `statusChanged`
 * events existing subscribers rely on. These tests pin both the new event and
 * the preserved behavior (no `statusChanged` on create-as-published).
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
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

const DOC_EVENTS = [
  "document.published",
  "document.statusChanged",
  "document.statusTransition",
] as const;

function recordEvents(handle: TestNextly): string[] {
  const seen: string[] = [];
  for (const name of DOC_EVENTS) {
    handle.events.on(name, () => seen.push(name));
  }
  return seen;
}

describe("document status-transition events (integration)", () => {
  it("create-as-published emits published + statusTransition, never statusChanged", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const seen = recordEvents(current);
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "x", status: "published" }
    );

    expect(seen).toContain("document.published");
    expect(seen).toContain("document.statusTransition");
    expect(seen).not.toContain("document.statusChanged");
  });

  it("create-as-draft emits no status events", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const seen = recordEvents(current);
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "x", status: "draft" }
    );

    expect(seen).toEqual([]);
  });

  it("update draft->published emits statusChanged + published + statusTransition", async () => {
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
      { title: "x", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    const seen = recordEvents(current);
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { status: "published" }
    );

    expect(seen).toContain("document.statusChanged");
    expect(seen).toContain("document.published");
    expect(seen).toContain("document.statusTransition");
  });

  it("per-locale draft->published emits locale-tagged status events", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const adapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown>;
    };
    // Create the companion (with per-locale `_status`) through the production
    // DDL path so the fixture matches the migrated schema.
    const spec = deriveCompanionSpec({
      slug: "pages",
      fields: [{ name: "title", type: "text", localized: true }],
      dialect: current.adapter.dialect,
      defaultLocale: "en",
      collectionLocalized: true,
      status: true,
    });
    if (!spec) throw new Error("expected a companion spec");
    await adapter.executeQuery(buildCompanionCreateOnlySql(spec));

    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "t", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    // Capture the payloads so we can assert the locale + prev/next status.
    const payloads: Record<string, Record<string, unknown>> = {};
    for (const name of DOC_EVENTS) {
      current.events.on(name, (e: unknown) => {
        payloads[name] = (e as { payload: Record<string, unknown> }).payload;
      });
    }

    // Publish only the German translation — main-row status is untouched.
    await handler.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { status: "published" }
    );

    expect(payloads["document.statusTransition"]).toMatchObject({
      locale: "de",
      previousStatus: "draft",
      status: "published",
    });
    expect(payloads["document.statusChanged"]).toMatchObject({ locale: "de" });
    expect(payloads["document.published"]).toMatchObject({ locale: "de" });
  });

  it("re-publishing an already-published locale fires no status events", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const adapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown>;
    };
    const spec = deriveCompanionSpec({
      slug: "pages",
      fields: [{ name: "title", type: "text", localized: true }],
      dialect: current.adapter.dialect,
      defaultLocale: "en",
      collectionLocalized: true,
      status: true,
    });
    if (!spec) throw new Error("expected a companion spec");
    await adapter.executeQuery(buildCompanionCreateOnlySql(spec));

    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "t", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    const seen = recordEvents(current);
    // Re-publish the same locale — no status movement.
    await handler.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { status: "published" }
    );

    expect(seen).toEqual([]);
  });
});
