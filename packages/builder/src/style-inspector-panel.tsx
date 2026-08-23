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
  type ContrastResult,
  type NodeStyles,
  type SiteTokenSet,
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
  ColorPicker,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import { fieldLabel } from "./inspector";
import {
  activeTokenMode,
  colourHexOf,
  colourShowable,
  colourTokenFor,
  colourTokensFor,
  contrastAtLeaf,
  contrastPartnerOf,
  contrastRatioText,
  type ColourToken,
} from "./style-colour";
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
  CSS_NUMBER,
  measurementOfText,
  steppedValue,
  toggleOptionsFor,
  toggleShows,
  unitChoicesFor,
  withUnit,
} from "./style-numeric";
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
  /**
   * The site's design tokens, so a colour control can offer them and resolve
   * one it is shown.
   *
   * Separate from `policy.tokens`, which cannot serve this: a `TokenLookup` is
   * `{ kindOf(name) }` and answers ABOUT a name the caller already has. It can
   * confirm a reference and cannot enumerate one, so a picker sourced from it
   * would have nothing to list.
   *
   * Carried rather than defaulted, exactly as `policy` is: omitting it does not
   * mean the site has no tokens, it means the question was never asked. A
   * control with no table offers no token picker and shows a stored reference
   * by the identity the document holds, because that is the only name it has.
   */
  tokens?: SiteTokenSet;
}

export function StyleInspectorPanel({
  editor,
  policy,
  tokens,
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
  const prefersDark = usePrefersDark();

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
            tokens={tokens}
            prefersDark={prefersDark}
            onChooseForm={chooseForm}
          />
        ))}
      </Accordion>
    </div>
  );
}

/**
 * Whether the viewer's system asks for a dark colour scheme.
 *
 * Read because a site on the `media` dark-mode strategy has its dark token
 * block wrapped in `@media (prefers-color-scheme:dark)`, so the canvas switches
 * with the system and nothing tells the panel. Resolving every token to its
 * light value regardless would paint swatches and report ratios for colours the
 * canvas is not showing.
 *
 * Starts `false` and subscribes after mount, so a server render and the first
 * client render agree — React discards a subtree whose two renders disagree,
 * which would take the whole Style tab with it. A viewer already in dark mode
 * sees one frame of light-mode swatches; the alternative is a hydration
 * mismatch, which is worse and harder to see.
 */
