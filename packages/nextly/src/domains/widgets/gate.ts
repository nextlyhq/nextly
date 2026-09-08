/**
 * Whether a reader may be told a widget exists.
 *
 * 🔴 Its own module, with NO IMPORTS, and that is the whole design. Two
 * processes decide this question about the same serialized declaration -- the
 * layout endpoint, which drops a card before sending it, and the browser, which
 * drops it again before rendering -- and they must not answer differently. A
 * card the server sends and the browser hides is invisible with nothing logged;
 * a card the server hides and the browser would have shown is a permission
 * someone cannot exercise. Neither reports itself.
 *
 * The rule lived twice for a while, held together by a parity test. That test
 * could only ever cover the declarations someone thought to write down: it
 * proved the two agreed on ten inputs, not that they agreed. A new accepted
 * gate form, or a change to how an unusable one is read, would pass every case
 * in it and still split the two processes apart.
 *
 * So this file has no dependencies at all -- not `NextlyError`, not a type from
 * a sibling -- because that is what lets it be an entry point the browser can
 * import (`nextly/widget-gate`) without pulling the server in behind it. Adding
 * an import here is not a small change: it is what would force the copy back.
 *
 * @module domains/widgets/gate
 */

/**
 * The permission slugs a gate names, or `undefined` when the declaration cannot
 * be used as a gate at all.
 *
 * 🔴 The `undefined` return is NOT "no gate" -- that is the field being absent,
 * which callers check first. It means the value is there and unusable, and
 * every caller reads it as a REFUSAL. That direction is deliberate and is one
 * the validation had to be corrected into once: reading a malformed gate as "no
 * permission declared" failed OPEN, returning the card to every authenticated
 * caller.
 *
 * An empty array is unusable for the same reason and it is the member of that
 * set most likely to be written on purpose. "Any of nothing" is satisfied by
 * nobody, so admitting it would gate a card for everyone while reading, to its
 * author, like a widened grant.
 */
export function requiredPermissionSlugs(
  value: unknown
): readonly string[] | undefined {
  const usable = (slug: unknown): slug is string =>
    typeof slug === "string" && slug !== "";

  if (usable(value)) return [value];
  // Every member must be usable, rather than filtering the junk out: an array
  // whose second entry is a number is a mistake its author can still see, and
  // silently gating on the first entry alone answers a narrower question than
  // they wrote.
  if (Array.isArray(value) && value.length > 0 && value.every(usable)) {
    return [...(value as readonly string[])];
  }
  return undefined;
}

/**
 * The gate decision, parameterised by how a single slug gets answered.
 *
 * 🔴 The two processes differ ONLY in that: the server holds a resolved verdict
 * map, the browser holds the session's permission predicate. Everything else --
 * that an absent gate admits everyone, that an unusable one admits nobody, that
 * an array is ANY-of rather than all-of -- is the same question, so it is asked
 * in one place and each caller supplies its own answerer.
 *
 * Any-of rather than all-of because that is the shape every existing consumer
 * of this vocabulary has: `requireAnyPermission` at the route layer, the
 * capability lists in the admin, and `ReleasesService.authorize`, which treats
 * `create` or `publish` as satisfying `read`. Nothing needs all-of yet, and
 * inventing the second form before something does is how a declaration ends up
 * with two meanings nobody can keep straight.
 */
export function widgetGateHolds(
  requiredPermission: unknown,
  holds: (slug: string) => boolean
): boolean {
  if (requiredPermission === undefined) return true;
  const slugs = requiredPermissionSlugs(requiredPermission);
  // Present and unusable. Refused rather than read as absent.
  if (slugs === undefined) return false;
  return slugs.some(holds);
}

/**
 * The gate decision against a map of already-resolved verdicts.
 *
 * The server's adapter over {@link widgetGateHolds}. `verdicts.get` answers
 * `undefined` for a slug nobody resolved, and `undefined !== true`, so an
 * unresolved member denies on its own terms rather than being mistaken for a
 * held grant.
 */
export function holdsWidgetPermission(
  requiredPermission: unknown,
  verdicts: ReadonlyMap<string, boolean>
): boolean {
  return widgetGateHolds(
    requiredPermission,
    slug => verdicts.get(slug) === true
  );
}
