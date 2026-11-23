/**
 * A collection's private files: routing that fails closed, and a store that
 * forms no public address.
 *
 * What separates a correct implementation from the plausible broken one here
 * is WHERE a private collection's file can end up. The broken one is today's
 * routing: a collection no storage plugin lists falls back to the local disk,
 * which serves every file under `/uploads`. So each refusal below is paired
 * with a control showing the same setup still routes an ordinary collection,
 * and asserts the write never reached any storage, not only that something
 * threw.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import {
  lastStorageWriteFailure,
  recordStorageWriteSuccess,
} from "../last-write-failure";
import {
  attachmentDisposition,
  keepsFilesPrivate,
  PRIVATE_DOWNLOAD_URL_MAX_SECONDS,
  PRIVATE_UPLOAD_URL_MAX_SECONDS,
} from "../private-files";
import { MediaStorage } from "../storage";
import type {
  CollectionStorageMap,
  IStorageAdapter,
  StoragePlugin,
} from "../types";

afterEach(() => {
  recordStorageWriteSuccess();
});

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A storage with every private call, saying it keeps files private or not. */
function privateCapable(supportsPrivateFiles = true) {
  const adapter = {
    upload: vi.fn(async () => ({ url: "https://x.test/k", path: "k" })),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    getPublicUrl: vi.fn((path: string) => `https://x.test/${path}`),
    getType: () => "s3",
    getInfo: () => ({
      type: "s3" as const,
      name: "TestAdapter",
      supportsSignedUrls: true,
      supportsClientUploads: true,
      supportsPrivateFiles,
    }),
    read: vi.fn(async () => Buffer.from("stored bytes")),
    head: vi.fn(async () => ({ size: 12, contentType: "application/pdf" })),
    readStream: vi.fn(async () => new Blob(["stored bytes"]).stream()),
    putPrivate: vi.fn(async () => {}),
    getPrivateUploadUrl: vi.fn(
      async (
        key: string,
        _mimeType: string,
        options: { expiresIn: number }
      ) => ({
        uploadUrl: `https://bucket.test/${key}?signed`,
        path: key,
        method: "PUT" as const,
        expiresAt: new Date(Date.now() + options.expiresIn * 1000),
      })
    ),
    getPrivateDownloadUrl: vi.fn(
      async (key: string) => `https://bucket.test/${key}?get`
    ),
    getSignedUrl: vi.fn(
      async (key: string) => `https://bucket.test/${key}?long`
    ),
  } satisfies IStorageAdapter;
  return adapter;
}

function plugin(
  adapter: IStorageAdapter,
  collections: CollectionStorageMap
): StoragePlugin {
  return {
    name: "test-storage",
    type: "s3",
    collections,
    adapter,
    getClientUploadUrl: vi.fn(),
    getSignedDownloadUrl: vi.fn(async () => "https://bucket.test/signed"),
  };
}

/** The error a call threw, or `undefined` when it returned. */
async function thrown(call: () => unknown): Promise<unknown> {
  try {
    await call();
    return undefined;
  } catch (error) {
    return error;
  }
}

function isConfigurationError(error: unknown): boolean {
  return NextlyError.isCode(error, "CONFIGURATION_ERROR");
}