function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = React.useState(false);
  React.useEffect(() => {
    // Detected by CALLABILITY, not by presence. `"matchMedia" in window` is
    // true under jsdom while the value is not a function, so the property test
    // passes and the call throws — measured, and it took 85 tests down. A
    // capability check has to ask the question the caller will ask.
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(query.matches);
    const listen = (event: MediaQueryListEvent): void =>
      setPrefersDark(event.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);
  return prefersDark;
}

/** One catalog group, as a section that opens onto its properties. */
function StyleSectionItem({
  section,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  tokens,
  prefersDark,
  onChooseForm,
}: {
  section: StyleSection;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
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
              tokens={tokens}
              prefersDark={prefersDark}
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
  tokens,
  prefersDark,
  onChooseForm,
}: {
  property: InspectedStyleProperty;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
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
          tokens={tokens}
          prefersDark={prefersDark}
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
  tokens,
  prefersDark,
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
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
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
  // Read ONCE and shared by both lookups below, so the control's own value and
  // its contrast partner cannot come from two different reads of the document.
  const styles = findNode(editor.document.nodes, nodeId)?.styles;
  const stored = readStyleValue(styles, address);
  const pairedColour = partnerColour(control.leaf, styles, address);
  const actionName = actionNameFor(propertyLabel, label);
  const [issue, setIssue] = React.useState<string | null>(null);

  // A refusal describes the draft that produced it, so it stops describing
  // anything the moment the document holds a different value here. Clearing on
  // the stored value rather than only on the next commit is what covers an undo
  // or an edit applied from elsewhere: the remount key changes with the
  // SELECTION, and neither of those changes the selection.
  React.useEffect(() => {
    setIssue(null);
  }, [stored]);

  const commit = (value: StyleValue | null): CommitOutcome =>
    writeStyleValue({ editor, nodeId, address, policy, value, setIssue });

  const readOnly = showsNoField(control, stored, clearOnly);
  const labelId = `${id}-label`;
  // Computed once and used by both the control and its message: two spellings
  // of "is there an error" is the shape that drifts into a control described by
  // a message it is not marked invalid for.
  const describedBy = issue === null ? undefined : errorId;

  if (!control.supported) {
    return (
      <UnsupportedField
        labelId={labelId}
        label={label}
        summary={summary}
        actionName={actionName}
        leafKind={control.leaf.kind}
        stored={stored}
        onClear={() => commit(null)}
      />
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
        tokens={tokens}
        prefersDark={prefersDark}
        pairedColour={pairedColour}
        describedBy={describedBy}
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
  tokens,
  prefersDark,
  pairedColour,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  actionName: string;
  clearOnly: boolean;
  tokens: SiteTokenSet | undefined;
  /** Whether the viewer's system asks for dark, for a site on the media strategy. */
  prefersDark: boolean;
  /** The other half of this control's contrast pair, when its leaf has one. */
  pairedColour: StyleValue | undefined;
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
  /*
   * A colour draws its own surface, INCLUDING for a stored token reference.
   *
   * Placed before the token branch below rather than after it, because that one
   * returns for every reference and a colour control would never see one. It
   * exists for controls that cannot offer a token picker, and says so: choosing
   * a token was "the token picker's job and it does not exist yet". For a
   * colour it now does, so a reference here is editable rather than read-only.
   *
   * Narrowed on the LEAF rather than on `control.kind`, because the leaf is what
   * carries `tokenKinds` and `cssProperty` — the two facts the colour surface
   * asks the catalog for — so passing it narrowed means neither is re-derived.
   *
   * Guarded by {@link colourShowable}, so a value NO colour control can
   * represent — an object at a scalar position from an import or the API — does
   * not take this branch and skip the read-only surface below. Without it the
   * field projects that object to an empty draft and reads as unset while the
   * value goes on compiling, which is the failure the surface below exists to
   * prevent.
   */
  if (control.leaf.kind === "color" && colourShowable(stored)) {
    return (
      <ColourField
        id={id}
        labelledBy={labelledBy}
        control={{ ...control, leaf: control.leaf }}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
        prefersDark={prefersDark}
        pairedColour={pairedColour}
        describedBy={describedBy}
        onCommit={onCommit}
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
      labelledBy={labelledBy}
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
  const noteId = React.useId();
  return (
    <>
      {/*
        `group` for the reason {@link TokenValue} carries one: the ARIA
        `paragraph` role a bare paragraph maps to prohibits an accessible name.

        The note is pointed AT rather than left beside: it is the only thing
        saying why this value cannot be edited, and a group announced with its
        name and its Clear button but not its reason tells a screen-reader user
        that a field is read-only without ever saying what made it so.
      */}
      <p
        className="nx-style-inspector__token"
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={note === undefined ? undefined : noteId}
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
      {note === undefined ? null : (
        <p className="nx-inspector__note" id={noteId}>
          {note}
        </p>
      )}
    </>
  );
}

/**
 * A closed vocabulary of more than two keywords, as a menu.
 *
 * Its own component rather than a branch inside the router, so that deciding
 * WHICH surface a leaf gets and drawing one are separate readings: the router
 * is then short enough to see all three choices at once, which is the thing a
 * reader comes to it for.
 */
function SelectField({
  id,
  control,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl & { leaf: Extract<StyleLeaf, { kind: "keyword" }> };
  stored: StyleValue | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
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
/**
 * What this control's clear action removes, named for the author.
 *
 * The property alone where a property draws one control, and the property plus
 * the position where it draws several: `padding` and `margin` both have a block
 * start, so two buttons called "Clear block start" name the same thing twice
 * and a screen-reader user cannot tell which style each removes.
 */
function actionNameFor(propertyLabel: string, label: string): string {
  return propertyLabel === label
    ? propertyLabel
    : `${propertyLabel} ${label.toLowerCase()}`;
}

/**
 * Whether this position renders no element a label can be attached to.
 *
 * HTML's `for` only associates a label with a LABELABLE element — input,
 * select, textarea, button, output, meter, progress. Pointing it at the
 * paragraph the read-only surfaces render drops the association SILENTLY, so
 * the label carries an id of its own and the value points back at it instead.
 *
 * `control.supported` is not a term here: the caller returns before this is
 * read, so including it would be a condition that can never be true where it
 * is used.
 */
function showsNoField(
  control: StyleControl,
  stored: StyleValue | undefined,
  clearOnly: boolean
): boolean {
  if (clearOnly) return true;
  // Every reference, whatever the control. The colour surface reaches this the
  // same way the others do: it draws a name and a button for a reference and a
  // text field only for a literal, so a reference has no field there either.
  if (isTokenRef(stored)) return true;
  return editableText(control, stored) === undefined;
}

/**
 * A position this build has no control for: shown by value, and removable.
 *
 * Its own component because it is a different SURFACE rather than a variation
 * of one — nothing here is editable, so no labelable element exists and the
 * label has to name the value by id instead of pointing at a field.
 *
 * UNTESTED as a CATALOG case, and stated rather than left to be assumed: every
 * leaf kind the engine ships resolves to a control, so only a catalog written
 * by a newer engine reaches this — and the catalog is compiled in rather than
 * registered, so no fixture can hand this panel an unknown kind. What IS
 * reachable and IS covered is the value: a node can store one at such a leaf,
 * and it compiles.
 */
function UnsupportedField({
  labelId,
  label,
  summary,
  actionName,
  leafKind,
  stored,
  onClear,
}: {
  labelId: string;
  label: string;
  summary: string | undefined;
  actionName: string;
  leafKind: StyleLeaf["kind"];
  stored: StyleValue | undefined;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__field" data-unsupported={leafKind}>
      {/* No `htmlFor`: this branch renders no labelable element. */}
      <Label id={labelId} title={summary}>
        {label}
      </Label>
      <RetainedValue
        labelledBy={labelId}
        label={actionName}
        stored={stored}
        note={`This build has no control for ${leafKind} values.`}
        onClear={onClear}
      />
    </div>
  );
}

/**
 * Apply one control's edit to the document, and say what happened to it.
 *
 * Lifted out of the field because it is a different question from drawing one:
 * the field owns what the author is looking at, and this owns the write — which
 * of two ops to build, which refusals are reportable, and which of the three
 * outcomes each produces.
 *
 * Read the node at COMMIT TIME rather than closing over one. A field committing
 * on blur can fire after another edit has already replaced the node, and
 * writing from the older copy would resurrect its styles.
 */
function writeStyleValue({
  editor,
  nodeId,
  address,
  policy,
  value,
  setIssue,
}: {
  editor: EditorState;
  nodeId: string;
  address: StyleAddress;
  policy: StylePolicy | undefined;
  /** `null` clears, which is not the same as writing an empty value. */
  value: StyleValue | null;
  setIssue: (message: string | null) => void;
}): CommitOutcome {
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
  // the edited leaf, while `applyOp` judges the whole document — a page at its
  // byte limit rejects an edit whose value is perfectly valid. Unreported, the
  // field goes on showing the draft and reads as saved while neither the
  // document nor the undo history moved.
  if (editor.apply(write.op) === null) {
    setIssue("This edit could not be applied to the document.");
    return "refused";
  }
  return "applied";
}

/**
 * The other half of a contrast pair, for a leaf that has one.
 *
 * Read from THIS node at the same state and breakpoint the control edits,
 * which is narrower than the cascade and is the honest limit of what this panel
 * can answer today: a background arriving from a named class, a block default
 * or a wider breakpoint is not seen, so the readout reports nothing rather than
 * measuring against a background that is not the one on the page.
 *
 * Answering it properly means asking `styleProvenance`, which has already
 * settled tier order, both breakpoint axes, states and specificity — and which
 * needs a `trace` of compiled declarations that nothing supplies to this panel.
 * Walking the cascade a second time HERE is the thing that must not happen.
 *
 * The address is reused rather than rebuilt so the state and breakpoint cannot
 * drift from the ones the control is reading its own value at — a pair measured
 * across two breakpoints is two colours that are never drawn together.
 */
function partnerColour(
  leaf: StyleLeaf,
  styles: NodeStyles | undefined,
  address: StyleAddress
): StyleValue | undefined {
  const property = contrastPartnerOf(leaf);
  if (property === undefined) return undefined;
  return readStyleValue(styles, { ...address, property, path: [] });
}

/**
 * The hex a picker opens on when the stored value cannot be decomposed.
 *
 * Black, and it is never WRITTEN by being shown: the picker reports a colour
 * only when the author moves something. So this is where the surface starts for
 * a value it cannot represent, not a value substituted for one.
 */
const PICKER_FALLBACK = "#000000";

/**
 * A colour: a swatch that opens a picker, beside the field that owns the value.
 *
 * **The text field remains the control**, exactly as it does for a length. A
 * stored colour may be `oklch()`, `color-mix()`, a named colour, `currentcolor`,
 * a CSS-wide keyword or a `var()`, and a control that modelled the value as
 * RGBA would write every one of them away the moment it opened. The picker is
 * an affordance on top, and it reports nothing until the author moves it.
 *
 * **A token reference is EDITABLE here rather than read-only**, which is the
 * other half of what this control adds. `TokenValue` shows a reference and
 * offers only Clear because choosing a token had nowhere to happen; a colour
 * control has the site's table, so it shows the token's CURRENT name and lets
 * the author swap it, replace it with a literal, or remove it.
 *
 * **A token is stored by IDENTITY, never by the name shown.** The two differ
 * after a rename, and `ColourToken` carries both for that reason — the picker
 * hands back the swatch it was given, so the identity travels with it and the
 * label never reaches the document.
 *
 * **Literal and token are exclusive**, which is what the two layouts express.
 * The same rule Gutenberg's palette follows: a value is a reference or a
 * colour, and nothing sensible reads as both at once.
 */
function ColourField({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  tokens,
  prefersDark,
  pairedColour,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: StyleControl & { leaf: Extract<StyleLeaf, { kind: "color" }> };
  stored: StyleValue | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  pairedColour: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const noteId = React.useId();
  // The draft lives here for the reason it does in `NumericField`: two controls
  // edit one value, so a draft private to the text field would leave the swatch
  // painting a superseded one.
  const [draft, setDraft] = React.useState(() => storedText(stored));
  React.useEffect(() => {
    setDraft(storedText(stored));
  }, [stored]);

  const reference = isTokenRef(stored) ? stored.$token : null;
  const mode = activeTokenMode(tokens, prefersDark);
  const choices = colourTokensFor(control.leaf, tokens, mode);
  // What the picker composed, written once the gesture is over. Compared
  // against the stored text so closing a picker nobody moved writes nothing.
  const commitDraft = (): void => {
    if (draft === storedText(stored)) return;
    if (onCommit(draft) === "unchanged") setDraft(storedText(stored));
  };
  // What the surface is currently SHOWING: the draft while a literal is being
  // typed, so the swatch follows the field, and the stored value for a
  // reference, which no field is editing. Named once and resolved once, rather
  // than resolved in each branch — two calls to the same resolver is the shape
  // that drifts.
  const showing = reference === null ? draft : stored;
  const shown = colourHexOf(showing, tokens, mode);
  // Measured from what the surface is SHOWING, which is the same value the
  // swatch is painted from. Reading `stored` instead left the verdict describing
  // the old colour for the whole of a picker gesture — stale exactly while an
  // author is choosing, which is when a contrast readout is for — and put the
  // swatch and the figure beside it on two different colours.
  const contrast = contrastAtLeaf(
    control.leaf,
    showing,
    pairedColour,
    tokens,
    mode
  );
  // Both descriptions, not one. A control pointed only at the refusal message
  // never announces the contrast verdict, and one pointed only at the verdict
  // drops the reason its last value was refused — so a screen-reader user gets
  // whichever happens to be listed and no way to reach the other.
  const describes =
    [describedBy, contrast === undefined ? undefined : noteId]
      .filter(part => part !== undefined)
      .join(" ") || undefined;

  return (
    <>
      <div
        className="nx-style-inspector__colour"
        // Named as a GROUP only where there is no field to carry the name: with
        // a text input present the label points at it directly, and a group
        // wrapping a named control announces the property twice.
        {...(reference === null
          ? {}
          : { role: "group", "aria-labelledby": labelledBy })}
      >
        <ColourPicker
          shown={shown}
          choices={choices}
          actionName={actionName}
          describedBy={describes}
          invalid={describedBy !== undefined}
          // A warning wherever there is something to LOSE, which is a stored
          // reference or non-empty text. Tested on the draft alone this missed
          // every reference — `storedText` answers `""` for one — so opening
          // the picker on a token the site no longer defines, or one holding
          // `var(...)`, started its controls at black and the first movement
          // replaced the reference with a near-black literal, unwarned.
          unrepresented={
            shown === undefined && (reference !== null || draft !== "")
          }
          // The draft moves with the pointer and the DOCUMENT does not. A drag
          // across the saturation surface fires `onColorChange` on every
          // pointer event, and committing each one writes an editor op each
          // time: one gesture becomes dozens of undo entries, and `MAX_HISTORY`
          // is 100, so a single drag can evict unrelated earlier edits and
          // leave undo walking intermediate colours instead of reverting the
          // gesture. This is the rule the text fields already follow — an op
          // per keystroke would make one undo remove one character.
          onColour={setDraft}
          // Committed when the picker CLOSES, which is where the gesture ends.
          onClosed={commitDraft}
          // A preset is one discrete choice rather than a gesture, so it
          // commits immediately, exactly as the select and toggle controls do.
          onToken={identity => onCommit({ $token: identity })}
        />
        {reference === null ? (
          // The SAME field every other text control uses, rather than one
          // written here. Commit on blur, Enter, the empty draft that clears
          // instead of storing `""`, and the `unchanged` case that puts back
          // what the document holds are one contract — and a second copy of it
          // beside the first is what drifts, silently, in the direction of
          // losing an edit.
          <TextField
            id={id}
            control={control}
            stored={stored}
            draft={draft}
            setDraft={setDraft}
            describedBy={describes}
            // The REFUSAL alone. `describes` also carries the contrast verdict,
            // which is supplementary text and never a complaint.
            invalid={describedBy !== undefined}
            onCommit={onCommit}
          />
        ) : (
          <TokenName
            identity={reference}
            token={colourTokenFor(reference, tokens, mode)}
            actionName={actionName}
            onClear={() => onCommit(null)}
          />
        )}
      </div>
      <ContrastNote id={noteId} contrast={contrast} />
    </>
  );
}

/**
 * The swatch, and the surface it opens onto.
 *
 * Its own component because CHOOSING a colour is a different question from
 * showing one: the row below owns the stored value and its text, and this owns
 * the picker, the token swatches and what the trigger is painted with. Kept
 * together here because all three read the one resolved colour, and split from
 * the row because neither half needs the other's state.
 *
 * The two callbacks stay separate for the reason `ColorPicker` keeps them
 * separate: only the host knows what a swatch MEANS. A token hands back its
 * identity and never the colour it currently resolves to — storing that would
 * turn a reference into a literal and stop the page following the token.
 */
function ColourPicker({
  shown,
  choices,
  actionName,
  describedBy,
  invalid,
  unrepresented,
  onColour,
  onClosed,
  onToken,
}: {
  /** The resolved colour, or `undefined` when nothing here can resolve one. */
  shown: string | undefined;
  choices: readonly ColourToken[];
  actionName: string;
  /** Everything describing the control: a refusal, a contrast verdict, or both. */
  describedBy: string | undefined;
  /** Whether the last value was refused. A contrast verdict is not a refusal. */
  invalid: boolean;
  /** Whether the stored value is one the picker cannot show. */
  unrepresented: boolean;
  /** The picker moved. Fires on every pointer event during a drag. */
  onColour: (hex: string) => void;
  /** The picker closed, which is where a gesture ends and a write belongs. */
  onClosed: () => void;
  onToken: (identity: string) => void;
}): React.JSX.Element {
  return (
    <Popover onOpenChange={open => !open && onClosed()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nx-style-inspector__swatch"
          aria-label={`Colour for ${actionName}`}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          // Painted through a custom property rather than `background-color`
          // directly, so the chequerboard beneath a translucent colour stays
          // visible through it. `undefined` leaves the class's own "nothing
          // here" appearance rather than a colour this cannot vouch for.
          style={
            shown === undefined
              ? undefined
              : ({ "--nx-swatch": shown } as React.CSSProperties)
          }
          data-empty={shown === undefined ? "" : undefined}
        />
      </PopoverTrigger>
      <PopoverContent className="nx-style-inspector__picker">
        {unrepresented ? (
          <p className="nx-inspector__note">
            This value cannot be shown on the picker. Choosing here replaces it.
          </p>
        ) : null}
        <ColorPicker<ColourToken>
          // A fallback only where nothing could be resolved, and it is never
          // WRITTEN by being shown: the picker reports a colour only once the
          // author moves something, so opening it over a value it cannot
          // represent changes nothing.
          color={shown ?? PICKER_FALLBACK}
          showAlpha
          swatches={choices.map(choice => ({
            // The IDENTITY as the swatch id, which is what keeps the list
            // stable across a rename: a key built from the label would remount
            // every renamed token's swatch, and would collide between a renamed
            // token and a new one that took its old name.
            id: choice.identity,
            label: choice.name,
            // The RESOLVED colour, never the token's raw value. A preset button
            // paints what it is handed, so a token holding `var(--brand)`,
            // `currentcolor` or a CSS-wide keyword would resolve against the
            // inspector rather than the canvas and show a colour the page does
            // not have — the same failure the main swatch refuses. A token this
            // package cannot resolve paints nothing and stays choosable, which
            // is what keeps the reference reachable.
            color: choice.swatch ?? "transparent",
            value: choice,
          }))}
          onColorChange={onColour}
          onSwatchSelect={swatch => {
            if (swatch.value !== undefined) onToken(swatch.value.identity);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A stored token, by the name an author reads, with the way to remove it.
 *
 * The name is resolved by the caller and the fallback is the stored identity,
 * which is the honest answer for a reference to a token the site no longer
 * defines: an unknown token is a warning rather than an error, so the value
 * goes on compiling and the author is shown the string their document holds
 * rather than an empty space.
 */
function TokenName({
  identity,
  token,
  actionName,
  onClear,
}: {
  /** What the document stores, and the fallback when nothing resolves it. */
  identity: string;
  /** The site's token of that identity, when it defines one. */
  token: ColourToken | undefined;
  actionName: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <>
      <span className="nx-style-inspector__colour-token">
        {token?.name ?? identity}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${actionName}`}
      >
        Clear
      </button>
    </>
  );
}

/**
 * How a colour pair fares, or nothing at all.
 *
 * `undefined` renders NOTHING rather than a placeholder, an approximation or a
 * last-known figure. That is the engine's own reasoning carried up one level:
 * a ratio computed from a colour that was misread "is worse than no figure,
 * because it is a number somebody will act on", and there is no honest estimate
 * of the contrast against a `var()` whose value the page decides at render.
 *
 * A failing pair is a WARNING and never a refusal — the value is valid, stored
 * and compiling, and the author may have a reason. The same position
 * Gutenberg's contrast checker takes.
 */
function ContrastNote({
  id,
  contrast,
}: {
  id: string;
  contrast: ContrastResult | undefined;
}): React.JSX.Element | null {
  if (contrast === undefined) return null;
  return (
    <p
      className="nx-style-inspector__contrast"
      id={id}
      data-level={contrast.level}
    >
      {`Contrast ${contrastRatioText(contrast)} — ${
        contrast.passesBodyText
          ? `passes AA for body text (${contrast.level})`
          : "below AA for body text"
      }`}
    </p>
  );
}

/**
 * The control a leaf's kind resolves to.
 *
 * A keyword leaf carries a closed vocabulary: two values get a toggle and more
 * than two get a select over them. Every other kind is drawn as a text field
 * that accepts whatever the catalog judges — `length`, `number`, `color`, `css`
 * and `url` all store a scalar — with the numeric affordances layered on top
 * where the stored value is a single measurement.
 *
 * Layered rather than substituted, which is the decision worth keeping. A field
 * that MODELLED a length as a number and a unit could not hold `auto`,
 * `clamp(...)`, a two-part shorthand or a token, and would write each of them
 * away on the first edit. So the text field remains the control and the stepper
 * and unit menu are affordances it grows when the value is simple enough to
 * carry them; `style-numeric.ts` decides when that is, and answers `undefined`
 * rather than guessing.
 */
function ValueField({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  /** The field label's id, so a group of buttons can be named by it. */
  labelledBy: string;
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
  // Decided BEFORE the menu, because every keyword leaf resolves to the
  // `select` control kind — so a branch on that kind placed first would return
  // for all of them and the toggle could never be reached.
  const toggle = toggleOptionsFor(control.leaf);
  if (toggle !== undefined && toggleShows(toggle, stored)) {
    return (
      <ToggleField
        id={id}
        labelledBy={labelledBy}
        options={toggle}
        stored={stored}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }

  // A keyword vocabulary too wide for a toggle is a menu. Narrowed here rather
  // than inside the component so the leaf carries its own kind through.
  if (control.kind === "select" && control.leaf.kind === "keyword") {
    return (
      <SelectField
        id={id}
        control={{ ...control, leaf: control.leaf }}
        stored={stored}
        actionName={actionName}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  return (
    <NumericField
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
 * Two keywords as two buttons, with the current one pressed.
 *
 * `aria-pressed` rather than a radio group: these are two states of one
 * property rather than a choice among options that includes "neither", and the
 * clear affordance beside them is what expresses unset. Labelled by the field's
 * own label, so a screen reader reads the property name before the state.
 */
function ToggleField({
  id,
  labelledBy,
  options,
  stored,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  options: readonly [string, string];
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  return (
    <div
      // The field's id sits on the GROUP rather than on either button. The
      // field label carries `htmlFor`, and a label pointing at a button
      // forwards a click to it — so naming the first option that way would make
      // clicking the property label press it, or clear it when already pressed,
      // and write an edit the author never asked for. A `div` is not labelable,
      // so the association is inert and the group is named by `aria-labelledby`
      // instead, which is what a screen reader reads either way.
      id={id}
      className="nx-style-inspector__toggle"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {options.map(option => {
        const pressed = stored === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            // Marked on the BUTTONS rather than on the group, which carries the
            // description. `aria-invalid` is not a state `role="group"`
            // supports, so setting it there would be an attribute a screen
            // reader is entitled to ignore — and the file's own rule is that a
            // control described by a refusal must also read as invalid, or it
            // announces the message as a hint rather than as a failure.
            aria-invalid={describedBy === undefined ? undefined : true}
            // Pressing the pressed option CLEARS rather than re-writing it,
            // which is the only way a two-button group can reach unset without
            // a third button standing for "neither".
            onClick={() => onCommit(pressed ? null : option)}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The text field, plus the affordances a value that is one measurement earns.
 *
 * The input stays a TEXT field whatever the value is, which is the whole design:
 * `auto`, `clamp(...)`, a shorthand and a token all remain typeable and none is
 * rewritten. The numeric behaviour is LAYERED on — arrow keys step the quantity
 * and a menu swaps the unit — and both disengage silently when the current value
 * is not a single measurement, so nothing an author can express is taken away by
 * the field being clever about the common case.
 */
function NumericField({
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
  /**
   * This control's own name, position included.
   *
   * Taken from the caller rather than derived from the property here: a
   * composite draws one of these per side, and a name built from the property
   * alone would give all four of `padding`'s menus the same accessible name,
   * leaving a screen reader no way to tell which side one edits.
   */
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const units = unitChoicesFor(control.leaf);
  // The draft lives HERE rather than inside the text field, because two
  // controls edit one value and the unit menu was reading the other copy. An
  // author who types `20` over `12px` and then picks `rem` had the blur refuse
  // the unitless draft, leaving `12px` stored — and the menu composed from
  // THAT, committing `12rem` and discarding the 20 they were looking at.
  const [draft, setDraft] = React.useState(() => storedText(stored));
  // The stored value wins whenever it changes underneath — an undo, an edit
  // applied from elsewhere. Without this both controls go on showing a value
  // the document no longer has.
  React.useEffect(() => {
    setDraft(storedText(stored));
  }, [stored]);
  // Read from the DRAFT, so the menu offers units for the quantity on screen
  // and swaps the unit on that quantity rather than on a superseded one.
  const measurement = measurementOfText(draft);
  // The menu is shown only where it can act. Rendered against a value it cannot
  // decompose, every choice in it would be a no-op, and a disabled-looking
  // control that silently does nothing is worse than one that is not there.
  //
  // A UNITLESS draft keeps the menu rather than losing it, because typing the
  // quantity and then choosing the unit is an ordinary way to write one — and a
  // control that vanishes mid-edit is worse than one showing no selection. A
  // leaf with no units to offer never reaches this: `unitChoicesFor` answers
  // empty for anything that is not a dimension, so `line-height` as a number
  // has no menu to gain a unit from.
  const showUnits = units.length > 0 && measurement !== undefined;
  // A stored unit the candidate list does not carry — `ch`, or an uppercase
  // `PX` the validator folds — is live and compiles while matching no item, and
  // a controlled select over it renders an EMPTY trigger above a value that is
  // doing something. Offered verbatim as its own item, which is what the
  // keyword select above already does for a value outside its vocabulary.
  const extraUnit =
    measurement !== undefined &&
    measurement.unit !== "" &&
    !units.includes(measurement.unit)
      ? measurement.unit
      : null;

  return (
    <div className="nx-style-inspector__numeric">
      <TextField
        id={id}
        control={control}
        stored={stored}
        draft={draft}
        setDraft={setDraft}
        describedBy={describedBy}
        invalid={describedBy !== undefined}
        onCommit={onCommit}
        onStep={(draft, delta) => {
          const next = steppedValue(control.leaf, draft, delta);
          // `undefined` means this value cannot be stepped or the result would
          // be refused, so the key does nothing rather than writing a value the
          // document then rejects.
          if (next === undefined) return null;
          onCommit(next);
          return String(next);
        }}
      />
      {showUnits ? (
        <Select
          // The empty string, never `undefined`. Radix reads `""` as "no
          // selection" and shows the placeholder, while `undefined` switches it
          // from controlled to UNCONTROLLED — where it keeps whatever was last
          // picked, so a unit added and then undone leaves the trigger still
          // displaying it while the draft has none. The draft is the only unit
          // state, and passing `undefined` would give it a second one.
          value={measurement.unit}
          onValueChange={unit => {
            // Composed from the draft, which is what the author is looking at.
            const next = withUnit(control.leaf, draft, unit);
            if (next === undefined) return;
            if (onCommit(next) !== "refused") setDraft(next);
          }}
        >
          <SelectTrigger
            className="nx-style-inspector__unit"
            aria-label={`Unit for ${actionName}`}
            // A unit change can be refused — a document at its byte limit, a
            // value the validator rejects — and the message that explains it is
            // rendered once for the field. Pointed at from HERE as well as from
            // the text input, because a screen-reader user who returns to the
            // menu is otherwise on the control that failed with nothing saying
            // so and no way to reach the reason.
            aria-describedby={describedBy}
            aria-invalid={describedBy === undefined ? undefined : true}
          >
            <SelectValue placeholder="unit" />
          </SelectTrigger>
          <SelectContent>
            {extraUnit === null ? null : (
              <SelectItem value={extraUnit}>{extraUnit}</SelectItem>
            )}
            {units.map(unit => (
              <SelectItem key={unit} value={unit}>
                {unit}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
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
  draft,
  setDraft,
  describedBy,
  invalid,
  onCommit,
  onStep,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /**
   * The text being edited, owned by the caller.
   *
   * Lifted because a numeric row has TWO controls over one value — the field
   * and the unit menu — and a draft private to this one leaves the other
   * reading the stored value instead, which is a different and usually older
   * answer to what the author is editing.
   */
  draft: string;
  setDraft: (value: string) => void;
  /**
   * Everything describing this field: a refusal message, a contrast verdict, or
   * both.
   *
   * Separate from {@link invalid}, and that separation is the point. A
   * description is not a complaint — a passing 21:1 contrast note is
   * supplementary text — so a field that inferred invalidity from having a
   * description would announce a perfectly good colour as invalid.
   */
  describedBy: string | undefined;
  /** Whether the LAST value was refused, which is the only thing that invalidates. */
  invalid: boolean;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /**
   * Applies one arrow-key step to the text currently shown, answering the text
   * that was written or `null` when nothing was.
   *
   * `null` leaves the key to its default behaviour, which is what keeps a value
   * that is not a single measurement — a shorthand, a function, a keyword —
   * behaving like ordinary text under the caret. The DRAFT is passed rather
   * than read from the store, so a step lands on what the author is looking at.
   */
  onStep?: (draft: string, delta: number) => string | null;
}): React.JSX.Element {
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
      aria-invalid={invalid ? true : undefined}
      // Committed on blur and on Enter, matching the content tab: an op per
      // keystroke would make one undo remove one character.
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return;
        }
        if (onStep === undefined) return;
        const delta = arrowStep(event);
        if (delta === null) return;
        // Stepped from the DRAFT rather than from what is stored, so the key
        // works while an author is mid-edit — which is most of when they reach
        // for it. Reading `stored` instead would either discard an uncommitted
        // edit or, if it declined to act, leave the arrow doing nothing in a
        // text input that has no numeric fallback: an affordance that appears
        // broken exactly while it is being used.
        const next = onStep(draft, delta);
        if (next === null) return;
        // The draft follows the value that was written, so the field shows the
        // step immediately rather than waiting for `stored` to come back.
        setDraft(next);
        // Only once the step was applied, so an unsteppable value keeps the
        // caret movement the key would otherwise perform.
        event.preventDefault();
      }}
    />
  );
}

/**
 * The step one key press asks for, or `null` when it asks for none.
 *
 * Separated from the handler so that WHICH keys are claimed is one readable
 * answer rather than a run of early returns inside an event callback — and so
 * the two rules it encodes sit together, since they are easy to change apart
 * and wrong apart.
 *
 * Arrow steps by one and Shift by ten, which is what Figma, Framer and Webflow
 * all do: an author arrives already knowing it, and a different scale here
 * would cost them for no gain.
 *
 * Alt, Control and Meta are refused outright. Those chords are platform,
 * browser and assistive-navigation shortcuts, so claiming one would mutate a
 * style and add an undo entry from a keystroke aimed somewhere else entirely.
 */
function arrowStep(event: React.KeyboardEvent): number | null {
  // A keystroke arriving mid-composition belongs to the IME, which uses the
  // arrows to move through conversion candidates. Stepping there would edit the
  // style AND suppress the candidate move, so the author loses both. The
  // shortcut manager states the same rule for the same reason, and this is the
  // second reader of a keyboard event in this repository that has to know it.
  if (event.nativeEvent.isComposing) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const direction =
    event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  if (direction === 0) return null;
  return direction * (event.shiftKey ? 10 : 1);
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
