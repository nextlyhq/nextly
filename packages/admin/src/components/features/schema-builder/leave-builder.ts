/**
 * Whether the Builder may be left now. No Builder page mounts a navigation
 * guard, so every exit that changes the route asks this first: with unsaved
 * changes, leaving discards them, so the editor is asked; with none, it is
 * not.
 */
import { BUILDER_KIND_NOUN, type BuilderKind } from "./builder-config";

export function mayLeaveBuilder(
  unsavedCount: number,
  kind: BuilderKind
): boolean {
  return (
    unsavedCount === 0 ||
    window.confirm(
      `You have unsaved changes to this ${BUILDER_KIND_NOUN[kind]}. Leave and discard them?`
    )
  );
}
