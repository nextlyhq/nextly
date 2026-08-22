/**
 * What the selected block offers on the Style tab.
 *
 * Pure, for the reason `inspector.ts` is: which sections a block offers, which
 * properties sit in each, and which control each property draws is derivation —
 * and a component test in jsdom cannot separate a correct answer from a
 * plausible wrong one, because both render a column of inputs.
 *
 * **Nothing here holds a list of properties, groups or capabilities.** A
 * block's `supports` decides which properties it may set and the engine answers
 * that; the catalog decides which group each property belongs to and the order
 * the groups appear in; a property's shape decides which controls it draws.
 * Adding a property or a group to the engine gives every block that supports it
 * an editor with no edit here — which is the property worth protecting, because
 * a list written here would be a second answer to a question the engine already
 * holds and the two would agree only on the day they were written.
 *
 * **Every supported property is offered, and the one-open accordion is what
 * bounds the screen.** The alternative — render only the properties that
 * already hold a value and put the rest behind an "add" menu — answers a
 * problem this layout does not have: it exists for editors that expand every
 * section at once, and here exactly one section is open. Measured against the
 * catalog, the largest group is layout at twelve scalar controls, which is a
 * panel rather than a wall. A control an author cannot see is one they cannot
 * discover, and the content tab beside this one already lists every prop a
 * block declares, including the ones it cannot draw.
 *
 * @module style-inspector
 */

