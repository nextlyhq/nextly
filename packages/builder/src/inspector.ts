/**
 * What the selected block exposes for editing, and the patch that changes it.
 *
 * Pure, for the reason every rule in this package is: which controls a block
 * offers, in what order, carrying which values, is derivation — and a component
 * test in jsdom cannot separate a correct answer from a plausible wrong one,
 * because both render a column of inputs.
 *
 * **A block declares its own editable surface.** `props` on the definition maps
 * each prop name to a `PropSchema`, and the schema's `type` decides the
 * control. Nothing here holds a list of which blocks have which fields: a
 * third-party block gets an inspector by declaring its props, exactly as a
 * first-party one does.
 *
 * @module inspector
 */

import {
  getBlock,
  findNode,
  type BlockDocument,
  type BlockNode,
  type PropSchema,
} from "@nextlyhq/blocks-engine";

import { blockLabel } from "./inserter";
import type { NodePatch } from "./ops";

/**
 * The prop types this inspector can draw a control for.
 *
 * Named as a set rather than inferred from what the switch happens to handle,
 * so an unsupported prop is a KNOWN gap rather than a silent fallthrough. A
 * block declaring `type: "array"` still appears in the panel — the author is
 * told the prop exists and is not editable here — because omitting it entirely
 * would present an incomplete block as a complete one.
 */
export const SUPPORTED_PROP_TYPES = [
  "text",
  "textarea",
  "url",
  "number",
  "checkbox",
  "select",
] as const;

export type SupportedPropType = (typeof SUPPORTED_PROP_TYPES)[number];

/** One editable prop, with everything a control needs to draw itself. */
export interface EditableProp {
  readonly name: string;
  readonly schema: PropSchema;
  /** The node's current value, which may be absent. */
  readonly value: unknown;
  /**
   * Whether this inspector can draw a control for it.
   *
   * Carried rather than recomputed by the panel: the panel would have to repeat
   * the membership test, and the two would disagree the first time this set
   * gained a member.
   */
  readonly supported: boolean;
  /** The options a `select` offers, empty for every other type. */
  readonly options: readonly string[];
}

/** The selected block, as something to edit. */
export interface BlockInspection {
  readonly nodeId: string;
  readonly blockName: string;
  /** What to title the panel: the block's label, or its name. */
  readonly label: string;
  /**
   * Props in the order the definition declares them.
   *
   * Declaration order rather than alphabetical: a block author writes a heading
   * before its level and a button before its destination, and sorting that into
   * alphabetical order rearranges a form somebody designed.
   */
  readonly props: readonly EditableProp[];
}

/** Read a schema's `options`, which is untyped by construction. */
function optionsOf(schema: PropSchema): readonly string[] {
  const declared = schema.options;
  if (!Array.isArray(declared)) return [];
  return declared.filter(
    (option): option is string => typeof option === "string"
  );
}

/**
 * Describe the selected block for editing, or `null` when there is nothing to
 * edit.
 *
 * `null` for no selection, for an id the document no longer holds, and for a
 * block the registry does not know — the last because an unregistered block's
 * props have no schemas, so every control would have to be guessed from the
 * stored value's runtime type. Guessing produces a text box for a number and
 * silently rewrites the value on save.
 */
export function inspectSelection(
  document: BlockDocument,
  selectedId: string | null
): BlockInspection | null {
  if (selectedId === null) return null;

  const node = findNode(document.nodes, selectedId);
  if (node === undefined) return null;

  const definition = getBlock(node.type);
  if (definition === undefined) return null;

  const declared = definition.props ?? {};
  const props = Object.entries(declared).flatMap<EditableProp>(
    ([name, schema]) => {
      if (schema === undefined) return [];
      return [
        {
          name,
          schema,
          value: node.props[name],
          supported: (SUPPORTED_PROP_TYPES as readonly string[]).includes(
            schema.type
          ),
          options: optionsOf(schema),
        },
      ];
    }
  );

  return {
    nodeId: node.id,
    blockName: node.type,
    // The same name the palette offered and the layers panel shows. Reading
    // `editor.label ?? node.type` here instead was a second rule that agreed
    // only for blocks which declare a label: an unlabelled third-party block
    // was "Collection loop" in the palette and `acme/collection-loop` here.
    label: blockLabel(node.type),
    props,
  };
}

/**
 * The patch that sets one prop.
 *
 * **The whole props object, not the one key.** `updateNode` merges at the top
 * level — `{ ...node, ...patch }` — so a patch carrying `{ props: { text } }`
 * REPLACES the node's props and drops every other one. Editing a heading's text
 * would silently discard its level.
 *
 * Built here rather than in the panel so that fact is stated once. A caller
 * assembling its own patch has to know a merge rule that is two files away, and
 * the failure is silent: the edit works and the other props are gone.
 */
export function propPatch(
  node: BlockNode,
  name: string,
  value: unknown
): NodePatch {
  return { props: { ...node.props, [name]: value } };
}
