/**
 * The job that gives media stored before records carried a fingerprint the
 * SHA-256 of their files.
 *
 * A new upload records its fingerprint at once; a record from before has
 * none until this job reaches it. It is kept queued (`sweep`), so every jobs
 * pass a site already triggers (`/api/jobs/run`) runs it with no one queuing
 * it, and each pass does what fits its time: it walks the records without a
 * fingerprint in id order, hashes each file as storage holds it, and stops
 * starting files once half the pass's time is spent, leaving the rest to the
 * other jobs of the pass. A file still being read at the pass's deadline is
 * stopped. Where the walk got to is stored in `nextly_meta` after every
 * batch and whenever a pass stops, so a pass in another process (a
 * serverless function, a restart) carries on from there.
 *
 * A file storage does not hold is passed over and named in the job's report,
 * which the same `nextly_meta` row keeps: how many files were hashed, how
 * many could not be read, and the first of those by name. A read that fails
 * stops the pass where it is, and the next pass tries that file again: an
 * outage of the storage or the database never passes over the files it
 * touches. Only a file whose read fails on `MAX_TRIES` passes in a row is
 * given up on and named. A storage that cannot read files back at all fails
 * the job, and names nothing.
 *
 * At the end of the walk, records still without a fingerprint that the
 * report does not explain (written behind the walk's place while it ran, by
 * an older release mid-deploy, say) send it round again from the start, up
 * to `MAX_LAPS` times. Then the report is marked finished and logged, and
 * later passes read only that row: a missing file is not read again on every
 * pass for ever. Records written after the walk carry their fingerprint from
 * their upload, and an export computes one for any record still without
 * (`hash-when-missing`).
 *
 * Idempotent: each record's fingerprint is written only while it has none
 * and still names the file that was read (`mediaHashWhenMissing`), so a pass
 * delivered twice, or one racing a Replace, writes nothing wrong.
 *
 * @module domains/media/hash-backfill/backfill-job
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { z } from "zod";

import { NextlyError } from "../../../errors/nextly-error";
import type { Logger } from "../../../shared/types";
import { defineJob, type JobDefinition } from "../../jobs/job-registry";
import { errorForLog } from "../remove-stored-files";

import type { StoredFileReading } from "./content-hash";
import { mediaHashWhenMissing } from "./hash-when-missing";

/** The slug the job is registered and kept queued under. */
export const MEDIA_HASH_BACKFILL_JOB = "nextly:media-hash-backfill";

/** The `nextly_meta` key the job's position and report are kept under. */
const MEDIA_HASH_BACKFILL_KEY = "media.hash.backfill";

/** How many records one read of the table fetches. */
const BATCH_SIZE = 50;

/** Passes in a row a file's read may fail before it is given up on. */
const MAX_TRIES = 3;

/**
 * Walks over the table a backfill makes at most. Each walk after the first
 * reads the files the one before could not, once more.
 */
const MAX_LAPS = 3;

/**
 * How many unreadable files the report names; the count covers them all. A
 * library with thousands of missing files keeps a report of bounded size.
 */
const NAMED_UNREADABLE = 100;

/** A file the job could not read, as the report names it. */
const unreadableSchema = z.object({
  id: z.string(),
  filename: z.string(),
  /** `missing`: storage holds nothing at the path; `error`: the read failed. */
  reason: z.enum(["missing", "error"]),
});

const reportSchema = z.object({
  /** The id of the last record the walk has passed, or `null` before any. */
  after: z.string().nullable(),
  /** Files hashed by the job so far. */
  hashed: z.number().int().nonnegative(),
  /** Files that could not be read, every one counted. */
  unreadableCount: z.number().int().nonnegative(),
  /** The first `NAMED_UNREADABLE` of them, by record and path. */
  unreadable: z.array(unreadableSchema),
  /**
   * The record whose read failed on the last pass, and on how many passes in
   * a row: the next pass starts with it.
   */
  failing: z
    .object({ id: z.string(), tries: z.number().int().positive() })
    .nullable()
    .default(null),
  /** Which walk over the table this is, from 1. */
  lap: z.number().int().positive().default(1),
  /** When the walk reached the end, as an ISO time; `null` while it runs. */
  finishedAt: z.string().nullable(),
});

