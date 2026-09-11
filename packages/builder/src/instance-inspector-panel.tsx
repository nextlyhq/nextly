"use client";

/**
 * The inspector for a selected component INSTANCE: its exposed properties.
 *
 * Draws what `instance-inspector` decides and decides nothing itself — which
 * rows an instance offers, what each shows, where its value came from and the
 * op that changes it all live there, where they can be asserted without a DOM.
 *
 * **This replaces the block inspector's tabs rather than adding to them.** An
 * instance is one node whose content is a definition's, inlined at render:
 * its own node carries no props a schema describes, and it renders as no
 * element of its own, so a Style tab and an Advanced tab would offer controls
 * over nothing. What it has instead is the surface the design names — exposed
 * properties now, variants, slots and the change list later.
 *
 * **Every row says where its value came from, and every override says how to
 * take it back.** An author reading "Site name" cannot tell from the value
 * alone whether they typed it or the component did, and the reset for an
 * override they made is offered ON the row, visibly. The one editor that
 * hides its reset behind a context menu is the one whose users had to ask
 * where it was.
 *
 * Text commits on blur, for the reason the block inspector's does: undo is
 * built from op inverses, and an op per keystroke would make one undo remove
 * one letter.
 *
 * @module instance-inspector-panel
 */

import {
  findNode,
  isRichTextValue,
  isUnsetOverride,
  richTextToPlainText,
  type OverrideValue,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import { IdentityFields } from "./identity-fields";
import {
  resetOverrideOp,
  setOverrideOp,
  type ExposedRow,
  type InstanceInspection,
  type OrphanedOverride,
} from "./instance-inspector";
import { useStoredDraft } from "./stored-draft";

/**
 * What the row's badge says for each source.
 *
 * A record over the closed set rather than a chain of comparisons, so a
 * source the resolver adds later is a build failure here until it has words.
 */
const SOURCE_LABEL: Readonly<Record<ExposedRow["source"], string>> = {
  definition: "Inherited",
  variant: "From variant",
  instance: "Overridden",
};

/**
 * The control's spelling of a definition's option value, and back.
 *
 * EVERY value wears a one-character prefix. A definition may offer `""` as a
 * choice — "none", for a select whose other options are class names — and the
 * validator accepts it, while the primitive underneath the select throws at
 * render on an item whose value is the empty string, which it reserves for
 * "no selection". A sentinel spelling `""` alone collides with the option
 * whose value IS that sentinel — an option's value is free text, so no string
 * is safe — and two items then share one value: the control draws the later
 * of them for either, and choosing one while the other is held changes
 * nothing. A prefix on every value cannot collide: distinct values stay
 * distinct, and no spelling is empty.
 */
const OPTION_PREFIX = "=";

function encodeOption(value: string): string {
  return `${OPTION_PREFIX}${value}`;
}

function decodeOption(value: string): string {
  return value.slice(OPTION_PREFIX.length);
}

/**
 * What an exposed type is called in a sentence telling the author it cannot be
 * edited here yet. The engine's names are code; these are words.
 */
const TYPE_LABEL: Readonly<Record<ExposedRow["type"], string>> = {
  text: "text",
  richText: "rich text",
  image: "image",
  link: "link",
  visibility: "visibility",
  select: "choice",
};

export function InstanceInspectorPanel({
  inspection,
  editor,
}: {
  inspection: InstanceInspection;
  editor: EditorState;
}): React.JSX.Element {
  // Read the node at commit time rather than closing over one. A field
  // committing on blur can fire after another edit has already replaced the
  // node, and an override record rebuilt from the older copy would resurrect
  // overrides that edit removed.
  const nodeNow = React.useCallback(
    () => findNode(editor.document.nodes, inspection.nodeId),
    [editor.document, inspection.nodeId]
  );
  const set = React.useCallback(
    (id: string, value: OverrideValue) => {
      const node = nodeNow();
      if (node !== undefined) editor.apply(setOverrideOp(node, id, value));
    },
    [editor, nodeNow]
  );
  const reset = React.useCallback(
    (id: string) => {
      const node = nodeNow();
      if (node !== undefined) editor.apply(resetOverrideOp(node, id));
    },
    [editor, nodeNow]
  );

  const headingId = React.useId();

  return (
    <div className="nx-inspector" data-instance="">
      <h2 className="nx-inspector__title">
        <span aria-hidden="true" className="nx-inspector__glyph">
          ⧉
        </span>{" "}
        {inspection.label}
      </h2>
      {/*
        What this IS, said once under the title. "Component" for the author who
        clicked into a header and is wondering why the tabs went; the usage
        count beside it when the library could say, because an edit to this
        component's definition reaches every one of those pages.
      */}
      <p className="nx-inspector__meta">
        Component
        {inspection.usedOn === undefined
          ? null
          : ` · used on ${inspection.usedOn} ${inspection.usedOn === 1 ? "page" : "pages"}`}
      </p>

      <IdentityFields
        // Keyed by node so the name input does not carry an uncommitted edit
        // across a selection change, exactly as the block inspector's does.
        key={`${inspection.nodeId}:identity`}
        nodeId={inspection.nodeId}
        identity={inspection.identity}
        editor={editor}
      />

      {!inspection.definitionFound ? (
        /*
         * The same state the canvas draws as could-not-be-loaded, in words. A
         * `status` region rather than an alert: it is a standing fact about
         * this selection, not an event.
         */
        <p className="nx-inspector__note" role="status">
          This component could not be loaded, so its properties cannot be edited
          here. It may have been deleted, or the library was too large to load
          whole.
        </p>
      ) : inspection.rows.length === 0 ? (
        /*
         * Zero exposed properties is a locked, reusable block — a footer — not
         * a broken component, so this says what there is to do rather than
         * that something is missing: the content lives on the definition, and
         * the definition has a screen.
         */
        <p className="nx-inspector__note">
          This component exposes nothing to edit here. Its content is edited on
          the component itself, from the Components screen.
        </p>
      ) : (
        <section aria-labelledby={headingId}>
          <h3 id={headingId} className="nx-inspector__heading">
            Exposed properties
          </h3>
          <div className="nx-inspector__fields">
            {inspection.rows.map(row => (
              <ExposedField
                // Keyed by node AND property, for the reason the block
                // inspector keys its fields: a bare id would let React reuse
                // one instance's field for the next instance's same-named
                // property, and the input would keep the previous one's
                // uncommitted text.
                key={`${inspection.nodeId}:${row.id}`}
                row={row}
                onSet={set}
                onReset={reset}
              />
            ))}
          </div>
        </section>
      )}

      {inspection.orphaned.length > 0 ? (
        <OrphanedOverrides orphaned={inspection.orphaned} onDiscard={reset} />
      ) : null}
    </div>
  );
}

/**
 * One exposed property: its label, where its value came from, the control
 * that changes it, and the way back.
 */
function ExposedField({
  row,
  onSet,
  onReset,
}: {
  row: ExposedRow;
  onSet: (id: string, value: OverrideValue) => void;
  onReset: (id: string) => void;
}): React.JSX.Element {
  // Unique per MOUNTED ROW, not per property: a page can hold two blocks
  // fields, each with its own editor, and a fixed id per property made both
  // labels resolve to the first editor's control — which then carried two
  // labels and a doubled name, while the second's input had none.
  const id = `${React.useId()}-${row.id}`;
  // What a reset would remove is this row's OWN override, which is not the
  // same fact as its source: a row shadowed by a neighbour holding the
  // override reads `instance` too, and a reset offered there removes nothing.
  const overridden = row.ownOverride;
  // A label points at a control, and two kinds of row draw none: the label
  // then names the row without claiming to label an input that is not there.
  const hasControl = row.shadowedBy === undefined && row.supported;

  return (
    <div
      className="nx-inspector__field nx-inspector__field--exposed"
      data-source={row.cleared ? "cleared" : row.source}
    >
      <Label {...(hasControl ? { htmlFor: id } : {})}>{row.label}</Label>
      <div className="nx-inspector__exposed">
        <ExposedControl id={id} row={row} onSet={onSet} />
        <div className="nx-inspector__provenance">
          {/*
            The badge is VISIBLE, and it is a badge rather than the label's
            styling: "Overridden" beside a value is what tells an author the
            reset below undoes their own edit rather than the component's
            design.
          */}
          <span
            className="nx-inspector__source"
            data-source={row.cleared ? "cleared" : row.source}
          >
            {row.cleared ? "Cleared" : SOURCE_LABEL[row.source]}
          </span>
          {overridden ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // Named for the row, because six rows each offering "Reset"
              // are six identical controls to a screen reader.
              aria-label={`Reset ${row.label} to the component's value`}
              onClick={() => onReset(row.id)}
            >
              Reset
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The control for one row, or the sentence explaining why there is none.
 *
 * Two reasons a row has no control, and they are told apart because the
 * remedies differ. A SHADOWED row is not what the page shows — another
 * exposure writes the same target after it — so editing it would change a
 * value nobody sees; the sentence names the row that is in force. An
 * UNSUPPORTED type has no control yet; the row still shows its value, so an
 * author can read what the component holds without being able to change it.
 */
function ExposedControl({
  id,
  row,
  onSet,
}: {
  id: string;
  row: ExposedRow;
  onSet: (id: string, value: OverrideValue) => void;
}): React.JSX.Element {
  if (row.shadowedBy !== undefined) {
    return (
      <p className="nx-inspector__note">
        Set by “{row.shadowedBy.label}”, which the page shows instead of this.
      </p>
    );
  }
  if (!row.supported) {
    const shown = valueSummary(row.value);
    return (
      <p className="nx-inspector__note">
        {shown === "" ? null : `“${shown}” — `}
        Not editable here yet ({TYPE_LABEL[row.type]}).
      </p>
    );
  }
  if (row.type === "select") {
    return (
      <Select
        value={
          typeof row.value === "string" ? encodeOption(row.value) : undefined
        }
        onValueChange={next => onSet(row.id, decodeOption(next))}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {row.options.map(option => (
            <SelectItem key={option.value} value={encodeOption(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return <ExposedTextField id={id} row={row} onSet={onSet} />;
}

/**
 * A stored value as a line an author can read — empty only for a value that
 * is empty.
 *
 * {@link storedText} answers what a TEXT FIELD can hold, and a structured
 * value is not that: a rich-text document, a link or an image object, a list.
 * Read through it, a value that is there and one that is not both came out
 * empty, so a row showed nothing where the page shows a passage and an
 * orphan read as holding no value. Rich text is read as its words, through
 * the engine's own reader; a list says how many entries it holds; any other
 * structure shows its data; a cleared override says so.
 */
function valueSummary(value: OverrideValue): string {
  if (isUnsetOverride(value)) return "(cleared)";
  if (isRichTextValue(value)) return clipped(richTextToPlainText(value));
  if (Array.isArray(value)) {
    return value.length === 1 ? "1 item" : `${String(value.length)} items`;
  }
  if (typeof value === "object" && value !== null) {
    return clipped(dataOf(value));
  }
  return storedText(value);
}

/** How many characters of a summary a row shows before it trails off. */
const SUMMARY_LENGTH = 80;

/** One line of at most {@link SUMMARY_LENGTH} characters, whitespace folded. */
function clipped(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= SUMMARY_LENGTH
    ? line
    : `${line.slice(0, SUMMARY_LENGTH - 1)}…`;
}

/**
 * A structured value as JSON, or a plain statement that it is one.
 *
 * Stored values arrive as JSON and serialise back; one a hook built in memory
 * can hold a cycle or a bigint, which `JSON.stringify` refuses, and a summary
 * must not take the panel down over it.
 */
function dataOf(value: object): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    if (error instanceof TypeError) return "(structured value)";
    throw error;
  }
}

/** A value as editable text, or empty when it is not representable. */
function storedText(value: OverrideValue): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * A text exposure the author types into.
 *
 * Holds its own value while focused and reports it on blur, for the reason the
 * block inspector's text field does. **An emptied field CLEARS the property**
 * rather than writing an empty string: the whole reason the `$unset` sentinel
 * exists is so an author can take away a subtitle the definition fills in, and
 * a field that wrote `""` would leave them with a value the definition may
 * treat as meaningful and no way to say "nothing".
 */
function ExposedTextField({
  id,
  row,
  onSet,
}: {
  id: string;
  row: ExposedRow;
  onSet: (id: string, value: OverrideValue) => void;
}): React.JSX.Element {
  // Only a primitive becomes text, for the reason the block inspector gives:
  // an unrepresentable value shows empty, and because `send` compares against
  // this, an untouched field writes nothing.
  const stored = storedText(row.value);
  const [draft, setDraft] = useStoredDraft(stored);

  const send = () => {
    if (draft === stored) return;
    onSet(row.id, draft === "" ? { $unset: true } : draft);
  };

  return (
    <Input
      id={id}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={send}
      // Enter commits as well as blur, as every single-line field here does.
      onKeyDown={event => {
        if (event.key === "Enter") {
          event.preventDefault();
          send();
        }
      }}
    />
  );
}

/**
 * Values this instance stores for properties the definition no longer
 * exposes.
 *
 * Their own section rather than rows among the properties: they are not
 * properties any more. Each shows the stored value — the id is the only name
 * it has left — and offers to discard it, which is the one thing that can be
 * done with it. Nothing is discarded silently; that is the point.
 */
function OrphanedOverrides({
  orphaned,
  onDiscard,
}: {
  orphaned: readonly OrphanedOverride[];
  onDiscard: (id: string) => void;
}): React.JSX.Element {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="nx-inspector__orphaned">
      <h3 id={headingId} className="nx-inspector__heading">
        No longer exposed
      </h3>
      <p className="nx-inspector__note">
        This instance holds values for properties the component no longer
        exposes. They do nothing until the component exposes them again.
      </p>
      <ul className="nx-inspector__orphans">
        {orphaned.map(entry => (
          <li key={entry.id} className="nx-inspector__orphan">
            <code>{entry.id}</code>
            <span className="nx-inspector__orphan-value">
              {valueSummary(entry.value) === ""
                ? "(empty)"
                : valueSummary(entry.value)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Discard the stored value for ${entry.id}`}
              onClick={() => onDiscard(entry.id)}
            >
              Discard
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
