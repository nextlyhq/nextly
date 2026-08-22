"use client";

/**
 * The Style tab: editing the selected block's style values.
 *
 * Draws what `style-inspector` decides and decides nothing itself — which
 * sections a block offers, which properties sit in each, and which control each
 * property draws all live there, where they can be asserted without a DOM.
 *
 * **One section open at a time.** The choice is remembered across selections
 * rather than reset, because an author working on spacing selects one block
 * after another and means to stay on spacing; it falls back to the first
 * section only when the newly selected block does not offer the open one.
 *
 * **Text commits on blur, discrete controls immediately**, the same rule the
 * content tab follows and for the same reason: undo is built from op inverses,
 * so an op per keystroke would make one undo remove one character.
 *
 * **Clearing is not writing an empty value.** An emptied field removes the
 * entry, so the property falls back through the cascade to whatever a class, a
 * block default or a wider breakpoint set — which is what an author asking to
 * reset a control means. Writing `""` would instead pin the property to nothing
 * here and beat the tier they wanted back.
 *
 * **A refused value is shown, not swallowed.** The catalog's own message sits
 * under the control that produced it, because a field that silently keeps its
 * old value after an edit reads as an editor that dropped the keystroke.
 *
 * @module style-inspector-panel
 */

import {
  findNode,
  isTokenRef,
  trimCssWhitespace,
  type BreakpointId,
  type StyleLeaf,
  type StyleShape,
  type StyleState,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
import { fieldLabel } from "./inspector";
import type {
  StyleControl,
  StyleControlKind,
  StyleControlVariants,
} from "./style-controls";
import {
  inspectStyle,
  type InspectedStyleProperty,
  type StyleSection,
} from "./style-inspector";
import {
  readStyleValue,
  styleClearOp,
  styleWriteOp,
  type StyleAddress,
  type StylePolicy,
} from "./style-values";

export interface StyleInspectorPanelProps {
  /**
   * The editor whose selected block this styles.
   *
   * The whole state rather than a document and an `apply` separately, for the
   * reason the content tab takes it: a write is built from the node in a
   * particular document, and passing them apart lets a caller hand a node from
   * one render to an `apply` bound to another.
   */
  editor: EditorState;
  /**
   * What the site allows, forwarded to both the arm choice and the write.
   *
   * Carried rather than defaulted: the engine ships no host list of its own, so
   * omitting it does not mean "allow" — it means the question was never asked.
   */
  policy?: StylePolicy;
  /** The interaction state being edited. `base` when the host says nothing. */
  state?: StyleState;
  /** The breakpoint being edited. The unconditional one when the host says nothing. */
  breakpoint?: BreakpointId;
}

export function StyleInspectorPanel({
  editor,
  policy,
  state,
  breakpoint,
}: StyleInspectorPanelProps): React.JSX.Element {
  // `null` is "the author has not chosen yet", which is NOT the same as the
  // empty string the accordion sends when they collapse the open section. The
  // two collapsed onto one value made the first section impossible to close,
  // and closing any later one silently opened the first.
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);
  // The form an author chose at a union position, keyed by property and path.
  // Panel state rather than document state: it is only consulted where nothing
  // is stored, so there is nothing to persist — the moment a value exists, the
  // value decides its own form.
  const [chosenForms, setChosenForms] = React.useState<Record<string, number>>(
    {}
  );

  // Recomputed each render rather than memoised, as the content tab is: an
  // inspection is only valid against the document it was read from, and an edit
  // anywhere changes both the document and the values shown.
  const inspection = inspectStyle(editor.document, editor.selectedId, {
    ...policy,
    state,
    breakpoint,
    variantAt: (property, path) => chosenForms[formKey(property, path)],
  });

  const chooseForm = (property: string, path: readonly string[], arm: number) =>
    setChosenForms(current => ({ ...current, [formKey(property, path)]: arm }));

  /*
   * Several blocks selected: a different panel, not a thinner one.
   *
   * `selectedId` is the PRIMARY of the selection, so inspecting it would draw
   * writable controls that change one block while the canvas outlines six —
   * two surfaces answering different questions with the same words. The
   * inspector wrapper makes the same refusal for the content half; this one
   * makes it for itself because it is exported standalone, and a host mounting
   * it directly gets no wrapper.
   *
   * Editing one property across a whole selection — one field showing "Mixed"
   * and writing to every block — is a different surface with its own rules
   * about what a shared value means, and it does not exist yet.
   */
  if (editor.selection.ids.length > 1) {
    return (
      <div className="nx-style-inspector" data-empty="many-selected">
        <p className="nx-inspector__note">
          {editor.selection.ids.length} blocks selected. Select one to style it.
        </p>
      </div>
    );
  }

  if (inspection === null) {
    return (
      <div className="nx-style-inspector" data-empty="no-selection">
        <p className="nx-inspector__note">Select a block to style it.</p>
      </div>
    );
  }

  if (inspection.sections.length === 0) {
    return (
      <div className="nx-style-inspector" data-empty="no-style-support">
        <p className="nx-inspector__note">
          This block does not offer style properties.
        </p>
      </div>
    );
  }

  const groups = inspection.sections.map(section => section.group);
  // Held rather than left to the accordion, so the open section survives a
  // change of selection. Falling back to the first is what keeps it valid when
  // the newly selected block does not offer the section that was open — an
  // accordion asked to open a section it does not have shows nothing open at
  // all, which reads as the panel having failed to load.
  //
  // Compared as strings because that is what the accordion hands back, and
  // narrowing its argument to a catalog group would be this file claiming to
  // know the vocabulary rather than reading it off the sections in hand.
  const available = new Set<string>(groups);
  const open = openSection(openGroup, available, groups[0] ?? "");

  return (
    <div className="nx-style-inspector">
      <Accordion
        type="single"
        collapsible
        value={open}
        onValueChange={setOpenGroup}
      >
        {inspection.sections.map(section => (
          <StyleSectionItem
            // Keyed by node AND group: a bare group would let React reuse one
            // block's inputs for the next block's same-named section, so a field
            // would keep the previous block's uncommitted text.
            key={`${inspection.nodeId}:${section.group}`}
            section={section}
            nodeId={inspection.nodeId}
            state={inspection.state}
            breakpoint={inspection.breakpoint}
            editor={editor}
            policy={policy}
            onChooseForm={chooseForm}
          />
        ))}
      </Accordion>
    </div>
  );
}

