"use client";

/**
 * The inspector when several blocks are selected: how many, and the lock,
 * the one control well defined across a set.
 *
 * @module many-blocks-panel
 */

import * as React from "react";

import { SelectionCard } from "./block-card";
import type { EditorState } from "./editor-state";
import {
  lockStateOf,
  layersLockChangeable,
  lockStatusOf,
  lockViewOf,
  type LockState,
} from "./inspector";
import { selectionLock } from "./selection-ops";

/**
 * The inspector when several blocks are selected.
 *
 * Says how many, and offers in its menu the one control that is well defined
 * across a set: the lock. From a set that is partly locked, the menu LOCKS
 * everything — the alternative is a first press that appears to do nothing to
 * the blocks that were already unlocked, and every file manager and design
 * tool resolves it the same way.
 *
 * Planned only over the blocks whose own lock may change here. A block inside
 * a `contentOnly` area has its lock pinned by that area, and the edit is
 * applied as one group, so planning it would have the save refuse the whole
 * edit and change none of the others. The card says how many are held and why.
 */
export function ManyBlocksPanel({
  editor,
  count,
  lock,
}: {
  editor: EditorState;
  count: number;
  lock: LockState;
}): React.JSX.Element {
  const view = lockViewOf(editor);
  const changeable = editor.selection.ids.filter(id =>
    layersLockChangeable(lockStatusOf(editor.document, id, view))
  );
  // The direction is read from the blocks it would change, so a held block
  // already in the other state cannot leave the menu with nothing to do.
  const unlocking =
    changeable.length > 0 &&
    lockStateOf(editor.document, changeable) === "locked";
  const plan = selectionLock(editor.document, changeable, !unlocking);

  return (
    <div className="nx-inspector" data-selection="many">
      <SelectionCard
        count={count}
        lock={lock}
        unlocking={unlocking}
        held={editor.selection.ids.length - changeable.length}
        onLock={plan === null ? undefined : () => editor.applyAll(plan.ops)}
      />
      <p className="nx-inspector__note">
        Editing properties across several blocks is not available yet. Select
        one block to edit what it holds.
      </p>
    </div>
  );
}
