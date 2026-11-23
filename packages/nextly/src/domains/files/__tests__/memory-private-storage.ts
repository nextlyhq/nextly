/**
 * A storage that keeps files private, in memory, for the file routes' tests.
 *
 * It implements the private calls as a bucket would: an upload link names
 * the key, the type and the exact length it was signed for, and
 * {@link MemoryPrivateStorage.browserPut} refuses a body of another length,
 * as S3 refuses one its signature does not cover. {@link
 * MemoryPrivateStorage.storeDirectly} stands in for a storage that does not
 * enforce the length, so the confirm step's own size check can be reached.
 */
import { StorageReadTooLargeError } from "../../../storage/read-errors";
import type {
  ClientUploadData,
  IStorageAdapter,
  StoragePlugin,
  StoredObjectHead,
} from "../../../storage/types";

interface Stored {
  bytes: Buffer;
  contentType: string;
}

export class MemoryPrivateStorage {
  readonly objects = new Map<string, Stored>();

  /** How many deletes to refuse next, as a storage that is briefly down would. */
  refuseDeletes = 0;

  /** The storage adapter, as a storage plugin hands it to core. */
  readonly adapter: IStorageAdapter = {
    upload: () => Promise.reject(new Error("public upload refused in test")),
    delete: async key => {
      if (this.refuseDeletes > 0) {
        this.refuseDeletes--;
        throw new Error("storage unavailable in test");
      }
      this.objects.delete(key);
    },
    exists: async key => this.objects.has(key),
    getPublicUrl: () => {
      throw new Error("no public address in test");
    },
    getType: () => "s3",
    getInfo: () => ({
      type: "s3",
      name: "MemoryPrivateStorage",
      supportsSignedUrls: true,
      supportsClientUploads: true,
      supportsPrivateFiles: true,
    }),
    head: async (key): Promise<StoredObjectHead | null> => {
      const found = this.objects.get(key);
      return found
        ? { size: found.bytes.length, contentType: found.contentType }
        : null;
    },
    read: async (key, options) => {
      const found = this.objects.get(key);
      if (!found) return null;
      if (
        options?.maxBytes !== undefined &&
        found.bytes.length > options.maxBytes
      ) {
        throw new StorageReadTooLargeError(
          key,
          options.maxBytes,
          found.bytes.length
        );
      }
      return found.bytes;
    },
    readStream: async key => {
      const found = this.objects.get(key);
      return found ? new Blob([new Uint8Array(found.bytes)]).stream() : null;
    },
    putPrivate: async (key, buffer, { mimeType }) => {
      this.objects.set(key, { bytes: buffer, contentType: mimeType });
    },
    getPrivateUploadUrl: async (
      key,
      mimeType,
      { contentLength, expiresIn }
    ): Promise<ClientUploadData> => ({
      uploadUrl: `https://storage.test/${key}?length=${contentLength}&type=${encodeURIComponent(mimeType)}`,
      path: key,
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, no-store",
      },
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    }),
    getPrivateDownloadUrl: async (key, { expiresIn }) =>
      `https://storage.test/${key}?get&expires=${expiresIn}`,
  };

  /** The storage plugin, taking the given collections. */
  plugin(collections: string[]): StoragePlugin {
    return {
      name: "memory-private-storage",
      type: "s3",
      collections: Object.fromEntries(collections.map(slug => [slug, true])),
      adapter: this.adapter,
    };
  }

  /**
   * What a browser sending `bytes` to an upload link gets: stored, or refused
   * (403) when the length or type is not the one the link was signed for.
   */
  browserPut(
    upload: { url: string; headers: Record<string, string> },
    bytes: Buffer
  ): { ok: boolean; status: number } {
    const url = new URL(upload.url);
    const signedLength = Number(url.searchParams.get("length"));
    const signedType = url.searchParams.get("type");
    if (
      bytes.length !== signedLength ||
      upload.headers["Content-Type"] !== signedType
    ) {
      return { ok: false, status: 403 };
    }
    this.objects.set(url.pathname.slice(1), {
      bytes,
      contentType: signedType ?? "",
    });
    return { ok: true, status: 200 };
  }

  /** Bytes put at the link's key whatever their length, as a lax storage would. */
  storeDirectly(
    upload: { url: string },
    bytes: Buffer,
    contentType: string
  ): void {
    this.objects.set(new URL(upload.url).pathname.slice(1), {
      bytes,
      contentType,
    });
  }
}
