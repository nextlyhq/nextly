/**
 * One entry read that also answers with the entry as stored: `?stored=1` on
 * `GET /collections/<slug>/entries/<id>`.
 *
 * An editor reads an entry populated, with its related rows drawn, and also
 * at depth 0, with every link as stored, since the populated read leaves out
 * a related row the editor may not read and the form saves the whole entry
 * back. `?stored=1` makes both reads in one request: the entry's own read as
 * asked, and beside it, under `_stored`, the read a separate depth-0 request
 * in the same language and view would give. Each is the service's own read,
 * made as the same caller, so access, hooks, the held draft and the language
 * are judged for each exactly as for two requests.
 *
 * Either read failing fails the answer: half of the pair is no pair. A
 * refusal or a missing entry is said first, from either read, since that is
 * what ends the entry for the caller; otherwise the populated read's failure,
 * then the stored one's.
 *
 * @module dispatcher/helpers/entry-with-stored
 */
import { NextlyError } from "../../errors";

/** Whether a failure ends the entry for its caller: refused, or gone. */
function endsEntry(reason: unknown): boolean {
  return (
    NextlyError.is(reason) &&
    (reason.statusCode === 403 || reason.statusCode === 404)
  );
}

/**
 * The populated read with the stored read beside it as `_stored`, once both
 * have answered; the failure that says most when either fails.
 */
export async function entryWithStored<T extends object>(
  populated: Promise<T>,
  stored: Promise<unknown>
): Promise<T & { _stored: unknown }> {
  const [entry, asStored] = await Promise.allSettled([populated, stored]);
  if (entry.status === "fulfilled" && asStored.status === "fulfilled") {
    return { ...entry.value, _stored: asStored.value };
  }
  const failures = [entry, asStored].flatMap(read =>
    read.status === "rejected" ? [read.reason as unknown] : []
  );
  throw failures.find(endsEntry) ?? failures[0];
}
