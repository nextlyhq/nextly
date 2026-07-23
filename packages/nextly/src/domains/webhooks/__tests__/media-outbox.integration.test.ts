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

import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { MediaService } from "../../../services/media";
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
});