import {
  BASE_BREAKPOINT,
  getStyleProperty,
  STYLE_GROUP_DEFS,
  stylePropertiesForSupports,
  type BlockDocument,
  type BreakpointId,
  type StyleGroup,
  type StyleState,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { fieldLabel, selectedBlock } from "./inspector";
import {
  styleControlsFor,
  type StyleControl,
  type StyleControlOptions,
  type StyleControlVariants,
} from "./style-controls";
import { readStyleValue } from "./style-values";

/** Which state × breakpoint the panel reads and writes, and what the site is. */
export interface StyleInspectionOptions extends StyleControlOptions {
  /**
   * The form an author picked for one union position, if any.
   *
   * Addressed by property AND path, because a union can sit below the property
   * root — `position.zIndex` is a number or `auto`. Consulted only where
   * nothing is stored: a stored value decides its own arm, and the engine
   * decides that.
   */
  readonly variantAt?: (
    property: string,
    path: readonly string[]
  ) => number | undefined;
  /**
   * The interaction state being edited.
   *
   * `base` unless a caller says otherwise. The switcher that changes it does
   * not exist yet, and defaulting to anything else would write hover styles
   * from a panel with no way to say so.
   */
  readonly state?: StyleState;
  /**
   * The breakpoint being edited.
   *
   * The engine's unconditional context unless a caller says otherwise, for the
   * same reason: a panel with no breakpoint switcher must write the rules that
   * apply at every width, not a narrow band an author never chose.
   */
  readonly breakpoint?: BreakpointId;
}

/** One catalog property as the Style tab offers it. */
export interface InspectedStyleProperty {
  /** The catalog key, as stored in a `StyleValues` record. */
  readonly property: string;
  /** The property's name as a human reads it. */
  readonly label: string;
  /** The catalog's own one-line description, for a tooltip or a hint. */
  readonly summary: string;
  /** One descriptor per editable position inside the property's value. */
  readonly controls: readonly StyleControl[];
  /** Every choice of form the property's shape offers, empty when it holds no union. */
  readonly variants: readonly StyleControlVariants[];
  /** What this node stores for the property at this address, if anything. */
  readonly value: StyleValue | undefined;
  /**
   * Whether this node sets the property HERE.
   *
   * At this state and breakpoint only, and deliberately: a value inherited from
   * the base breakpoint is not one this panel would clear, so reporting it as
   * set would put a reset affordance on a control that has nothing to reset.
   * Where the value visibly comes from is `styleProvenance`'s question, and it
   * needs the compiler's trace rather than the document.
   */
  readonly set: boolean;
}

/** One accordion section: a catalog group, and the properties this block has in it. */
export interface StyleSection {
  readonly group: StyleGroup;
  readonly label: string;
  /** Never empty — a group this block supports nothing in is not a section. */
  readonly properties: readonly InspectedStyleProperty[];
}

/** The selected block, as something to style. */
export interface StyleInspection {
  readonly nodeId: string;
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
  /**
   * Sections in the catalog's own order, each holding at least one property.
   *
   * Empty for a block that opts into no style groups at all, which is a real
   * answer rather than a failure: the panel says the block offers none, exactly
   * as the content tab says when a block declares no props.
   */
  readonly sections: readonly StyleSection[];
}

/**
 * Describe the selected block's style surface, or `null` when there is none.
 *
 * `null` under exactly the conditions the content tab returns null under, which
 * is why they share one answer — see {@link selectedBlock}.
 */
export function inspectStyle(
  document: BlockDocument,
  selectedId: string | null,
  options?: StyleInspectionOptions
): StyleInspection | null {
  const selected = selectedBlock(document, selectedId);
  if (selected === null) return null;
  const { node, definition } = selected;

  const state = options?.state ?? "base";
  const breakpoint = options?.breakpoint ?? BASE_BREAKPOINT;
  // ASKED of the engine. `supports` is a capability declaration whose meaning —
  // `true` for a whole group, an object naming sub-flags — is the registry's,
  // and a second reading of it here would offer a property the compiler
  // silently drops, or withhold one the block really has.
  const allowed = new Set(
    stylePropertiesForSupports(definition.supports).map(entry => entry.property)
  );

  const sections: StyleSection[] = [];
  for (const group of STYLE_GROUP_DEFS) {
    const properties = propertiesInGroup(allowed, group.key).map(property =>
      inspectProperty(property, node.styles, {
        ...options,
        state,
        breakpoint,
      })
    );
    // A group the block supports nothing in is not a section. Rendering an
    // empty accordion would offer an author somewhere to click that opens onto
    // nothing, and every block would show all eleven headings whatever it does.
    if (properties.length > 0) {
      sections.push({ group: group.key, label: group.label, properties });
    }
  }

  return { nodeId: node.id, state, breakpoint, sections };
}

/**
 * The allowed properties of one group, in the catalog's order.
 *
 * Filtered from the allowed set rather than intersected with
 * `stylePropertiesInGroup`, so the ORDER is the one the engine emits in and not
 * an artefact of how the set was built.
 */
function propertiesInGroup(
  allowed: ReadonlySet<string>,
  group: StyleGroup
): readonly string[] {
  const rows: string[] = [];
  for (const property of allowed) {
    if (getStyleProperty(property)?.group === group) rows.push(property);
  }
  return rows;
}

/** One property's controls and the value they are showing. */
function inspectProperty(
  property: string,
  styles: Parameters<typeof readStyleValue>[0],
  options: StyleInspectionOptions & {
    state: StyleState;
    breakpoint: BreakpointId;
  }
): InspectedStyleProperty {
  // Present by construction: the name came out of `stylePropertiesForSupports`,
  // which reads the same catalog. Asked again rather than threaded through so
  // this function takes a name, which is what makes it callable from a test
  // without assembling a catalog row.
  const entry = getStyleProperty(property);
  if (entry === undefined) {
    throw new Error(`${property} is not a style property`);
  }
  const value = readStyleValue(styles, {
    state: options.state,
    breakpoint: options.breakpoint,
    property,
    path: [],
  });
  const set = styleControlsFor(entry, value, {
    ...options,
    // Bound to THIS property before it reaches the walk, which speaks only in
    // paths: two properties can both hold a union at the root, and a resolver
    // told only the path would answer for whichever asked first.
    variantAt: path => options.variantAt?.(property, path),
  });
  return {
    property,
    label: fieldLabel(property),
    summary: entry.summary,
    controls: set.controls,
    variants: set.variants,
    value,
    set: value !== undefined,
  };
}
