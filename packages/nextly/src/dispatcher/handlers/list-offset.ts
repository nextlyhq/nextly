/**
 * Where a page of an offset-paged list starts.
 *
 * @module dispatcher/handlers/list-offset
 */
import { toNumber } from "../helpers/validation";
import type { Params } from "../types";

/**
 * The offset a list request asks for: `offset` (canonical) or a 1-based
 * `page`, which is what the admin's shared query builder writes. `offset`
 * wins when both are given; a page needs a positive limit to become one.
 * Shared by the Singles and field-group lists, so a page means the same row
 * on both.
 */
export function readListOffset(
  p: Params,
  limit: number | undefined
): number | undefined {
  const offset = toNumber(p.offset);
  if (!p.offset && p.page !== undefined && limit && limit > 0) {
    const page1Based = toNumber(p.page);
    if (page1Based !== undefined && page1Based > 0) {
      return (page1Based - 1) * limit;
    }
  }
  return offset;
}
