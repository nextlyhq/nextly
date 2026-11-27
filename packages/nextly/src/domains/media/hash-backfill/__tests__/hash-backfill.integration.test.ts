/**
 * Media stored before records carried a fingerprint get one from a job that
 * works a step at a time.
 *
 * 500 records whose files were stored without a hash, one of those files gone
 * from storage. Each jobs pass is given a budget that fits a fraction of
 * them, and every pass is run through a NEW job built from nothing but the
 * database and storage, as a pass in a fresh process (a serverless function,
 * a restart) would be: so whatever the second pass knows of the first, it read
 * from what the first stored. That separates resuming from starting again,
 * which would also fill every hash in the end, but would read the missing
 * file again on every pass.
 *
 * Then: every record but one carries the SHA-256 of its own stored bytes, the
 * one whose file is missing carries none, and the job's report names it and
 * counts it. A pass after the job has finished reads no file, so a missing
 * file is not read again on every pass for ever, and the finish is announced
 * once, not on every pass after it.
 *
 * Smaller libraries then show what a failing read does: a read that fails is
 * tried again on the next pass rather than passed over (an outage passes over
 * nothing), a file that fails three passes in a row is named, a storage that
 * cannot read files back fails the job and names nothing, and a record
 * written behind the walk's place sends it round again.
 *
 * On the real local-disk adapter, and on the stand-in that keys files as the
 * S3 adapter does, read through a stream as that adapter reads; on every
 * dialect the process is configured for.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { LocalStorageAdapter } from "../../../../storage/adapters/local-adapter";
import { Bucket } from "../../../../storage/__tests__/stand-in-bucket";
import type { IStorageAdapter } from "../../../../storage/types";
import type { JobContext } from "../../../jobs/job-registry";
import {
  createMediaHashBackfillJob,
  MEDIA_HASH_BACKFILL_JOB,
  readMediaHashBackfillReport,
} from "../backfill-job";
import { contentHashOf } from "../content-hash";

const RECORDS = 500;
/** The record whose file is removed from storage after it is stored. */
const MISSING = 137;
/** What one pass's budget is, in reads of the job's clock. */
const PER_PASS = 400;
/** More passes than any walk here should need. */
const MAX_PASSES = 60;

/** A logger that records what it was told, for the job's announcements. */
function recordingLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
let logger = recordingLogger();

/** `bytes` as a stream of chunks of up to 7 bytes, as a stored object streams. */
function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(bytes.subarray(at, at + 7)));
      at += 7;
    },
  });
}

/**
 * `adapter` with each read of a file counted, so a pass that reads nothing
 * is observable. For S3 it reads through a stream, as the S3 adapter does.
 */
function counted(
  adapter: IStorageAdapter,
  kind: "local" | "s3"
): { storage: IStorageAdapter; reads: () => number } {
  let reads = 0;
  const storage: IStorageAdapter = Object.create(adapter) as IStorageAdapter;
  storage.read = async (filePath, options) => {
    reads += 1;
    return adapter.read!(filePath, options);
  };
  if (kind === "s3") {
    storage.readStream = async filePath => {
      reads += 1;
      const bytes = await adapter.read!(filePath);
      return bytes ? streamOf(bytes) : null;
    };
  }
  return { storage, reads: () => reads };
}

/** `storage` whose read of `filePath` throws while `fails()` says so. */
function failingFor(
  storage: IStorageAdapter,
  filePath: string,
  fails: () => boolean
): IStorageAdapter {
  const failing: IStorageAdapter = Object.create(storage) as IStorageAdapter;
  failing.read = async (asked, options) => {
    if (asked === filePath && fails()) {
      throw new Error("the storage did not answer");
    }
    return storage.read!(asked, options);
  };
  return failing;
}

