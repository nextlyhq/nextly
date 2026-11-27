/**
 * What a restore puts back beside the entry's own row, and what the trash
 * keeps out of sight.
 *
 * - Its field-group rows come back. A hidden field-group value is kept out
 *   of the trash's copy of the document, so the restore's webhook delivery
 *   never carries it. The deleted event is delivered at the delete, and the
 *   created event, marked as a restore, at the restore.
 * - Its pending edits (a working draft) and recovery points come back.
 * - A slug taken since is asked for again, whether or not its field says
 *   `unique`: the slug column is unique either way.
 * - A relation of its own whose target was deleted since comes back empty,
 *   and the restore says so, rather than failing on the target.
 * - Other entries' relations to it come back where they still hold nothing,
 *   never over a later edit.
 * - A title, or a taken value, of a field with its own read rule is never
 *   shown in the list or in a conflict.
 *
 * @module domains/trash/__tests__/trash-references.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { TRASH_TABLE, type TrashedEntry } from "../../../schemas/trash";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { runWebhookDrain } from "../../webhooks/drain-runner";
import type { WebhookEndpointRegistry } from "../../webhooks/endpoint-registry";
import {
  refreshEndpointPresence,
  resetWebhookActivation,
} from "../../webhooks/recording-activation";
import type { WebhookEvent } from "../../webhooks/types";

perLanguageStorageSuite();

const TAGS = "trashref_tags";
const PAGES = "trashref_pages";
const NOTES = "trashref_notes";
const PRIVATE = "trashref_private";
const META = "trashref_meta";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetWebhookActivation();
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: META,
        fields: [
          text({ name: "note" }),
          text({ name: "token", admin: { hidden: true } }),
        ],
      }),
    ],
    collections: [
      defineCollection({ slug: TAGS, fields: [text({ name: "title" })] }),
      defineCollection({
        slug: PAGES,
        fields: [
          text({ name: "title" }),
          // A slug that does not say `unique`, kept on the entry's own row:
          // its column there is unique anyway.
          text({ name: "slug", localized: false }),
          fieldGroup({ name: "meta", component: META }),
          relationship({ name: "tag", relationTo: TAGS }),
        ],
      }),
      defineCollection({
        slug: NOTES,
        fields: [
          text({ name: "title" }),
          relationship({ name: "page", relationTo: PAGES }),
        ],
      }),
      defineCollection({
        slug: PRIVATE,
        fields: [
          text({ name: "title", access: { read: () => false } }),
          text({
            name: "slug",
            localized: false,
            access: { read: () => false },
          }),
        ],
      }),
    ],
  });
  return current;
}

async function make(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const made = await t.nextly.create({ collection, data });
  return String(made.item.id);
}

async function read(
  t: TestNextly,
  collection: string,
  id: string
): Promise<Record<string, unknown>> {
  return (await t.nextly.findByID({
    collection,
    id,
    depth: 0,
  })) as unknown as Record<string, unknown>;
}

/** The trash record of `id`, its stored rows parsed. */
async function trashed(t: TestNextly, id: string) {
  const [row] = await t.adapter.select<{
    label: string | null;
    stored: TrashedEntry | string;
  }>(TRASH_TABLE, {
    where: { and: [{ column: "itemId", op: "=", value: id }] },
  });
  return {
    label: row.label,
    stored: (typeof row.stored === "string"
      ? JSON.parse(row.stored)
      : row.stored) as TrashedEntry,
  };
}

/** An enabled endpoint taking every entry event, its secret kept as given. */
async function endpoint(t: TestNextly): Promise<void> {
  const now = new Date();
  await t.adapter.insert("nextly_webhooks", {
    id: "trashref-hook",
    name: "trashref-hook",
    url: "https://example.com/trashref",
    enabled: true,
    event_types: ["entry.created", "entry.deleted"],
    filter: null,
    headers: null,
    secret_hash: [`whsec_${Buffer.from("trashref").toString("base64")}`],
    secret_prefix: "whsec_",
    field_allowlist: null,
    created_by: null,
    created_at: now,
    updated_at: now,
  });
  (
    t.getService("webhookEndpointRegistry" as never) as WebhookEndpointRegistry
  ).invalidate();
  await refreshEndpointPresence();
}

