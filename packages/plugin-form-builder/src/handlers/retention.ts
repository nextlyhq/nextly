/**
 * Submissions are not kept forever. Each night a pass deletes:
 *
 * - each form's submissions older than the form keeps them for
 *   (`settings.keepDays`, set under Settings › Privacy; none keeps them), and
 * - every form's spam older than {@link SPAM_KEEP_DAYS} days, whatever the
 *   form's setting.
 *
 * Then the files those submissions answered with are deleted, once no other
 * submission names them and nothing else uses them (`retention-files`).
 *
 * Each submission is deleted through the collection, one transaction each,
 * so every deletion path runs the same handlers: what it sent is forgotten
 * (`forget-sends`) and its one-response key is handed on. Age is read from
 * `createdAt`, which the system sets, never from what a caller sent.
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

import type { AnyFormField } from "../types";
import { normalizeFormSettings } from "../utils/form-settings";

import { type FreeingCursor, fileIdsOf, freeFiles } from "./retention-files";

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
  media: Pick<PluginContext["services"]["media"], "isInUse" | "delete">;
  formsSlug: string;
  submissionsSlug: string;
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
 * Where a run carries on from: past the spam, and past the forms already
 * done, by id. Handed to the continuation, so a run that stops partway does
 * not spend the next one re-reading the forms it finished.
 */
export interface RetentionCursor {
  spamDone?: boolean;
  afterForm?: string;
  /** Every deletion is done; what is left is freeing files. */
  deletionsDone?: boolean;
  /** The files the deleted submissions answered with, not yet freed. */
  files?: string[];
  /** How far the look for files still named has read, by submission id. */
  afterSubmission?: string;
}

/**
 * The most files a continuation carries. Past that, the rest stay where they
 * are: kept, never deleted on a guess.
 */
const MAX_CARRIED_FILES = 1000;

/** A continuation's cursor, read from its job input; none starts afresh. */
export function retentionCursorOf(input: unknown): RetentionCursor {
  if (!input || typeof input !== "object") return {};
  const { spamDone, afterForm, deletionsDone, files, afterSubmission } =
    input as Record<string, unknown>;
  const ids = Array.isArray(files)
    ? files.filter((id): id is string => typeof id === "string")
    : [];
  return {
    ...(spamDone === true ? { spamDone } : {}),
    ...(typeof afterForm === "string" ? { afterForm } : {}),
    ...(deletionsDone === true ? { deletionsDone } : {}),
    ...(ids.length > 0 ? { files: ids } : {}),
    ...(typeof afterSubmission === "string" ? { afterSubmission } : {}),
  };
}

/**
 * Delete what is past keeping, until `deadline`, from `cursor`, then free the
 * files those submissions answered with that nothing else uses. Answers
 * whether it finished; one that did not has queued its continuation, with
 * where it stopped.
 */
export async function runRetention(
  deps: RetentionDeps,
  deadline: Date,
  cursor: RetentionCursor = {}
): Promise<"done" | "continued"> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const files = new Set(cursor.files);
  if (!cursor.deletionsDone) {
    const stopped = await deleteExpired(
      deps,
      now,
      deadline,
      cursor,
      fileCollector(deps, files)
    );
    if (stopped !== "done") {
      return continueFrom(deps, { ...stopped, files: [...files] });
    }
  }
  const freeing: FreeingCursor = {
    files: [...files],
    ...(cursor.afterSubmission
      ? { afterSubmission: cursor.afterSubmission }
      : {}),
  };
  const freed = await freeFiles(deps, freeing, deadline);
  if (freed === "done") return "done";
  return continueFrom(deps, { spamDone: true, deletionsDone: true, ...freed });
}

/**
 * The deletions: old spam, then each form's submissions past keeping. Answers
 * "done", or where to carry on from.
 */
async function deleteExpired(
  deps: RetentionDeps,
  now: number,
  deadline: Date,
  cursor: RetentionCursor,
  collect: (row: DeletedRow) => Promise<void>
): Promise<"done" | RetentionCursor> {
  if (!cursor.spamDone) {
    const where = {
      status: { equals: "spam" },
      createdAt: { less_than: new Date(now - SPAM_KEEP_DAYS * DAY_MS) },
    };
    if (!(await deleteWhere(deps, where, deadline, collect))) return {};
  }
  const stoppedAt = await deleteAgedPerForm(
    deps,
    now,
    deadline,
    cursor,
    collect
  );
  return stoppedAt === "done" ? "done" : { spamDone: true, ...stoppedAt };
}

/** A submission about to be deleted, as the pass reads it. */
type DeletedRow = { id: unknown; form?: unknown; data?: unknown };

/**
 * What gathers the files a submission answered with, before it is deleted:
 * read under its form's file fields, each form's fields read once a run.
 */
function fileCollector(
  deps: RetentionDeps,
  files: Set<string>
): (row: DeletedRow) => Promise<void> {
  const fieldsByForm = new Map<string, AnyFormField[]>();
  return async row => {
    const formId = formIdOf(row.form);
    if (formId === undefined) return;
    let fields = fieldsByForm.get(formId);
    if (fields === undefined) {
      fields = await formFields(deps, formId);
      fieldsByForm.set(formId, fields);
    }
    for (const id of fileIdsOf(fields, row.data)) files.add(id);
  };
}

/** A relationship's id, as a read gives it: an id, or the related row. */
function formIdOf(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "id" in value) {
    return formIdOf(value.id);
  }
  return undefined;
}

/** A form's fields, as stored; none for a form that is gone. */
async function formFields(
  deps: RetentionDeps,
  formId: string
): Promise<AnyFormField[]> {
  const { data } = await deps.collections.listEntries(
    deps.formsSlug,
    {
      where: { id: { equals: formId } },
      pagination: { limit: 1 },
      depth: 0,
    },
    { as: "system" }
  );
  const fields = (data[0] as { fields?: unknown } | undefined)?.fields;
  const parsed = typeof fields === "string" ? parseJson(fields) : fields;
  return Array.isArray(parsed) ? (parsed as AnyFormField[]) : [];
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Queue the continuation, with where this run stopped. */
async function continueFrom(
  deps: RetentionDeps,
  cursor: RetentionCursor
): Promise<"continued"> {
  const { files = [], ...rest } = cursor;
  const carried = files.slice(0, MAX_CARRIED_FILES);
  const input = carried.length > 0 ? { ...rest, files: carried } : rest;
  await deps.jobs.queue({
    task: RETENTION_JOB,
    input: Object.keys(input).length > 0 ? input : null,
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
  cursor: RetentionCursor,
  collect: (row: DeletedRow) => Promise<void>
): Promise<"done" | { afterForm?: string }> {
  let after = cursor.afterForm;
  for (;;) {
    const forms = await formsAfter(deps, after);
    for (const form of forms) {
      if (!(await retainForm(deps, form, now, deadline, collect))) {
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
  deadline: Date,
  collect: (row: DeletedRow) => Promise<void>
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
    deadline,
    collect
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
  deadline: Date,
  collect: (row: DeletedRow) => Promise<void>
): Promise<boolean> {
  for (;;) {
    if (pastDeadline(deadline)) return false;
    const { data } = await deps.collections.listEntries(
      deps.submissionsSlug,
      { where, pagination: { limit: PAGE }, depth: 0 },
      { as: "system" }
    );
    const rows = data as DeletedRow[];
    for (const row of rows) {
      if (pastDeadline(deadline)) return false;
      // Its files, read before it goes, for freeing once deletions are done.
      await collect(row);
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
