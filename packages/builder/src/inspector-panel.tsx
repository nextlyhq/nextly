"use client";

/**
 * The inspector: editing the selected block's props.
 *
 * Draws what `inspector` decides and decides nothing itself — which props a
 * block exposes, in what order, and the patch that changes one all live there,
 * where they can be asserted without a DOM.
 *
 * **Text commits on blur, not on every keystroke.** Undo is built from op
 * inverses, so an op per character would make one undo remove one letter, and
 * a sentence would take a sentence's worth of presses to take back. Committing
 * on blur keeps an edit to a field one entry in the history, which is what an
 * author means by "undo that change". The cost is that the canvas updates when
 * focus leaves the field rather than as you type; live preview needs the store
 * to coalesce consecutive updates to one node and prop, which it does not do
 * yet.
 *
 * Discrete controls — a checkbox, a select — commit immediately. There is no
 * typing to coalesce, and waiting for blur on a checkbox would leave the canvas
 * disagreeing with a control the author has already changed.
 *
 * @module inspector-panel
 */

import { findNode } from "@nextlyhq/blocks-engine";
import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import {
  inspectSelection,
  lockOp,
  propPatch,
  renameOp,
  type BlockIdentity,
  type EditableProp,
} from "./inspector";

export interface InspectorPanelProps {
  /**
   * The editor whose selected block this edits.
   *
   * The whole state rather than a document and an `apply` separately: a patch is
   * built from the node in a particular document, and passing them apart lets a
   * caller hand a node from one render to an `apply` bound to another — which
   * writes a merged props object assembled from a stale node.
   */
  editor: EditorState;
}

