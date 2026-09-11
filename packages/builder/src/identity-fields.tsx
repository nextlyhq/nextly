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
import type * as React from "react";

import type { EditorState } from "./editor-state";
import { lockOp, renameOp, type BlockIdentity } from "./inspector";
import { useStoredDraft } from "./stored-draft";

export function IdentityFields({
  nodeId,
  identity,
  editor,
}: {
  nodeId: string;
  identity: BlockIdentity;
  editor: EditorState;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(identity.name);

  const commitName = () => {
    if (draft.trim() === identity.name) return;
    editor.apply(renameOp(nodeId, draft));
  };

  return (
    <div className="nx-inspector__fields nx-inspector__identity">
      <div className="nx-inspector__field">
        <Label htmlFor="nx-block-name">Name</Label>
        <Input
          id="nx-block-name"
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

      <div className="nx-inspector__field nx-inspector__field--inline">
        <Checkbox
          id="nx-block-locked"
          checked={identity.locked}
          // Immediately, with no blur to wait for. There is nothing to coalesce
          // in a checkbox, and waiting would leave the canvas disagreeing with a
          // control the author has already changed.
          onCheckedChange={checked =>
            editor.apply(lockOp(nodeId, checked === true))
          }
        />
        <Label htmlFor="nx-block-locked">Lock this block</Label>
      </div>
    </div>
  );
}
