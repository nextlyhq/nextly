/**
 * A builder with nothing pending: no changes, nothing to undo or redo. For
 * tests that render the toolbar or the page layout and are not about the
 * pending changes themselves.
 */
import type { BuilderPendingChanges } from "@admin/hooks/useBuilderEntityState";

export const NO_PENDING_CHANGES: BuilderPendingChanges = {
  changes: [],
  marks: new Map(),
  canUndo: false,
  canRedo: false,
  undo: () => null,
  redo: () => null,
  discardAll: () => {},
};