/** One catalog group, as a section that opens onto its properties. */
function StyleSectionItem({
  section,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  onChooseForm,
}: {
  section: StyleSection;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  onChooseForm: ChooseForm;
}): React.JSX.Element {
  // How many of this section's properties this node sets HERE, so an author can
  // see which sections they have touched without opening each one.
  const setCount = section.properties.filter(property => property.set).length;
  return (
    <AccordionItem value={section.group}>
      <AccordionTrigger>
        <span className="nx-style-inspector__section-label">
          {section.label}
        </span>
        {setCount > 0 ? (
          <span
            className="nx-style-inspector__section-count"
            aria-label={`${setCount} set`}
          >
            {setCount}
          </span>
        ) : null}
      </AccordionTrigger>
      <AccordionContent>
        <div className="nx-inspector__fields">
          {section.properties.map(property => (
            <StylePropertyFields
              key={`${nodeId}:${property.property}`}
              property={property}
              nodeId={nodeId}
              state={state}
              breakpoint={breakpoint}
              editor={editor}
              policy={policy}
              onChooseForm={onChooseForm}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * One catalog property, which is one control or several.
 *
 * `margin` is four logical sides and `position` is a scheme, four offsets and a
 * stacking order, so a property is a GROUP of controls rather than a field. The
 * heading is drawn only when there is more than one, because a lone control
 * already carries the property's name.
 */
function StylePropertyFields({
  property,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  onChooseForm,
}: {
  property: InspectedStyleProperty;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  onChooseForm: ChooseForm;
}): React.JSX.Element {
  const many = property.controls.length > 1;
  return (
    <div
      className="nx-style-inspector__property"
      data-property={property.property}
    >
      {many ? (
        <p
          className="nx-style-inspector__property-label"
          title={property.summary}
        >
          {property.label}
        </p>
      ) : null}
      {/*
        The forms the catalog offers at each union position, so every one is
        reachable. Without this an unset `borderRadius` could only ever be
        authored as a single radius and `position.zIndex` only as a number: the
        engine answers with the catalog's first arm when nothing is stored, and
        that answer is right precisely because the author has not spoken yet.

        Withheld for a property the block no longer offers. `FormChoice`
        REMOVES what is stored at the union's position — `styleClearOp`, so the
        new form starts empty — which is right while a property is still
        editable and wrong once it is not: a selector left enabled beside the
        notice below reads as "switch this to corners" and instead deletes the
        value, through a capability the block has withdrawn. The Clear action on
        the value itself is the honest way to remove it, and it is already
        there.
      */}
      {(property.offered ? property.variants : [])
        .filter(variant => variant.count > 1)
        .map(variant => (
          <FormChoice
            key={variant.path.join(".")}
            property={property}
            variant={variant}
            nodeId={nodeId}
            state={state}
            breakpoint={breakpoint}
            editor={editor}
            policy={policy}
            onChooseForm={onChooseForm}
          />
        ))}
      {property.offered ? null : (
        <p className="nx-inspector__note" data-not-offered={property.property}>
          This block no longer offers {property.label}. The value is still on
          the page and can be cleared.
        </p>
      )}
      {property.controls.map(control => (
        <StyleControlField
          // The ADDRESS, not just the position: a host switching state or
          // breakpoint leaves this field mounted, and where the old and new
          // addresses hold the same value — both unset, most often — the
          // synchronisation effect does not run either. An unfinished draft
          // from the base breakpoint would then commit into the hover state.
          key={[state, breakpoint, property.property, ...control.path].join(
            "."
          )}
          control={control}
          label={
            many
              ? fieldLabel(control.path[control.path.length - 1] ?? "")
              : property.label
          }
          summary={many ? undefined : property.summary}
          propertyLabel={property.label}
          clearOnly={!property.offered}
          nodeId={nodeId}
          state={state}
          breakpoint={breakpoint}
          editor={editor}
          policy={policy}
        />
      ))}
    </div>
  );
}

/** How an author says which form they mean to write a value in. */
type ChooseForm = (
  property: string,
  path: readonly string[],
  arm: number
) => void;

/** The panel-state key for one union position. */
function formKey(property: string, path: readonly string[]): string {
  return [property, ...path].join(".");
}

/**
 * What each form is called, from the arm's own shape kind.
 *
 * The catalog gives arms no names, so their shape kind is the most specific
 * thing it says about them — and "Form 1 / Form 2" tells an author nothing
 * about which is which. Partial for the same reason the placeholders are: this
 * is a label, so a kind this build has not learned about gets the kind itself
 * rather than a compile error.
 */
const FORM_LABEL: Partial<Record<StyleShape["kind"], string>> = {
  dimension: "Length",
  number: "Number",
  keyword: "Keyword",
  color: "Colour",
  cssValue: "Custom",
  url: "URL",
  logicalSides: "Per side",
  logicalCorners: "Per corner",
  object: "Fields",
  union: "Mixed",
};

/**
 * The choice of form at one union position.
 *
 * Choosing a form while a value is stored CLEARS it. The two forms hold
 * different things — one radius is not four corners — so there is nothing to
 * carry across, and leaving the value in place would be worse than clearing:
 * the stored value decides its own arm, so the panel would snap straight back
 * to the form the author just moved away from.
 */
function FormChoice({
  property,
  variant,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  onChooseForm,
}: {
  property: InspectedStyleProperty;
  variant: StyleControlVariants;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  onChooseForm: ChooseForm;
}): React.JSX.Element {
  const id = React.useId();
  const choose = (raw: string) => {
    const arm = Number(raw);
    if (!Number.isInteger(arm)) return;
    onChooseForm(property.property, variant.path, arm);
    const current = findNode(editor.document.nodes, nodeId);
    if (current === undefined) return;
    // The union's OWN position, not the property's root. A union can sit below
    // it — `position` holds a type, an inset and a zIndex, and only the last is
    // a union — so clearing the root to change the zIndex form would delete the
    // author's positioning scheme and offsets along with it.
    const address: StyleAddress = {
      state,
      breakpoint,
      property: property.property,
      path: variant.path,
    };
    // Read at this position for the same reason: `property.set` answers for the
    // whole property, which is true whenever any sibling holds a value.
    if (readStyleValue(current.styles, address) === undefined) return;
    const cleared = styleClearOp(nodeId, current.styles, address, policy);
    if (cleared.ok && cleared.op !== null) editor.apply(cleared.op);
  };

  return (
    <div className="nx-inspector__field" data-form-choice={property.property}>
      <Label htmlFor={id}>
        {/*
          The PROPERTY's name at the root, because a property whose shape is a
          union at the top draws one control and therefore no heading — so
          `fontWeight`, `lineHeight` and `fontStyle` would all offer a selector
          called "Form". Below the root the heading is rendered, so the position
          is enough to tell them apart.
        */}
        {variant.path.length === 0
          ? `${property.label} form`
          : `${fieldLabel(variant.path[variant.path.length - 1] ?? "")} form`}
      </Label>
      <Select value={String(variant.active)} onValueChange={choose}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {variant.kinds.map((kind, index) => (
            <SelectItem key={`${index}:${kind}`} value={String(index)}>
              {FORM_LABEL[kind] ?? kind}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * What a commit did to the document.
 *
 * Three outcomes rather than a boolean, because the surface showing the value
 * has to do something different in each and two of them are easy to conflate.
 * `refused` KEEPS what the author typed, so they can correct it beside the
 * message. `unchanged` means the write was valid and the document already held
 * that value — `01` where it holds `1` — so the field has to go back to what
 * the document says, and nothing else will make it: the stored value never
 * moved, so no effect keyed on it fires.
 */
type CommitOutcome = "applied" | "refused" | "unchanged";

/** One editable position, drawn as the control its leaf kind resolves to. */
function StyleControlField({
  control,
  label,
  summary,
  propertyLabel,
  clearOnly,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
}: {
  control: StyleControl;
  label: string;
  summary: string | undefined;
  /**
   * The whole property's name, for naming an ACTION rather than a field.
   *
   * A field is labelled by its position — "Block start" — which is enough
   * beside its own property's heading and not enough on a button: `padding` and
   * `margin` both have a block start, so two buttons called "Clear block start"
   * name the same thing twice and a screen-reader user cannot tell which style
   * each removes.
   */
  propertyLabel: string;
  /**
   * Whether this value may only be REMOVED, not changed.
   *
   * True for a property the block's `supports` no longer declares. The value is
   * still emitted — nothing in validation or compilation reads `supports` — so
   * withholding the control entirely would leave styling on the page that the
   * author can see and cannot remove. Letting them go on EDITING it is the
   * other error: it writes new values through a capability the block has
   * withdrawn, which is the definition the panel is supposed to be reading.
   */
  clearOnly: boolean;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
}): React.JSX.Element {
  const id = React.useId();
  // The message's own id, so the control can point at it. A `role="alert"`
  // announces once and then it is gone: a screen-reader user who returns to the
  // field, or meets several rejected controls, has no way to tell which message
  // belongs to which without the relationship being stated.
  const errorId = `${id}-error`;
  const address: StyleAddress = {
    state,
    breakpoint,
    property: control.property,
    path: control.path,
  };
  const node = findNode(editor.document.nodes, nodeId);
  const stored = readStyleValue(node?.styles, address);
  // The property alone where a property draws one control, and the property
  // plus the position where it draws several.
  const actionName =
    propertyLabel === label
      ? propertyLabel
      : `${propertyLabel} ${label.toLowerCase()}`;
  const [issue, setIssue] = React.useState<string | null>(null);

  // A refusal describes the draft that produced it, so it stops describing
  // anything the moment the document holds a different value here. Clearing on
  // the stored value rather than only on the next commit is what covers an undo
  // or an edit applied from elsewhere: the remount key changes with the
  // SELECTION, and neither of those changes the selection.
  React.useEffect(() => {
    setIssue(null);
  }, [stored]);

  /*
   * Read the node at commit time rather than closing over one. A field
   * committing on blur can fire after another edit has already replaced the
   * node, and writing from the older copy would resurrect its styles.
   */
  const commit = (value: StyleValue | null): CommitOutcome => {
    const current = findNode(editor.document.nodes, nodeId);
    if (current === undefined) return "refused";
    const write =
      value === null
        ? styleClearOp(nodeId, current.styles, address, policy)
        : styleWriteOp(nodeId, current.styles, address, value, policy);
    if (!write.ok) {
      setIssue(write.issues[0]?.message ?? "This value cannot be used here.");
      return "refused";
    }
    setIssue(null);
    // Null is the store saying the document already holds this value, which is
    // the ordinary case for a field blurred without being changed. Applying it
    // would ask the op store for a history entry that undoes to no visible
    // effect, which it refuses.
    if (write.op === null) return "unchanged";
    // The store's own refusal, which the validator cannot anticipate: it judges
    // the edited leaf, while `applyOp` judges the whole document — a page at
    // its byte limit rejects an edit whose value is perfectly valid. Unreported,
    // the field goes on showing the draft and reads as saved while neither the
    // document nor the undo history moved.
    if (editor.apply(write.op) === null) {
      setIssue("This edit could not be applied to the document.");
      return "refused";
    }
    return "applied";
  };

  // A value that cannot be typed into is shown, not edited — and HTML's `for`
  // only associates a label with a LABELABLE element (input, select, textarea,
  // button, output, meter, progress). Pointing it at the paragraph those
  // branches render drops the association silently, so the label carries an id
  // of its own and the value points back at it instead.
  //
  // `control.supported` is NOT a term here: the branch below returns before
  // this is read, so including it would be a condition that can never be true
  // where it is used.
  const readOnly =
    clearOnly ||
    isTokenRef(stored) ||
    editableText(control, stored) === undefined;
  const labelId = `${id}-label`;

  if (!control.supported) {
    return (
      <div className="nx-inspector__field" data-unsupported={control.leaf.kind}>
        {/*
          The label carries no `htmlFor`, for the reason stated above: this
          branch renders no labelable element.

          UNTESTED as a CATALOG case, and stated rather than left to be assumed:
          every leaf kind the engine ships resolves to a control, so a catalog
          written by a newer engine is the only thing that reaches this — and
          the catalog is compiled in rather than registered, so no fixture can
          hand this panel an unknown kind. What IS reachable and IS covered is
          the value: a node can store one at such a leaf, and it compiles.
        */}
        <Label id={labelId} title={summary}>
          {label}
        </Label>
        <RetainedValue
          labelledBy={labelId}
          label={actionName}
          stored={stored}
          note={`This build has no control for ${control.leaf.kind} values.`}
          onClear={() => commit(null)}
        />
      </div>
    );
  }

  return (
    <div className="nx-inspector__field" data-control={control.kind}>
      <Label id={labelId} htmlFor={readOnly ? undefined : id} title={summary}>
        {label}
      </Label>
      <ControlValue
        id={id}
        labelledBy={labelId}
        control={control}
        stored={stored}
        actionName={actionName}
        clearOnly={clearOnly}
        describedBy={issue === null ? undefined : errorId}
        onCommit={commit}
      />
      {issue === null ? null : (
        <p className="nx-inspector__error" id={errorId} role="alert">
          {issue}
        </p>
      )}
    </div>
  );
}

/**
 * The surface one value is shown through: read-only, a token, or editable.
 *
 * Its own component rather than a chain of conditionals inside the field,
 * because the three are genuinely different surfaces — one of them cannot be
 * typed into at all — and reading them as early returns says that, where a
 * nested ternary reads as one control with two exceptions.
 */
function ControlValue({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  clearOnly,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  actionName: string;
  clearOnly: boolean;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  if (clearOnly) {
    return (
      <RetainedValue
        labelledBy={labelledBy}
        label={actionName}
        stored={stored}
        onClear={() => onCommit(null)}
      />
    );
  }
  if (isTokenRef(stored)) {
    return (
      <TokenValue
        labelledBy={labelledBy}
        label={actionName}
        name={stored.$token}
        onClear={() => onCommit(null)}
      />
    );
  }
  // A value the editing surface below cannot represent. Drawing it anyway is
  // the worst of the three outcomes: the control reads as unset, the value goes
  // on compiling, and the keystroke that would clear it is the one the field
  // refuses. Shown and removable instead, which is what the other two branches
  // already do for the other two kinds of unteachable value.
  if (editableText(control, stored) === undefined) {
    return (
      <RetainedValue
        labelledBy={labelledBy}
        label={actionName}
        stored={stored}
        note="No control here can edit this value. It is still on the page and can be cleared."
        onClear={() => onCommit(null)}
      />
    );
  }
  return (
    <ValueField
      id={id}
      control={control}
      stored={stored}
      actionName={actionName}
      describedBy={describedBy}
      onCommit={onCommit}
    />
  );
}

/**
 * A stored design-token reference, which is a value no text field can edit.
 *
 * Shown by name with a way to remove it rather than as editable text: `{$token}`
 * is one value spelled as an object, and typing over it would store the token's
 * NAME as a literal — a value that looks right in the field and compiles to
 * nothing. Choosing a token is the token picker's job and it does not exist
 * yet, so what is offered here is the honest half: see it, or clear it.
 */
function TokenValue({
  labelledBy,
  label,
  name,
  onClear,
}: {
  /** The id of the label element that names this value. */
  labelledBy: string;
  label: string;
  name: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    // Named by the property's own label, and given a role that can CARRY a
    // name: a bare paragraph maps to the ARIA `paragraph` role, which prohibits
    // one, so `aria-labelledby` on it may be dropped outright. The button is
    // named for the PROPERTY as well, because a panel with several
    // token-valued properties otherwise offers a column of buttons all called
    // "Clear" and a screen-reader user cannot tell which style each removes.
    <p
      className="nx-style-inspector__token"
      role="group"
      aria-labelledby={labelledBy}
      tabIndex={-1}
    >
      <span>{name}</span>
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`}>
        Clear
      </button>
    </p>
  );
}

/**
 * A value that is live on the page and cannot be edited here: shown, and
 * removable.
 *
 * Three different reasons reach this one surface — the block's `supports` no
 * longer declares the property, no control in this build can draw the leaf's
 * kind, or the stored value has a shape the control cannot represent — and they
 * share it because the author's position is identical in all three: the styling
 * is on the page, nothing here can change it, and the panel owes them the
 * action that removes it. `note` is what tells them WHICH of the three, since
 * only the first has a notice of its own beside the property.
 *
 * Named for the property for the same reason the token control is — several of
 * these on one panel would otherwise be a column of identical "Clear" buttons.
 */
function RetainedValue({
  labelledBy,
  label,
  stored,
  note,
  onClear,
}: {
  /** The id of the label element that names this value. */
  labelledBy: string;
  label: string;
  stored: StyleValue | undefined;
  /** Why this value cannot be edited, where the property does not already say. */
  note?: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <>
      {/*
        `group` for the reason {@link TokenValue} carries one: the ARIA
        `paragraph` role a bare paragraph maps to prohibits an accessible name.
      */}
      <p
        className="nx-style-inspector__token"
        role="group"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {/*
          `displayText` rather than the text-field projection, which answers
          `""` for a shape it cannot type — and an empty span beside a Clear
          button asks an author to remove something they cannot see.
        */}
        <span>{displayText(stored)}</span>
        <button type="button" onClick={onClear} aria-label={`Clear ${label}`}>
          Clear
        </button>
      </p>
      {note === undefined ? null : <p className="nx-inspector__note">{note}</p>}
    </>
  );
}

/**
 * The control a leaf's kind resolves to.
 *
 * A keyword leaf carries a closed vocabulary and gets a select over it. Every
 * other kind is drawn as a text field in this build: `length`, `number`,
 * `color`, `css` and `url` all store a scalar the catalog judges, and the
 * affordances that tell them apart — a unit stepper, a colour surface, a token
 * picker — are the control set's, not this panel's. Drawing a text field for
 * them is what makes each editable now, rather than presenting an incomplete
 * property as a complete one.
 */
function ValueField({
  id,
  control,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /** What this control's clear action removes, named for the property. */
  actionName: string;
  /**
   * The id of the message explaining why this control's last value was refused,
   * or `undefined` when nothing was. Also what marks the control invalid: the
   * two travel together because a control described by an error message and not
   * marked invalid reads as one carrying a hint.
   */
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  if (control.kind === "select" && control.leaf.kind === "keyword") {
    const current = typeof stored === "string" ? stored : "";
    // The validator accepts a keyword case-insensitively, with surrounding CSS
    // whitespace and escapes, and accepts the CSS-wide keywords everywhere — so
    // a stored `Bold` or `inherit` is live and compiles while matching no item
    // here, and the select would render empty over a value that is doing
    // something. Offered VERBATIM as its own item rather than normalised: any
    // rule written here to fold spellings would be a second copy of the
    // engine's, and the stored string is the one thing that needs no rule.
    const extra =
      current !== "" && !control.leaf.values.includes(current) ? current : null;
    return (
      <div className="nx-style-inspector__select">
        <Select value={current} onValueChange={value => onCommit(value)}>
          <SelectTrigger
            id={id}
            aria-describedby={describedBy}
            aria-invalid={describedBy === undefined ? undefined : true}
          >
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            {extra === null ? null : (
              <SelectItem value={extra}>{extra}</SelectItem>
            )}
            {control.leaf.values.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/*
          A select cannot offer "unset" as an item: an empty value is not a
          choice the list can carry, and a sentinel standing for it would mean
          two things at once. A button beside it clears, which is the same act
          an emptied text field performs.
        */}
        {current === "" ? null : (
          <button
            type="button"
            onClick={() => onCommit(null)}
            aria-label={`Clear ${actionName}`}
          >
            Clear
          </button>
        )}
      </div>
    );
  }
  return (
    <TextField
      id={id}
      control={control}
      stored={stored}
      describedBy={describedBy}
      onCommit={onCommit}
    />
  );
}

/**
 * A text field over one stored value.
 *
 * The draft is local so a half-typed value — `16` on the way to `16px` — is not
 * sent to the validator on every keystroke and refused four times while the
 * author is still typing.
 */
function TextField({
  id,
  control,
  stored,
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /** The id of the message explaining a refusal, and what marks this invalid. */
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(() => storedText(stored));

  // The stored value wins whenever it changes underneath the field — an undo, a
  // scrub, an edit applied from somewhere else. Without this the input would go
  // on showing a value the document no longer has.
  React.useEffect(() => {
    setDraft(storedText(stored));
  }, [stored]);

  const commit = () => {
    if (draft === storedText(stored)) return;
    // CSS whitespace here too, not JavaScript's. `String.prototype.trim` also
    // strips NBSP and the Unicode spaces, so a draft of nothing but a
    // non-breaking space would read as empty and DELETE the declaration —
    // where the engine treats it as a value and refuses it.
    const emptied = trimCssWhitespace(draft) === "";
    const outcome = onCommit(
      emptied ? null : committedValue(control.kind, draft)
    );
    // The document did not move because it already holds this value in another
    // spelling: `01`, `+1` and `1e0` all commit as the `1` that is stored. The
    // effect above cannot cover it — `stored` is identical, so it does not fire
    // — and without this the field goes on showing text the document does not
    // contain until something remounts it. A REFUSAL deliberately keeps the
    // draft: the author has to be able to correct what they typed.
    if (outcome === "unchanged") setDraft(storedText(stored));
  };

  return (
    <Input
      id={id}
      value={draft}
      placeholder={placeholderFor(control)}
      aria-describedby={describedBy}
      aria-invalid={describedBy === undefined ? undefined : true}
      // Committed on blur and on Enter, matching the content tab: an op per
      // keystroke would make one undo remove one character.
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/**
 * Which section is open, given what the author has said.
 *
 * Three states, not two: not yet chosen falls back to the first section so the
 * panel never opens onto a column of headings; the empty string is an explicit
 * collapse and is honoured; and a section the newly selected block does not
 * offer falls back, because an accordion asked to open one it does not have
 * shows nothing open at all.
 */
function openSection(
  chosen: string | null,
  available: ReadonlySet<string>,
  first: string
): string {
  if (chosen === null) return first;
  if (chosen === "") return "";
  return available.has(chosen) ? chosen : first;
}

/**
 * The grammar CSS calls a `<number>`: an optional sign, digits with an optional
 * decimal part, and an optional exponent.
 *
 * Deliberately narrower than `Number` in both directions. `Number` reads
 * spellings CSS does not (`0x10`, `0b10`, `0o10`), and it also accepts a
 * trailing point: CSS requires at least one digit AFTER a decimal point, so
 * `1.` is a number followed by a stray delimiter rather than a number, and
 * `Number("1.")` quietly answering `1` would store a value the author never
 * wrote a valid spelling of.
 */
const CSS_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A stored value as a text field shows it. */
function storedText(value: StyleValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** How much of an unrepresentable value is worth showing before it stops helping. */
const DISPLAY_LIMIT = 80;

/**
 * A stored value as a READ-ONLY surface shows it, including one no field can
 * edit.
 *
 * Separate from {@link storedText}, which answers what a text field's draft
 * starts as and is right to give `""` for a shape it cannot type. Here `""`
 * would be a lie: the surface exists precisely because something IS stored, and
 * a blank one beside a Clear button tells an author to remove they-cannot-see-
 * what.
 */
function displayText(value: StyleValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isTokenRef(value)) return value.$token;
  // Its own JSON, because there is nothing else honest to show: the value is
  // live on the page and the author is being asked whether to remove it.
  // Truncated because a panel column is not a document viewer, and a value long
  // enough to need this is already one nothing here can repair.
  const json = jsonText(value);
  return json.length > DISPLAY_LIMIT
    ? `${json.slice(0, DISPLAY_LIMIT)}…`
    : json;
}

/**
 * A value's JSON, or a stand-in when it has none.
 *
 * `JSON.stringify` THROWS on a circular reference rather than declining to
 * answer, and a panel that throws while rendering leaves the author with no
 * Clear button at all — which is the exact failure this surface exists to
 * prevent, arrived at from the other direction. Nothing in the document
 * pipeline can produce one today, since a stored document is parsed from JSON;
 * the guard is here because it costs one branch on a path that already decided
 * the value is unrepresentable.
 *
 * The fallback makes no claim about the value beyond being unable to show it,
 * which is what keeps it honest: the Clear beside it still works.
 */
function jsonText(value: StyleValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "(value cannot be shown)";
  }
}

/**
 * A stored value as this control's EDITING surface shows it, or `undefined`
 * when that surface cannot show it at all.
 *
 * Two shapes reach this. An object at a scalar position — `fontSize: {value:
 * "12px"}` from an import or the API — has no text spelling, and a text field
 * given `""` for it reads as UNSET while the value compiles; worse, the one
 * keystroke that would clear it is refused, because an emptied draft already
 * equals that empty projection. And a number stored where the leaf's vocabulary
 * is keywords has no item to be current, so the select renders its "Not set"
 * placeholder over a value that is doing something.
 *
 * Both are the same question — can the author see and change this here — so
 * they get one answer rather than a check in each control.
 */
function editableText(
  control: StyleControl,
  value: StyleValue | undefined
): string | undefined {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "number") return undefined;
  return control.kind === "select" ? undefined : String(value);
}

/**
 * What a typed string is stored as.
 *
 * A `number` leaf takes a NUMBER, and accepts a string only as one of the
 * CSS-wide keywords — measured: `opacity: "0.5"` is refused where `opacity: 0.5`
 * is accepted. So a numeric-looking draft is converted and anything else is
 * passed through, which is what lets `inherit` reach a numeric property and
 * lets every other refusal carry the catalog's own message.
 *
 * Every other kind stores its value as written: a `dimension` accepts the
 * string `"0"` as readily as the number, so converting there would change what
 * is stored without changing what is valid.
 */
function committedValue(
  kind: StyleControlKind | undefined,
  draft: string
): StyleValue {
  if (kind !== "number") return draft;
  // The engine's own trim, not `String.prototype.trim`, which also strips NBSP
  // and the Unicode spaces where CSS strips neither. Trimming wider than CSS
  // does turns a spelling the engine REFUSES into a number it accepts: pasting
  // a non-breaking space before a digit would silently store the digit.
  const trimmed = trimCssWhitespace(draft);
  // `Number` reads spellings CSS does not: `0x10` becomes 16, `0b10` becomes 2,
  // `0o10` becomes 8. Converting those would store a number the author never
  // typed and pass validation, so only the grammar CSS calls a <number> is
  // converted and everything else is left for the catalog to judge.
  if (!CSS_NUMBER.test(trimmed)) return draft;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : draft;
}

/**
 * The hint for a kind whose form does not vary with the leaf's own fields.
 *
 * Partial on purpose, and the one place in this lane where a fallthrough is the
 * right answer: a placeholder is advisory text, so a leaf kind this build has
 * not learned about gets a generic hint rather than a compile error. Whether
 * the kind can be DRAWN at all is a different question, and `style-controls.ts`
 * already answers it with a mapped type that does fail to compile.
 */
const FIXED_PLACEHOLDER: Partial<Record<StyleLeaf["kind"], string>> = {
  keyword: "Not set",
  cssValue: "Not set",
  // The FORM rather than an example, as the length and number hints are. A
  // literal here would also be a hardcoded colour, which this repository bans
  // outright — the rule reads source, not intent, and it is right to: a hex in
  // a placeholder is one copy away from a hex in a style.
  color: "hex, rgb(), or a colour name",
  url: "https://…",
};

/** A length's hint, which depends on what the catalog lets this one hold. */
function dimensionHint(
  leaf: Extract<StyleLeaf, { kind: "dimension" }>
): string {
  const units = leaf.allowPercentage === true ? "16px or 50%" : "16px";
  // The catalog's helper always writes this field, and the TYPE leaves it
  // optional — so a leaf assembled by hand, which every fixture in this package
  // is, legitimately arrives without one.
  const keywords = leaf.keywords ?? [];
  return keywords.length > 0 ? `${units}, or ${keywords.join(", ")}` : units;
}

/** A number's hint, which names its bounds when the catalog gives it both. */
function numberHint(leaf: Extract<StyleLeaf, { kind: "number" }>): string {
  if (leaf.min === undefined || leaf.max === undefined) return "a number";
  return `${leaf.min} to ${leaf.max}`;
}

/** A hint at the form this leaf takes, from the catalog rather than a list here. */
function placeholderFor(control: StyleControl): string {
  const { leaf } = control;
  if (leaf.kind === "dimension") return dimensionHint(leaf);
  if (leaf.kind === "number") return numberHint(leaf);
  return FIXED_PLACEHOLDER[leaf.kind] ?? "Not set";
}
