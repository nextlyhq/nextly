"use client";

/**
 * The selected node's own name and its lock.
 *
 * Its own module because two inspectors draw it: the block inspector above its
 * Content, Style and Advanced tabs, and the instance inspector above its
 * exposed properties. Both are describing the same two node fields — `name`
 * and `locked` live on the NODE rather than in `props`, so no prop schema and
 * no exposed property reaches them — and a second copy of the control would be
 * the second writer of one field that this package's rules exist to refuse.
 *
 * Applied through `editor.apply` like every other edit, so both are covered by
 * undo — a rename an author regrets is one press away, and a lock is not a
 * setting that sits outside the history everything else is in.
 *
 * @module identity-fields
 */

import { Checkbox, Input, Label } from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import { HeldByLock } from "./held-by-lock";
import { lockOp, renameOp, type BlockIdentity } from "./inspector";
import { useStoredDraft } from "./stored-draft";

export function IdentityFields({
  nodeId,
  identity,
  editor,
  heldBy,
}: {
  nodeId: string;
  identity: BlockIdentity;
  editor: EditorState;
  /**
   * The lock reason's element id, when the block sits inside an area locked
   * to its content. Its own lock is then held, since the area fixes it; its
   * name is the editor's label for it, which the page never draws, so it stays
   * editable.
   */
  heldBy?: string | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(identity.name);
  // Unique per mount, for the reason the exposed rows' are: two editors on one
  // page drew two fields under one id, and a label then pointed at the other
  // editor's control.
  const nameId = React.useId();
  const lockId = React.useId();

  const commitName = () => {
    // Trimmed ONCE, and the same value compared and stored. The rename trims,
    // so a draft that differs from the name only in its spaces renames
    // nothing — and the field is handed the stored name back rather than
    // left showing spaces the document does not hold.
    const next = draft.trim();
    if (next === identity.name) {
      setDraft(identity.name);
      return;
    }
    editor.apply(renameOp(nodeId, next));
  };

  return (
    <div className="nx-inspector__fields nx-inspector__identity">
      <div className="nx-inspector__field">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={draft}
          placeholder="Unnamed"
          onChange={event => setDraft(event.target.value)}
          // Committed on blur and on Enter, matching the text props below: an
          // op per keystroke would make one undo remove one letter.
          onBlur={commitName}
          onKeyDown={event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitName();
          }}
        />
      </div>

      <HeldByLock reasonId={heldBy}>
        <div className="nx-inspector__field nx-inspector__field--inline">
          <Checkbox
            id={lockId}
            checked={identity.locked}
            // Immediately, with no blur to wait for. There is nothing to coalesce
            // in a checkbox, and waiting would leave the canvas disagreeing with a
            // control the author has already changed.
            onCheckedChange={checked =>
              editor.apply(lockOp(nodeId, checked === true))
            }
          />
          <Label htmlFor={lockId}>Lock this block</Label>
        </div>
      </HeldByLock>
    </div>
  );
}
