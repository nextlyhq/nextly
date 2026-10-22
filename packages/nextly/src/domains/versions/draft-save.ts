/**
 * Holding a save as the working draft, and keeping it in the history.
 *
 * A save that names no status on a published document does not change what is
 * live: it is stored as the document's working draft, one row per document and
 * language that every later save rewrites. On its own that row keeps only the
 * newest save, credited to whoever saved last. So the same step also records
 * the save as a durable version, numbered, retried and retained like every
 * other version, and credited to the person who made it.
 *
 * Both steps live here, behind one function, so no write path can hold a draft
 * without recording it. The version mirrors the draft row it was saved into:
 * the same language key and the same snapshot. A write path that stores
 * several drafts in one save (one per part of a document) calls this once per
 * draft, and each part's save becomes that part's version.
 *
 * @module domains/versions/draft-save
 */

import type { SystemColumnEntity } from "../../lib/system-columns";
import { readFieldGroupType } from "../field-groups/storage/field-group-type-key";

import type { VersionsDbApi } from "./db-api";
import { documentSystemKeys } from "./snapshot-system-keys";
import type { VersionCaptureService } from "./version-capture-service";
import { VersionsRepository, type VersionRef } from "./versions-repository";

/** One held save. */
export interface DraftSaveInput {
  ref: VersionRef;
  /** The working draft's language key: null for a document with no languages. */
  locale: string | null;
  /**
   * The language the save's version is recorded under, when it is not the
   * draft's key. A document without languages keys its draft under none, yet
   * a snapshot carrying a component was read in the default language, and
   * every other save of it is recorded under that; its draft's version is
   * recorded the same way, so a comparison pairs them. Absent: the draft's key.
   */
  versionLocale?: string | null;
  /** The working draft after this save, as it is stored. */
  snapshot: Record<string, unknown>;
  /**
   * What this save replaces: the previous working draft, or the live document
   * on the first held save. A save whose content equals it records no version.
   */
  replaces: Record<string, unknown>;
  /** Who saved, or null when the write carried no person. */
  createdBy: string | null;
  /** The version this save restored, when it is a restore. */
  sourceVersionNo?: number | null;
  /**
   * Durable versions kept for the document, from its versions config; `false`
   * or omitted leaves history unbounded, as for every capture.
   */
  maxPerDoc?: number | false;
}

/** The version a held save recorded, or null when it changed nothing. */
export interface DraftSaveResult {
  versionNo: number | null;
}

/** The language a held save's version is recorded under. */
function versionLocaleOf(input: DraftSaveInput): string | null {
  return input.versionLocale === undefined ? input.locale : input.versionLocale;
}

/**
 * Store the working draft and record the save as a version, inside `tx`.
 *
 * The version's snapshot leaves out `status`. A held draft is built on the live
 * document, so its snapshot carries the live status, which says nothing about
 * the save. The version row's own `status` (`draft`) is what the version is,
 * and a restore of a snapshot that names no status cannot publish or unpublish
 * anything: on a published document it is held as a draft, like any save.
 */
export async function storeDraftSave(
  tx: VersionsDbApi,
  capture: VersionCaptureService,
  input: DraftSaveInput
): Promise<DraftSaveResult> {
  await new VersionsRepository(tx).upsertWorkingDraft({
    ref: input.ref,
    locale: input.locale,
    snapshot: input.snapshot,
    createdBy: input.createdBy,
  });
  const entity = input.ref.scopeKind === "single" ? "single" : "collection";
  if (sameContent(input.snapshot, input.replaces, entity)) {
    return { versionNo: null };
  }

  // A restore held as a draft replaces the working draft, not the live row, so
  // what it replaces is the undo point: recorded first, under the name every
  // restore's undo point carries, so it takes the number just below the
  // restore's own, which retention keeps. No retention runs here; the restore's
  // capture below trims once, with that protection in place.
  if (typeof input.sourceVersionNo === "number") {
    await capture.capture(tx, {
      ref: input.ref,
      status: "draft",
      snapshot: withoutStatus(input.replaces),
      createdBy: input.createdBy,
      locale: versionLocaleOf(input),
      label: "Before restore",
      // A held draft exists only under the Draft/Published lifecycle.
      lifecycle: true,
    });
  }

  const { versionNo } = await capture.capture(tx, {
    ref: input.ref,
    status: "draft",
    snapshot: withoutStatus(input.snapshot),
    createdBy: input.createdBy,
    locale: versionLocaleOf(input),
    sourceVersionNo: input.sourceVersionNo ?? null,
    maxPerDoc: input.maxPerDoc,
    lifecycle: true,
  });
  return { versionNo };
}

/** A snapshot without the live status a held draft is built on. */
function withoutStatus(
  snapshot: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "status")
  );
}

/**
 * Whether two document snapshots hold the same content: equal in every key an
 * editor writes, whatever their framework keys (id, timestamps, author, status)
 * say. A save moves `updatedAt` every time, so comparing whole snapshots would
 * call every save a change.
 *
 * A component instance (a nested row that names its component type) is a row of
 * its own, and a save rewrites its timestamps too, so those are left out of
 * it as well. A plain group has no framework columns: a key there is content.
 *
 * Key order does not matter. Values are compared as the JSON they are stored
 * as, because one side is usually read back from the database (a date as its
 * string) and the other built in memory (a date as a Date).
 */
export function sameContent(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  /** The kind of document compared: its framework keys differ by kind. */
  entity: SystemColumnEntity = "collection"
): boolean {
  const ignored = documentSystemKeys(entity);
  return (
    canonicalJson(contentOf(a, ignored)) ===
    canonicalJson(contentOf(b, ignored))
  );
}

function contentOf(
  document: Record<string, unknown>,
  ignored: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => !ignored.has(key))
  );
}

/** The timestamps a component row's own columns carry, in both spellings. */
const COMPONENT_ROW_TIMESTAMPS = new Set([
  "created_at",
  "updated_at",
  "createdAt",
  "updatedAt",
]);

/** An object's entries, without a component row's own timestamps. */
function contentEntries(inner: Record<string, unknown>): [string, unknown][] {
  const entries = Object.entries(inner);
  return readFieldGroupType(inner) !== undefined
    ? entries.filter(([key]) => !COMPONENT_ROW_TIMESTAMPS.has(key))
    : entries;
}

/**
 * JSON with object keys sorted at every depth, and component rows' timestamps
 * left out, so equal content is equal text.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          contentEntries(inner as Record<string, unknown>).sort(([x], [y]) =>
            x < y ? -1 : x > y ? 1 : 0
          )
        )
      : inner
  );
}
