/**
 * Which fields are addressable at a level, with presentational groups flattened.
 *
 * Core's implementation, and the one plugins may call. It was exported from its
 * module and from no public entry, so a plugin needing this answer could only
 * reach it by importing core's file layout — or write the walk again, which is
 * what happened.
 *
 * This descends any unnamed field carrying an array of `fields`. That is
 * deliberate and is what core's five call sites expect: a field is addressable
 * here if its value is stored at this level, and an unnamed container stores
 * its children at the level it sits in whatever its `type` says.
 *
 * A caller that must NOT descend some of those — an index keyed per stored row,
 * for instance, where descending an unnamed repeater would file rows per row
 * that no rebuild can reconcile — filters the result rather than walking again.
 * Filtering is visible; a second traversal is a second answer to this question,
 * and the two drift silently because both look correct.
 *
 * @module shared/addressable-fields
 */

import type { AuthorableFieldConfig } from "../collections/fields/types/plugin-field";

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
export function addressableFields(fields: unknown): AuthorableFieldConfig[] {
  const out: AuthorableFieldConfig[] = [];
  if (!Array.isArray(fields)) return out;

  // Reversed so that popping yields declaration order.
  const pending: unknown[] = [];
  for (let i = fields.length - 1; i >= 0; i--) pending.push(fields[i]);

  // Only unnamed groups are descended into, so only they can close a cycle.
  // Marking named fields too would wrongly collapse a config that legitimately
  // reuses one field object at two levels.
  const descended = new WeakSet<object>();

  while (pending.length > 0) {
    const field = pending.pop();
    if (typeof field !== "object" || field === null) continue;

    const name = (field as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) {
      out.push(field as AuthorableFieldConfig);
      continue;
    }

    if (descended.has(field)) continue;
    descended.add(field);

    const children = (field as { fields?: unknown }).fields;
    if (!Array.isArray(children)) continue;
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }

  return out;
}
