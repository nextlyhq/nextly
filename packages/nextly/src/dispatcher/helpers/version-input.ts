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