describe("routing for a private collection fails closed", () => {
  it("refuses a private collection no storage plugin lists, rather than the local disk", async () => {
    const storage = new MediaStorage({
      privateCollections: ["contracts"],
      local: { uploadDir: "/tmp/never-written", publicPath: "/uploads" },
    });
    const local = storage.getDefaultAdapter();
    const localUpload = vi.spyOn(local, "upload");

    // Control: an ordinary collection with the same setup goes to the local disk.
    expect(storage.getAdapterForCollection("posts")).toBe(local);

    expect(
      isConfigurationError(
        await thrown(() => storage.getAdapterForCollection("contracts"))
      )
    ).toBe(true);
    expect(storage.getAdapterOrNull("contracts")).toBeNull();
    expect(
      isConfigurationError(
        await thrown(() => storage.getPrivateFiles("contracts"))
      )
    ).toBe(true);
    expect(
      isConfigurationError(
        await thrown(() =>
          storage.upload(Buffer.from("x"), {
            filename: "a.pdf",
            mimeType: "application/pdf",
            collection: "contracts",
          })
        )
      )
    ).toBe(true);
    expect(
      isConfigurationError(
        await thrown(() => storage.getPublicUrl("k", "contracts"))
      )
    ).toBe(true);
    expect(localUpload).not.toHaveBeenCalled();
  });

  it("refuses storage that has the private calls but cannot keep files private as configured", async () => {
    const publicBucket = privateCapable(false);
    const storage = new MediaStorage({
      plugins: [plugin(publicBucket, { contracts: true })],
      privateCollections: ["contracts"],
    });
    expect(keepsFilesPrivate(publicBucket)).toBe(false);
    expect(
      isConfigurationError(
        await thrown(() => storage.getPrivateFiles("contracts"))
      )
    ).toBe(true);
    expect(
      isConfigurationError(
        await thrown(() => storage.getAdapterForCollection("contracts"))
      )
    ).toBe(true);
    expect(storage.getAdapterOrNull("contracts")).toBeNull();

    // Control: the same storage saying it keeps files private is accepted.
    const privateBucket = privateCapable(true);
    const accepted = new MediaStorage({
      plugins: [plugin(privateBucket, { contracts: true })],
      privateCollections: ["contracts"],
    });
    expect(keepsFilesPrivate(privateBucket)).toBe(true);
    expect(accepted.getPrivateFiles("contracts").collection).toBe("contracts");
  });

  it("refuses storage that says it keeps files private but lacks a private call", async () => {
    const { putPrivate: _dropped, ...partial } = privateCapable(true);
    const storage = new MediaStorage({
      plugins: [plugin(partial, { contracts: true })],
      privateCollections: ["contracts"],
    });
    expect(keepsFilesPrivate(partial)).toBe(false);
    expect(
      isConfigurationError(
        await thrown(() => storage.getPrivateFiles("contracts"))
      )
    ).toBe(true);
  });

  it("refuses upload() for a private collection before anything is written", async () => {
    const adapter = privateCapable();
    const storage = new MediaStorage({
      plugins: [plugin(adapter, { contracts: true, media: true })],
      privateCollections: ["contracts"],
    });
    const error = await thrown(() =>
      storage.upload(Buffer.from("x"), {
        filename: "signed-contract.pdf",
        mimeType: "application/pdf",
        collection: "contracts",
      })
    );
    expect(isConfigurationError(error)).toBe(true);
    expect(adapter.upload).not.toHaveBeenCalled();
    expect(adapter.putPrivate).not.toHaveBeenCalled();
    // A refused call is not a failed storage write.
    expect(lastStorageWriteFailure()).toBeUndefined();

    // Control: the same storage still takes an ordinary collection's upload.
    await storage.upload(Buffer.from("x"), {
      filename: "a.jpg",
      mimeType: "image/jpeg",
      collection: "media",
    });
    expect(adapter.upload).toHaveBeenCalledOnce();
  });

  it("hands out a view of the storage that reads but forms no public address", async () => {
    const adapter = privateCapable();
    const storage = new MediaStorage({
      plugins: [plugin(adapter, { contracts: true })],
      privateCollections: ["contracts"],
    });
    const view = storage.getAdapterForCollection("contracts");

    expect((await view.read?.("files/contracts/k"))?.toString()).toBe(
      "stored bytes"
    );
    expect(
      isConfigurationError(
        await thrown(() => view.getPublicUrl("files/contracts/k"))
      )
    ).toBe(true);
    expect(adapter.getPublicUrl).not.toHaveBeenCalled();
    // No signed link, direct upload or key-of-its-choosing write to find by feature detection.
    expect(view.getSignedUrl).toBeUndefined();
    expect(view.getPresignedUploadUrl).toBeUndefined();
    expect(view.uploadAt).toBeUndefined();
    expect(view.getInfo?.()).toMatchObject({
      supportsSignedUrls: false,
      supportsClientUploads: false,
    });
    expect(storage.keepsCopies("contracts")).toBe(false);
  });

  it("turns off client uploads and unchecked signed downloads for a private collection", async () => {
    const adapter = privateCapable();
    const both = { clientUploads: true, signedDownloads: true };
    const storage = new MediaStorage({
      plugins: [plugin(adapter, { contracts: both, docs: both })],
      privateCollections: ["contracts"],
    });

    // Control: an ordinary collection with the same settings has both.
    expect(storage.supportsClientUploads("docs")).toBe(true);
    expect(storage.supportsSignedDownloads("docs")).toBe(true);

    expect(storage.supportsClientUploads("contracts")).toBe(false);
    expect(storage.supportsSignedDownloads("contracts")).toBe(false);
    expect(
      await storage.getSignedDownloadUrl("files/contracts/k", "contracts")
    ).toBeNull();
    expect(
      await storage.getClientUploadUrl(
        "a.pdf",
        "application/pdf",
        "contracts",
        {
          size: 10,
        }
      )
    ).toBeNull();
    expect(adapter.getSignedUrl).not.toHaveBeenCalled();
  });
});

