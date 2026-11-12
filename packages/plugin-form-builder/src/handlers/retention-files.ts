/**
 * The files the retention pass frees: the uploads its deleted submissions
 * answered with, once nothing else uses them.
 *
 * A form's file answer is a media id (a list of them for a field taking
 * several) inside the submission's answers, which core's usage record does
 * not read. So a file is freed only when both hold:
 *
 * - no remaining submission's answers name it, which this checks by reading
 *   them, conservatively: an id anywhere in the answers keeps the file, and
 *   submissions stored before any record of files existed are read too;
 * - core says nothing else uses it (`ctx.services.media.isInUse`): no
 *   document's field, avatar or logo, and the usage record is built.
 *
 * Deleting media is refused inside a transaction, so this runs after the
 * submissions' own deletions have committed.
 *
 * @module handlers/retention-files
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import type { AnyFormField } from "../types";

/** The media ids a submission answered with, under its form's file fields. */
export function fileIdsOf(
  fields: readonly AnyFormField[],
  data: unknown
): string[] {
  const answers = answersOf(data);
  const ids: string[] = [];
  for (const field of fields) {
    if (field.type !== "file") continue;
    const value = answers[field.name];
    for (const id of Array.isArray(value) ? value : [value]) {
      if (typeof id === "string" && id !== "") ids.push(id);
    }
  }
  return ids;
}

/** A submission's answers as stored: an object, or a JSON string of one. */
function answersOf(data: unknown): Record<string, unknown> {
  let parsed = data;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** What freeing files reads and deletes with. */
export interface FreeingDeps {
  collections: PluginContext["services"]["collections"];
  media: Pick<PluginContext["services"]["media"], "isInUse" | "delete">;
  submissionsSlug: string;
}

/** Where freeing carries on from: the ids left, and how far the scan got. */
export interface FreeingCursor {
  files: string[];
  afterSubmission?: string;
}

/** Submissions read at a time while looking for the files still named. */
const SCAN_PAGE = 200;

function pastDeadline(deadline: Date): boolean {
  return Date.now() >= deadline.getTime();
}

/**
 * Free the files among `cursor.files` nothing uses, until `deadline`.
 * Answers "done", or where to carry on from.
 */
export async function freeFiles(
  deps: FreeingDeps,
  cursor: FreeingCursor,
  deadline: Date
): Promise<"done" | FreeingCursor> {
  const left = new Set(cursor.files);
  const scanned = await keepNamed(deps, left, cursor.afterSubmission, deadline);
  if (scanned !== "done") return scanned;
  for (const id of [...left]) {
    if (pastDeadline(deadline)) {
      // Scanned already: what is left was named by none.
      return { files: [...left], afterSubmission: SCAN_DONE };
    }
    await freeOne(deps, id);
    left.delete(id);
  }
  return "done";
}

/**
 * Read the remaining submissions, by id from `after`, taking out of `left`
 * every file one still names. Answers "done" once all are read, or where to
 * carry on from when the deadline comes first.
 */
async function keepNamed(
  deps: FreeingDeps,
  left: Set<string>,
  after: string | undefined,
  deadline: Date
): Promise<"done" | FreeingCursor> {
  let position = after;
  for (;;) {
    if (left.size === 0) return "done";
    if (pastDeadline(deadline)) {
      return {
        files: [...left],
        ...(position ? { afterSubmission: position } : {}),
      };
    }
    const rows = await submissionsAfter(deps, position);
    for (const row of rows) {
      forgetNamedBy(left, row.data);
      position = String(row.id);
    }
    if (rows.length < SCAN_PAGE) return "done";
  }
}

/** Take out of `left` every id a submission's answers name. */
function forgetNamedBy(left: Set<string>, data: unknown): void {
  const answers = JSON.stringify(data ?? null);
  for (const id of left) if (answers.includes(id)) left.delete(id);
}

/**
 * The scan's position once it has read every submission, so a continuation
 * goes straight to freeing. No id sorts after it.
 */
export const SCAN_DONE = "￿";

/** The next page of submissions after `after`, by id: ids and answers. */
async function submissionsAfter(
  deps: FreeingDeps,
  after: string | undefined
): Promise<Array<{ id: unknown; data?: unknown }>> {
  if (after === SCAN_DONE) return [];
  const { data } = await deps.collections.listEntries(
    deps.submissionsSlug,
    {
      ...(after === undefined
        ? {}
        : { where: { id: { greater_than: after } } }),
      sort: { field: "id", direction: "asc" },
      pagination: { limit: SCAN_PAGE },
      depth: 0,
    },
    { as: "system" }
  );
  return data;
}

/** Delete one file, unless anything uses it; one already gone is fine. */
async function freeOne(deps: FreeingDeps, id: string): Promise<void> {
  if (await deps.media.isInUse(id)) return;
  try {
    await deps.media.delete(id);
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return;
    throw error;
  }
}
