/**
 * The fingerprint of a media file: the SHA-256 of its bytes, as lowercase
 * hex, and the same fingerprint read back from where the storage keeps it.
 *
 * The known vectors are FIPS 180-2's, so a hash of something other than the
 * bytes (their length, their name, a truncated digest) cannot pass. Reading
 * from storage is checked against the same bytes held in memory, through a
 * stream split into uneven chunks, so a reader that hashed only its first
 * chunk, or each chunk separately, gives a different answer.
 */
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_READ_MAX_BYTES } from "../../../../storage/fetch-stored-bytes";
import { contentHashOf, hashOfStoredFile } from "../content-hash";

/** `abc` and the empty input, from FIPS 180-2 appendix B and its errata. */
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const EMPTY =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** A stream of `bytes` in chunks of the given sizes. */
function streamOf(bytes: Buffer, sizes: number[]): ReadableStream<Uint8Array> {
  let at = 0;
  let turn = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[turn % sizes.length];
      turn += 1;
      controller.enqueue(new Uint8Array(bytes.subarray(at, at + size)));
      at += size;
    },
  });
}

describe("contentHashOf", () => {
  it("is the SHA-256 of the bytes, as 64 lowercase hex characters", () => {
    expect(contentHashOf(Buffer.from("abc"))).toBe(ABC);
    expect(contentHashOf(Buffer.alloc(0))).toBe(EMPTY);
  });
});

describe("hashOfStoredFile", () => {
  const bytes = Buffer.from("a file of some length, read back in parts");

  it("hashes the whole stream when the storage can stream", async () => {
    const read = vi.fn();
    const hash = await hashOfStoredFile(
      { read, readStream: async () => streamOf(bytes, [3, 7, 1]) },
      "media/file.bin"
    );

    expect(hash).toBe(contentHashOf(bytes));
    // Streamed, so a large video is never held whole in memory.
    expect(read).not.toHaveBeenCalled();
  });

  it("reads the whole file when the storage cannot stream", async () => {
    const hash = await hashOfStoredFile(
      { read: async () => bytes },
      "media/file.bin"
    );

    expect(hash).toBe(contentHashOf(bytes));
  });

  it("asks the storage for the file at the path it was given", async () => {
    const read = vi.fn(async () => bytes);

    await hashOfStoredFile({ read }, "media/2026/11/file.bin");

    expect(read).toHaveBeenCalledWith("media/2026/11/file.bin");
  });

  it("caps a whole read at the size the record says is stored, when larger than the default", async () => {
    // A storage's default cap (10 MiB) would refuse a larger video.
    const read = vi.fn(async () => bytes);

    await hashOfStoredFile({ read }, "media/video.mp4", { size: 52_428_800 });

    expect(read).toHaveBeenCalledWith("media/video.mp4", {
      maxBytes: 52_428_800,
    });
  });

  it("never caps a whole read below the storage's default", async () => {
    // A size an older release recorded may understate the stored file.
    const read = vi.fn(async () => bytes);

    await hashOfStoredFile({ read }, "media/a.bin", { size: 3 });

    expect(read).toHaveBeenCalledWith("media/a.bin", {
      maxBytes: DEFAULT_READ_MAX_BYTES,
    });
  });

  it("gives a whole read only the time left before its deadline", async () => {
    const read = vi.fn(async () => bytes);

    await hashOfStoredFile({ read }, "media/a.bin", {
      deadline: 5_000,
      clock: () => 1_000,
    });

    expect(read).toHaveBeenCalledWith("media/a.bin", { timeoutMs: 4_000 });
  });

  it("stops a stream still being read at its deadline, and refuses", async () => {
    let now = 0;
    let cancelled = false;
    // Each chunk takes a second of the clock; the deadline is 3 s away and
    // the stream ten chunks long, so a reader that ignored the deadline
    // would finish it and answer a hash.
    let chunks = 0;
    const slow = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks === 10) {
          controller.close();
          return;
        }
        chunks += 1;
        now += 1_000;
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      hashOfStoredFile({ readStream: async () => slow }, "media/huge.mp4", {
        deadline: 3_000,
        clock: () => now,
      })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(cancelled).toBe(true);
  });

  it("stops a stream that stalls mid-body at its deadline, though no chunk comes", async () => {
    // One chunk, then nothing: storage that answered and then stalled. A
    // check made only between chunks would wait on the read for ever.
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const startedAt = Date.now();

    await expect(
      hashOfStoredFile({ readStream: async () => stalled }, "media/stuck.mp4", {
        deadline: startedAt + 50,
      })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(cancelled).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("answers null when nothing is stored at the path", async () => {
    expect(
      await hashOfStoredFile({ readStream: async () => null }, "gone.bin")
    ).toBeNull();
    expect(
      await hashOfStoredFile({ read: async () => null }, "gone.bin")
    ).toBeNull();
  });

  // Not null: that would report every file of the site as missing, when the
  // files may all be there and only this storage cannot hand them back.
  it("refuses when the storage can read no file at all", async () => {
    await expect(hashOfStoredFile({}, "anything.bin")).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
  });
});
