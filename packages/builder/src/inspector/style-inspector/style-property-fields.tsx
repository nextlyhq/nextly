"use client";

/**
 * The fields of a section's style properties: one control per property, the
 * choices a placement offers, and the toggle between a property's forms.
 *
 * @module style-property-fields
 */
import {
  findNode,
  type BreakpointId,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { batchStyleClearOps } from "../../batch-style";
import { propertyWordsFor, wordedProperty } from "../../block-style-words";
import type { EditorState } from "../../editor-state";
import { radioGroupStep } from "../../roving-radios";
import type { SideOrientation } from "../../side-orientation";
import {
  formNamesOf,
  type StyleControl,
  type StyleControlVariants,
} from "../../style-controls";
import { foldedControlFor } from "../../style-folded";
import {
  isLogicalSide,
  physicalCornerName,
  physicalSideName,
  sideBoxFor,
  sideOf,
} from "../../style-sides";
import {
  readStyleValue,
  type StyleAddress,
  type StylePolicy,
} from "../../style-values";
import { CssHint } from "../css-hint";
import { fieldLabel } from "../inspector";

import { APPEAR_PROPERTY, AppearPlay } from "./appear-play";
import { SideBoxFrame } from "./spacing-box-fields";
import { flowOf } from "./style-alignment-icons";
import { StyleControlField } from "./style-field-shell";
import {
  type StyleFieldSurroundings,
  NamedAbove,
  type ChooseForm,
} from "./style-field-surroundings";
import type { InspectedStyleProperty } from "./style-inspector";
import { FoldedUnion, AlignmentFlow } from "./style-value-fields";

/**
 * One catalog property, which is one control or several.
 *
 * `margin` is four logical sides and `position` is a scheme, four offsets and a
 * stacking order, so a property is a GROUP of controls rather than a field. The
 * heading is drawn only when there is more than one, because a lone control
 * already carries the property's name, and not when the section is titled
 * with it.
 */
export function StylePropertyFields({
  property: catalogProperty,
  orientation,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  tokens,
  prefersDark,
  provenanceOf,
  editing,
  onChooseForm,
  namesSection,
}: {
  property: InspectedStyleProperty;
  /**
   * Whether the property shares its section's name, as `border` does in the
   * Border section: its heading would say the section's title again.
   */
  namesSection: boolean;
} & StyleFieldSurroundings): React.JSX.Element {
  // The block's own words for this property, where it has them: the fields
  // it draws, what each is called, and a line saying what it is here.
  const words = propertyWordsFor(
    findNode(editor.document.nodes, nodeId)?.type,
    catalogProperty.property
  );
  const property = wordedProperty(catalogProperty, words);
  const many = property.controls.length > 1;
  const fold = property.offered
    ? foldedControlFor(property.property)
    : undefined;
  const choices = (property.offered ? property.variants : [])
    // A folded property's root form follows from its value; see
    // `style-folded.ts`. Its other choices, if any, stay.
    .filter(
      variant =>
        variant.count > 1 && (fold === undefined || variant.path.length > 0)
    );
  // A toggle at the root is drawn on a row named for the property, so the
  // property needs no heading over it as well.
  const headed =
    many && !namesSection && !choices.some(choice => choice.path.length === 0);
  /*
   * Whether this property is drawn as a box, and in what order — one decision,
   * settled outside the component. Each side still keeps its own control, so it
   * commits on its own and undo stays per side; the grouping is for the DRAWING
   * only.
   */
  const box = sideBoxFor(property.controls, orientation);
  const { above, before, toggled } = placeChoices(choices, box.boxed);
  const toggle = (variant: StyleControlVariants) => (
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
  );
  return (
    <div
      className="nx-style-inspector__property"
      data-property={property.property}
    >
      <PropertyHeading
        property={property}
        headed={headed}
        nodeId={nodeId}
        state={state}
        breakpoint={breakpoint}
        editor={editor}
      />
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
      {words?.hint === undefined ? null : (
        <p className="nx-inspector__note">{words.hint}</p>
      )}
      {above.map(toggle)}
      {property.offered ? null : (
        <p className="nx-inspector__note" data-not-offered={property.property}>
          {/* Not "no longer": a value written through the API is stored on
              blocks that never offered the property. Said plainly so the
              author knows clearing it changes the page. */}
          This block doesn&apos;t offer {property.label}. The value set here
          still applies; clearing it removes it.
        </p>
      )}
      {/* The container's flow, which alignment icons are drawn in. */}
      <AlignmentFlow.Provider
        value={flowOf(
          findNode(editor.document.nodes, nodeId)?.styles,
          state,
          breakpoint,
          orientation
        )}
      >
        {/* A folded union's one control, read where the value field is drawn;
          see `style-folded.ts`. Its controls sit at the root, so the whole
          property is the fold's. */}
        <FoldedUnion.Provider
          value={
            fold === undefined
              ? undefined
              : { kind: fold, property: property.property }
          }
        >
          <SideBoxFrame box={box}>
            {box.controls.map(control => (
              <React.Fragment
                // The ADDRESS, not just the position: a host switching state or
                // breakpoint leaves this field mounted, and where the old and new
                // addresses hold the same value — both unset, most often — the
                // synchronisation effect does not run either. An unfinished draft
                // from the base breakpoint would then commit into the hover state.
                key={[
                  state,
                  breakpoint,
                  property.property,
                  ...control.path,
                ].join(".")}
              >
                {before(control.path).map(toggle)}
                <NamedAbove.Provider
                  value={toggled.includes(control.path.join("."))}
                >
                  <StyleControlField
                    control={control}
                    side={sideOf(box, control)}
                    label={
                      words?.labels[control.path.join(".")] ??
                      (many
                        ? positionLabel(control, orientation)
                        : property.label)
                    }
                    summary={many ? undefined : property.summary}
                    propertyLabel={property.label}
                    clearOnly={!property.offered || control.withheld}
                    nodeId={nodeId}
                    state={state}
                    breakpoint={breakpoint}
                    editor={editor}
                    policy={policy}
                    tokens={tokens}
                    prefersDark={prefersDark}
                    provenanceOf={provenanceOf}
                    editing={editing}
                  />
                </NamedAbove.Provider>
              </React.Fragment>
            ))}
          </SideBoxFrame>
        </FoldedUnion.Provider>
      </AlignmentFlow.Provider>
    </div>
  );
}

/**
 * A property's heading, when it has one, and the action drawn beside it: Play
 * beside "Animation when it appears", the one property that has one.
 */
function PropertyHeading({
  property,
  headed,
  nodeId,
  state,
  breakpoint,
  editor,
}: {
  property: InspectedStyleProperty;
  headed: boolean;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
}): React.JSX.Element | null {
  const label = headed ? (
    // What the property does, then the CSS its fields write, on hover.
    <CssHint
      summary={property.summary}
      writes={writtenProperties(property.controls)}
    >
      <p className="nx-style-inspector__property-label">{property.label}</p>
    </CssHint>
  ) : null;
  if (property.property !== APPEAR_PROPERTY) return label;
  return (
    <div className="nx-style-inspector__property-head">
      {label}
      <AppearPlay
        nodeId={nodeId}
        state={state}
        breakpoint={breakpoint}
        editor={editor}
      />
    </div>
  );
}

/**
 * Where each form toggle is drawn. A nested form's toggle sits just above its
 * own control where the controls are a list; a box places its sides itself,
 * so its toggles stay above it. Only a control with its toggle just above
 * drops its own visible name (`toggled`, by path).
 */
function placeChoices(
  choices: readonly StyleControlVariants[],
  boxed: boolean
): {
  above: readonly StyleControlVariants[];
  before: (path: readonly string[]) => readonly StyleControlVariants[];
  toggled: readonly string[];
} {
  const inline = boxed ? [] : choices.filter(c => c.path.length > 0);
  const above = choices.filter(choice => !inline.includes(choice));
  const toggled = [
    ...above.filter(choice => choice.path.length === 0),
    ...inline,
  ].map(choice => choice.path.join("."));
  return {
    above,
    before: path =>
      inline.filter(choice => choice.path.join(".") === path.join(".")),
    toggled,
  };
}

/**
 * Rows whose stored key reads wrong as a word, by the kind of value and the
 * CSS property they set: the background's `url` is the image an author
 * chooses, not an address (a gradient writes the same property, as itself).
 */
const ROW_LABELS: Readonly<Record<string, string>> = {
  "url:background-image": "Image",
};

/**
 * A control's name within its property: a side or a corner in plain words
 * ("Top", "Bottom left"), as the element's measured axes place it, rather
 * than CSS's logical words ("Block start", "End start"); any other position
 * by its key. Logical until the canvas has said which way the element runs:
 * on a right-to-left or vertical page a guessed "Left" would be wrong, and
 * the logical word is true either way.
 */
function positionLabel(
  control: StyleControl,
  orientation: SideOrientation | undefined
): string {
  const named = ROW_LABELS[`${control.leaf.kind}:${control.leaf.cssProperty}`];
  if (named !== undefined) return named;
  const key = control.path[control.path.length - 1] ?? "";
  if (orientation === undefined) return fieldLabel(key);
  const plain =
    (isLogicalSide(key) ? physicalSideName(key, orientation) : undefined) ??
    physicalCornerName(key, orientation);
  return plain === undefined
    ? fieldLabel(key)
    : plain.charAt(0).toUpperCase() + plain.slice(1);
}

/**
 * The choice of form at one union position: a toggle of its forms, named in
 * plain words ("All | Corners", "Number | Auto"), on a row named for the
 * property, where a menu labelled "Border radius form" put an internal word in
 * front of authors.
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
  const labelId = React.useId();
  const radios = React.useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (arm: number) => {
    if (arm === variant.active) return;
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
    // Through the batch layer as a group of ONE, like every other style write
    // in this panel. A refusal or an already-absent value both come back as no
    // ops, which is what the two conditions here used to say separately.
    const cleared = batchStyleClearOps([current], address, policy);
    if (cleared.ops.length > 0) editor.applyAll(cleared.ops);
  };
  // As a radio group's arrow keys do: move and choose together, wrapping.
  const step = (event: React.KeyboardEvent) => {
    const delta = radioGroupStep(event.key);
    if (delta === null) return;
    event.preventDefault();
    const next = (variant.active + delta + variant.count) % variant.count;
    choose(next);
    radios.current[next]?.focus();
  };

  return (
    <div className="nx-inspector__field" data-form-choice={property.property}>
      {/*
        The PROPERTY's name at the root, and the position's below it, where the
        heading names the property: a toggle called "Form" would tell a
        screen-reader user nothing about which property it changes. Plain text
        rather than a label, which would forward a click to a radio.
      */}
      <p className="nx-inspector__field-name" id={labelId}>
        {variant.path.length === 0
          ? property.label
          : fieldLabel(variant.path[variant.path.length - 1] ?? "")}
      </p>
      <div
        className="nx-style-inspector__toggle"
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {formNamesOf(variant).map((name, index) => {
          const checked = index === variant.active;
          return (
            <button
              key={`${index}:${name}`}
              ref={button => {
                radios.current[index] = button;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              // The group's one tab stop is the chosen form.
              tabIndex={checked ? 0 : -1}
              onClick={() => choose(index)}
              onKeyDown={step}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The CSS properties a property's fields write, each once, in their order. */
function writtenProperties(
  controls: readonly { readonly leaf: { readonly cssProperty: string } }[]
): string | undefined {
  const names = [...new Set(controls.map(control => control.leaf.cssProperty))];
  return names.length === 0 ? undefined : names.join("; ");
}