/** Every event the endpoint is sent by a drain, as delivered. */
async function delivered(t: TestNextly): Promise<WebhookEvent[]> {
  const bodies: WebhookEvent[] = [];
  await runWebhookDrain(
    t.adapter as never,
    t.getService("webhookEndpointRegistry" as never) as WebhookEndpointRegistry,
    {
      transport: async (_url, options) => {
        bodies.push(JSON.parse(options.body) as WebhookEvent);
        return new Response("ok", { status: 200 });
      },
      decryptSecret: ciphertext => ciphertext,
      // A moment ahead: MySQL keeps a delivery's due time to the second,
      // rounding it up, so a delivery made this second is due by the next.
      now: () => new Date(Date.now() + 2000),
    }
  );
  return bodies;
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  it("puts its field-group rows back, and never delivers a hidden field-group value", async () => {
    const t = await boot(dialect);
    await endpoint(t);
    const id = await make(t, PAGES, {
      title: "Grouped",
      slug: "grouped",
      meta: { note: "kept", token: "s3cret-token" },
    });
    await delivered(t);

    await t.nextly.delete({ collection: PAGES, id });
    const { stored } = await trashed(t, id);
    expect(JSON.stringify(stored.document)).not.toContain("s3cret-token");
    const atDelete = await delivered(t);
    expect(
      atDelete.filter(e => e.type === "entry.deleted" && e.resource.id === id)
    ).toHaveLength(1);

    await t.nextly.trash.restore({ id });

    expect(await read(t, PAGES, id)).toMatchObject({
      meta: expect.objectContaining({ note: "kept" }),
    });
    const atRestore = (await delivered(t)).filter(
      e => e.type === "entry.created" && e.resource.id === id
    );
    expect(atRestore).toHaveLength(1);
    expect(atRestore[0].restoredFrom).toBe("trash");
    expect(JSON.stringify(atRestore[0])).not.toContain("s3cret-token");
  });

  it("puts back its pending edits and recovery points", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Live", slug: "live" });
    const version = (isAutosave: boolean, body: string) => ({
      id: randomUUID(),
      scopeKind: "collection",
      scopeSlug: PAGES,
      entryId: id,
      versionNo: null,
      status: "draft",
      isAutosave,
      snapshot: JSON.stringify({ title: body }),
      label: null,
      locale: null,
      sourceVersionNo: null,
      createdBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await t.adapter.insert(VERSIONS_TABLE, version(false, "pending edit"));
    await t.adapter.insert(VERSIONS_TABLE, version(true, "recovery point"));
    const kept = async () =>
      (
        await t.adapter.select<{ snapshot: unknown }>(VERSIONS_TABLE, {
          where: {
            and: [
              { column: "entryId", op: "=", value: id },
              { column: "versionNo", op: "IS NULL" },
            ],
          },
        })
      )
        .map(row => JSON.stringify(row.snapshot))
        .join(" ");

    await t.nextly.delete({ collection: PAGES, id });
    expect(await kept()).toBe("");

    await t.nextly.trash.restore({ id });

    expect(await kept()).toContain("pending edit");
    expect(await kept()).toContain("recovery point");
  });

  it("asks again for a slug taken since, though its field does not say unique", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "First", slug: "same" });
    await t.nextly.delete({ collection: PAGES, id });
    await make(t, PAGES, { title: "Second", slug: "same" });

    expect(await t.nextly.trash.restore({ id })).toEqual({
      restored: false,
      conflicts: [{ field: "slug", value: "same" }],
    });
  });

  it("puts a relation back empty where its target was deleted since, and says so", async () => {
    const t = await boot(dialect);
    const tag = await make(t, TAGS, { title: "Gone" });
    const id = await make(t, PAGES, { title: "Tagged", slug: "tagged", tag });
    await t.nextly.delete({ collection: PAGES, id });
    await t.nextly.delete({ collection: TAGS, id: tag });
    await t.nextly.trash.empty({ collection: TAGS });

    const result = await t.nextly.trash.restore({ id });

    expect(result).toMatchObject({
      restored: true,
      notPutBack: { links: 0, relationsCleared: ["tag"] },
    });
    expect((await read(t, PAGES, id)).tag ?? null).toBeNull();
  });

  it("puts back other entries' relations to it where they still hold nothing, never over a later edit", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Target", slug: "target" });
    const other = await make(t, PAGES, { title: "Other", slug: "other" });
    const cleared = await make(t, NOTES, { title: "Cleared", page: id });
    const edited = await make(t, NOTES, { title: "Edited", page: id });

    await t.nextly.delete({ collection: PAGES, id });
    // What a foreign key set to `set null` leaves, and a person's later
    // choice of another page.
    await t.adapter.update(
      `dc_${NOTES}`,
      { page: null },
      { and: [{ column: "id", op: "=", value: cleared }] }
    );
    await t.nextly.update({
      collection: NOTES,
      id: edited,
      data: { page: other, _overwrite: true },
    } as never);

    await t.nextly.trash.restore({ id });

    expect((await read(t, NOTES, cleared)).page).toBe(id);
    expect((await read(t, NOTES, edited)).page).toBe(other);
  });

  it("never shows a title or a taken value behind a field read rule", async () => {
    const t = await boot(dialect);
    const id = await make(t, PRIVATE, { title: "Secret title", slug: "hid" });
    await t.nextly.delete({ collection: PRIVATE, id });
    await make(t, PRIVATE, { title: "Another", slug: "hid" });

    expect((await trashed(t, id)).label).toBeNull();
    const listed = await t.nextly.trash.list({ collection: PRIVATE });
    expect(JSON.stringify(listed.items)).not.toContain("Secret title");
    expect(await t.nextly.trash.restore({ id })).toEqual({
      restored: false,
      conflicts: [{ field: "slug" }],
    });
  });
});
