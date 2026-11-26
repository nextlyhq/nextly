/**
 * A media record's fingerprint when something needs it now: an export's media
 * step asks for every item it writes, whether or not the background fill has
 * reached it yet.
 *
 * What separates the right answer from the plausible wrong ones:
 * - an item that has its fingerprint is answered from the record, with no
 *   read of storage (an export of a large library must not read every file);
 * - one without is answered from its stored bytes, never skipped, and the
 *   answer is kept on the record, so the next export does not read it again;
 * - keeping it never overwrites a fingerprint written meanwhile, or one for
 *   another file: a Replace between the read and the write points the record
 *   at a new file with its own fingerprint;
 * - a file storage does not hold is answered as null and nothing is written,
 *   so the caller can say the file is missing rather than store a hash of
 *   nothing.
 */
import { describe, expect, it, vi } from "vitest";

import { contentHashOf } from "../content-hash";
import { mediaHashWhenMissing } from "../hash-when-missing";

const bytes = Buffer.from("the stored bytes of one media file");
const stored = contentHashOf(bytes);

/** A database that records each update it is asked for. */
function recordingDb() {
  const update = vi.fn(async () => [{}]);
  return { db: { update }, update };
}

describe("mediaHashWhenMissing", () => {
  it("answers the record's own fingerprint without reading storage", async () => {
    const { db, update } = recordingDb();
    const read = vi.fn(async () => bytes);
    const kept = contentHashOf(Buffer.from("what the record already says"));

    const hash = await mediaHashWhenMissing(
      { db, storage: { read } },
      { id: "m1", filename: "media/a.bin", sha256: kept }
    );

    expect(hash).toBe(kept);
    expect(read).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("hashes the stored file when the record has none, and keeps it on the record", async () => {
    const { db, update } = recordingDb();

    const hash = await mediaHashWhenMissing(
      { db, storage: { read: async () => bytes } },
      { id: "m1", filename: "media/a.bin", sha256: null }
    );

    expect(hash).toBe(stored);
    expect(update).toHaveBeenCalledTimes(1);
    const [table, values, where] = update.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      { and: Array<Record<string, unknown>> },
    ];
    expect(table).toBe("media");
    expect(values).toEqual({ sha256: stored });
    // Only this record, only while it still names the file that was read,
    // and only while it still has no fingerprint.
    expect(where.and).toEqual(
      expect.arrayContaining([
        { column: "id", op: "=", value: "m1" },
        { column: "filename", op: "=", value: "media/a.bin" },
        { column: "sha256", op: "IS NULL" },
      ])
    );
    expect(where.and).toHaveLength(3);
  });

  it("treats a value that is not a fingerprint as none", async () => {
    const { db } = recordingDb();

    const hash = await mediaHashWhenMissing(
      { db, storage: { read: async () => bytes } },
      { id: "m1", filename: "media/a.bin", sha256: "" }
    );

    expect(hash).toBe(stored);
  });

  it("answers null and writes nothing when storage does not hold the file", async () => {
    const { db, update } = recordingDb();

    const hash = await mediaHashWhenMissing(
      { db, storage: { read: async () => null } },
      { id: "m1", filename: "media/gone.bin", sha256: null }
    );

    expect(hash).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
