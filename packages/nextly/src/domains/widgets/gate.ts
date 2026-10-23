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
 * Every permission slug a gate names, once each, or `undefined` when the
 * declaration cannot be used as a gate at all: what a server must resolve a
 * verdict for before it can ask {@link widgetGateHolds}.
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
  const groups = requiredPermissionGroups(value);
  return groups === undefined ? undefined : [...new Set(groups.flat())];
}

/**
 * What a widget's `requiredPermission` may be: one slug, an ANY-of array of
 * slugs, or `{ allOf }`, whose entries must ALL hold, each a slug or an any-of
 * array of slugs.
 *
 * @experimental The `allOf` form. One level only: an entry is a slug or an
 * array of slugs, never another `allOf`, so a gate always reads as "every one
 * of these, each satisfied by any of its slugs" and never as a nested formula.
 */
export type WidgetPermissionGate =
  | string
  | readonly string[]
  | { readonly allOf: readonly (string | readonly string[])[] };

/**
 * The gate as groups that must ALL hold, each satisfied by ANY of its slugs, or
 * `undefined` when the declaration cannot be used as a gate.
 *
 * Every form reads into this one shape, so the decision has one rule: a slug is
 * one group of one, an array is one any-of group, and `{ allOf }` is one group
 * per entry. A slug or an array therefore means exactly what it meant before
 * `allOf` existed.
 *
 * An empty `allOf`, an empty entry, an entry that is not a slug or an array of
 * slugs, and an object carrying anything but `allOf` are all unusable, for the
 * reason the empty array is above: each would gate a card for everyone, or for
 * nobody, while reading to its author like the opposite.
 */
export function requiredPermissionGroups(
  value: unknown
): readonly (readonly string[])[] | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const allOf = (value as { allOf?: unknown }).allOf;
    if (keys.length !== 1 || keys[0] !== "allOf") return undefined;
    if (!Array.isArray(allOf) || allOf.length === 0) return undefined;
    const groups: (readonly string[])[] = [];
    for (const entry of allOf as readonly unknown[]) {
      const group = anyOfGroup(entry);
      if (group === undefined) return undefined;
      groups.push(group);
    }
    return groups;
  }
  const group = anyOfGroup(value);
  return group === undefined ? undefined : [group];
}

/** One any-of group: a slug, or a non-empty array of slugs. */
function anyOfGroup(value: unknown): readonly string[] | undefined {
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
 * an array is ANY-of, that `allOf` needs every entry -- is the same question,
 * so it is asked in one place and each caller supplies its own answerer.
 *
 * An array is any-of because that is the shape every consumer of this
 * vocabulary has: `requireAnyPermission` at the route layer, the capability
 * lists in the admin, and `ReleasesService.authorize`, which treats `create` or
 * `publish` as satisfying `read`. All-of is a separate, explicit form (`allOf`)
 * rather than a second meaning of the array, so no declaration can be read two
 * ways: the Team card needs a reader who may read people AND may add or change
 * them, which no any-of list can say.
 */
export function widgetGateHolds(
  requiredPermission: unknown,
  holds: (slug: string) => boolean
): boolean {
  if (requiredPermission === undefined) return true;
  const groups = requiredPermissionGroups(requiredPermission);
  // Present and unusable. Refused rather than read as absent.
  if (groups === undefined) return false;
  return groups.every(group => group.some(holds));
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
