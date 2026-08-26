/**
 * Which fields are addressable at a level, with presentational groups flattened.
 *
 * Core's implementation, and the one plugins may call. It was exported from its
 * module and from no public entry, so a plugin needing this answer could only
 * reach it by importing core's file layout — or write the walk again, which is
 * what happened.
 *
 * By default it descends any unnamed field carrying an array of `fields`, which
 * is what core's five call sites expect: a field is addressable here if its
 * value is stored at this level, and an unnamed container stores its children
 * at the level it sits in whatever its `type` says.
 *
 * A caller that must NOT descend some of those says so with `descendInto`,
 * rather than filtering afterwards. Filtering afterwards cannot work and it is
 * worth being precise about why: the result carries the flattened children
 * themselves, so a child reached through an unnamed REPEATER — whose values are
 * stored per row — is the same object as the same child reached through an
 * unnamed group. Ancestry is gone by the time a filter could read it. An index
 * keyed per stored row must exclude the first and include the second, and no
 * predicate over the returned list can tell them apart.
 *
 * Deciding it during the walk keeps one traversal answering one question, with
 * the caller's narrower rule as an input to it rather than as a second walk
 * that drifts.
 *
 * @module shared/addressable-fields
 */

import type { AuthorableFieldConfig } from "../collections/fields/types/plugin-field";

/**
 * An entry that carries a name and nothing else this walk can vouch for.
 *
 * The walk runs on author-written config, and on some paths before validation
 * has seen it, so `{ name: "title" }` with no `type` reaches it and is
 * addressable — it names a place a value is stored. Calling that an
 * `AuthorableFieldConfig` would tell a caller the discriminant is present when
 * it may not be.
 */
export interface UnvalidatedAddressableField {
  name: string;
  /**
   * Declared rather than left to the index signature, because it is the
   * property every caller reaches for first — and because a target typed
   * `{ type?: unknown }` rejects an object that shares no declared property
   * with it, however permissive its index signature.
   */
  type?: unknown;
  [key: string]: unknown;
}

/**
 * What the walk emits: a valid field when the caller had one, and otherwise
 * something that is merely addressable.
 *
 * A union rather than the weaker arm alone, so a caller can still recover the
 * type it put in — `Extract<AddressableField, PluginDataFieldConfig>` is that
 * plugin's field, not `never`.
 */
export type AddressableField =
  | AuthorableFieldConfig
  | UnvalidatedAddressableField;

/**
 * The fields stored at this level, in the order they are declared.
 *
 * A group with no name exists to lay fields out: its children are stored at the
 * level the group sits in, not under it, so the walk descends through it and
 * emits its children here. A NAMED group stores its children under itself, so
 * it is emitted whole and never descended into — that distinction is the whole
 * point, and reversing it changes what every caller looks up.
 *
 * Takes `unknown` rather than `FieldConfig[]` because it runs on author-written
 * config, and on some paths before validation has seen it. A caller that has
 * already validated loses nothing; one that has not gets an empty list instead
 * of a throw.
 *
 * Iterative, and that is load-bearing rather than a style preference. The
 * recursive version this replaces died two ways on config an author can write:
 * a group that contains itself overflowed the call stack, and a group wider
 * than the engine's argument limit threw `RangeError` out of
 * `push(...children)` — measured at roughly 110,000 children on node 22, which
 * is an engine limit rather than a specified one. Both surfaced inside a
 * post-commit hook, where a throw reports a failed save for one that succeeded.
 *
 * Overloaded so the element type SURVIVES the walk. `FieldConfig` is the closed
 * built-in union and excludes `PluginDataFieldConfig`, so returning it would
 * erase exactly the contributed fields this is published for: a plugin passing
 * its own `blocks(...)` through and then narrowing would land on `never`, and
 * could not replace its duplicate walk without a cast. Widening the return to
 * `AuthorableFieldConfig` for everyone is the other wrong answer — the note on
 * that type says the openness a contributed field needs belongs at the boundary
 * where a schema is WRITTEN, not in the type every internal reader shares, and
 * core's own callers would start seeing `{} | null` on ordinary property reads.
 *
 * ONE signature, returning the widest union a field can be. Two narrower
 * overloads were wrong for the same reason a generic was: what comes out is not
 * only the top-level elements. A group's children are typed
 * `GroupFieldConfig_FieldConfig` — a deliberately open bag with an `any` index
 * signature — so a group may legitimately contain a CONTRIBUTED field, and
 * flattening it returns something no built-in union describes. Promising
 * `FieldConfig[]` for a `FieldConfig[]` input therefore narrowed a plugin's own
 * field to `never` the moment its owner tried to recognise it.
 *
 * The cost lands on core's callers, which now receive the wider union. That is
 * the honest place for it: every one of them already reads properties through a
 * cast (`component`, `components`, `name`), so none was relying on the narrow
 * union for anything the checker was enforcing.
 */
export interface AddressableFieldsOptions {
  /**
   * Whether this unnamed container's children are stored at ITS level, and so
   * should be flattened into the result.
   *
   * Only ever asked about a field with no name and an array of `fields` — a
   * named one stores its children under itself and is never descended. Default:
   * every such container is transparent, which is what core's callers expect.
   */
  descendInto?: (container: AuthorableFieldConfig) => boolean;
}

/**
 * What an unnamed field contributes to the level it sits in: its children when
 * it is a transparent container, or nothing.
 *
 * Separate from the walk because it answers a different question: the walk
 * decides order and termination, this decides transparency. It is also the
 * shape a caller's own rule takes, so the two line up.
 */
function childrenToFlatten(
  field: object,
  descendInto: AddressableFieldsOptions["descendInto"]
): readonly unknown[] | null {
  const children = (field as { fields?: unknown }).fields;
  if (!Array.isArray(children)) return null;
  if (descendInto && !descendInto(field as AuthorableFieldConfig)) return null;
  return children;
}

/** The name a field is addressed by, or null when it has none. */
function addressableName(field: object): string | null {
  const name = (field as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

export function addressableFields(
  fields: unknown,
  options?: AddressableFieldsOptions
): AddressableField[] {
  const out: AddressableField[] = [];
  if (!Array.isArray(fields)) return out;
  const descendInto = options?.descendInto;

  // Reversed so that popping yields declaration order.
  const pending: unknown[] = [];
  for (let i = fields.length - 1; i >= 0; i--) pending.push(fields[i]);

  // Only unnamed containers are descended into, so only they can close a cycle.
  // Marking named fields too would wrongly collapse a config that legitimately
  // reuses one field object at two levels.
  const descended = new WeakSet<object>();

  while (pending.length > 0) {
    const field = pending.pop();
    if (typeof field !== "object" || field === null) continue;

    if (addressableName(field) !== null) {
      out.push(field as AddressableField);
      continue;
    }

    if (descended.has(field)) continue;
    descended.add(field);

    const children = childrenToFlatten(field, descendInto);
    if (children === null) continue;
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }

  return out;
}
