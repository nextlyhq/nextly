/**
 * The version a claimant's copy started from, and what changed since.
 *
 * A claim and a renewal may name the version the editor's copy started from
 * (`_rev`), the one a save from that copy would send. The lock then answers
 * whether someone else has changed the document since, through the one
 * reader every surface describing a change uses (`changesSinceStartedFrom`):
 * so the heartbeat's notice, a refused save and a recovery point's offer
 * cannot describe one change differently. The lock still gates no write; this
 * only tells the holder.
 *
 * @module domains/document-lock/held-version
 * @experimental
 */
import { getService } from "../../di";
import { changesSinceStartedFrom } from "../versions/recovery-point-changes";
import {
  givenVersionOf,
  type ChangeSinceArgs,
  type DecodedVersion,
} from "../versions/stale-version";

import type { DocumentLockChange, DocumentRef } from "./types";

/**
 * The version a claim or renewal body names, decoded; undefined when it names
 * none.
 *
 * Decoded as a save's `_rev` is, so a malformed one is refused with the same
 * 400 rather than read as a change by someone else. Only decoded, never
 * judged as a write: a claim or renewal naming no version is answered as
 * before, whatever a write is required to name.
 *
 * @throws NextlyError.validation for a `_rev` that is not a version.
 */
export function heldVersionOf(
  body: Readonly<Record<string, unknown>>
): DecodedVersion | undefined {
  return givenVersionOf(body);
}

/**
 * The copy's language: the one language its version names. An editor's copy
 * is read in one language, so its version names that one (`7.es:3`) or none
 * (`7`, a document without translations); a version naming several came from
 * a read of every language, and only the document's own row is judged.
 */
function languageOf(held: DecodedVersion): string | null {
  const named = Object.keys(held.languages);
  return named.length === 1 ? named[0] : null;
}

/**
 * What someone else changed in `ref` since `held`, in the parts it covers;
 * undefined when nothing moved or the document is gone.
 */
export async function changeSinceHeldVersion(
  ref: DocumentRef,
  held: DecodedVersion,
  reader: ChangeSinceArgs["reader"]
): Promise<DocumentLockChange | undefined> {
  return changesSinceStartedFrom(getService("adapter"), {
    scopeKind: ref.scopeKind,
    slug: ref.slug,
    entryId: ref.entryId,
    given: held,
    locale: languageOf(held),
    reader,
  });
}
