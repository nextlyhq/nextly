/**
 * An uploaded file's record carries the SHA-256 of the bytes storage holds,
 * and a Replace gives the record the new file's.
 *
 * The fingerprint is compared with a hash of the bytes READ BACK from the
 * storage, never with one of the bytes the test sent: an SVG is sanitized
 * before it is stored, so its stored bytes differ from the upload's, and a
 * hash taken before sanitizing would describe a file the storage never held.
 * Each case runs on the real local-disk adapter and on the stand-in that
 * keys and addresses files exactly as the S3 adapter does, on every dialect
 * the process is configured for, since the value is a column read back from
 * the database.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { MediaService } from "../../../../services/media";
import { pdfDocument } from "../../../../services/upload-validation/__tests__/format-fixtures";
import { LocalStorageAdapter } from "../../../../storage/adapters/local-adapter";
import { Bucket } from "../../../../storage/__tests__/stand-in-bucket";
import { getMediaStorage } from "../../../../storage/storage";
import type { IStorageAdapter } from "../../../../storage/types";
import type { WebhookEvent } from "../../../webhooks/types";
import { replaceMediaFile } from "../../replace-media-file";
import { contentHashOf } from "../content-hash";

const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
    "<script>alert(1)</script>" +
    '<rect width="10" height="10" fill="#47a"/></svg>'
);

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** A small PNG, different on every call, so two uploads never share a hash. */
function png(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: Math.floor(Math.random() * 256), g: 7, b: 9 },
    },
  })
    .png()
    .toBuffer();
}

/** Routes the media collection's files to `adapter`. */
function storeMediaIn(adapter: IStorageAdapter, type: "local" | "s3"): void {
  getMediaStorage().registerPlugin({
    name: `hash-test-${type}-${randomUUID()}`,
    type,
    collections: { media: true },
    adapter,
  });
}

/** The media row as stored, straight from the table. */
async function storedRow(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown>> {
  const [row] = (await t.adapter.select("media", {
    where: { and: [{ column: "id", op: "=", value: id }] },
  })) as Array<Record<string, unknown>>;
  if (!row) throw new Error(`no media row ${id}`);
  return row;
}

/** The hash of what storage holds at the row's file, read back from it. */
async function hashOfStored(
  adapter: IStorageAdapter,
  row: Record<string, unknown>
): Promise<string> {
  const bytes = await adapter.read!(String(row.filename));
  if (!bytes) throw new Error(`storage holds nothing at ${row.filename}`);
  return contentHashOf(bytes);
}

describe.each(getConfiguredTestDialects())(
  "an uploaded file's fingerprint (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let uploads: string | undefined;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    afterEach(async () => {
      if (uploads) await rm(uploads, { recursive: true, force: true });
      uploads = undefined;
    });

    /** The storage each case runs on, registered for media. */
    async function storage(kind: "local" | "s3"): Promise<IStorageAdapter> {
      if (kind === "s3") {
        const bucket = new Bucket("s3");
        storeMediaIn(bucket, "s3");
        return bucket;
      }
      uploads = await mkdtemp(path.join(tmpdir(), "nextly-media-hash-"));
      const local = new LocalStorageAdapter({
        basePath: uploads,
        baseUrl: "/uploads",
      });
      storeMediaIn(local, "local");
      return local;
    }

    async function upload(
      data: Buffer,
      name: string,
      mimetype: string
    ): Promise<string> {
      const item = await t.nextly.media.upload({
        file: { data, name, mimetype, size: data.length },
      });
      return item.id;
    }

    it.each(["local", "s3"] as const)(
      "records the SHA-256 of an uploaded image's stored bytes (%s)",
      async kind => {
        const adapter = await storage(kind);
        const image = await png();

        const id = await upload(image, "dot.png", "image/png");

        const row = await storedRow(t, id);
        expect(row.sha256).toBe(await hashOfStored(adapter, row));
        // A PNG is stored as sent, so this is also the upload's own hash.
        expect(row.sha256).toBe(contentHashOf(image));
      }
    );

    it.each(["local", "s3"] as const)(
      "records the hash of a sanitized SVG as stored, not as sent (%s)",
      async kind => {
        const adapter = await storage(kind);

        const id = await upload(SVG_WITH_SCRIPT, "icon.svg", "image/svg+xml");

        const row = await storedRow(t, id);
        // The control: sanitizing changed the bytes, so the two hashes differ
        // and only one of them describes the stored file.
        expect(await hashOfStored(adapter, row)).not.toBe(
          contentHashOf(SVG_WITH_SCRIPT)
        );
        expect(row.sha256).toBe(await hashOfStored(adapter, row));
      }
    );

    it.each(["local", "s3"] as const)(
      "gives a replaced item the new file's hash (%s)",
      async kind => {
        const adapter = await storage(kind);
        const id = await upload(await png(), "dot.png", "image/png");
        const before = (await storedRow(t, id)).sha256;
        const next = pdfDocument(randomUUID());

        await replaceMediaFile(
          {
            adapter: t.adapter,
            storage: getMediaStorage(),
            images: {
              isValidImage: async () => "valid",
              getDimensions: async () => null,
              generateThumbnail: async () => null,
            },
            logger: silent,
            addressHolders: async () => 0,
          },
          id,
          { buffer: next, filename: "guide.pdf", mimeType: "application/pdf" }
        );

        const row = await storedRow(t, id);
        expect(row.sha256).not.toBe(before);
        expect(row.sha256).toBe(contentHashOf(next));
        expect(row.sha256).toBe(await hashOfStored(adapter, row));
      }
    );

    it("sends the hash in the media.uploaded event", async () => {
      await storage("local");
      const bytes = pdfDocument(randomUUID());

      const result = await new MediaService(
        t.adapter,
        silent as never
      ).uploadMedia(
        {
          file: bytes,
          filename: "doc.pdf",
          mimeType: "application/pdf",
          size: bytes.length,
          uploadedBy: null,
        },
        { type: "user", id: "user-1" }
      );

      const rows = await t.adapter.select<{
        type: string;
        resourceId: string | null;
        payload: unknown;
      }>("nextly_events");
      const event = rows.find(
        row =>
          row.type === "media.uploaded" && row.resourceId === result.data!.id
      );
      expect(event, "the upload recorded its event").toBeDefined();
      const envelope = (
        typeof event!.payload === "string"
          ? JSON.parse(event!.payload)
          : event!.payload
      ) as WebhookEvent;
      expect((envelope.data as { sha256?: string }).sha256).toBe(
        contentHashOf(bytes)
      );
    });
  }
);
