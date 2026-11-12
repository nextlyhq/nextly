/**
 * Submissions are not kept forever. Each night a pass deletes:
 *
 * - each form's submissions older than the form keeps them for
 *   (`settings.keepDays`, set under Settings › Privacy; none keeps them), and
 * - every form's spam older than {@link SPAM_KEEP_DAYS} days, whatever the
 *   form's setting.
 *
 * Each submission is deleted through the collection, one transaction each,
 * so every deletion path runs the same handlers: what it sent is forgotten
 * (`forget-sends`) and its one-response key is handed on. Age is read from
 * `createdAt`, which the system sets, never from what a caller sent.
 *
 * Deleting a submission releases the uploads it held, and their files are
 * deleted once the deletion commits (`upload-claims`, `upload-cleanup`).
 * Last, the pass frees what an earlier deletion could not (a storage error,
 * a file then in use) and the uploads no submission claimed within a day.
 *
 * A pass stops at the deadline its jobs run gives it and queues a
 * continuation, so a large backlog is worked through on the next runs rather
 * than waiting a day.
 *
 * @module handlers/retention
 */
import {
  defineJob,
  type JobDefinition,
  NextlyError,
  type PluginContext,
  type PluginSchedule,
} from "@nextlyhq/plugin-sdk";

import { normalizeFormSettings } from "../utils/form-settings";

import { sweepUploads, type UploadCleanupDeps } from "./upload-cleanup";

/** The retention job's slug. */
export const RETENTION_JOB = "form-builder:retention";

/** The schedule that runs it each night. */
export const RETENTION_SCHEDULE: PluginSchedule = {
  slug: "form-builder-retention-nightly",
  cron: "@daily",
  job: RETENTION_JOB,
};

/** How long spam is kept, whatever a form's setting. */
const SPAM_KEEP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows read at a time: forms, or one form's submissions to delete. */
const PAGE = 100;

/** What the pass reads, deletes and queues with. */
export interface RetentionDeps {
  collections: PluginContext["services"]["collections"];
  jobs: Pick<PluginContext["services"]["jobs"], "queue">;
  formsSlug: string;
  submissionsSlug: string;
  /** What the uploads' files are freed with; none frees no files. */
  uploads?: UploadCleanupDeps;
  /** The time the pass judges ages against; the clock when absent. */
  now?: () => Date;
}

/** The retention job, run by `run` until the deadline the runner gives it. */
export function retentionJob(
  run: (deadline: Date, cursor: RetentionCursor) => Promise<void>
): JobDefinition {
  return defineJob({
    slug: RETENTION_JOB,
    handler: async (input, context) => {
      await run(context.deadline, retentionCursorOf(input));
    },
  });
}

/** A form's settings as stored: an object, or a JSON string of one. */
function settingsOf(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function pastDeadline(deadline: Date): boolean {
  return Date.now() >= deadline.getTime();
}

/**
 * Where a run carries on from: past the spam, past the forms already done,
 * by id, and past every form. Handed to the continuation, so a run that
 * stops partway does not spend the next one re-reading what it finished.
 */
export interface RetentionCursor {
  spamDone?: boolean;
  afterForm?: string;
  formsDone?: boolean;
}

/** A continuation's cursor, read from its job input; none starts afresh. */
export function retentionCursorOf(input: unknown): RetentionCursor {
  if (!input || typeof input !== "object") return {};
  const { spamDone, afterForm, formsDone } = input as Record<string, unknown>;
  return {
    ...(spamDone === true ? { spamDone } : {}),
    ...(typeof afterForm === "string" ? { afterForm } : {}),
    ...(formsDone === true ? { formsDone } : {}),
  };
}

/**
 * Delete what is past keeping, until `deadline`, from `cursor`. Answers
 * whether it finished; one that did not has queued its continuation, with
 * where it stopped.
 */
export async function runRetention(
  deps: RetentionDeps,
  deadline: Date,
  cursor: RetentionCursor = {}
): Promise<"done" | "continued"> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  if (!cursor.spamDone) {
    const spamCutoff = new Date(now - SPAM_KEEP_DAYS * DAY_MS);
    const where = {
      status: { equals: "spam" },
      createdAt: { less_than: spamCutoff },
    };
    if (!(await deleteWhere(deps, where, deadline))) {
      return continueFrom(deps, {});
    }
  }
  if (!cursor.formsDone) {
    const stoppedAt = await deleteAgedPerForm(deps, now, deadline, cursor);
    if (stoppedAt !== "done") {
      return continueFrom(deps, { spamDone: true, ...stoppedAt });
    }
  }
  if (deps.uploads && !(await sweepUploads(deps.uploads, now, deadline))) {
    return continueFrom(deps, { spamDone: true, formsDone: true });
  }
  return "done";
}

