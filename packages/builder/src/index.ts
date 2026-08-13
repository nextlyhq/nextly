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
 * **Public surface**, all of it `@experimental` while the editor is being built
 * out:
 *
 * - {@link BUILDER_PACKAGE_NAME}, for diagnostics that report what a host loaded.
 * - The frame geometry — {@link pointToCanvas}, {@link pointToHost},
 *   {@link rectToHost}, {@link frameContentOrigin}, {@link frameInsetOf} — also
 *   published at `@nextlyhq/builder/geometry`, which carries no `"use client"`
 *   banner and so is reachable from a server component.
 * - The shell's declared bounds and preference port, also published at
 *   `@nextlyhq/builder/shell-state`.
 * - `BuilderShell` itself at `@nextlyhq/builder/shell`, which is the ONLY entry
 *   carrying `"use client"`. This one does not, so everything above is callable
 *   from a Server Component.
 * - `@nextlyhq/builder/styles.css`, the chrome's stylesheet. It SUPPLEMENTS the
 *   design system's rather than restating it, so a host loads
 *   `@nextlyhq/ui/styles.css` — or the admin's, which contains it — alongside.
 *   The shell says so in the console, in development, when it is missing.
 *
 * - The op store — {@link applyOp}, {@link OpError} and the op vocabulary —
 *   which every edit is expressed in and which derives each edit's inverse.
 *
 * The package was created ahead of any of this so its name could be claimed on
 * npm, because trusted publishing cannot perform a package's first publish and
 * the bootstrap script will not claim a name that is not already a workspace
 * package.
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

/**
 * The DOM read the mapping cannot do for itself.
 *
 * Exported beside the geometry because the inset is the one input every caller
 * has to measure, and the one they get wrong: documenting the recipe as
 * `clientLeft`/`clientTop` left three call sites short by the padding.
 */
export { frameInsetOf } from "./geometry-dom";

/**
 * @experimental The op store: the vocabulary every edit is expressed in, and
 * how one applies.
 *
 * Exported from the package entry because the entry is what `tsup` builds. A
 * module the entry does not reference is absent from `dist` however thoroughly
 * it is tested — the tests import it by relative path and pass, while a consumer
 * installing the package finds nothing.
 *
 * `OpPosition` travels with the vocabulary because `BuilderOp` is written in
 * terms of it: a consumer that can name an op but not the position inside one
 * cannot construct an insert or a move.
 */
export {
  applyOp,
  OpError,
  type AppliedOp,
  type BuilderOp,
  type NodePatch,
  type OpPosition,
} from "./ops";

/**
 * @experimental The editor shell's props.
 *
 * The TYPE only. `BuilderShell` itself lives at `@nextlyhq/builder/shell`, and
 * this entry deliberately does not re-export it: a value re-export would pull
 * the component into this bundle, which would then need the `"use client"`
 * banner, which would make every export above it a client reference — including
 * the geometry, which a Server Component is supposed to be able to call.
 *
 * A type costs nothing at runtime, so it can be described from here.
 */
export type { BuilderShellProps } from "./builder-shell";

/**
 * @experimental The shell's own decisions: which panels the rail offers, the
 * bounds handed to the panel library, and the preference port.
 */
export {
  LEFT_PANELS,
  MIN_CANVAS_WIDTH,
  MIN_SHELL_WIDTH,
  PANEL_BOUNDS,
  RAIL_WIDTH,
} from "./shell-state";
export type {
  LeftPanel,
  PreferenceStore,
  ShellPreferences,
} from "./shell-state";
