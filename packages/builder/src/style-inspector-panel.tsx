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
   * Per-property batch editing is Plan 05's batch edit and is deliberately not
   * here.
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
      */}
      {property.variants
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
      {property.controls.map(control => (
        <StyleControlField
          key={[property.property, ...control.path].join(".")}
          control={control}
          label={
            many
              ? fieldLabel(control.path[control.path.length - 1] ?? "")
              : property.label
          }
          summary={many ? undefined : property.summary}
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
    if (!property.set) return;
    const current = findNode(editor.document.nodes, nodeId);
    if (current === undefined) return;
    const cleared = styleClearOp(
      nodeId,
      current.styles,
      { state, breakpoint, property: property.property, path: [] },
      policy
    );
    if (cleared.ok && cleared.op !== null) editor.apply(cleared.op);
  };

  return (
    <div className="nx-inspector__field" data-form-choice={property.property}>
      <Label htmlFor={id}>
        {variant.path.length === 0
          ? "Form"
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

/** One editable position, drawn as the control its leaf kind resolves to. */
function StyleControlField({
  control,
  label,
  summary,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
}: {
  control: StyleControl;
  label: string;
  summary: string | undefined;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
}): React.JSX.Element {
  const id = React.useId();
  const address: StyleAddress = {
    state,
    breakpoint,
    property: control.property,
    path: control.path,
  };
  const node = findNode(editor.document.nodes, nodeId);
  const stored = readStyleValue(node?.styles, address);
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
  const commit = (value: StyleValue | null) => {
    const current = findNode(editor.document.nodes, nodeId);
    if (current === undefined) return;
    const write =
      value === null
        ? styleClearOp(nodeId, current.styles, address, policy)
        : styleWriteOp(nodeId, current.styles, address, value, policy);
    if (!write.ok) {
      setIssue(write.issues[0]?.message ?? "This value cannot be used here.");
      return;
    }
    setIssue(null);
    // Null is the store saying the document already holds this value, which is
    // the ordinary case for a field blurred without being changed. Applying it
    // would ask the op store for a history entry that undoes to no visible
    // effect, which it refuses.
    if (write.op === null) return;
    // The store's own refusal, which the validator cannot anticipate: it judges
    // the edited leaf, while `applyOp` judges the whole document — a page at
    // its byte limit rejects an edit whose value is perfectly valid. Unreported,
    // the field goes on showing the draft and reads as saved while neither the
    // document nor the undo history moved.
    if (editor.apply(write.op) === null) {
      setIssue("This edit could not be applied to the document.");
    }
  };

  if (!control.supported) {
    return (
      <div className="nx-inspector__field" data-unsupported={control.leaf.kind}>
        {/*
          Plain text, not a `<label>`. This branch renders no control, so a
          label would carry `htmlFor` to an id nothing has — which a screen
          reader announces as a field that cannot be reached, worse than the
          note below saying plainly that there is nothing to reach.

          UNTESTED, and stated rather than left to be assumed: every leaf kind
          the engine ships resolves to a control, so nothing reaches this branch
          today. It exists for a catalog written by a NEWER engine, and the
          catalog is compiled in rather than registered, so no fixture can hand
          this panel an unknown kind.
        */}
        <p className="nx-style-inspector__property-label">{label}</p>
        <p className="nx-inspector__note">
          This build has no control for {control.leaf.kind} values.
        </p>
      </div>
    );
  }

  return (
    <div className="nx-inspector__field" data-control={control.kind}>
      <Label htmlFor={id} title={summary}>
        {label}
      </Label>
      {isTokenRef(stored) ? (
        <TokenValue name={stored.$token} onClear={() => commit(null)} />
      ) : (
        <ValueField
          id={id}
          control={control}
          stored={stored}
          onCommit={commit}
        />
      )}
      {issue === null ? null : (
        <p className="nx-inspector__error" role="alert">
          {issue}
        </p>
      )}
    </div>
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
  name,
  onClear,
}: {
  name: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <p className="nx-style-inspector__token">
      <span>{name}</span>
      <button type="button" onClick={onClear}>
        Clear
      </button>
    </p>
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
  onCommit,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  onCommit: (value: StyleValue | null) => void;
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
          <SelectTrigger id={id}>
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
          <button type="button" onClick={() => onCommit(null)}>
            Clear
          </button>
        )}
      </div>
    );
  }
  return (
    <TextField id={id} control={control} stored={stored} onCommit={onCommit} />
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
  onCommit,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  onCommit: (value: StyleValue | null) => void;
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
    onCommit(draft.trim() === "" ? null : committedValue(control.kind, draft));
  };

  return (
    <Input
      id={id}
      value={draft}
      placeholder={placeholderFor(control)}
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
 * decimal part, and an optional exponent. Deliberately narrower than
 * `Number` — see {@link committedValue}.
 */
const CSS_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A stored value as a text field shows it. */
function storedText(value: StyleValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
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
  const trimmed = draft.trim();
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
