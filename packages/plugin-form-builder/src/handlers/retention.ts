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
  /** The time the pass judges ages against; the clock when absent. */
  now?: () => Date;
}

/** The retention job, run by `run` until the deadline the runner gives it. */
export function retentionJob(
  run: (deadline: Date) => Promise<void>
): JobDefinition {
  return defineJob({
    slug: RETENTION_JOB,
    handler: async (_input, context) => {
      await run(context.deadline);
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
 * Delete what is past keeping, until `deadline`. Answers whether it finished;
 * one that did not has queued its continuation.
 */
export async function runRetention(
  deps: RetentionDeps,
  deadline: Date
): Promise<"done" | "continued"> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const spamCutoff = new Date(now - SPAM_KEEP_DAYS * DAY_MS);
  const finished =
    (await deleteWhere(
      deps,
      { status: { equals: "spam" }, createdAt: { less_than: spamCutoff } },
      deadline
    )) && (await deleteAgedPerForm(deps, now, deadline));
  if (finished) return "done";
  await deps.jobs.queue({ task: RETENTION_JOB, input: null });
  return "continued";
}

/** Each form that keeps submissions for a while: those older than that. */
async function deleteAgedPerForm(
  deps: RetentionDeps,
  now: number,
  deadline: Date
): Promise<boolean> {
  for (let page = 1; ; page++) {
    const { data } = await deps.collections.listEntries(
      deps.formsSlug,
      { pagination: { limit: PAGE, page }, depth: 0 },
      { as: "system" }
    );
    const forms = data as Array<{ id: unknown; settings?: unknown }>;
    for (const form of forms) {
      const { keepDays } = normalizeFormSettings(settingsOf(form.settings));
      if (keepDays === undefined) continue;
      const where = {
        form: { equals: String(form.id) },
        createdAt: { less_than: new Date(now - keepDays * DAY_MS) },
      };
      if (!(await deleteWhere(deps, where, deadline))) return false;
    }
    if (forms.length < PAGE) return true;
  }
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
