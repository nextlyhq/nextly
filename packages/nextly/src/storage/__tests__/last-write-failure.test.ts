/**
 * The storage adapter's last failed write, as `MediaStorage` records it for
 * an upload, a delete and a bulk delete: set when a write throws, or a bulk
 * delete leaves a file, cleared by the next write that succeeds, and never
 * carrying what the adapter's error said.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  lastStorageWriteFailure,
  recordStorageWriteSuccess,
  storageFailureReason,
} from "../last-write-failure";
import { MediaStorage } from "../storage";
import type { IStorageAdapter, StoragePlugin } from "../types";

afterEach(() => {
  recordStorageWriteSuccess();
});

/** An adapter of `type` whose uploads answer as `upload` says. */
function adapter(
  type: string,
  upload: IStorageAdapter["upload"]
): IStorageAdapter {
  return {
    upload,
    delete: () => Promise.resolve(),
    exists: () => Promise.resolve(true),
    getPublicUrl: path => `https://${type}.test/${path}`,
    getType: () => type,
  };
}

/** Storage routing `media` to `s3`, whose next answers are `answers`, in turn. */
function storageWith(
  answers: (() => Promise<{ url: string; path: string }>)[]
) {
  let call = 0;
  const upload = vi.fn(() => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return answer();
  });
  const plugin: StoragePlugin = {
    name: "s3-storage",
    type: "s3",
    adapter: adapter("s3", upload),
    collections: { media: true },
  };
  return new MediaStorage({ plugins: [plugin] });
}

const ok = () =>
  Promise.resolve({ url: "https://s3.test/a.jpg", path: "a.jpg" });

/** An S3 refusal whose message carries what a dashboard must never show. */
const refused = () =>
  Promise.reject(
    Object.assign(
      new Error(
        "Access Denied for s3://private-bucket/secret/key?X-Amz-Signature=abc123"
      ),
      { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }
    )
  );

const upload = (storage: MediaStorage) =>
  storage.upload(Buffer.from("x"), {
    filename: "a.jpg",
    mimeType: "image/jpeg",
    collection: "media",
  });

describe("the storage adapter's last failed write", () => {
  it("is absent while every write succeeds", async () => {
    await upload(storageWith([ok]));
    expect(lastStorageWriteFailure()).toBeUndefined();
  });

  it("is recorded when a write fails, with when, the adapter and a short reason, and the error still thrown", async () => {
    const before = Date.now();
    await expect(upload(storageWith([refused]))).rejects.toThrow(
      "Access Denied"
    );
    const failure = lastStorageWriteFailure();
    expect(failure).toEqual({
      at: expect.any(String),
      adapter: "s3",
      reason: "The storage service refused the credentials or permissions.",
    });
    expect(Date.parse(failure?.at ?? "")).toBeGreaterThanOrEqual(before);
  });

  it("carries nothing the adapter's error said: no path, signature or message", async () => {
    await expect(upload(storageWith([refused]))).rejects.toThrow();
    const shown = JSON.stringify(lastStorageWriteFailure());
    expect(shown).not.toContain("private-bucket");
    expect(shown).not.toContain("X-Amz-Signature");
    expect(shown).not.toContain("Access Denied");
  });

  it("is cleared by the next write that succeeds", async () => {
    const storage = storageWith([refused, ok]);
    await expect(upload(storage)).rejects.toThrow();
    expect(lastStorageWriteFailure()).toBeDefined();

    await upload(storage);
    expect(lastStorageWriteFailure()).toBeUndefined();
  });

  it("chooses its reason by the error's code, from a fixed set", () => {
    expect(storageFailureReason({ code: "ECONNREFUSED" })).toBe(
      "The storage service could not be reached."
    );
    expect(storageFailureReason({ name: "TimeoutError" })).toBe(
      "The storage service did not answer in time."
    );
    expect(storageFailureReason({ code: "ENOSPC" })).toBe(
      "There was no room to store the file."
    );
    // A message alone says nothing it may repeat.
    expect(storageFailureReason(new Error("disk /var/secret full"))).toBe(
      "The storage adapter could not save or delete the file."
    );
  });
});

describe("a delete, as a write", () => {
  /** Storage routing `media` to an `s3` adapter with these delete answers. */
  function deleting(
    remove: IStorageAdapter["delete"],
    bulkDelete?: IStorageAdapter["bulkDelete"]
  ) {
    const plugin: StoragePlugin = {
      name: "s3-storage",
      type: "s3",
      adapter: {
        ...adapter("s3", ok),
        delete: remove,
        ...(bulkDelete === undefined ? {} : { bulkDelete }),
      },
      collections: { media: true },
    };
    return new MediaStorage({ plugins: [plugin] });
  }
  const unreachable = () =>
    Promise.reject(Object.assign(new Error("down"), { code: "ECONNREFUSED" }));
  const REACH = "The storage service could not be reached.";

  it("records a failed delete, and clears it on the next that succeeds", async () => {
    // 🔴 Only uploads were recorded: a failing delete left the card "Working".
    await expect(
      deleting(unreachable).delete("a.jpg", "media")
    ).rejects.toThrow("down");
    expect(lastStorageWriteFailure()).toMatchObject({
      adapter: "s3",
      reason: REACH,
    });
    await deleting(() => Promise.resolve()).delete("a.jpg", "media");
    expect(lastStorageWriteFailure()).toBeUndefined();
  });

  it("records a bulk delete that left a file, through the fallback, by its first rejection", async () => {
    const remove = vi.fn((path: string) =>
      path === "b.jpg" ? unreachable() : Promise.resolve()
    );
    const result = await deleting(remove).bulkDelete(
      ["a.jpg", "b.jpg"],
      "media"
    );
    expect(result.failed.map(entry => entry.filePath)).toEqual(["b.jpg"]);
    expect(lastStorageWriteFailure()).toMatchObject({ reason: REACH });

    await deleting(() => Promise.resolve()).bulkDelete(["a.jpg"], "media");
    expect(lastStorageWriteFailure()).toBeUndefined();
  });

  it("records the adapter's own bulk delete when it leaves a file or throws, and clears it when all go", async () => {
    const leaves = deleting(
      () => Promise.resolve(),
      paths =>
        Promise.resolve({
          successful: paths.slice(1),
          failed: [{ filePath: paths[0] ?? "", error: "denied" }],
        })
    );
    await leaves.bulkDelete(["a.jpg", "b.jpg"], "media");
    expect(lastStorageWriteFailure()).toMatchObject({ adapter: "s3" });

    const clears = deleting(
      () => Promise.resolve(),
      paths => Promise.resolve({ successful: paths, failed: [] })
    );
    await clears.bulkDelete(["a.jpg"], "media");
    expect(lastStorageWriteFailure()).toBeUndefined();

    const throws = deleting(() => Promise.resolve(), unreachable);
    await expect(throws.bulkDelete(["a.jpg"], "media")).rejects.toThrow("down");
    expect(lastStorageWriteFailure()).toMatchObject({ reason: REACH });
  });
});