/** What the job has done, as `nextly_meta` keeps it between passes. */
export type MediaHashBackfillReport = z.infer<typeof reportSchema>;

/** The database the job reads and writes. */
type BackfillDb = Pick<DrizzleAdapter, "select" | "update" | "upsert">;

/** What the job needs, resolved when a pass runs rather than when it is built. */
export interface MediaHashBackfillDeps {
  db: () => BackfillDb;
  /** The storage media files are kept in. */
  storage: () => StoredFileReading;
  logger: Logger;
  /** The wall clock, in epoch ms; injected so a pass's budget is testable. */
  clock?: () => number;
}

/** The report as stored, or `null` before the job has run. */
export async function readMediaHashBackfillReport(
  db: Pick<DrizzleAdapter, "select">
): Promise<MediaHashBackfillReport | null> {
  const [row] = await db.select<Record<string, unknown>>("nextly_meta", {
    columns: ["key", "value"],
    where: {
      and: [{ column: "key", op: "=", value: MEDIA_HASH_BACKFILL_KEY }],
    },
  });
  if (!row) return null;
  let value: unknown = row.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const read = reportSchema.safeParse(value);
  return read.success ? read.data : null;
}

async function writeReport(
  db: BackfillDb,
  report: MediaHashBackfillReport
): Promise<void> {
  await db.upsert(
    "nextly_meta",
    {
      key: MEDIA_HASH_BACKFILL_KEY,
      value: JSON.stringify(report),
      updatedAt: new Date(),
    },
    { conflictColumns: ["key"] }
  );
}

/** The next records without a fingerprint, after `after` in id order. */
async function nextBatch(
  db: BackfillDb,
  after: string | null
): Promise<Array<{ id: string; filename: string; size: number | null }>> {
  return db.select<{ id: string; filename: string; size: number | null }>(
    "media",
    {
      columns: ["id", "filename", "size"],
      where: {
        and: [
          { column: "sha256", op: "IS NULL" },
          ...(after === null
            ? []
            : [{ column: "id", op: ">" as const, value: after }]),
        ],
      },
      orderBy: [{ column: "id", direction: "asc" }],
      limit: BATCH_SIZE,
    }
  );
}

/** A report before the job's first pass. */
function freshReport(): MediaHashBackfillReport {
  return {
    after: null,
    hashed: 0,
    unreadableCount: 0,
    unreadable: [],
    failing: null,
    lap: 1,
    finishedAt: null,
  };
}

/**
 * Whether records without a fingerprint remain that the report does not
 * name as unreadable: written behind the walk's place while it ran.
 */
async function unexplainedRemain(
  db: BackfillDb,
  report: MediaHashBackfillReport
): Promise<boolean> {
  const left = await db.select<{ id: string }>("media", {
    columns: ["id"],
    where: { and: [{ column: "sha256", op: "IS NULL" }] },
    limit: report.unreadableCount + 1,
  });
  return left.length > report.unreadableCount;
}

/** What one pass works with, resolved once at its start. */
interface PassContext {
  deps: MediaHashBackfillDeps;
  db: BackfillDb;
  report: MediaHashBackfillReport;
  clock: () => number;
  /** The pass's deadline, in epoch ms; a read still going then is stopped. */
  deadline: number;
  storage: () => StoredFileReading;
}

/**
 * One file: its fingerprint written, or its file named as missing, and the
 * walk moved past it; or, when its read failed, `"stop"`, with the walk left
 * on it so the next pass tries it again, until `MAX_TRIES` passes have.
 */
async function hashOne(
  pass: PassContext,
  item: { id: string; filename: string; size: number | null }
): Promise<"next" | "stop"> {
  const { report } = pass;
  let hash: string | null;
  try {
    hash = await mediaHashWhenMissing(
      {
        db: pass.db,
        storage: pass.storage(),
        deadline: pass.deadline,
        clock: pass.clock,
      },
      item
    );
  } catch (error) {
    // A storage that cannot read files back cannot hash any: the job
    // fails, and no file is named for it.
    if (NextlyError.isCode(error, "CONFIGURATION_ERROR")) throw error;
    const tries = report.failing?.id === item.id ? report.failing.tries + 1 : 1;
    pass.deps.logger.warn(
      "A media file could not be read for its fingerprint",
      { mediaId: item.id, tries, error: errorForLog(error) }
    );
    if (tries < MAX_TRIES) {
      // Stop here, so an outage passes over nothing: the next pass starts
      // with this file.
      report.failing = { id: item.id, tries };
      return "stop";
    }
    noteUnreadable(report, item, "error");
    return movePast(report, item);
  }
  if (hash === null) noteUnreadable(report, item, "missing");
  else report.hashed += 1;
  return movePast(report, item);
}

