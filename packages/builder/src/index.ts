/**
 * `@nextlyhq/builder` — the visual page-builder editor.
 *
 * The editor half of the page builder: the shell, the canvas, and the op store
 * that everything in it either produces or reads. It is deliberately NOT a
 * renderer.
 *
 * **The invariant this package is built around**: the canvas renders documents
 * through `@nextlyhq/blocks-react` — the same renderer that serves published
 * pages — and re-implements nothing downstream of the document model. Read-path
 * preparation, condition gating and slot pruning are consumed from the engine's
 * own entry points, never reproduced here.
 *
 * That rule is not stylistic. `plugin-page-builder` carries a second renderer of
 * its own, and the two disagree about condition gating in OPPOSITE directions —
 * one failing closed, the other not evaluating conditions at all. Sharing a
 * predicate would not have prevented that, because sharing a predicate does not
 * share the decision to call it; only sharing the entry point does.
 *
 * This entry exports no features yet. The package exists ahead of them so its
 * name is claimed on npm: trusted publishing cannot perform a package's first
 * publish, and the bootstrap script will not claim a name that is not already a
 * workspace package.
 *
 * @module @nextlyhq/builder
 */

/**
 * This package's npm name, for diagnostics that report which packages a host
 * has loaded.
 *
 * The name and not the version. A version literal in source would be stale one
 * release after it was written, because every release bumps this package in
 * lockstep with its siblings; reporting a version means injecting the manifest's
 * value at build time, which belongs with the surface that displays it rather
 * than with a constant nothing reads yet.
 */
export const BUILDER_PACKAGE_NAME = "@nextlyhq/builder" as const;
