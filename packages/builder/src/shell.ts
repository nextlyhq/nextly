/**
 * The editor shell, published as its own entry because it is a CLIENT one.
 *
 * The shell is a client component, and Rollup drops per-module `"use client"`
 * directives while bundling, so the directive has to be re-applied to the built
 * file as a banner. A banner applies to the WHOLE artifact and to everything it
 * re-exports — which is why this is a separate entry rather than part of the
 * root barrel.
 *
 * Put in the root barrel, the shell's banner would have marked the frame
 * geometry as client-only too. Those helpers are plain arithmetic that a Server
 * Component is meant to be able to call, and they were part of this package's
 * public surface before the shell existed, so the banner would have been a
 * silent regression for anyone already importing them: the export map would go
 * on advertising a callable function while the artifact delivered a client
 * reference. Splitting the entry keeps the boundary where the React actually is.
 *
 * The props type is still described from the root entry — a type is erased, so
 * it carries no boundary with it.
 *
 * @module @nextlyhq/builder/shell
 */

export { BuilderShell } from "./builder-shell";
export type { BuilderShellProps } from "./builder-shell";

/**
 * Whether the surrounding shell is interactive.
 *
 * Exported for slot content that PORTALS out of the shell, which the shell cannot reach with
 * `hidden` and `inert` and so has to inform instead.
 */
export { useShellIsActive } from "./builder-shell";

/**
 * The command palette, published here beside the shell because it is a client
 * component for the same reason: it holds React state and registers a keyboard
 * binding through the shell's provider, so it belongs behind the same banner.
 *
 * Its types are described from the root entry, which stays server-callable.
 */
export { COMMAND_PALETTE_KEYS, CommandPalette } from "./command-palette";
export type { BuilderCommand, CommandPaletteProps } from "./command-palette";

/**
 * The canvas, behind the same client banner and for a stricter reason than the
 * shell's: it holds a pointer handler and renders `PageRenderer`, so it is
 * interactive in its own right rather than merely stateful.
 *
 * `CANVAS_NODE_ATTR` and `nodeIdFromEvent` ship beside it rather than from the
 * root entry even though neither touches React. They describe how a DOM element
 * is matched to a node id, which is only answerable where that DOM exists, and
 * splitting them across two entries would let a host read the attribute name
 * from a server module while the writer lives behind the boundary — two halves
 * of one contract that could then be versioned apart.
 */
export { CANVAS_NODE_ATTR, Canvas, nodeIdFromEvent } from "./canvas";
export type { CanvasProps } from "./canvas";
