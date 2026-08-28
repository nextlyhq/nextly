/**
 * Committing a single-line field with Enter, without submitting what contains it.
 *
 * One policy rather than a copy per field. Every builder panel that edits a
 * value in place mounts inside the entry form, where an unprevented Enter
 * submits it — saving or publishing the entry when the author only meant to
 * finish typing. Two fields deciding that separately is two chances to omit the
 * `preventDefault`, and the omission is invisible until the form is what moves.
 *
 * @module commit-on-enter
 */
import type * as React from "react";

/**
 * Whether this key event was the commit, having performed it.
 *
 * Returns a boolean rather than swallowing the event, because callers have
 * their own keys to handle afterwards — a stepper reads the arrows, a rename
 * reads Escape — and a handler that could not tell whether the commit ran would
 * have to re-test the key it was just given.
 */
export function commitOnEnter(
  event: React.KeyboardEvent,
  commit: () => void
): boolean {
  if (event.key !== "Enter") return false;
  event.preventDefault();
  commit();
  return true;
}
