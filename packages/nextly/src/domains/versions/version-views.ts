/**
 * "The version you last looked at": a marker per person, document and part.
 *
 * The admin records a mark with an explicit call when it actually shows a
 * version or a comparison; no read writes one. A read that wrote would move the
 * marker when nobody looked (a prefetch, a link preview, a second tab, a
 * retry), and because the history list opens first, would leave "since I last
 * looked" always empty.
 *
 * The marker works by visit. A mark more than `VISIT_GAP_MS` after the
 * person's last one starts a new visit. "Last looked at" is the furthest
 * version of the PREVIOUS visit, so the history list's divider, a comparison
 * from that baseline and the marks the admin makes while showing them all agree,
 * in whatever order they arrive. Within a visit the marker only moves forward:
 * opening an older version to check something does not drag it back.
 *
 * Each part (a language, or the part with no language) has its own marker, so
 * it never points across languages. People only: an API key or the system
 * never moves a person's marker.
 *
 * @module domains/versions/version-views
 * @experimental
 */

import { createHash } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { VERSION_VIEWS_TABLE } from "../../schemas/version-views";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { refuseHistoryWriteIfRemovedFromCode } from "../dynamic-collections/services/removed-from-code-writes";

import type { VersionsDbApi } from "./db-api";
import type { VersionRef } from "./versions-repository";

const VIEWS_TABLE = VERSION_VIEWS_TABLE;

/** How long after a person's last mark a new mark starts a new visit. */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** Whose marker, on which document and part. */
export interface VersionViewTarget {
  userId: string;
  ref: VersionRef;
  /** A language, or null for the part with none. */
  part: string | null;
}

/** A marker's stored state. */
export interface VersionViewMarker {
  /** The furthest version looked at in the current visit. */
  versionNo: number;
  /** The furthest version looked at in the visit before it. */
  previousVersionNo: number | null;
  /** The latest mark's time. */
  viewedAt: Date;
  /** When the current visit began. */
  visitStartedAt: Date;
}

interface ViewRow {
  id: string;
  versionNo: number;
  previousVersionNo: number | null;
  viewedAt: Date | string | number;
  visitStartedAt: Date | string | number;
  part?: string | null;
}

/**
 * The digest the one-marker rule is enforced on: one row per person, document
 * and part. A digest because a null part cannot sit in a unique index on every
 * dialect, and the readable composite would pass MySQL's key limit. A null
 * part and a part named "" stay distinct.
 */