describe("a private collection's file store", () => {
  function store(prefix?: string) {
    const adapter = privateCapable();
    const storage = new MediaStorage({
      plugins: [
        plugin(adapter, {
          contracts: prefix === undefined ? true : { prefix },
        }),
      ],
      privateCollections: ["contracts"],
    });
    return { adapter, files: storage.getPrivateFiles("contracts") };
  }

  it("makes opaque keys under the collection's folder, distinct each time", () => {
    const { files } = store();
    const first = files.newKey();
    expect(first).toMatch(new RegExp(`^files/contracts/${UUID}$`));
    expect(files.newKey()).not.toBe(first);
  });

  it("makes keys under the configured prefix, however its slashes are written", () => {
    expect(store("private/contracts//").files.newKey()).toMatch(
      new RegExp(`^private/contracts/${UUID}$`)
    );
    expect(store("vault").files.newKey()).toMatch(
      new RegExp(`^vault/${UUID}$`)
    );
  });

  it("stores bytes through the private call, at the key it made", async () => {
    const { adapter, files } = store();
    const key = files.newKey();
    await files.put(key, Buffer.from("%PDF-1.7"), {
      mimeType: "application/pdf",
    });
    expect(adapter.putPrivate).toHaveBeenCalledWith(
      key,
      Buffer.from("%PDF-1.7"),
      { mimeType: "application/pdf" }
    );
    expect(adapter.upload).not.toHaveBeenCalled();
  });

  it("refuses a key it did not make, before storage is asked anything", async () => {
    const { adapter, files } = store();
    const id = "0b8a3c1e-6f00-4c1d-9a7e-2f5d6c7b8a90";
    for (const key of [
      `files/other/${id}`,
      `files/contracts/../other/${id}`,
      `files/contracts/${id}/x`,
      `files/contracts/${id}-contract.pdf`,
      "files/contracts/",
    ]) {
      for (const call of [
        () => files.put(key, Buffer.from("x"), { mimeType: "application/pdf" }),
        () => files.read(key),
        () => files.head(key),
        () => files.readStream(key),
        () => files.delete(key),
        () => files.uploadUrl(key, { mimeType: "application/pdf", size: 1 }),
        () => files.downloadUrl(key, { filename: "a.pdf" }),
      ]) {
        expect(
          NextlyError.isCode(await thrown(call), "INTERNAL_ERROR"),
          key
        ).toBe(true);
      }
    }
    for (const call of [
      adapter.putPrivate,
      adapter.read,
      adapter.head,
      adapter.readStream,
      adapter.delete,
      adapter.getPrivateUploadUrl,
      adapter.getPrivateDownloadUrl,
    ]) {
      expect(call).not.toHaveBeenCalled();
    }
    // Control: its own key reaches storage.
    expect(await files.read(`files/contracts/${id}`)).not.toBeNull();
    expect(adapter.read).toHaveBeenCalledOnce();
  });

  it("gives upload links no longer than the cap, bound to the exact size", async () => {
    const { adapter, files } = store();
    const key = files.newKey();
    await files.uploadUrl(key, {
      mimeType: "application/pdf",
      size: 2048,
      expiresIn: 3600,
    });
    expect(adapter.getPrivateUploadUrl).toHaveBeenLastCalledWith(
      key,
      "application/pdf",
      {
        contentLength: 2048,
        expiresIn: PRIVATE_UPLOAD_URL_MAX_SECONDS,
      }
    );
    await files.uploadUrl(key, {
      mimeType: "application/pdf",
      size: 2048,
      expiresIn: 120,
    });
    expect(adapter.getPrivateUploadUrl).toHaveBeenLastCalledWith(
      key,
      "application/pdf",
      {
        contentLength: 2048,
        expiresIn: 120,
      }
    );
    expect(PRIVATE_UPLOAD_URL_MAX_SECONDS).toBe(300);
  });

  it("gives download links no longer than the cap, as an attachment", async () => {
    const { adapter, files } = store();
    const key = files.newKey();
    await files.downloadUrl(key, {
      filename: "note.pdf",
      contentType: "application/pdf",
      expiresIn: 3600,
    });
    expect(adapter.getPrivateDownloadUrl).toHaveBeenLastCalledWith(key, {
      expiresIn: PRIVATE_DOWNLOAD_URL_MAX_SECONDS,
      contentDisposition: attachmentDisposition("note.pdf"),
      contentType: "application/pdf",
    });
    await files.downloadUrl(key, { filename: "note.pdf", expiresIn: 10 });
    expect(adapter.getPrivateDownloadUrl).toHaveBeenLastCalledWith(key, {
      expiresIn: 10,
      contentDisposition: attachmentDisposition("note.pdf"),
    });
    expect(PRIVATE_DOWNLOAD_URL_MAX_SECONDS).toBe(60);
  });

  it("records a failed private write for System health, as every storage write is", async () => {
    const { adapter, files } = store();
    adapter.putPrivate.mockRejectedValueOnce(new Error("bucket unreachable"));
    const error = await thrown(() =>
      files.put(files.newKey(), Buffer.from("x"), {
        mimeType: "application/pdf",
      })
    );
    expect(error).toBeInstanceOf(Error);
    expect(lastStorageWriteFailure()?.adapter).toBe("s3");
  });
});

