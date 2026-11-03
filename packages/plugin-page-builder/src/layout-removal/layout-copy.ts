/**
 * A Layout's copy and its version: what a removal records at its final step,
 * and what the guard compares before it lets the delete or unpublish through.
 *
 * The version is the two rows' `updatedAt`, the live row's and the working
 * draft's. Any save of either moves it, so a Layout edited after the copy was
 * taken no longer matches, and the removal takes the copy again rather than
 * deleting an edit its copy does not hold.
 *
 * @module layout-removal/layout-copy
 */
import type { Nextly } from "nextly";

import { toDate, type LayoutCopy } from "./store";

/** The Direct API reads a copy takes. */
export type CopyReads = Pick<Nextly, "find" | "findByID">;

/** A row's `updatedAt` as milliseconds, whichever spelling and form it has. */
function stamp(row: Record<string, unknown> | null): string {
  if (row === null) return "-";
  const date = toDate(row.updatedAt ?? row.updated_at);
  return date === null ? "?" : String(date.getTime());
}

/** The version of a Layout made of `live` and its working draft `draft`. */
export function versionOf(
  live: Record<string, unknown>,
  draft: Record<string, unknown> | null
): string {
  return `${stamp(live)}|${stamp(draft)}`;
}

/** Whether a by-id read with `draft: true` answered a working draft. */
function workingDraft(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    (value as { _isWorkingDraft?: unknown })._isWorkingDraft === true
    ? (value as Record<string, unknown>)
    : null;
}

/** The Layout's working draft, read as the system, or `null` when it has none. */
export async function workingDraftOf(
  nextly: Pick<Nextly, "findByID">,
  layouts: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const read = await nextly.findByID({
    collection: layouts,
    id,
    draft: true,
    depth: 0,
    overrideAccess: true,
  });
  return workingDraft(read);
}

/**
 * The Layout as it is stored now, with its version, read as the system; `null`
 * when it no longer exists.
 */
export async function readLayoutCopy(
  nextly: CopyReads,
  layouts: string,
  id: string
): Promise<{ copy: LayoutCopy; version: string } | null> {
  const found = await nextly.find({
    collection: layouts,
    where: { id: { equals: id } },
    status: "all",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  const live = found.items[0];
  if (typeof live !== "object" || live === null) return null;
  const draft = await workingDraftOf(nextly, layouts, id);
  return {
    copy: { live, draft },
    version: versionOf(live, draft),
  };
}