export function versionViewKey(target: VersionViewTarget): string {
  const { userId, ref, part } = target;
  const joined = [
    userId,
    ref.scopeKind,
    ref.scopeSlug,
    ref.entryId,
    part === null ? "-" : `=${part}`,
  ]
    .map(encodeURIComponent)
    .join(":");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

/** Dialects return a timestamp as a Date, an ISO string or epoch milliseconds. */
function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function toMarker(row: ViewRow): VersionViewMarker {
  return {
    versionNo: Number(row.versionNo),
    previousVersionNo:
      row.previousVersionNo === null ? null : Number(row.previousVersionNo),
    viewedAt: toDate(row.viewedAt),
    visitStartedAt: toDate(row.visitStartedAt),
  };
}

/**
 * The version the person last looked at, as of `now`: the furthest version of
 * their previous visit. While a visit is under way that is the stored previous
 * visit; once the gap has passed, the visit that just ended is the previous
 * one. Null before a person has a previous visit.
 */
export function lastLookedAt(
  marker: VersionViewMarker,
  now: Date
): number | null {
  const gap = now.getTime() - marker.viewedAt.getTime();
  return gap >= VISIT_GAP_MS ? marker.versionNo : marker.previousVersionNo;
}

/**
 * The marker after a mark of `versionNo` at `now`.
 *
 * Marks can arrive out of order: two requests take the marker's lock in an
 * order their times need not follow. A mark timestamped before the latest one
 * joins the visit it belongs to and moves no time backwards: within the
 * current visit it can only raise the visit's furthest version, and before it
 * (the current visit began after it) it can only raise the previous visit's.
 */
export function nextMarker(
  marker: VersionViewMarker | undefined,
  versionNo: number,
  now: Date
): VersionViewMarker {
  if (!marker) {
    return {
      versionNo,
      previousVersionNo: null,
      viewedAt: now,
      visitStartedAt: now,
    };
  }
  if (now < marker.viewedAt) {
    if (now >= marker.visitStartedAt) {
      return { ...marker, versionNo: Math.max(marker.versionNo, versionNo) };
    }
    return {
      ...marker,
      previousVersionNo: Math.max(
        marker.previousVersionNo ?? versionNo,
        versionNo
      ),
    };
  }
  if (now.getTime() - marker.viewedAt.getTime() >= VISIT_GAP_MS) {
    // A new visit: the one that ended becomes the previous visit.
    return {
      versionNo,
      previousVersionNo: marker.versionNo,
      viewedAt: now,
      visitStartedAt: now,
    };
  }
  return {
    ...marker,
    versionNo: Math.max(marker.versionNo, versionNo),
    viewedAt: now,
  };
}

function keyWhere(key: string) {
  return { and: [{ column: "viewKey", op: "=" as const, value: key }] };
}

/**
 * Record that the person was shown `versionNo` of a part, on the caller's
 * transaction: the caller takes the locks that order the mark against the
 * deletions that sweep markers. Idempotent within a visit: the same mark again
 * leaves the same versions.
 *
 * The marker row is read with a locking read, so two marks of one marker (a
 * list and a comparison shown at once) apply one after the other and neither's
 * forward move is lost. Two first marks that race both insert; the loser's
 * unique violation fails its transaction, which the caller runs once more to
 * update the row the winner made.
 */
export async function markVersionSeen(
  tx: TransactionContext,
  target: VersionViewTarget,
  versionNo: number,
  now: Date = new Date()
): Promise<void> {
  // Refused first when the document's collection or Single is removed from
  // code: a "seen" marker is something recorded about the entry. Read on the
  // caller's transaction.
  await refuseHistoryWriteIfRemovedFromCode(target.ref, {
    executor: tx.getDrizzle(),
  });
  const key = versionViewKey(target);
  const row = await tx.selectOne<ViewRow>(VIEWS_TABLE, {
    columns: [
      "id",
      "versionNo",
      "previousVersionNo",
      "viewedAt",
      "visitStartedAt",
    ],
    where: keyWhere(key),
    forUpdate: true,
  });
  const next = nextMarker(row ? toMarker(row) : undefined, versionNo, now);
  if (row) {
    await tx.update(VIEWS_TABLE, { ...next }, keyWhere(key));
    return;
  }
  await tx.insert(VIEWS_TABLE, {
    id: crypto.randomUUID(),
    userId: target.userId,
    scopeKind: target.ref.scopeKind,
    scopeSlug: target.ref.scopeSlug,
    entryId: target.ref.entryId,
    part: target.part,
    viewKey: key,
    ...next,
    createdAt: now,
  });
}

/** The version the person last looked at in one part, as of `now`. */
export async function readLastLookedAt(
  db: VersionsDbApi,
  target: VersionViewTarget,
  now: Date = new Date()
): Promise<number | null> {
  const [row] = await db.select<ViewRow>(VIEWS_TABLE, {
    columns: [
      "id",
      "versionNo",
      "previousVersionNo",
      "viewedAt",
      "visitStartedAt",
    ],
    where: keyWhere(versionViewKey(target)),
    limit: 1,
  });
  return row ? lastLookedAt(toMarker(row), now) : null;
}

/**
 * The version the person last looked at in each part of a document, as of
 * `now`, for the history list's "You last looked here". Parts with no previous
 * visit are left out.
 */
export async function lastLookedAtByPart(
  db: VersionsDbApi,
  userId: string,
  ref: VersionRef,
  now: Date = new Date()
): Promise<Map<string | null, number>> {
  const rows = await db.select<ViewRow>(VIEWS_TABLE, {
    columns: [
      "id",
      "part",
      "versionNo",
      "previousVersionNo",
      "viewedAt",
      "visitStartedAt",
    ],
    where: {
      and: [
        { column: "userId", op: "=" as const, value: userId },
        { column: "scopeKind", op: "=" as const, value: ref.scopeKind },
        { column: "scopeSlug", op: "=" as const, value: ref.scopeSlug },
        { column: "entryId", op: "=" as const, value: ref.entryId },
      ],
    },
  });
  const byPart = new Map<string | null, number>();
  for (const row of rows) {
    const looked = lastLookedAt(toMarker(row), now);
    if (looked !== null) byPart.set(row.part ?? null, looked);
  }
  return byPart;
}

/**
 * Mark the rows of a history page where "You last looked here" sits: in each
 * part, the row of that part's divider version (`dividerByPart`, the version
 * the person last looked at, or the nearest older one kept). Marked by number,
 * so the divider sits on whichever page holds its row, however the parts
 * interleave. Reads nothing and writes nothing.
 */
export function markLastViewed<
  T extends { versionNo: number | null; locale: string | null },
>(
  rows: readonly T[],
  dividerByPart: ReadonlyMap<string | null, number>
): (T & { lastViewed?: true })[] {
  return rows.map(row =>
    typeof row.versionNo === "number" &&
    dividerByPart.get(row.locale ?? null) === row.versionNo
      ? { ...row, lastViewed: true as const }
      : row
  );
}

/** Remove a document's markers with the document. */
export async function deleteViewsForDocument(
  db: VersionsDbApi,
  ref: VersionRef
): Promise<void> {
  await db.delete(VIEWS_TABLE, {
    and: [
      { column: "scopeKind", op: "=" as const, value: ref.scopeKind },
      { column: "scopeSlug", op: "=" as const, value: ref.scopeSlug },
      { column: "entryId", op: "=" as const, value: ref.entryId },
    ],
  });
}

/** Remove every marker on an entity, when the entity itself is deleted. */
export async function deleteViewsForEntity(
  db: VersionsDbApi,
  scopeKind: VersionScopeKind,
  scopeSlug: string
): Promise<void> {
  await db.delete(VIEWS_TABLE, {
    and: [
      { column: "scopeKind", op: "=" as const, value: scopeKind },
      { column: "scopeSlug", op: "=" as const, value: scopeSlug },
    ],
  });
}
