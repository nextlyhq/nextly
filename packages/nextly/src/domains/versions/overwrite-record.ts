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

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  recordOverwriteEvent,
  type OverwriteRecord,
  type WriteEventDeps,
  type WriteEventInput,
} from "../content-events/write-event";

import {
  givenOf,
  lastChangerOf,
  staleParts,
  type DocumentRevisionState,
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
 * changer nobody where there was no row yet. `before.languages` is every
 * language's, for a write over all of them at once, such as publishing them
 * all.
 *
 * @experimental
 */
export function overwriteRecordOf(
  check: Extract<VersionCheck, { kind: "overwrite" }>,
  before: {
    main?: PartState;
    language?: PartState;
    languages?: readonly PartState[];
  }
): OverwriteRecord {
  const given = givenOf(check);
  if (!given) return { given: "none", replaced: null };
  // Each read before the write, so nothing of this save's is in them yet.
  const languages = [
    ...(before.language ? [before.language] : []),
    ...(before.languages ?? []),
  ];
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

/**
 * Record `check`'s overwrite in the document's history, when the write said
 * to overwrite, in the write's own transaction. Whom it replaced is read from
 * `before`, the rows as the write found them under the lock: the main row,
 * the language it saves, and every language for a write over all of them,
 * which are the ones the main row's read carries unless given apart.
 *
 * @experimental
 */
export async function recordOverwriteIfAsked(
  tx: TransactionContext,
  deps: WriteEventDeps,
  check: VersionCheck,
  write: Pick<WriteEventInput, "subject" | "actor" | "personName"> & {
    locale?: string | null;
  },
  before: {
    main: DocumentRevisionState | undefined;
    language?: PartState | undefined;
    languages?: readonly PartState[];
  }
): Promise<void> {
  if (check.kind !== "overwrite") return;
  await recordOverwriteEvent(tx, deps, {
    ...write,
    ...overwriteRecordOf(check, {
      main: before.main?.main,
      language: before.language,
      languages:
        before.languages ?? Object.values(before.main?.languages ?? {}),
    }),
  });
}
