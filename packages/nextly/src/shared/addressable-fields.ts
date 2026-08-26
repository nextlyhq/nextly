/**
 * Which fields are addressable at a level, with presentational groups flattened.
 *
 * One implementation, in one place. It answered the same question in two —
 * `domains/versions/tag-component-types.ts` and the page-builder plugin's own
 * copy — and the second existed because this one was exported from its module
 * and from no public entry, so a plugin could only reach it by importing core's
 * file layout. Two functions deciding which fields a level addresses is two
 * functions that can drift, and the drift is silent because both look correct.
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
 * The generic assumes a field list is homogeneous with its nested lists, which
 * holds here because a group's `fields` is the same union as its siblings. A
 * caller with no type at all falls to the second signature and gets the
 * authorable union, which is the widest thing it can honestly be told.
 */
export function addressableFields<T extends object>(fields: readonly T[]): T[];
export function addressableFields(fields: unknown): AuthorableFieldConfig[];
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
