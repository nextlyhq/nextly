/**
 * Turning a permitted-types list into words an author reads.
 *
 * The nesting rule answers with registry SPECIFIERS — `core/columns`,
 * `acme/card`, or a namespace wildcard like `core/*` — and none of those is
 * something to put in front of a person. Told that a block "goes inside
 * core/columns", an author has to know how this project names its modules
 * before they can act on the sentence.
 *
 * One home, because two surfaces now say it. The drag refusal has said it since
 * drops were explained; the composition refusal says it about a selection that
 * cannot be saved. Written twice they would agree today and differ the first
 * time either learned about a new kind of entry — and a wildcard is exactly that
 * kind of entry, which is why the naive reading produces "goes inside *".
 *
 * @module permitted-prose
 */

import {
  asPermittedList,
  permittedLabel as permittedLabelWith,
} from "@nextlyhq/blocks-engine";

import { blockLabel } from "./inserter";

/**
 * One entry of a permitted list, as an author reads it: a block's label, or
 * "any core block" for a namespace. The engine words it, so a refusal read on
 * the canvas and one read from a save name the same set the same way; this
 * binds it to the editor's labels.
 */
export function permittedLabel(entry: string): string {
  return permittedLabelWith(entry, blockLabel);
}

/** "A", "A and B", "A, B and C", as the engine joins a permitted list. */
export { asPermittedList };
