"use client";

/**
 * Whether the shell around a subtree is currently interactive.
 *
 * Its own module rather than a member of `builder-shell`, because the answer has
 * two kinds of consumer and they sit on opposite sides of that file. The shell
 * PROVIDES it; the notice machinery and the command palette CONSUME it. Declared
 * in the shell, a consumer that the shell also imports — `builder-notices` is
 * both — has to import back into it, which is an import cycle for a boolean.
 *
 * @module shell-active
 */
import * as React from "react";

/**
 * Whether the shell around this subtree is currently interactive.
 *
 * Defaults to `true`, which covers both callers outside a shell entirely and the
 * server render, where the width is unknowable — the same assumption the shell's
 * own width hook makes and for the same reason.
 */
export const ShellActiveContext = React.createContext(true);

/**
 * Whether the surrounding shell is interactive, for content that has to answer for itself.
 *
 * The shell hides its slots behind `hidden` and `inert` below its minimum width, which is enough
 * for anything rendering in place. It is NOT enough for two other cases. Anything that portals to
 * the document body escapes the wrapper — a dialog would sit over the narrow-screen notice, fully
 * interactive. And anything DECIDING WHERE TO SPEAK has to know as well: `hidden` and `inert` do
 * not unmount, so a component behind the notice is still mounted and would go on reporting into a
 * subtree that is excluded from the accessibility tree.
 *
 * Such a component reads this instead of re-deriving the width, so one media query decides them
 * all and they cannot disagree.
 *
 * @experimental
 */
export function useShellIsActive(): boolean {
  return React.useContext(ShellActiveContext);
}