describe.each(getConfiguredTestDialects())(
  "the media fingerprint backfill (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const folders: string[] = [];

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
    });

    afterAll(async () => {
      await t?.destroy();
      for (const folder of folders) {
        await rm(folder, { recursive: true, force: true });
      }
    });

    beforeEach(async () => {
      logger = recordingLogger();
      await t.adapter.delete("media", {
        and: [{ column: "id", op: "IS NOT NULL" }],
      });
      await t.adapter.delete("nextly_meta", {
        and: [{ column: "key", op: "LIKE", value: "media.hash%" }],
      });
    });

    async function adapterFor(kind: "local" | "s3"): Promise<IStorageAdapter> {
      if (kind === "s3") return new Bucket("s3");
      const folder = await mkdtemp(path.join(tmpdir(), "nextly-hash-fill-"));
      folders.push(folder);
      return new LocalStorageAdapter({ basePath: folder, baseUrl: "/uploads" });
    }

    /** Stores one file, and a record for it with no fingerprint. */
    async function earlierRecord(
      adapter: IStorageAdapter,
      name: string,
      id: string = randomUUID()
    ): Promise<{ id: string; filename: string; bytes: Buffer }> {
      const bytes = Buffer.from(`stored file ${name} ${randomUUID()}`);
      const stored = await adapter.upload(bytes, {
        filename: `${name}.txt`,
        mimeType: "text/plain",
        collection: "media",
      });
      const now = new Date();
      await t.adapter.insert("media", {
        id,
        filename: stored.path,
        original_filename: `${name}.txt`,
        mime_type: "text/plain",
        size: bytes.length,
        url: stored.url,
        uploaded_at: now,
        updated_at: now,
      });
      return { id, filename: stored.path, bytes };
    }

    /** `count` records as an upload before fingerprints stored them. */
    async function earlierLibrary(
      adapter: IStorageAdapter,
      count: number
    ): Promise<Array<{ id: string; filename: string; bytes: Buffer }>> {
      const records = [];
      for (let i = 0; i < count; i += 1) {
        records.push(await earlierRecord(adapter, `file-${i}`));
      }
      return records;
    }

    /**
     * One jobs pass, through a job built afresh, with a clock that moves one
     * step each time the job reads it and a deadline `budget` steps away.
     */
    async function pass(
      storage: IStorageAdapter,
      budget: number = PER_PASS,
      options: { startAt?: number; db?: TestNextly["adapter"] } = {}
    ): Promise<void> {
      const startAt = options.startAt ?? 0;
      let now = startAt;
      const job = createMediaHashBackfillJob({
        db: () => options.db ?? t.adapter,
        storage: () => storage,
        logger,
        clock: () => now++,
      });
      const context = {
        jobId: randomUUID(),
        attempt: 1,
        user: null,
        now: new Date(startAt),
        deadline: new Date(startAt + budget),
      } as unknown as JobContext;
      await job.handler(null, context);
    }

    /** Passes until the report says the walk finished; how many it took. */
    async function passesUntilFinished(
      storage: IStorageAdapter,
      budget: number = PER_PASS
    ): Promise<number> {
      let passes = 0;
      while (
        !(await readMediaHashBackfillReport(t.adapter))?.finishedAt &&
        passes < MAX_PASSES
      ) {
        await pass(storage, budget);
        passes += 1;
      }
      return passes;
    }

    async function hashes(): Promise<Map<string, unknown>> {
      const rows = await t.adapter.select<{ id: string; sha256: unknown }>(
        "media",
        { columns: ["id", "sha256"] }
      );
      return new Map(rows.map(row => [row.id, row.sha256]));
    }

    /** The finish announcements naming files that could not be read. */
    const finishedWithUnreadable = () =>
      logger.warn.mock.calls.filter(([message]) =>
        String(message).includes("could not be read for their fingerprint")
      );

    it("is a job every jobs pass runs, needing no one to queue it", () => {
      const job = createMediaHashBackfillJob({
        db: () => t.adapter,
        storage: () => new Bucket("s3"),
        logger,
      });
      expect(job.slug).toBe(MEDIA_HASH_BACKFILL_JOB);
      expect(job.sweep).toBe(true);
    });

    it.each(["local", "s3"] as const)(
      "fills 500 records across several passes and names the file it could not read (%s)",
      async kind => {
        const adapter = await adapterFor(kind);
        const records = await earlierLibrary(adapter, RECORDS);
        const missing = records[MISSING];
        await adapter.delete(missing.filename);
        const { storage, reads } = counted(adapter, kind);

        await pass(storage);

        // Resumable: the first pass stopped at its budget with part done,
        // and stored where it got to.
        const afterOne = [...(await hashes()).values()].filter(Boolean);
        expect(afterOne.length).toBeGreaterThan(0);
        expect(afterOne.length).toBeLessThan(RECORDS - 1);
        const firstReport = await readMediaHashBackfillReport(t.adapter);
        expect(firstReport?.finishedAt).toBeNull();

        const passes = 1 + (await passesUntilFinished(storage));

        expect(passes).toBeGreaterThan(2);
        expect(passes).toBeLessThan(MAX_PASSES);
        const filled = await hashes();
        for (const record of records) {
          if (record.id === missing.id) continue;
          expect(filled.get(record.id), `record ${record.id}`).toBe(
            contentHashOf(record.bytes)
          );
        }
        expect(filled.get(missing.id) ?? null).toBeNull();

        const report = await readMediaHashBackfillReport(t.adapter);
        expect(report).toMatchObject({
          hashed: RECORDS - 1,
          unreadableCount: 1,
          unreadable: [
            { id: missing.id, filename: missing.filename, reason: "missing" },
          ],
          lap: 1,
        });
        expect(report?.finishedAt).toEqual(expect.any(String));

        // Each file was read once, and the missing one once: resuming did
        // not read again what an earlier pass had done.
        expect(reads()).toBe(RECORDS);

        // Announced once, naming the file, when the walk reached the end.
        expect(finishedWithUnreadable()).toHaveLength(1);
        expect(finishedWithUnreadable()[0][1]).toMatchObject({
          hashed: RECORDS - 1,
          unreadable: 1,
          files: [{ id: missing.id, filename: missing.filename }],
        });

        // Finished: a later pass reads no file, the missing one included,
        // and does not announce the finish again.
        await pass(storage);
        expect(reads()).toBe(RECORDS);
        expect(finishedWithUnreadable()).toHaveLength(1);
      },
      120_000
    );

    it("starts no file once half the pass's time is spent, leaving the rest to the other jobs", async () => {
      const adapter = await adapterFor("local");
      await earlierLibrary(adapter, 40);
      // A whole read takes two steps of this clock (the check before it and
      // the time it is given), so a 40-step pass has time for 20 files and
      // half of it for 10.
      await pass(counted(adapter, "local").storage, 40);

      const filled = [...(await hashes()).values()].filter(Boolean);
      expect(filled.length).toBeGreaterThan(5);
      expect(filled.length).toBeLessThanOrEqual(10);
    });

    it("tries a file whose read failed again on the next pass, and hashes it once the read works", async () => {
      const adapter = await adapterFor("local");
      const records = await earlierLibrary(adapter, 10);
      const flaky = records[3];
      let failures = 0;
      const storage = failingFor(adapter, flaky.filename, () => {
        // The first two reads fail, as during a short outage.
        if (failures >= 2) return false;
        failures += 1;
        return true;
      });

      const passes = await passesUntilFinished(storage);

      expect(passes).toBeGreaterThanOrEqual(3);
      expect((await hashes()).get(flaky.id)).toBe(contentHashOf(flaky.bytes));
      expect(await readMediaHashBackfillReport(t.adapter)).toMatchObject({
        hashed: 10,
        unreadableCount: 0,
        unreadable: [],
        failing: null,
      });
      expect(finishedWithUnreadable()).toHaveLength(0);
    });

    it("passes over nothing while reads fail: the files after a failing one wait for it", async () => {
      const adapter = await adapterFor("local");
      const records = await earlierLibrary(adapter, 10);
      const ordered = [...records].sort((a, b) => (a.id < b.id ? -1 : 1));
      const first = ordered[0];
      const storage = failingFor(adapter, first.filename, () => true);

      await pass(storage);

      // The walk stopped at the first file, so no other was read past or
      // named, and the report says which file it waits on.
      const filled = [...(await hashes()).values()].filter(Boolean);
      expect(filled).toHaveLength(0);
      expect(await readMediaHashBackfillReport(t.adapter)).toMatchObject({
        unreadableCount: 0,
        failing: { id: first.id, tries: 1 },
        finishedAt: null,
      });
    });

    it("gives up on a file whose read fails three passes in a row, and names it", async () => {
      const adapter = await adapterFor("local");
      const records = await earlierLibrary(adapter, 10);
      const broken = records[6];
      const storage = failingFor(adapter, broken.filename, () => true);

      await passesUntilFinished(storage);

      expect((await hashes()).get(broken.id) ?? null).toBeNull();
      expect(await readMediaHashBackfillReport(t.adapter)).toMatchObject({
        hashed: 9,
        unreadableCount: 1,
        unreadable: [
          { id: broken.id, filename: broken.filename, reason: "error" },
        ],
      });
    });

    it("fails the job, naming nothing, when the storage cannot read files back", async () => {
      const adapter = await adapterFor("local");
      await earlierLibrary(adapter, 3);
      const cannotRead: IStorageAdapter = Object.create(
        adapter
      ) as IStorageAdapter;
      Object.defineProperty(cannotRead, "read", { value: undefined });

      await expect(pass(cannotRead)).rejects.toMatchObject({
        code: "CONFIGURATION_ERROR",
      });

      const report = await readMediaHashBackfillReport(t.adapter);
      expect(report?.unreadableCount ?? 0).toBe(0);
      expect(report?.finishedAt ?? null).toBeNull();
    });

    it("fails the job, giving up on nothing, when the database refuses a fingerprint", async () => {
      const adapter = await adapterFor("local");
      const records = await earlierLibrary(adapter, 5);
      let refusals = 0;
      // The database refuses the first write of a fingerprint, as under a
      // lock timeout; every other statement goes through.
      const refusing = Object.create(t.adapter) as TestNextly["adapter"];
      refusing.update = (async (
        ...args: Parameters<typeof t.adapter.update>
      ) => {
        if (args[0] === "media" && refusals === 0) {
          refusals += 1;
          throw new Error("lock wait timeout exceeded");
        }
        return t.adapter.update(...args);
      }) as typeof t.adapter.update;

      await expect(
        pass(counted(adapter, "local").storage, PER_PASS, { db: refusing })
      ).rejects.toThrow("lock wait timeout exceeded");
      expect(
        (await readMediaHashBackfillReport(t.adapter))?.unreadableCount ?? 0
      ).toBe(0);

      await passesUntilFinished(counted(adapter, "local").storage);

      const filled = await hashes();
      for (const record of records) {
        expect(filled.get(record.id)).toBe(contentHashOf(record.bytes));
      }
      expect(await readMediaHashBackfillReport(t.adapter)).toMatchObject({
        hashed: 5,
        unreadableCount: 0,
      });
    });

    it("looks again a day after finishing, and fills a record an older release wrote since", async () => {
      const adapter = await adapterFor("local");
      await earlierLibrary(adapter, 3);
      const { storage } = counted(adapter, "local");
      await passesUntilFinished(storage);
      const later = await earlierRecord(adapter, "written-later");
      const day = 24 * 60 * 60 * 1000;

      // Within the day: the finished walk is left alone.
      await pass(storage, PER_PASS, { startAt: day / 2 });
      expect((await hashes()).get(later.id) ?? null).toBeNull();

      // A day on: it counts, finds the record, and walks again.
      await pass(storage, PER_PASS, { startAt: day + 1_000 });
      expect((await hashes()).get(later.id)).toBe(contentHashOf(later.bytes));
      const report = await readMediaHashBackfillReport(t.adapter);
      expect(report).toMatchObject({ hashed: 4, unreadableCount: 0 });
      expect(report?.finishedAt).toEqual(expect.any(String));
    });

    it("goes round again for a record written behind its place", async () => {
      const adapter = await adapterFor("local");
      const records = await earlierLibrary(adapter, 10);
      const storage = counted(adapter, "local").storage;

      // A short first pass: part of the walk done.
      await pass(storage, 12);
      const done = await readMediaHashBackfillReport(t.adapter);
      expect(done?.after).not.toBeNull();
      // A record with an id before the walk's place, written meanwhile with
      // no fingerprint, as an older release mid-deploy would write it.
      const behind = await earlierRecord(
        adapter,
        "behind",
        "00000000-0000-4000-8000-000000000000"
      );

      await passesUntilFinished(storage);

      const filled = await hashes();
      expect(filled.get(behind.id)).toBe(contentHashOf(behind.bytes));
      for (const record of records) {
        expect(filled.get(record.id)).toBe(contentHashOf(record.bytes));
      }
      expect(await readMediaHashBackfillReport(t.adapter)).toMatchObject({
        hashed: 11,
        unreadableCount: 0,
        lap: 2,
      });
    });
  }
);