/** Queue the continuation, with where this run stopped. */
async function continueFrom(
  deps: RetentionDeps,
  cursor: RetentionCursor
): Promise<"continued"> {
  await deps.jobs.queue({
    task: RETENTION_JOB,
    input: Object.keys(cursor).length > 0 ? { ...cursor } : null,
  });
  return "continued";
}

/**
 * Each form that keeps submissions for a while, in id order from the cursor:
 * those older than that. Answers "done", or where to carry on from: just
 * before the form it stopped in.
 */
async function deleteAgedPerForm(
  deps: RetentionDeps,
  now: number,
  deadline: Date,
  cursor: RetentionCursor
): Promise<"done" | { afterForm?: string }> {
  let after = cursor.afterForm;
  for (;;) {
    const forms = await formsAfter(deps, after);
    for (const form of forms) {
      if (!(await retainForm(deps, form, now, deadline))) {
        return after === undefined ? {} : { afterForm: after };
      }
      after = String(form.id);
    }
    if (forms.length < PAGE) return "done";
  }
}

/** The next page of forms after `after`, by id. */
async function formsAfter(
  deps: RetentionDeps,
  after: string | undefined
): Promise<Array<{ id: unknown; settings?: unknown }>> {
  const { data } = await deps.collections.listEntries(
    deps.formsSlug,
    {
      ...(after === undefined
        ? {}
        : { where: { id: { greater_than: after } } }),
      sort: { field: "id", direction: "asc" },
      pagination: { limit: PAGE },
      depth: 0,
    },
    { as: "system" }
  );
  return data;
}

/**
 * One form: its submissions past keeping, if it keeps them for a while.
 * Answers false when the deadline stopped it first.
 */
async function retainForm(
  deps: RetentionDeps,
  form: { id: unknown; settings?: unknown },
  now: number,
  deadline: Date
): Promise<boolean> {
  if (pastDeadline(deadline)) return false;
  const { keepDays } = normalizeFormSettings(settingsOf(form.settings));
  if (keepDays === undefined) return true;
  return deleteWhere(
    deps,
    {
      form: { equals: String(form.id) },
      createdAt: { less_than: new Date(now - keepDays * DAY_MS) },
    },
    deadline
  );
}

/**
 * Delete the submissions `where` selects, a page at a time. Answers false
 * when the deadline stopped it with some left. Each page is read afresh,
 * since what was deleted no longer matches.
 */
async function deleteWhere(
  deps: RetentionDeps,
  where: Record<string, unknown>,
  deadline: Date
): Promise<boolean> {
  for (;;) {
    if (pastDeadline(deadline)) return false;
    const { data } = await deps.collections.listEntries(
      deps.submissionsSlug,
      { where, pagination: { limit: PAGE }, depth: 0 },
      { as: "system" }
    );
    const rows = data as Array<{ id: unknown }>;
    for (const row of rows) {
      if (pastDeadline(deadline)) return false;
      await deleteOne(deps, String(row.id));
    }
    if (rows.length < PAGE) return true;
  }
}

/**
 * Delete one submission. One another runner, or a person, deleted first is
 * already gone, which is what this wanted.
 */
async function deleteOne(deps: RetentionDeps, id: string): Promise<void> {
  try {
    await deps.collections.deleteEntry(deps.submissionsSlug, id, {
      as: "system",
    });
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return;
    throw error;
  }
}
