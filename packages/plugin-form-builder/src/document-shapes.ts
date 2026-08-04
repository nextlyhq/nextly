/**
 * Reading a stored row as one of this plugin's documents.
 *
 * The services layer answers with a loose row -- `id`, `createdAt`, `updatedAt`
 * and an `unknown` index signature -- while this plugin declares concrete
 * documents. There is no overlap for TypeScript to check between the two, so
 * the conversion goes through `unknown` and **nothing here is verified at
 * compile time**. A single assertion does not compile:
 *
 * ```
 * error TS2352: Conversion of type 'CollectionEntry' to type
 * 'SubmissionDocument' may be a mistake because neither type sufficiently
 * overlaps with the other.
 * ```
 *
 * The parameters are therefore `unknown`, which is what the rows honestly are
 * at this boundary. One assertion from `unknown` is legal where two from a
 * partially-known shape were needed, so the widening removes a cast rather
 * than adding one -- but it removes the notation, not the risk.
 *
 * The point of this module is therefore not safety it cannot provide. It is
 * that the unchecked step happens in ONE place a reviewer can find, rather than
 * at five call sites where it reads as ordinary code. It has already cost
 * something: a mutation envelope was once assigned straight into
 * `SubmissionDocument`, compiled, and handed every caller `undefined` for
 * `submission.id`.
 *
 * The real guarantee is meant to come from elsewhere. Nextly generates
 * per-collection types from the schema, and the Direct API is generic over the
 * collection slug, so `nextly.find({ collection: "posts" })` is typed. The
 * plugin-facing services are not generic yet; when they are, these functions
 * lose their reason to exist and the call sites can hold the row directly.
 *
 * @module document-shapes
 */

import type { FormDocument, SubmissionDocument } from "./types";

/**
 * A row as the services layer hands it over.
 *
 * `unknown` rather than `Record<string, unknown>`: the read paths type their
 * results loosely enough that a narrower parameter only moves the assertion to
 * the call site, which is the thing this module exists to stop.
 */
type StoredRow = unknown;

/**
 * Read a stored row as a submission.
 *
 * Does not validate, and deliberately cannot throw: every caller is on a path
 * where the row has already committed, so rejecting here would turn a saved
 * submission into an error the visitor is invited to retry.
 */
export function asSubmissionDocument(row: StoredRow): SubmissionDocument {
  return row as SubmissionDocument;
}

/** Read a list of stored rows as submissions. */
export function asSubmissionDocuments(
  rows: readonly StoredRow[]
): SubmissionDocument[] {
  return rows as SubmissionDocument[];
}

/** Read a stored row as a form. Same contract as {@link asSubmissionDocument}. */
export function asFormDocument(row: StoredRow): FormDocument {
  return row as FormDocument;
}