/** Move the walk past `item`, which no longer holds it up. */
function movePast(
  report: MediaHashBackfillReport,
  item: { id: string }
): "next" {
  report.failing = null;
  report.after = item.id;
  return "next";
}

/**
 * The walk has reached the end: round again from the start while records
 * remain that the report does not explain (up to `MAX_LAPS` walks), or
 * mark the job finished and say so once.
 */
async function endOfWalk(pass: PassContext): Promise<"again" | "finished"> {
  const { db, report } = pass;
  if (report.lap < MAX_LAPS && (await unexplainedRemain(db, report))) {
    // What the next walk cannot read it names afresh, so the count stays
    // one per file.
    report.after = null;
    report.lap += 1;
    report.unreadable = [];
    report.unreadableCount = 0;
    await writeReport(db, report);
    return "again";
  }
  report.finishedAt = new Date(pass.clock()).toISOString();
  await writeReport(db, report);
  announceFinished(pass.deps.logger, report);
  return "finished";
}

/**
 * One pass: hash records from where the last pass stopped until the walk
 * reaches the end, half the time to `deadline` is spent, or a read fails.
 * Answers the report as it stands at the end of the pass.
 */
async function runMediaHashBackfillPass(
  deps: MediaHashBackfillDeps,
  deadline: Date
): Promise<MediaHashBackfillReport> {
  const clock = deps.clock ?? Date.now;
  const db = deps.db();
  const report = (await readMediaHashBackfillReport(db)) ?? freshReport();
  if (report.finishedAt !== null) return report;

  let storage: StoredFileReading | undefined;
  const pass: PassContext = {
    deps,
    db,
    report,
    clock,
    deadline: deadline.getTime(),
    storage: () => (storage ??= deps.storage()),
  };
  // Half the pass's time, as the releases sweep takes: the pass's other
  // jobs are claimed only while time remains, and this one could use it all.
  const startedAt = clock();
  const stopStartingAt = startedAt + (pass.deadline - startedAt) / 2;
  for (;;) {
    const batch = await nextBatch(db, report.after);
    if (batch.length === 0) {
      if ((await endOfWalk(pass)) === "finished") return report;
      continue;
    }
    for (const item of batch) {
      // Checked before each file rather than each batch, since one file can
      // be a large video; the rest waits for the next pass.
      if (clock() >= stopStartingAt || (await hashOne(pass, item)) === "stop") {
        await writeReport(db, report);
        return report;
      }
    }
    await writeReport(db, report);
  }
}

function noteUnreadable(
  report: MediaHashBackfillReport,
  item: { id: string; filename: string },
  reason: "missing" | "error"
): void {
  report.unreadableCount += 1;
  if (report.unreadable.length < NAMED_UNREADABLE) {
    report.unreadable.push({ id: item.id, filename: item.filename, reason });
  }
}

/** Say once that the walk is done, loudly when files could not be read. */
function announceFinished(
  logger: Logger,
  report: MediaHashBackfillReport
): void {
  if (report.unreadableCount === 0) {
    logger.info("Every stored media file now has its fingerprint", {
      hashed: report.hashed,
    });
    return;
  }
  logger.warn(
    "Some stored media files could not be read for their fingerprint",
    {
      hashed: report.hashed,
      unreadable: report.unreadableCount,
      files: report.unreadable,
    }
  );
}

/** The job, kept queued so every jobs pass runs it. */
export function createMediaHashBackfillJob(
  deps: MediaHashBackfillDeps
): JobDefinition<null> {
  return defineJob<null>({
    slug: MEDIA_HASH_BACKFILL_JOB,
    sweep: true,
    handler: async (_input, context) => {
      await runMediaHashBackfillPass(deps, context.deadline);
    },
  });
}
