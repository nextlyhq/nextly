/**
 * The status a write will leave a row in, and the request context that carries
 * it to a field's `validate`.
 *
 * A field type can only apply a different rule to published content if it knows
 * the write is publishing, and the write payload alone does not say: an edit to
 * a live entry that never mentions status is still a write to published
 * content. Resolving the two together is what makes "published" mean the same
 * thing whether the write set it or inherited it.
 *
 * @module shared/lib/effective-status
 */

/**
 * The status the row will hold once this write commits.
 *
 * The write's own value when it names one, the stored value otherwise.
 * `undefined` means neither exists — a create that named no status, or a
 * collection with no publish lifecycle at all — and callers should read that as
 * "no status applies" rather than substituting a default, because a collection
 * without a lifecycle has no published state to be in.
 *
 * A non-string value is ignored on both sides. A hook can reintroduce an
 * explicit `status: undefined` (which names no change, and is stripped later on
 * the write path), and a status column can be NULL; neither is a status, and
 * treating either as one would let a write be judged against a value the row
 * will never hold.
 */
export function effectiveStatus(
  patch: Record<string, unknown> | undefined | null,
  stored: Record<string, unknown> | undefined | null
): string | undefined {
  const named = patch?.status;
  if (typeof named === "string") return named;
  const current = stored?.status;
  return typeof current === "string" ? current : undefined;
}

/**
 * The `req` handed to `validateEntryData`.
 *
 * Keys are omitted rather than set to `undefined` so a validator can test
 * presence, and so a write that resolves no status is indistinguishable from
 * one made before status was forwarded at all — which is what keeps a field
 * type's default behaviour unchanged on every path that does not thread it.
 */
export function validationRequest(
  user: unknown,
  status?: string
): Record<string, unknown> {
  const req: Record<string, unknown> = {};
  if (user) req.user = user;
  if (status !== undefined) req.status = status;
  return req;
}
