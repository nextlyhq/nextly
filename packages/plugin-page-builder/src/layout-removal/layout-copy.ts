/**
 * A Layout's copy and its version: what a removal records at its final step,
 * and what the guard compares before it lets the delete or unpublish through.
 *
 * The version is a digest of the two rows' authored content ({@link authoredOf},
 * the projection a restore writes back) and `updatedAt`, the live row's and the
 * working draft's. Any change to either moves it, so a
 * Layout edited after the copy was taken no longer matches, and the removal
 * takes the copy again rather than deleting an edit its copy does not hold.
 *
 * @module layout-removal/layout-copy
 */
import type { Nextly } from "nextly";

import { relationId } from "../default-layout/store";

import { toDate, type LayoutCopy } from "./store";

/** The Direct API reads a copy takes. */
export type CopyReads = Pick<Nextly, "find" | "findByID">;

/** A row's `updatedAt` as milliseconds, whichever spelling and form it has. */
function stamp(row: Record<string, unknown>): string {
  const date = toDate(row.updatedAt ?? row.updated_at);
  return date === null ? "?" : String(date.getTime());
}

/** A string field, or the empty string. */
function textOf(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

/**
 * A Layout row's `areas` repeater as its rows, whichever shape the read handed
 * it over in: an array, or JSON text as SQLite stores a repeater. Anything
 * else reads as no rows.
 */
function areaRows(row: Record<string, unknown>): unknown[] {
  let areas: unknown = row.areas;
  if (typeof areas === "string") {
    try {
      areas = JSON.parse(areas) as unknown;
    } catch {
      areas = [];
    }
  }
  return Array.isArray(areas) ? areas : [];
}

/**
 * The columns a stored Layout row carries that the system writes, never an
 * author: its id, its timestamps, its lifecycle and who made it. Keys starting
 * with `_` (a read's own bookkeeping, such as `_isWorkingDraft`) are left off
 * too.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
  "createdBy",
  "created_by",
  "firstPublishedAt",
  "first_published_at",
  "publishedAt",
  "published_at",
]);

/**
 * The authored fields of a Layout row, as a write takes them: the whole row
 * less what the system writes, so fields another plugin added to Layouts are
 * kept. The one projection both a restore writes back and a version is taken
 * over, so a field a restore would bring back is one whose edit moves the
 * version. The address is left out: each restore sets its own, and a version
 * adds it beside this.
 *
 * `areas` is read through `areaRows`, so SQLite's JSON text reads as the other
 * dialects' arrays; each row's own id is dropped, since it belongs to the rows
 * it was read from, and each component is named by its id.
 */
export function authoredOf(
  row: Record<string, unknown>
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SYSTEM_FIELDS.has(key) || key === "slug" || key.startsWith("_")) {
      continue;
    }
    fields[key] = value;
  }
  fields.areas = areaRows(row).map(area => {
    if (typeof area !== "object" || area === null) return area;
    const rest: Record<string, unknown> = { ...area };
    delete rest.id;
    const component = relationId(rest.component);
    if (component !== null) rest.component = component;
    return rest;
  });
  return fields;
}

/** `value` with every object's keys in order, so equal content prints equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonical((value as Record<string, unknown>)[key])])
  );
}

/** What a version is taken over: the row's authored content, address, state and stamp. */
function contentOf(row: Record<string, unknown> | null): unknown {
  if (row === null) return null;
  return [
    canonical(authoredOf(row)),
    textOf(row, "slug"),
    textOf(row, "status"),
    stamp(row),
  ];
}

/**
 * The version of a Layout made of `live` and its working draft `draft`: a
 * SHA-256 over both rows' authored content and `updatedAt`, as hex.
 *
 * The content, not only the stamp: MySQL and SQLite store `updatedAt` to the
 * second, so an edit landing in the same second as the copy would leave a
 * stamp-only version unchanged, and the delete would take content its copy
 * does not hold. Fixed length, so it fits the column it is stored in.
 */
export async function versionOf(
  live: Record<string, unknown>,
  draft: Record<string, unknown> | null
): Promise<string> {
  const text = JSON.stringify([contentOf(live), contentOf(draft)]);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
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
async function workingDraftOf(
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
    version: await versionOf(live, draft),
  };
}
