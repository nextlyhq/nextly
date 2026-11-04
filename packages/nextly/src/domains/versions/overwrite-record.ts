/**
 * What an overwrite saved over, as its history event keeps it.
 *
 * An update that says `_overwrite: true` is applied whatever the current
 * version, so what it replaced is known only from the document as it stood
 * just before the write: its own row, read under the row lock, and the row of
 * the language it saves. Out of date against the version given, it names who
 * made the latest change among the parts that moved, by the same picker a
 * refused update names, so an overwrite and the refusal it stands in for
 * never name two different people.
 *
 * @module domains/versions/overwrite-record
 * @experimental
 */

import type { OverwriteRecord } from "../content-events/write-event";

import {
  givenOf,
  lastChangerOf,
  staleParts,
  type PartState,
  type VersionCheck,
} from "./stale-version";

/**
 * How `check`'s overwrite stood against the document before its write, and
 * whom it replaced.
 *
 * `before.main` is the main row as read under the lock, before the write.
 * `before.language`, where the save writes a language's row, is that row as
 * read before the write (its `part` the language), its counter 0 and its
 * changer nobody where there was no row yet.
 *
 * @experimental
 */
export function overwriteRecordOf(
  check: Extract<VersionCheck, { kind: "overwrite" }>,
  before: { main?: PartState; language?: PartState }
): OverwriteRecord {
  const given = givenOf(check);
  if (!given) return { given: "none", replaced: null };
  // Each read before the write, so nothing of this save's is in them yet.
  const languages = before.language ? [before.language] : [];
  const parts = [...(before.main ? [before.main] : []), ...languages];
  const moved = staleParts(given, { main: before.main, languages });
  if (moved.length === 0) return { given: "current", replaced: null };
  const changer = lastChangerOf(parts, given);
  return {
    given: "stale",
    replaced: changer
      ? {
          kind: changer.kind,
          id: changer.id,
          principalKind: changer.principalKind,
        }
      : null,
  };
}