/** A prop name as a human reads it: `backgroundColor` becomes "Background color". */
function labelFor(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function InspectorPanel({
  editor,
}: InspectorPanelProps): React.JSX.Element {
  // Recomputed each render rather than memoised: an inspection is only valid
  // against the document it was read from, and an edit anywhere changes both
  // the document and the values shown.
  const inspection = inspectSelection(editor.document, editor.selectedId);

  const commit = React.useCallback(
    (name: string, value: unknown) => {
      const id = editor.selectedId;
      if (id === null) return;
      // Read the node at commit time rather than closing over one. A field
      // committing on blur can fire after another edit has already replaced the
      // node, and patching from the older copy would resurrect its props.
      const node = findNode(editor.document.nodes, id);
      if (node === undefined) return;
      editor.apply({ kind: "update", id, patch: propPatch(node, name, value) });
    },
    [editor]
  );

  if (inspection === null) {
    return (
      <div className="nx-inspector" data-empty="no-selection">
        <p className="nx-inspector__note">Select a block to edit it.</p>
      </div>
    );
  }

  return (
    <div className="nx-inspector">
      <h2 className="nx-inspector__title">{inspection.label}</h2>

      {/*
        What the block IS, above what it holds.
        
        First because it answers "which block am I looking at" — a page with six
        headings gives an author six identical inspector titles, and the name is
        the only thing that tells them apart. Both fields are also the two the
        layers panel already shows, so this is where that display gets a writer.
      */}
      <IdentityFields
        // Keyed by node so the name input does not carry an uncommitted edit
        // across a selection change, exactly as the prop fields are.
        key={`${inspection.nodeId}:identity`}
        nodeId={inspection.nodeId}
        identity={inspection.identity}
        editor={editor}
      />

      {inspection.props.length === 0 ? (
        <p className="nx-inspector__note">
          This block has no editable properties.
        </p>
      ) : (
        <div className="nx-inspector__fields">
          {inspection.props.map(prop => (
            <PropField
              // Keyed by node AND prop: a bare prop name would let React reuse
              // one block's field for the next block's same-named prop, so the
              // input would keep the previous block's uncommitted text.
              key={`${inspection.nodeId}:${prop.name}`}
              prop={prop}
              onCommit={commit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The block's own name and its lock.
 *
 * Applied through `editor.apply` like every other edit, so both are covered by
 * undo — a rename an author regrets is one press away, and a lock is not a
 * setting that sits outside the history everything else is in.
 */
function IdentityFields({
  nodeId,
  identity,
  editor,
}: {
  nodeId: string;
  identity: BlockIdentity;
  editor: EditorState;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(identity.name);

  // The stored name wins whenever it changes underneath the field — an undo, or
  // a rename applied from somewhere else. Without this the input would go on
  // showing a name the document no longer has.
  React.useEffect(() => {
    setDraft(identity.name);
  }, [identity.name]);

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

function PropField({
  prop,
  onCommit,
}: {
  prop: EditableProp;
  onCommit: (name: string, value: unknown) => void;
}): React.JSX.Element {
  const id = `nx-prop-${prop.name}`;

  if (!prop.supported) {
    return (
      <div className="nx-inspector__field" data-unsupported="">
        <Label htmlFor={id}>{labelFor(prop.name)}</Label>
        {/*
          Listed rather than omitted. A block declaring a prop this panel cannot
          draw is still a block with that prop, and hiding it presents an
          incomplete block as a complete one — an author would conclude the
          field does not exist rather than that it is edited elsewhere.
        */}
        <p className="nx-inspector__note">
          Not editable here ({prop.schema.type}).
        </p>
      </div>
    );
  }

  if (prop.schema.type === "checkbox") {
    return (
      <div className="nx-inspector__field nx-inspector__field--inline">
        <Checkbox
          id={id}
          checked={prop.value === true}
          onCheckedChange={checked => onCommit(prop.name, checked === true)}
        />
        <Label htmlFor={id}>{labelFor(prop.name)}</Label>
      </div>
    );
  }

  if (prop.schema.type === "select") {
    return (
      <div className="nx-inspector__field">
        <Label htmlFor={id}>{labelFor(prop.name)}</Label>
        <Select
          value={typeof prop.value === "string" ? prop.value : undefined}
          onValueChange={next => onCommit(prop.name, next)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {prop.options.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return <TextishField id={id} prop={prop} onCommit={onCommit} />;
}

/** A prop's value as editable text, or empty when it is not representable. */
function storedText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * A field the author types into: text, textarea, url, number.
 *
 * Holds its own value while focused so typing is responsive, and reports it on
 * blur. Reading straight from the node would make every keystroke a document
 * edit; reporting only on blur without local state would make the field refuse
 * to show what was typed.
 */
function TextishField({
  id,
  prop,
  onCommit,
}: {
  id: string;
  prop: EditableProp;
  onCommit: (name: string, value: unknown) => void;
}): React.JSX.Element {
  // Only a primitive becomes text. `String({})` is "[object Object]", and a
  // field showing that would COMMIT it on blur — turning a prop the panel
  // cannot represent into a string that permanently replaces it. An
  // unrepresentable value shows empty and, because `send` compares against
  // this, an untouched field writes nothing.
  const stored = storedText(prop.value);
  const [draft, setDraft] = React.useState(stored);

  // The stored value wins whenever it changes underneath the field — an undo,
  // an edit from the canvas, a different block selected into the same slot.
  // Without this the input would go on showing a value the document no longer
  // has.
  React.useEffect(() => {
    setDraft(stored);
  }, [stored]);

  const send = () => {
    if (draft === stored) return;
    if (prop.schema.type === "number") {
      const parsed = Number(draft);
      // A number field that cannot parse reverts rather than writing NaN, which
      // survives JSON as `null` and reaches the renderer as a missing prop.
      if (draft.trim() === "" || Number.isNaN(parsed)) {
        setDraft(stored);
        return;
      }
      onCommit(prop.name, parsed);
      return;
    }
    onCommit(prop.name, draft);
  };

  const shared = {
    id,
    value: draft,
    onBlur: send,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => setDraft(event.target.value),
  };

  return (
    <div className="nx-inspector__field">
      <Label htmlFor={id}>{labelFor(prop.name)}</Label>
      {prop.schema.type === "textarea" ? (
        <Textarea {...shared} rows={3} />
      ) : (
        <Input
          {...shared}
          type={prop.schema.type === "number" ? "number" : "text"}
          inputMode={prop.schema.type === "url" ? "url" : undefined}
          // Enter commits as well as blur. A single-line field is where an
          // author expects Enter to mean "done", and waiting for them to click
          // elsewhere leaves the canvas stale after a deliberate action.
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
      )}
    </div>
  );
}
