/**
 * Which renderer draws a node of a comparison.
 *
 * A registry rather than another arm on the switch, mirroring
 * `defineValueDisplay` in the value-display kit beside it. Two reasons: the
 * switch it relieves had already grown past the point where adding a kind was
 * safe, and a plugin field type needs to supply its own comparison rendering
 * for the same reason it supplies its own input.
 *
 * The switch is still the fallback, so nothing has to register to keep working,
 * and an unrecognised kind still lands on the fail-safe branch rather than
 * rendering nothing.
 *
 * @module components/features/versions/diff/field-diff-registry
 */

import type { ReactNode } from "react";

import type { FieldDiff } from "@admin/services/versionApi";

export type FieldDiffRenderer = (node: FieldDiff) => ReactNode;

const registry = new Map<string, FieldDiffRenderer>();

/**
 * Register a renderer for one or more node kinds. A later registration for the
 * same kind wins, so a renderer can be replaced rather than patched.
 */
export function defineFieldDiff(
  kinds: string[],
  render: FieldDiffRenderer
): void {
  for (const kind of kinds) registry.set(kind, render);
}

/** The renderer for a kind, or undefined when none is registered. */
export function resolveFieldDiff(kind: string): FieldDiffRenderer | undefined {
  return registry.get(kind);
}

/** Test and introspection helper. */
export function getRegisteredDiffKinds(): string[] {
  return [...registry.keys()];
}
