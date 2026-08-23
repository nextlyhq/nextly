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

import {
  findNode,
  type BreakpointId,
  type SiteTokenSet,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import {
  fieldLabel,
  inspectSelection,
  lockOp,
  lockStateOf,
  propPatch,
  renameOp,
  type BlockIdentity,
  type EditableProp,
  type LockState,
} from "./inspector";
import { selectionLock } from "./selection-ops";
import { StyleInspectorPanel } from "./style-inspector-panel";
import type { StylePolicy } from "./style-values";

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
  /**
   * What the site allows, forwarded to the Style tab.
   *
   * Carried rather than defaulted: the engine ships no host list of its own, so
   * omitting it does not mean "allow" — it means the question was never asked.
   */
  policy?: StylePolicy;
  /** The interaction state the Style tab edits. `base` when the host says nothing. */
  styleState?: StyleState;
  /** The breakpoint the Style tab edits. The unconditional one by default. */
  breakpoint?: BreakpointId;
  /**
   * The site's design tokens, forwarded to the Style tab's colour controls.
   *
   * Carried rather than defaulted, as `policy` is: omitting it means the
   * question was never asked, not that the site defines none. See
   * {@link StyleInspectorPanelProps.tokens} for why `policy.tokens` cannot
   * serve this.
   */
  tokens?: SiteTokenSet;
}

/**
 * Which half of the inspector is showing.
 *
 * Two tabs rather than a second rail: two rails meaning different things is the
 * ambiguity this editor's layout rulings have consistently removed, and the
 * inspector is already the region that answers "what is selected".
 */
const INSPECTOR_TABS = [
  { value: "content", label: "Content" },
  { value: "style", label: "Style" },
] as const;

export function InspectorPanel({
  editor,
  policy,
  styleState,
  breakpoint,
  tokens,
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

  /*
   * Several blocks selected: a different panel, not a thinner one.
   *
   * Showing the primary's name and props while six blocks are selected would
   * describe one block and act on one block, on a screen where the canvas shows
   * six outlined and the toolbar's delete removes all of them. The two surfaces
   * would be answering different questions with the same words.
   *
   * Per-property batch editing — one field showing "Mixed" and writing to every
   * block — is Plan 05's batch edit and is deliberately not here. What IS here
   * is the one property that is well defined across any set today, because it
   * is a flag rather than a value: the lock.
   */
  if (editor.selection.ids.length > 1) {
    return (
      <ManyBlocksPanel
        editor={editor}
        count={editor.selection.ids.length}
        lock={lockStateOf(editor.document, editor.selection.ids)}
      />
    );
  }

  /*
   * Nothing selected: one note, and no tabs.
   *
   * The entry's OWN fields are not drawn here. They already ship as a left
   * panel the host renders, and reproducing them in this region would be the
   * second surface-meaning-two-things the layout ruling removed, wearing a
   * different shape. Tabs are withheld too: a Style tab over no selection would
   * offer an author somewhere to click that can never show anything.
   */
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

        Above the tabs rather than inside Content, because it describes the block
        under both of them: an author on the Style tab still needs to know which
        of six headings they are looking at.
      */}
      <IdentityFields
        // Keyed by node so the name input does not carry an uncommitted edit
        // across a selection change, exactly as the prop fields are.
        key={`${inspection.nodeId}:identity`}
        nodeId={inspection.nodeId}
        identity={inspection.identity}
        editor={editor}
      />

      {/*
        Uncontrolled, so the chosen tab survives a change of selection — an
        author styling one block after another means to stay on Style. React
        keeps that state because this element's position does not change; a
        `key` on the node id here would reset it on every click.
      */}
      <Tabs defaultValue="content" className="nx-inspector__tabs">
        <TabsList>
          {INSPECTOR_TABS.map(tab => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="content">
          {inspection.props.length === 0 ? (
            <p className="nx-inspector__note">
              This block has no editable properties.
            </p>
          ) : (
            <div className="nx-inspector__fields">
              {inspection.props.map(prop => (
                <PropField
                  // Keyed by node AND prop: a bare prop name would let React
                  // reuse one block's field for the next block's same-named
                  // prop, so the input would keep the previous block's
                  // uncommitted text.
                  key={`${inspection.nodeId}:${prop.name}`}
                  prop={prop}
                  onCommit={commit}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="style">
          <StyleInspectorPanel
            editor={editor}
            policy={policy}
            state={styleState}
            breakpoint={breakpoint}
            tokens={tokens}
          />
        </TabsContent>
      </Tabs>
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
        <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
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
        <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
      </div>
    );
  }

  if (prop.schema.type === "select") {
    return (
      <div className="nx-inspector__field">
        <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
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
      <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
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

/**
 * The inspector when several blocks are selected.
 *
 * Says how many, and offers the one control that is well defined across a set:
 * the lock. A tri-state checkbox rather than a two-state one, because "some of
 * these are locked" is a real state and showing it as either on or off tells
 * the author something false about half of their selection.
 *
 * From `mixed`, the first press LOCKS everything. The alternative — unlocking —
 * is a first press that appears to do nothing to the blocks that were already
 * unlocked, and every file manager and design tool resolves it the same way.
 */
function ManyBlocksPanel({
  editor,
  count,
  lock,
}: {
  editor: EditorState;
  count: number;
  lock: LockState;
}): React.JSX.Element {
  const plan = selectionLock(
    editor.document,
    editor.selection.ids,
    // Mixed locks; locked unlocks; unlocked locks.
    lock !== "locked"
  );

  return (
    <div className="nx-inspector" data-selection="many">
      <h2 className="nx-inspector__title">{count} blocks selected</h2>

      <div className="nx-inspector__identity">
        <label className="nx-inspector__check">
          <input
            type="checkbox"
            checked={lock === "locked"}
            // `indeterminate` is a DOM property with no HTML attribute, so it
            // is set through a ref rather than declared. `aria-checked` carries
            // the same fact to assistive technology, which reads the attribute
            // and never the property.
            ref={element => {
              if (element !== null) element.indeterminate = lock === "mixed";
            }}
            aria-checked={lock === "mixed" ? "mixed" : lock === "locked"}
            onChange={() => {
              if (plan === null) return;
              editor.applyAll(plan.ops);
            }}
          />
          Lock these blocks
        </label>
      </div>

      <p className="nx-inspector__note">
        Editing properties across several blocks is not available yet. Select
        one block to edit what it holds.
      </p>
    </div>
  );
}