describe("attachmentDisposition", () => {
  it("is always an attachment, with the name plain and encoded", () => {
    expect(attachmentDisposition("note.pdf")).toBe(
      `attachment; filename="note.pdf"; filename*=UTF-8''note.pdf`
    );
  });

  it("keeps a quote or a line break from ending the header value", () => {
    const value = attachmentDisposition('a"; filename="evil.html\r\nX: y.pdf');
    expect(value).not.toMatch(/[\r\n]/);
    // Exactly the two quotes around the plain name.
    expect(value.match(/"/g)).toHaveLength(2);
    expect(value).toContain(
      `filename*=UTF-8''a%22%3B%20filename%3D%22evil.html%0D%0AX%3A%20y.pdf`
    );
  });

  it("encodes a name outside ASCII exactly, with a plain fallback", () => {
    expect(attachmentDisposition("résumé (1).pdf")).toBe(
      `attachment; filename="r_sum_ (1).pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.pdf`
    );
  });

  it("keeps only the last path segment", () => {
    expect(attachmentDisposition("../../etc/passwd")).toContain(
      `filename="passwd"`
    );
    expect(attachmentDisposition("C:\\Users\\a\\b.pdf")).toContain(
      `filename="b.pdf"`
    );
    expect(attachmentDisposition("dir/")).toContain(`filename="file"`);
  });
});
