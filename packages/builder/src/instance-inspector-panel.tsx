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
  exposedValueFits,
  findNode,
  isRichTextValue,
  isUnsetOverride,
  neededFor,
  richTextToPlainText,
  type BlockDocument,
  type ComponentDocument,
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
  Switch,
} from "@nextlyhq/ui";
import {
  CircleSlash,
  Layers,
  Link2,
  Lock,
  PenLine,
  RotateCcw,
  SquarePen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { BlockCard, type CardVerbs } from "./block-card";
import { CanvasPassageContext } from "./canvas-passage";
import {
  ChosenMedia,
  ContentServicesContext,
  MediaChoice,
  RichTextField,
  type PickedMedia,
} from "./content-controls";
import type { EditorState } from "./editor-state";
import { markExposedParts } from "./exposed-outline";
import { HeldByLock, HeldHere } from "./held-by-lock";
import { lockOp, lockStatusOf, lockViewOf, renameOp } from "./inspector";
import {
  resetOverrideOp,
  setOverrideOp,
  type ExposedRow,
  type InstanceInspection,
  type OrphanedOverride,
} from "./instance-inspector";
import { refusalAnnouncement } from "./move-refusal";
import { useStoredDraft } from "./stored-draft";
import { VariantPicker } from "./variant-picker";

/**
 * What the row's badge says for each source.
 *
 * A record over the closed set rather than a chain of comparisons, so a
 * source the resolver adds later is a build failure here until it has words.
 */
const SOURCE_LABEL: Readonly<Record<ExposedRow["source"], string>> = {
  // In the editor's words for a component: where the value comes from, said
  // as a quiet line rather than an internal term in capitals.
  definition: "From the component",
  variant: "From variant",
  instance: "Set on this page",
};

/**
 * The badge's icon for each state, beside its words, so the four states differ
 * by shape as well as by label and never by colour alone: "Cleared" (a value
 * deliberately removed) and "Inherited" (nothing set here) are the pair an
 * author most needs to tell apart, and the one a colour-blind author could
 * not tell apart by tint.
 */
const SOURCE_ICON: Readonly<
  Record<ExposedRow["source"] | "cleared", LucideIcon>
> = {
  definition: Link2,
  variant: Layers,
  instance: PenLine,
  cleared: CircleSlash,
};

/**
 * A cleared value, said by whoever cleared it: a variant's clearing is not
 * this page's, and there is no page value to reset.
 */
const CLEARED_LABEL: Readonly<Record<ExposedRow["source"], string>> = {
  definition: "Empty in the component",
  variant: "Cleared by variant",
  instance: "Cleared on this page",
};

/** The words a row's badge shows: its source, or who cleared it. */
function sourceBadgeLabel(row: Pick<ExposedRow, "source" | "cleared">): string {
  return (row.cleared ? CLEARED_LABEL : SOURCE_LABEL)[row.source];
}

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
  verbs,
  definition,
  canvasRoot,
}: {
  inspection: InstanceInspection;
  editor: EditorState;
  /** The shared block verbs for the card's menu, as a block's card gets. */
  verbs?: CardVerbs | undefined;
  /** The definition the placement resolves against, for its variant picker. */
  definition?: ComponentDocument | undefined;
  /**
   * The canvas's root, where the placement's exposed parts are marked; the
   * page's document when the host names none. Scoped so a canvas drawn in a
   * frame is reached, and another editor's marks are left alone.
   */
  canvasRoot?: HTMLElement | null | undefined;
}): React.JSX.Element {
  // Read the node at commit time rather than closing over one. A field
  // committing on blur can fire after another edit has already replaced the
  // node, and an override record rebuilt from the older copy would resurrect
  // overrides that edit removed.
  const nodeNow = React.useCallback(
    () => findNode(editor.document.nodes, inspection.nodeId),
    [editor.document, inspection.nodeId]
  );
  // Answers the document the write produced, or `null` when it was refused,
  // so a field holding words only it has (a rich-text passage) can keep them.
  const set: SetExposed = React.useCallback(
    (id: string, value: OverrideValue) => {
      const node = nodeNow();
      return node === undefined
        ? null
        : editor.apply(setOverrideOp(node, id, value));
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
  // The selected placement's editable parts, outlined on the canvas while it
  // is selected: after every render, since the canvas redraws with the
  // document this panel reads, and cleared when the selection moves on.
  const composed = editor.composed();
  React.useEffect(() => {
    const root: ParentNode = canvasRoot ?? globalThis.document;
    markExposedParts(root, inspection.nodeId, composed);
    return () => markExposedParts(root, null, undefined);
  }, [inspection.nodeId, composed, canvasRoot]);
  // The card's lock line, which every held row points to while the placement
  // is locked in Layers. Its own lock control stays live above, so it can be
  // unlocked.
  const lockedReasonId = React.useId();
  const locked = inspection.identity.locked;
  const onCanvas = React.useContext(CanvasPassageContext);

  return (
    <OnCanvasHere.Provider
      value={
        onCanvas?.placementId === inspection.nodeId
          ? onCanvas.exposureId
          : undefined
      }
    >
      <div className="nx-inspector" data-instance="">
        {/*
        The same card every block gets. Its description says what this IS —
        "Component", for the author who clicked into a header and is wondering
        why the Style tab went — with the usage count beside it when the
        library could say, because an edit to this component's definition
        reaches every one of those pages.
      */}
        <BlockCard
          // Keyed by node so a rename half-typed for one instance does not carry
          // to the next, exactly as the block inspector's does.
          key={`${inspection.nodeId}:card`}
          // The editor's fallback mark: no block icon names a component.
          icon={undefined}
          type={inspection.label}
          name={inspection.identity.name}
          description={`Component${variantPhrase(inspection.variant)}${
            inspection.usedOn === undefined
              ? ""
              : ` · used on ${inspection.usedOn} ${inspection.usedOn === 1 ? "page" : "pages"}`
          }`}
          lock={lockStatusOf(
            editor.document,
            inspection.nodeId,
            lockViewOf(editor)
          )}
          onRename={name => editor.apply(renameOp(inspection.nodeId, name))}
          onLock={locked => editor.apply(lockOp(inspection.nodeId, locked))}
          verbs={verbs}
          // The lock is said once, by the card's own line, and the rows and the
          // values no longer exposed point at it; a second sentence below said
          // the same thing again.
          reasonId={lockedReasonId}
        />
        <EditComponentButton verbs={verbs} />

        <VariantPicker
          editor={editor}
          nodeId={inspection.nodeId}
          definition={definition}
          disabled={inspection.identity.locked}
        />

        {!inspection.definitionFound ? (
          /*
           * The same state the canvas draws as could-not-be-loaded, in words. A
           * `status` region rather than an alert: it is a standing fact about
           * this selection, not an event.
           */
          <p className="nx-inspector__note" role="status">
            This component could not be loaded, so its properties cannot be
            edited here. It may have been deleted, or the library was too large
            to load whole.
          </p>
        ) : inspection.rows.length === 0 ? (
          /*
           * Zero exposed properties is a locked, reusable block — a footer — not
           * a broken component, so this says what there is to do rather than
           * that something is missing: the content lives on the definition, and
           * the definition has a screen.
           */
          <NoFieldsNote verbs={verbs} />
        ) : (
          <section aria-labelledby={headingId}>
            <h3 id={headingId} className="nx-inspector__heading">
              Fields
            </h3>
            <HeldByLock reasonId={locked ? lockedReasonId : undefined}>
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
            </HeldByLock>
          </section>
        )}

        {inspection.orphaned.length > 0 ? (
          // Held by the same Layers lock as the rows: discarding a stored value
          // is an edit of the placement too.
          <HeldByLock reasonId={locked ? lockedReasonId : undefined}>
            <OrphanedOverrides
              orphaned={inspection.orphaned}
              onDiscard={reset}
            />
          </HeldByLock>
        ) : null}
      </div>
    </OnCanvasHere.Provider>
  );
}

/**
 * The variant this placement uses, as a phrase after "Component", or nothing.
 * A variant the component no longer offers is said once, by the variant
 * picker's notice beside its Clear, rather than here as well.
 */
function variantPhrase(variant: InstanceInspection["variant"]): string {
  if (variant?.label === undefined) return "";
  return ` · ${variant.label} variant`;
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
  onSet: SetExposed;
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
  const state = row.cleared ? "cleared" : row.source;
  const Icon = SOURCE_ICON[state];
  const reasonId = `${id}-held`;

  return (
    <div
      className="nx-inspector__field nx-inspector__field--exposed"
      data-source={state}
    >
      {/*
        The row's name and where its value comes from, in the label column:
        the source a quiet note under the label, as an inherited Style value
        says where it comes from, so the row is one row beside the 28px
        Style rows rather than a label, a field and a line under it.
      */}
      <div className="nx-inspector__exposed-name">
        {/* Its id names a control no `for` can reach: a rich-text passage. */}
        <Label id={`${id}-label`} {...(hasControl ? { htmlFor: id } : {})}>
          {row.label}
        </Label>
        {/*
          The source is VISIBLE, and words rather than the label's styling:
          "Set on this page" is what tells an author the reset beside the field
          undoes their own edit rather than the component's design.
        */}
        <span className="nx-inspector__source" data-source={state}>
          <Icon aria-hidden="true" className="nx-inspector__source-icon" />
          {sourceBadgeLabel(row)}
        </span>
      </div>
      <div className="nx-inspector__exposed">
        {/*
          Only the value is held. Reset stays live: a value the page gave
          before the component locked the block is one the save keeps and
          lets the page drop, so the way back is never closed.
        */}
        <HeldByLock reasonId={row.heldBy === undefined ? undefined : reasonId}>
          <ExposedControl id={id} row={row} onSet={onSet} />
        </HeldByLock>
        {/*
          Why the row is held, UNDER the field as its helper text: the field
          keeps its place beside its label, and the reason reads as a fact
          about the value above it.
        */}
        {row.heldBy === undefined ? null : (
          <p id={reasonId} className="nx-inspector__held-reason">
            <Lock aria-hidden="true" className="nx-inspector__source-icon" />
            <span>{refusalAnnouncement(row.heldBy)}</span>
          </p>
        )}
      </div>
      {/* Kept when empty, so every control ends at one edge, set or not. */}
      <span className="nx-inspector__exposed-reset-slot">
        {overridden ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="nx-inspector__exposed-reset"
            aria-label={`Reset ${row.label}`}
            title="Undo this page's change"
            onClick={() => onReset(row.id)}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </span>
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
  onSet: SetExposed;
}): React.JSX.Element {
  if (row.shadowedBy !== undefined) {
    return (
      <p className="nx-inspector__note">
        Set by “{row.shadowedBy.label}”, which the page shows instead of this.
      </p>
    );
  }
  // A type this panel has no control for, OR a value its control could not
  // represent. The second is not a shape problem to report: `OverrideValue` is
  // unconstrained and a host block may declare a text or link prop as an
  // object, which a text field renders as a blank — and the first edit then
  // replaces the whole value with what was typed into that blank. Shown rather
  // than offered for editing, so nothing is lost to a control that cannot hold
  // it.
  if (!row.supported || !representable(row)) return <NotEditable row={row} />;
  if (row.type === "visibility") {
    return <ExposedVisibilityField id={id} row={row} onSet={onSet} />;
  }
  if (row.type === "image") {
    return <ExposedImageField id={id} row={row} onSet={onSet} />;
  }
  if (row.type === "richText") {
    return <ExposedRichTextField id={id} row={row} onSet={onSet} />;
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

/**
 * Whether this row's control can hold the value in force.
 *
 * Only the TEXT controls can fail this, and only on a structured value: a
 * blank is what the field is meant to show, and a boolean or a number reads
 * back as itself. A CLEARED row is a blank too and needs no case of its own —
 * the resolver normalises a cleared value to `undefined` rather than handing
 * the sentinel on, which is the contract `instanceExposure` states.
 *
 * A select and a visibility row always pass. Neither carries the old value into
 * what it writes — choosing an option or ticking a box replaces it outright —
 * so a value they cannot show is repairable by using the control, and hiding it
 * would strand the property instead.
 */
/** Writes one exposed field's value: the document written, or `null` if refused. */
type SetExposed = (id: string, value: OverrideValue) => BlockDocument | null;

/**
 * A row with no control: its value in words, so an author can read what the
 * component holds without being offered a control that could not keep it.
 */
function NotEditable({ row }: { row: ExposedRow }): React.JSX.Element {
  const shown = valueSummary(row.value);
  return (
    <p className="nx-inspector__note">
      {shown === "" ? null : `“${shown}” — `}
      Not editable here yet ({TYPE_LABEL[row.type]}).
    </p>
  );
}

/**
 * A placement's own passage, edited with the admin's one rich-text editor,
 * the control the Content tab's rich text uses. Opened on what the page
 * shows (the component's passage until the page has its own), written once
 * when the field is left, so an edit is one step of the history. Without the
 * host's editor the row says it cannot be edited here: the canvas's passage
 * is the component's, so the Content tab's "edit it on the canvas" would not
 * be true of it.
 */
/**
 * The exposure of the placement shown whose passage the canvas is editing in
 * place, if any: its field is held meanwhile.
 */
const OnCanvasHere = React.createContext<string | undefined>(undefined);

function ExposedRichTextField({
  id,
  row,
  onSet,
}: {
  id: string;
  row: ExposedRow;
  onSet: SetExposed;
}): React.JSX.Element {
  const services = React.useContext(ContentServicesContext);
  // Held by the placement's Layers lock or a lock inside the component.
  const held = React.useContext(HeldHere);
  // Held while the canvas edits this passage in place: one editor serves
  // both, and opening it here would take the passage from under the caret.
  const onCanvas = React.useContext(OnCanvasHere) === row.id;
  if (services?.loadRichTextEditor === undefined) {
    return <NotEditable row={row} />;
  }
  return (
    <>
      <RichTextField
        id={id}
        labelledBy={`${id}-label`}
        value={row.value}
        // Passed to the passage itself: a held row's wrapper disables its
        // fieldset, which does not stop typing in a `contenteditable`.
        disabled={held || onCanvas}
        onCommit={value => onSet(row.id, value)}
        services={services}
      />
      {onCanvas ? (
        <p className="nx-inspector__note" data-held="canvas">
          This passage is being edited on the canvas. Finish there to edit it
          here.
        </p>
      ) : null}
    </>
  );
}

function representable(row: ExposedRow): boolean {
  if (row.type === "visibility" || row.type === "select") return true;
  const { value } = row;
  if (value === undefined || value === null) return true;
  // A passage is one the editor can open. Plain words are a passage to the
  // page but not to the editor, which would open them EMPTY, and the first
  // keystroke would replace what the page shows; they stay shown instead.
  if (row.type === "richText") return isRichTextValue(value);
  // An image row shows a cleared override as nothing chosen.
  // An image is a file's id, a string, or a cleared override; anything else
  // stays shown as it is rather than offered to a picker that would replace
  // it behind a blank-looking control.
  if (row.type === "image") {
    return typeof value === "string" || isUnsetOverride(value);
  }
  return typeof value !== "object";
}

/**
 * An image exposure, chosen from the host's media library as the Content
 * tab's image is: Choose or Replace opens it, and Remove clears this
 * placement's image, which reads as Cleared rather than falling back to the
 * component's. Where the host offers no library, it says so rather than
 * offering a button that does nothing.
 */
function ExposedImageField({
  id,
  row,
  onSet,
}: {
  id: string;
  row: ExposedRow;
  onSet: (id: string, value: OverrideValue) => void;
}): React.JSX.Element {
  const services = React.useContext(ContentServicesContext);
  const Picker = services?.MediaPicker;
  // What the last pick was called, for this session; a stored id shows as set.
  const [picked, setPicked] = React.useState<PickedMedia | null>(null);
  const stored =
    typeof row.value === "string" && row.value !== "" ? row.value : null;
  const name = picked?.id === stored ? picked?.filename : undefined;
  return (
    <div
      // The field's label names the Choose button, a labelable control; with
      // no library there is no control, and the group carries the name.
      {...(Picker === undefined ? { id } : {})}
      className="nx-inspector__media"
      role="group"
      aria-label={row.label}
    >
      <ChosenMedia
        mediaId={stored}
        read={services?.readMedia}
        pickedName={name}
        fallback="An image from the media library."
      />
      {Picker === undefined ? (
        <p className="nx-inspector__note">
          The media library is not available here.
        </p>
      ) : (
        <MediaChoice
          id={id}
          Picker={Picker}
          label={row.label}
          stored={stored}
          accept="image/*"
          disabled={false}
          onChoose={first => {
            setPicked(first);
            onSet(row.id, first.id);
          }}
        />
      )}
      {stored === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Remove ${row.label}`}
          onClick={() => onSet(row.id, { $unset: true })}
        >
          Remove
        </Button>
      )}
    </div>
  );
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
  // A value the store would refuse is held here with the reason rather than
  // written: a link the renderer would not draw is the case a text field can
  // produce. The draft stays, so the author can correct it. The refusal is
  // held against the stored value it was made over: once that changes (a
  // reset, an undo, an edit on the canvas), the field shows the new value and
  // the refusal no longer describes it.
  const [refusal, setRefusal] = React.useState<{
    readonly over: string;
    readonly message: string;
  } | null>(null);
  const problem = refusal?.over === stored ? refusal.message : null;
  const problemId = `${id}-problem`;

  const send = () => {
    if (draft === stored) {
      setRefusal(null);
      return;
    }
    const next = draft === "" ? { $unset: true } : draft;
    if (!exposedValueFits(row, next)) {
      setRefusal({ over: stored, message: `${row.label} ${neededFor(row)}.` });
      return;
    }
    setRefusal(null);
    onSet(row.id, next);
  };

  return (
    <>
      <Input
        id={id}
        value={draft}
        aria-invalid={problem === null ? undefined : true}
        aria-describedby={problem === null ? undefined : problemId}
        // Keyed for an address when the exposure is one, as the block inspector
        // keys a url prop: the value is the same string either way.
        inputMode={row.type === "link" ? "url" : undefined}
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
      {problem === null ? null : (
        <p id={problemId} className="nx-inspector__problem" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

/**
 * A visibility exposure: whether the node it aims at is served on this page.
 *
 * A checkbox, committed at once — there is nothing to coalesce. It writes
 * `true` or `false` and nothing else, because those are the two values the
 * resolver reads there: a cleared override hides, and anything else is
 * ignored with the component's own rule left in force. So checked means
 * "shown", and an INHERITED row reads as shown: the component's rule is to
 * serve the node unless the definition gates it itself, and the source badge
 * beside the box says which it is.
 */
function ExposedVisibilityField({
  id,
  row,
  onSet,
}: {
  id: string;
  row: ExposedRow;
  onSet: (id: string, value: OverrideValue) => void;
}): React.JSX.Element {
  const shown = row.value !== false && !row.cleared;
  return (
    // A switch named by its row, whose state says whether it is shown: a
    // checkbox beside "Shown on this page" wrapped onto two lines.
    <Switch
      id={id}
      checked={shown}
      onCheckedChange={checked => onSet(row.id, checked === true)}
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

/**
 * "Edit component", where the host offers it for this placement: the verb the
 * toolbar and the palette run, drawn here as the panel's first action because
 * an author looking at a placement's fields is the one most likely to want the
 * component's own design next.
 */
/**
 * What a component with no fields says. It points at Edit component only
 * where that button is offered: an author who may not edit components is not
 * sent to an action they lack.
 */
function NoFieldsNote({
  verbs,
}: {
  verbs: CardVerbs | undefined;
}): React.JSX.Element {
  return (
    <p className="nx-inspector__note">
      This component has no fields to change on this page.
      {editComponentOffered(verbs)
        ? " Use Edit component to change its content."
        : null}
    </p>
  );
}

/** Whether the host offers Edit component, enabled, for this placement. */
function editComponentOffered(verbs: CardVerbs | undefined): boolean {
  return (
    verbs?.actions.some(
      action => action.id === "edit-component" && action.enabled
    ) === true
  );
}

function EditComponentButton({
  verbs,
}: {
  verbs: CardVerbs | undefined;
}): React.JSX.Element | null {
  if (verbs === undefined || !editComponentOffered(verbs)) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="nx-inspector__edit-component"
      onClick={() => verbs.run("edit-component")}
    >
      <SquarePen size={14} aria-hidden="true" />
      Edit component
    </Button>
  );
}
