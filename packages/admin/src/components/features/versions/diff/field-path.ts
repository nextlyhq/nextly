/**
 * What a field in a comparison is called, and where it sits: its label as the
 * editor shows it, after the containers it sits inside ("SEO › Meta title").
 *
 * The comparison draws a named group as a box around its fields, so a field
 * inside it is already placed by that box. Only the containers NOT drawn around
 * it are named in front of its label: a tab or a collapsible with no name,
 * whose fields the comparison lists at the level of their parent.
 *
 * @module components/features/versions/diff/field-path
 */

import type { DiffPathSegment } from "nextly/api/versions-diff";

import { fieldLabel } from "@admin/lib/field-label";

/** The naming a comparison node carries. */
export interface NamedNode {
  name: string;
  label?: string;
  declaredLabel?: string | null;
  path?: readonly DiffPathSegment[];
}

/**
 * A field's label as the editor shows it: the label it declares, else its key
 * made readable. A node from a server that sends no `declaredLabel` keeps the
 * label that server resolved.
 */
export function fieldNameOf(node: NamedNode): string {
  if (node.declaredLabel === undefined && node.label) return node.label;
  const label = fieldLabel({
    name: node.name,
    label: node.declaredLabel ?? undefined,
  });
  return label === "" ? "Untitled field" : label;
}

/** A container's heading, as the editor shows it, or null when it has none. */
function containerName(segment: DiffPathSegment): string | null {
  const label = fieldLabel({
    name: segment.name ?? undefined,
    label: segment.declaredLabel ?? undefined,
  });
  return label === "" ? null : label;
}

/**
 * The containers to name in front of a field: those of its path below the
 * `drawn` outermost ones, which the comparison already draws around it.
 */
export function placeOf(
  path: readonly DiffPathSegment[] | undefined,
  drawn: number
): string[] {
  return (path ?? [])
    .slice(drawn)
    .map(containerName)
    .filter((name): name is string => name !== null);
}

/** A field's full name in a comparison: its place, then its label. */
export function fieldPathLabel(node: NamedNode, drawn: number): string {
  return [...placeOf(node.path, drawn), fieldNameOf(node)].join(" › ");
}
