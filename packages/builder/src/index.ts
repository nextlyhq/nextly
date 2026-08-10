/**
 * `@nextlyhq/builder` — the visual page-builder editor.
 *
 * The editor half of the rebuilt page builder: the shell, the canvas, and the op
 * store that everything in it either produces or reads. It is deliberately NOT a
 * renderer.
 *
 * **The invariant this package is built around** (Plan 04 D-04.7): the canvas
 * renders documents through `@nextlyhq/blocks-react` — the same renderer that
 * serves published pages — and re-implements nothing downstream of the document
 * model. Read-path preparation, condition gating and slot pruning are consumed
 * from the engine's own entry points, never reproduced here.
 *
 * That rule is not stylistic. The previous generation (`plugin-page-builder`)
 * carried its own renderer, and the two disagreed about condition gating in
 * OPPOSITE directions — one failing closed, one not evaluating conditions at all
 * — for as long as both existed. Sharing a predicate would not have prevented it,
 * because sharing a predicate does not share the decision to call it.
 *
 * This entry is intentionally empty of features. The package exists first so its
 * name can be claimed on npm: trusted publishing cannot perform a package's first
 * publish, and the bootstrap script will not claim a name that is not already a
 * workspace package.
 *
 * @module @nextlyhq/builder
 */

/**
 * The package's own version, for diagnostics and for the shell's about surface.
 *
 * Read from the manifest at build time rather than duplicated, so it cannot drift
 * from what was published.
 */
export const BUILDER_PACKAGE = "@nextlyhq/builder" as const;
