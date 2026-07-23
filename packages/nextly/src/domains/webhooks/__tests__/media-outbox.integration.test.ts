/**
 * Outbox capture on media writes.
 *
 * Proves the media mutation seam appends `nextly_events` rows: `media.uploaded`
 * on upload, `media.updated` on a metadata edit, `media.deleted` on delete —
 * each recorded inside the write transaction, carrying the flat media row and
 * the acting identity, with `resource.kind === "media"`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Storage + image processing are stubbed so the DB write path (and its outbox
// event) runs without a real backend. Mirrors services/__tests__/media.test.ts.
vi.mock("@nextly/storage", () => ({
  getMediaStorage: vi.fn(() => ({
    upload: vi.fn().mockResolvedValue({
      url: "https://test.local/cat.jpg",
      path: "cat.jpg",
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    getPublicUrl: vi.fn((p: string) => `https://test.local/${p}`),
    getStorageType: vi.fn().mockReturnValue("local"),
  })),
  getImageProcessor: vi.fn(() => ({
    isValidImage: vi.fn().mockResolvedValue(false),
    getDimensions: vi.fn().mockResolvedValue({ width: 0, height: 0 }),
    generateThumbnail: vi.fn().mockResolvedValue(null),
    optimizeImage: vi.fn().mockResolvedValue(null),
  })),
  withRetry: vi.fn(async (fn: () => unknown) => fn()),
  isTransientError: vi.fn(() => false),
}));

import { MediaService as UnifiedMediaService } from "../../../domains/media/services/media-service";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { MediaService } from "../../../services/media";
import type { RequestContext } from "../../../services/shared";
import type { WebhookFastDrainScheduler } from "../after-drain";
import type { WebhookEvent } from "../types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.clearAllMocks();
});

interface EventRow {
  id: string;
  type: string;
  resourceKind: string;
  resourceCollection: string | null;
  resourceId: string | null;
  payload: unknown;
  actorType: string | null;
  actorId: string | null;
}

function envelopeOf(row: EventRow): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

// Media rows (and folders) reference users via a foreign key, so a Direct-API
// write attributed to a user needs that user to exist. Seed a minimal row
// (only id + the NOT NULL unique email are required).
async function seedUser(handle: TestNextly, id: string): Promise<void> {
  await handle.adapter.insert("users", { id, email: `${id}@test.local` });
}

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function service(handle: TestNextly): MediaService {
  return new MediaService(handle.adapter, noopLogger as never);
}

describe("webhook outbox capture — media (integration)", () => {
  beforeEach(async () => {
    current = await createTestNextly({});
  });

  it("records media.uploaded on upload", async () => {
    const media = service(current!);
    const result = await media.uploadMedia(
      {
        file: Buffer.from("not-really-an-image"),
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 19,
        uploadedBy: null,
      },
      { type: "user", id: "user-1" }
    );

    const rows = (await events(current!)).filter(
      r => r.type === "media.uploaded"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceKind).toBe("media");
    expect(rows[0].resourceCollection).toBeNull();
    expect(rows[0].resourceId).toBe(result.data!.id);
    expect(rows[0].actorType).toBe("user");
    expect(rows[0].actorId).toBe("user-1");
    const env = envelopeOf(rows[0]);
    expect((env.data as { filename?: string }).filename).toBeTruthy();
    expect(env.previous).toBeNull();
  });

  it("records media.updated with the prior state on a metadata edit", async () => {
    const media = service(current!);
    const uploaded = await media.uploadMedia(
      {
        file: Buffer.from("x"),
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 1,
        uploadedBy: null,
      },
      { type: "user", id: "user-1" }
    );
    const id = uploaded.data!.id;

    await media.updateMedia(
      id,
      { altText: "A cat" },
      { type: "apiKey", id: "key-9" }
    );

    const row = (await events(current!)).find(r => r.type === "media.updated");
    expect(row).toBeDefined();
    expect(row!.resourceId).toBe(id);
    expect(row!.actorType).toBe("apiKey");
    expect(row!.actorId).toBe("key-9");
    const env = envelopeOf(row!);
    expect((env.data as { altText?: string }).altText).toBe("A cat");
    expect(env.previous).not.toBeNull();
  });

  it("records media.deleted and removes the row", async () => {
    const media = service(current!);
    const uploaded = await media.uploadMedia(
      {
        file: Buffer.from("x"),
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 1,
        uploadedBy: null,
      },
      { type: "user", id: "user-1" }
    );
    const id = uploaded.data!.id;

    await media.deleteMedia(id, { type: "user", id: "user-1" });

    const rows = await events(current!);
    const deleted = rows.find(r => r.type === "media.deleted");
    expect(deleted).toBeDefined();
    expect(deleted!.resourceId).toBe(id);
    expect(envelopeOf(deleted!).previous).toBeNull();

    const remaining = await current!.adapter.select<{ id: string }>("media");
    expect(remaining.find(m => m.id === id)).toBeUndefined();
  });

  it("records exactly one media.deleted when two deletes race the same row", async () => {
    // Two callers read the row (both see it present), then serialize on the
    // write. The first delete removes the row; the second finds zero rows
    // affected inside its transaction and must skip the event and report
    // not-found, so the outbox never carries a duplicate media.deleted.
    const media = service(current!);
    const uploaded = await media.uploadMedia(
      {
        file: Buffer.from("x"),
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 1,
        uploadedBy: null,
      },
      { type: "user", id: "user-1" }
    );
    const id = uploaded.data!.id;

    const [a, b] = await Promise.all([
      media.deleteMedia(id, { type: "user", id: "user-1" }),
      media.deleteMedia(id, { type: "user", id: "user-1" }),
    ]);

    // Exactly one caller wins the delete; the loser gets a 404 no-op.
    const outcomes = [a.success, b.success].sort();
    expect(outcomes).toEqual([false, true]);
    const loser = a.success ? b : a;
    expect(loser.statusCode).toBe(404);

    const deletedEvents = (await events(current!)).filter(
      r => r.type === "media.deleted"
    );
    expect(deletedEvents).toHaveLength(1);
  });

  it("does not record media.updated for an update to an already-deleted row", async () => {
    // A metadata edit whose target row is gone must not append a false
    // media.updated event; the write reports zero affected rows and returns
    // not-found instead of a successful no-op.
    const media = service(current!);
    const uploaded = await media.uploadMedia(
      {
        file: Buffer.from("x"),
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 1,
        uploadedBy: null,
      },
      { type: "user", id: "user-1" }
    );
    const id = uploaded.data!.id;

    await media.deleteMedia(id, { type: "user", id: "user-1" });
    const result = await media.updateMedia(
      id,
      { altText: "too late" },
      { type: "user", id: "user-1" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    const updatedEvents = (await events(current!)).filter(
      r => r.type === "media.updated"
    );
    expect(updatedEvents).toHaveLength(0);
  });

  it("keeps untouched metadata in the media.updated payload", async () => {
    // A Direct-API edit forwards omitted fields as `undefined`. The event row
    // must overlay only the columns actually written, so a field set earlier
    // (caption) survives a later edit that touches only altText — instead of
    // being wrongly reported as changed and dropped from `data`.
    const nextly = current!.nextly;
    await seedUser(current!, "editor-7");
    const uploaded = await nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "doc.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
      user: { id: "editor-7" },
    });

    await nextly.media.update({
      id: uploaded.id,
      data: { caption: "keep-me", altText: "first" },
      user: { id: "editor-7" },
    });
    await nextly.media.update({
      id: uploaded.id,
      data: { altText: "second" },
      user: { id: "editor-7" },
    });

    const latest = (await events(current!))
      .filter(r => r.type === "media.updated")
      .map(envelopeOf)
      .find(e => (e.data as { altText?: string }).altText === "second");
    expect(latest).toBeDefined();
    expect((latest!.data as { caption?: string }).caption).toBe("keep-me");
  });

  it("attributes a Direct-API media edit to the request user", async () => {
    // nextly.media.update carries the user via the request context but no
    // transport actor; without the actor fallback the event would record as
    // `system` instead of the acting user.
    const nextly = current!.nextly;
    await seedUser(current!, "editor-7");
    const uploaded = await nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "doc.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
      user: { id: "editor-7" },
    });

    await nextly.media.update({
      id: uploaded.id,
      data: { altText: "Edited" },
      user: { id: "editor-7" },
    });

    const updated = (await events(current!)).find(
      r => r.type === "media.updated"
    );
    expect(updated).toBeDefined();
    expect(updated!.actorType).toBe("user");
    expect(updated!.actorId).toBe("editor-7");
  });

  it("records media.updated when a media item is moved to a folder", async () => {
    // A folder move is a folder_id change; it must be captured as a
    // media.updated event (a bare folder write recorded nothing) so subscribers
    // see the move.
    await seedUser(current!, "editor-7");
    const nextly = current!.nextly;
    const folder = await nextly.media.folders.create({
      name: "Archive",
      user: { id: "editor-7" },
    });
    const uploaded = await nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "doc.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
      user: { id: "editor-7" },
    });

    const mediaService =
      current!.getService<UnifiedMediaService>("mediaService");
    const context: RequestContext = { user: { id: "editor-7" } };
    await mediaService.moveToFolder(uploaded.id, folder.id, context);

    const moved = (await events(current!)).find(
      r => r.type === "media.updated" && r.resourceId === uploaded.id
    );
    expect(moved).toBeDefined();
    expect((envelopeOf(moved!).data as { folderId?: string }).folderId).toBe(
      folder.id
    );
    expect(moved!.actorType).toBe("user");
    expect(moved!.actorId).toBe("editor-7");
  });

  it("offers the fast-drain from the legacy service when given a scheduler", async () => {
    // The exported server actions reach the legacy service directly (via
    // ServiceContainer), so a legacy service constructed WITH the scheduler must
    // offer the drain after a write — otherwise action-driven media events would
    // sit until the scheduled drain.
    const scheduler = current!.getService<WebhookFastDrainScheduler>(
      "webhookFastDrainScheduler"
    );
    const offerSpy = vi.spyOn(scheduler, "offer");
    const legacy = new MediaService(
      current!.adapter,
      noopLogger as never,
      scheduler
    );

    await legacy.uploadMedia(
      {
        file: Buffer.from("x"),
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 1,
        uploadedBy: null,
      },
      { type: "user", id: "user-1" }
    );

    expect(offerSpy).toHaveBeenCalled();
  });

  it("offers the webhook fast-drain after a media write", async () => {
    // A media write commits its outbox row inside the DB transaction; the
    // domain service must then offer the shared fast-drain so the event is
    // delivered promptly instead of waiting for the scheduled drain.
    await seedUser(current!, "editor-7");
    const scheduler = current!.getService<{ offer: () => void }>(
      "webhookFastDrainScheduler"
    );
    const offerSpy = vi.spyOn(scheduler, "offer");

    await current!.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "doc.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
      user: { id: "editor-7" },
    });

    expect(offerSpy).toHaveBeenCalled();
  });

  it("records the final folder on the media.uploaded event", async () => {
    // A Direct-API upload into a folder must record the folder on the initial
    // insert so the event reflects the final location, rather than recording
    // folderId:null and moving the row afterward (which fired the event with
    // the wrong folder and no move event).
    const nextly = current!.nextly;
    await seedUser(current!, "editor-7");
    const folder = await nextly.media.folders.create({
      name: "Reports",
      user: { id: "editor-7" },
    });

    const uploaded = await nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "doc.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
      folder: folder.id,
      user: { id: "editor-7" },
    });

    const uploadedEvent = (await events(current!)).find(
      r => r.type === "media.uploaded" && r.resourceId === uploaded.id
    );
    expect(uploadedEvent).toBeDefined();
    expect(
      (envelopeOf(uploadedEvent!).data as { folderId?: string }).folderId
    ).toBe(folder.id);
  });
});
