/**
 * The version each restored field of a save came from.
 *
 * An editor puts a version's values back as unsaved edits and names, on the
 * save that follows, the version each one came from (`_restoredFrom`, a map of
 * field name to version number). The save records those sources on the
 * version it captures, so the history can say "Restored from" and retention
 * keeps every version named. A source is recorded only while the saved value
 * is still the one its version holds: a restored value undone or overwritten
 * before the save carries none.
 *
 * @module domains/versions/restored-from
 */

import { z } from "zod";

import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import { DOCUMENT_RESTORED_FROM_KEY } from "../../lib/system-columns";
import { deepEqual } from "../../shared/lib/deep-equal";

import type { VersionsDbApi } from "./db-api";
import { VersionsRepository, type VersionRef } from "./versions-repository";

/** Each restored field's version, by top-level field name. */
export type FieldSources = Readonly<Record<string, number>>;

// Field names are top-level and non-empty; versions are durable version
// numbers, which start at 1. Bounded like a restore's own field list. Parsed
// under its own key, so a refusal's path names it.
const RestoredFromInput = z.object({
  [DOCUMENT_RESTORED_FROM_KEY]: z
    .record(z.string().min(1), z.number().int().min(1))
    .refine(map => Object.keys(map).length <= 1000, {
      message: "Too many restored fields.",
    }),
});

/**
 * The restored fields a save's body names, or undefined when it names none.
 *
 * @throws NextlyError.validation for a value that is not a map of field name
 *   to version number, rather than reading it as "nothing restored".
 */
export function restoredFromOf(
  body: Readonly<Record<string, unknown>>
): FieldSources | undefined {
  const value = body[DOCUMENT_RESTORED_FROM_KEY];
  if (value === undefined || value === null) return undefined;
  const parsed = RestoredFromInput.safeParse({
    [DOCUMENT_RESTORED_FROM_KEY]: value,
  });
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  return parsed.data[DOCUMENT_RESTORED_FROM_KEY];
}

/**
 * The named sources still true of what a save stores: each field the save
 * writes with the value its version holds. Undefined when none is.
 *
 * @param named The fields the save names as restored, and their versions.
 * @param saved The values the save writes, by top-level field name.
 * @param versionValues Each named version's values, by version number; a
 *   version missing here is no longer in the history and records nothing.
 */
export function sourcesStillRestored(
  named: FieldSources,
  saved: Readonly<Record<string, unknown>>,
  versionValues: ReadonlyMap<number, Readonly<Record<string, unknown>>>
): FieldSources | undefined {
  const kept: Record<string, number> = {};
  for (const [field, versionNo] of Object.entries(named)) {
    const values = versionValues.get(versionNo);
    if (!values || !Object.hasOwn(saved, field)) continue;
    if (!Object.hasOwn(values, field)) continue;
    if (deepEqual(storedForm(saved[field]), storedForm(values[field]))) {
      kept[field] = versionNo;
    }
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * A value as a version's JSON snapshot stores it. A version read back holds a
 * date as its ISO string while the save being recorded may hold it as a Date,
 * so both sides are compared in this form: compared as they arrive, an
 * unchanged restored date would lose its source.
 */
function storedForm(value: unknown): unknown {
  return value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as unknown);
}

/**
 * The named sources this version records: each field it holds with the value
 * its named version holds, read in `tx` in one query. A version no longer in
 * the history, or a value edited since its restore, records none.
 */
export async function sourcesHeld(
  tx: VersionsDbApi,
  ref: VersionRef,
  named: FieldSources,
  snapshot: Record<string, unknown>
): Promise<FieldSources | undefined> {
  const stored = await new VersionsRepository(tx).snapshotsByVersionNo(
    ref,
    Object.values(named)
  );
  const values = new Map<number, Readonly<Record<string, unknown>>>();
  for (const [versionNo, held] of stored) {
    if (held && typeof held === "object") {
      values.set(versionNo, held as Record<string, unknown>);
    }
  }
  return sourcesStillRestored(named, snapshot, values);
}
