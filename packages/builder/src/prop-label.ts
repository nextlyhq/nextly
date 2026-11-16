/**
 * What an author calls a stored key and a block's prop.
 *
 * Its own module, free of React, so the editor's panels and a server answer
 * naming a block's props use one rule: the inspector re-exports it, and the
 * server-safe `@nextlyhq/builder/ops` entry offers it.
 *
 * @module prop-label
 */
import type { PropSchema } from "@nextlyhq/blocks-engine";

/**
 * A stored key as a human reads it: `backgroundColor` becomes "Background color".
 *
 * Here rather than in a panel because both panels label the same way and from
 * the same kind of key — a prop name on the content tab, a catalog key on the
 * style tab — and two spellings of one rule would drift the first time either
 * learned about an acronym or a digit.
 */
export function fieldLabel(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  const label = spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  // The editor's spelling, which its own words ("Colour for", the Colour
  // form) already use: a key's American "color" read beside them as the same
  // word spelled two ways in one panel.
  return label.replace(/\b([Cc])olor\b/g, "$1olour");
}

/**
 * What an author calls a prop: the label its block gives it, or its name,
 * spaced and capitalised, when the block gives none.
 */
export function propLabel(name: string, schema: PropSchema): string {
  const given = schema.label;
  return typeof given === "string" && given.trim() !== ""
    ? given
    : fieldLabel(name);
}
