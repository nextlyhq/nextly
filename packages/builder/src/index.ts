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
 * No test enforces it. Reimplementing rendering on React and the engine
 * imports exactly the same packages as delegating to the renderer, so the
 * layering guard cannot tell the two apart; it narrows what may be imported,
 * which makes the shortcut inconvenient rather than impossible.
 *
 * That rule is not stylistic. `plugin-page-builder` carries a second renderer of
 * its own, and the two disagree about condition gating in OPPOSITE directions —
 * one failing closed, the other not evaluating conditions at all. Sharing a
 * predicate would not have prevented that, because sharing a predicate does not
 * share the decision to call it; only sharing the entry point does.
 *
 * **Public surface so far**: {@link BUILDER_PACKAGE_NAME}, and the frame
 * geometry below. The editor itself is not exported yet — the package was
 * created ahead of it so its name could be claimed on npm, because trusted
 * publishing cannot perform a package's first publish and the bootstrap script
 * will not claim a name that is not already a workspace package.
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

/**
 * The one mapping between the canvas frame and the host page.
 *
 * Exported because the acceptance harness measures against the SAME arithmetic
 * the editor positions with. A browser test carrying its own copy certifies its
 * own stale copy, and would keep passing through exactly the correction it
 * exists to catch.
 */
export {
  FrameGeometryError,
  frameContentOrigin,
  pointToCanvas,
  pointToHost,
  rectToHost,
  type FrameGeometry,
  type FrameInset,
  type Point,
  type Rect,
} from "./geometry";
