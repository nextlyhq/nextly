/**
 * The version a lifecycle or history request was made from, as its body
 * carries it.
 *
 * A save carries `_rev` and `_overwrite` among its values, and the write path
 * reads them there. A publish of every language, a restore and taking the
 * live values carry no values of their own, so their body holds only those
 * two keys, read here and handed to the service as the data it judges.
 *
 * @module dispatcher/helpers/version-input
 */

import { z } from "zod";

import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import {
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_VERSION_KEY,
} from "../../domains/versions/document-revision";

// Only the two keys, their values left for the write path to judge, so a
// malformed one is refused by the same check a save's is. Any other key a
// body names is ignored, as these routes always have.
const VersionInput = z
  .object({
    [DOCUMENT_VERSION_KEY]: z.unknown().optional(),
    [DOCUMENT_OVERWRITE_KEY]: z.unknown().optional(),
  })
  .strip();

/**
 * `_rev` and `_overwrite` from a request's query, for a route whose request
 * carries no body to read them from: a discard is a DELETE, whose body has no
 * defined meaning and which some clients and proxies drop. A query value is
 * text, so `_overwrite=true` and `_overwrite=false` are read as the choice they
 * spell; any other value is left for the write path to refuse.
 */
export function versionInputOfQuery(
  query: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const overwrite = query[DOCUMENT_OVERWRITE_KEY];
  return versionInputOf({
    [DOCUMENT_VERSION_KEY]: query[DOCUMENT_VERSION_KEY],
    [DOCUMENT_OVERWRITE_KEY]:
      overwrite === "true" ? true : overwrite === "false" ? false : overwrite,
  });
}

/**
 * `_rev` and `_overwrite` from a request body, as data the write path judges.
 * No body is the same as an empty one; a body that is not an object is
 * refused, since it cannot say which version it was made from.
 */
export function versionInputOf(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  const parsed = VersionInput.safeParse(body);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  // Absent keys stay absent: `_rev: undefined` is no version given.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  );
}

// A restore's choice of fields: top-level names, each a non-empty string. Any
// other key the body names is left to `versionInputOf` or ignored.
const RestoreFieldsInput = z
  .object({
    fields: z.array(z.string().min(1)).max(1000).optional(),
  })
  .strip();

/**
 * The fields a restore's body chooses, or undefined for every field the
 * version holds. A `fields` that is not a list of names is refused, rather
 * than read as "all of them".
 */
export function restoreFieldsOf(body: unknown): string[] | undefined {
  if (body === undefined || body === null) return undefined;
  const parsed = RestoreFieldsInput.safeParse(body);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  return parsed.data.fields;
}
