/**
 * Planning "Turn into": the `turnInto` op that turns one block into another
 * type, built from the block's own converter.
 *
 * The block being turned declares HOW in `BlockDefinition.converters`: which
 * props the target gets, what is lost, or why it cannot be turned as it
 * stands. This module carries what every block keeps whatever its type, so no
 * converter has to remember it:
 *
 * - its id and its place, so the selection, the Layers row and anything
 *   addressing it still find it;
 * - its name, its classes (its block style and shared styles), its
 *   visibility and conditions, and its Advanced settings;
 * - its styles, except a property the target does not support;
 * - a binding, only where the target prop it moves to can show what the
 *   binding fills (the same kind of value: words for words); any other is
 *   removed, and the plan names it.
 *
 * Pure: it reads the document and the block definitions and writes nothing.
 * The op it returns is what the editor applies, as one undo step.
 *
 * @module turn-into
 */
import { bindablePropKind } from "./binding-rules";
import { BINDABLE_KINDS, bindablePropTypeOf } from "./binding-vocabulary";
import type { AnyBlockDefinition, PropSchema } from "./block";
import {
  isComponentDocument,
  type BlockDocument,
  type BlockNode,
  isTokenRef,
  STYLE_STATES,
  type NodeStyles,
  type StyleValue,
} from "./document";
import type { BuilderOp } from "./ops-vocabulary";
import { getBlock } from "./registry";
import { STYLE_CATALOG } from "./style/catalog";
import {
  isLook,
  orderedNamedClasses,
  type NamedClass,
} from "./style/named-class";
import { overlaidStyles } from "./style/overlaid-styles";
import { supportsAllowStyleProperty } from "./style/supports-map";
import { findNode } from "./tree";

/** Where a plan reads block definitions: the registry, unless told. */
export type TurnIntoDefinitions = (
  name: string
) => AnyBlockDefinition | undefined;

/**
 * A planned "Turn into": the op, what the converter said is lost, and the
 * props whose binding is removed because the new block cannot show it.
 *
 * @experimental Settles with the editor's "Turn into".
 */
export interface TurnIntoPlan {
  readonly op: Extract<BuilderOp, { kind: "turnInto" }>;
  /** What the new block cannot hold, in the converter's words, if anything. */
  readonly dropped?: string;
  /** The old block's props whose binding is removed. */
  readonly unbound: readonly string[];
  /**
   * Set when part of a block style the new type cannot wear gave way to a
   * shared style the block keeps, which set the same thing at another width.
   */
  readonly lookTrimmed?: true;
}

/**
 * A plan, or why there is none, in words an author reads.
 *
 * @experimental Settles with the editor's "Turn into".
 */
export type TurnIntoResult = TurnIntoPlan | { readonly refused: string };

/** The fields a block keeps whatever its type, carried as they are. */
const KEPT_FIELDS = [
  "name",
  "classes",
  "visibility",
  "customCss",
  "cssId",
  "cssClasses",
  "nosnippet",
  "attributes",
  "origin",
] as const satisfies readonly (keyof BlockNode)[];

/** Every style property the catalog knows, which `supports` decides. */
const CATALOG_PROPERTIES: ReadonlySet<string> = new Set(
  STYLE_CATALOG.map(entry => entry.property)
);

/**
 * The block types a block of `type` can be turned into, in the order its
 * definition declares them: every converter whose target is registered.
 *
 * @experimental Settles with the editor's "Turn into".
 */
export function turnIntoTargets(
  type: string,
  definitions: TurnIntoDefinitions = getBlock
): string[] {
  const converters = definitions(type)?.converters;
  if (converters === undefined) return [];
  return Object.keys(converters).filter(
    target => target !== type && definitions(target) !== undefined
  );
}

/**
 * The `turnInto` op that turns the block `id` into a `to`, or why it cannot.
 *
 * Refused where the block is missing, where its type declares no converter to
 * `to` or `to` is not registered, where the block holds blocks inside it
 * (turning it would lose them), and where the converter says no.
 *
 * A block style (a look) belongs to one block type and is not drawn on any
 * other, so a look the block wears that the new type cannot is kept as the
 * new block's own styles, under the ones it set itself, when `library` names
 * it; its id is then left off. Without the library its id is carried as is.
 *
 * Refused too in a component, for a block whose props the component offers to
 * its placements: their saved values name this block's props, which the new
 * type does not have.
 *
 * Whether a lock allows the edit is the apply's question and the editor's,
 * asked of the op this returns.
 *
 * @experimental Settles with the editor's "Turn into".
 */
export function planTurnInto(
  document: BlockDocument,
  id: string,
  to: string,
  definitions: TurnIntoDefinitions = getBlock,
  library: readonly NamedClass[] = []
): TurnIntoResult {
  const node = findNode(document.nodes, id);
  if (node === undefined) return { refused: "This block is no longer here." };
  const from = definitions(node.type);
  const converter = from?.converters?.[to];
  const target = definitions(to);
  if (from === undefined || converter === undefined || target === undefined) {
    return {
      refused: `${labelOf(from, node.type)} can't be turned into ${labelOf(target, to)}.`,
    };
  }
  if (holdsBlocks(node)) {
    return { refused: "It holds other blocks, which would be lost." };
  }
  if (offeredToPlacements(document, id)) {
    return {
      refused:
        "Placements of this component fill in this block, so it can't be turned into another.",
    };
  }
  const converted = converter.convert(node.props, {
    bound: Object.keys(node.bindings ?? {}),
  });
  if ("refused" in converted) return { refused: converted.refused };

  const { bindings, unbound } = carriedBindings(
    node,
    from,
    target,
    converter.carries ?? {}
  );
  const worn = lookOf(node, library);
  const styles = supportedStyles(
    worn.look === undefined
      ? node.styles
      : overlaidStyles(worn.look, node.styles),
    target
  );
  const turned: BlockNode = {
    id: node.id,
    type: to,
    version: target.version,
    props: converted.props,
    ...(bindings === undefined ? {} : { bindings }),
    ...(styles === undefined ? {} : { styles }),
    ...keptFields(node),
    ...(worn.classes === undefined ? {} : { classes: worn.classes }),
  };
  if (worn.classes?.length === 0) delete turned.classes;
  return {
    op: { kind: "turnInto", id: node.id, node: turned },
    ...(converted.dropped === undefined ? {} : { dropped: converted.dropped }),
    unbound,
    ...(worn.trimmed === true ? { lookTrimmed: true as const } : {}),
  };
}

/** What an author calls a block type: its label, else its name. */
function labelOf(
  definition: AnyBlockDefinition | undefined,
  name: string
): string {
  return definition?.editor?.label ?? name;
}

/** Whether a component offers any of this block's props to its placements. */
function offeredToPlacements(document: BlockDocument, id: string): boolean {
  if (!isComponentDocument(document)) return false;
  return (document.exposed ?? []).some(exposed => exposed.nodeId === id);
}

/**
 * The look the block was drawn with, as styles the new block can carry, and
 * its classes without it; nothing when it wears none the library names.
 *
 * A look belongs to one block type: on any other it is not drawn. So the
 * block's own looks (of its own type, the ones it was drawn with) are folded
 * in under its own styles (`overlaidStyles`, side by side for a composite),
 * and their ids are left off. Looks of other types were never drawn on it:
 * nothing of them is folded, and they beat nothing.
 *
 * Folding moves a look into the block's own tier, where rules are ordered by
 * state, then by width, rather than by tier. So each look value is kept only
 * where what used to beat it still does:
 * - a kept class (a shared style), or a look worn after it, beat it wherever
 *   both applied. A value either sets at another state or width makes it go;
 *   at the same one, their sides are taken out of it.
 * - the block's own value beat it too. One set at a state or width written
 *   before it in a tier would now lose to it, so it goes; one written after
 *   it still wins, and both stay.
 *
 * `trimmed` says part of a look gave way, which may show where what beat it
 * did not apply; that is said rather than guessed around.
 */
function lookOf(
  node: BlockNode,
  library: readonly NamedClass[]
): { look?: NodeStyles; classes?: string[]; trimmed?: true } {
  const worn = new Set(node.classes ?? []);
  const drawn = library.filter(
    cls => worn.has(cls.id) && (!isLook(cls) || cls.blockType === node.type)
  );
  // In the order the stylesheet writes them, which decides between them.
  const looks = orderedNamedClasses(drawn.filter(isLook));
  if (looks.length === 0) return {};
  const gone = new Set(looks.map(look => look.id));
  const kept = drawn.filter(cls => !gone.has(cls.id)).map(cls => cls.styles);
  let look: NodeStyles = {};
  let trimmed = false;
  looks.forEach((each, index) => {
    const later = looks.slice(index + 1).map(cls => cls.styles);
    const left = beatenOut(each.styles, [...kept, ...later], node.styles);
    trimmed ||= left.trimmed;
    look = overlaidStyles(look, left.styles);
  });
  return {
    look,
    classes: (node.classes ?? []).filter(cls => !gone.has(cls)),
    ...(trimmed ? { trimmed: true as const } : {}),
  };
}

/** One value an envelope sets: where, and what. */
interface Placed {
  readonly state: string;
  readonly width: string;
  readonly value: StyleValue;
}

/** Every state and width an envelope sets `property` at, with its value. */
function placesOf(styles: NodeStyles | undefined, property: string): Placed[] {
  return lookValues(styles ?? {})
    .filter(([, , name]) => name === property)
    .map(([state, width, , value]) => ({ state, width, value }));
}

/** Where a state is written in a tier: the states come in this order. */
function stateOrder(state: string): number {
  return (STYLE_STATES as readonly string[]).indexOf(state);
}

/** `value` without what `taken` sets: the sides of a composite, or all. */
function minus(value: StyleValue, taken: StyleValue): StyleValue | undefined {
  if (!isSides(value) || !isSides(taken)) return undefined;
  const left = Object.entries(value).filter(
    ([side]) => !Object.hasOwn(taken, side)
  );
  return left.length === 0 ? undefined : Object.fromEntries(left);
}

/** Whether a stored value holds named sides (a token reference does not). */
function isSides(each: StyleValue): each is Record<string, StyleValue> {
  return typeof each === "object" && each !== null && !isTokenRef(each);
}

/** Whether taking `taken` out of `value` removes anything from it. */
function overlaps(value: StyleValue, taken: StyleValue): boolean {
  if (!isSides(value) || !isSides(taken)) return true;
  return Object.keys(value).some(side => Object.hasOwn(taken, side));
}

/** Whether two places are one state at one width. */
function samePlace(
  a: Omit<Placed, "value">,
  b: Omit<Placed, "value">
): boolean {
  return a.state === b.state && a.width === b.width;
}

/**
 * Whether a block's own value at `own` would lose, in one tier, to a look
 * value at `at`, which it beat before: the look's is written after it (a
 * later state), or the two are at different widths of one state, whose order
 * this cannot know.
 */
function ownWouldLose(at: Omit<Placed, "value">, own: Placed): boolean {
  const ahead = stateOrder(at.state) - stateOrder(own.state);
  return ahead > 0 || (ahead === 0 && at.width !== own.width);
}

/** What is left of one look value once what beat it is taken out. */
function leftOf(
  value: StyleValue,
  at: Omit<Placed, "value">,
  beaters: readonly Placed[],
  own: readonly Placed[]
): { value?: StyleValue; trimmed: boolean } {
  // What beat it before and would not now: a kept class or later look
  // anywhere, the block's own value where the look's would now come after it.
  // Only the sides they set go; at the look's own place a class's sides go
  // quietly, as they always won there.
  const winners = [...beaters, ...own.filter(each => ownWouldLose(at, each))];
  let left: StyleValue | undefined = value;
  let trimmed = false;
  for (const each of winners) {
    if (left === undefined) break;
    if (!samePlace(each, at) && overlaps(left, each.value)) trimmed = true;
    left = minus(left, each.value);
  }
  return left === undefined ? { trimmed } : { value: left, trimmed };
}

/** A look's values that what beat it does not overturn. */
function beatenOut(
  look: NodeStyles,
  beaters: readonly NodeStyles[],
  own: NodeStyles | undefined
): { styles: NodeStyles; trimmed: boolean } {
  const out: Record<string, Record<string, Record<string, StyleValue>>> = {};
  let trimmed = false;
  for (const [state, width, property, value] of lookValues(look)) {
    const left = leftOf(
      value,
      { state, width },
      beaters.flatMap(each => placesOf(each, property)),
      placesOf(own, property)
    );
    trimmed ||= left.trimmed;
    if (left.value === undefined) continue;
    out[state] ??= {};
    out[state][width] ??= {};
    out[state][width][property] = structuredClone(left.value);
  }
  return { styles: out, trimmed };
}

/** Every value an envelope sets, with its state, width and property. */
function lookValues(
  styles: NodeStyles
): [string, string, string, StyleValue][] {
  const out: [string, string, string, StyleValue][] = [];
  for (const [state, widths] of Object.entries(styles)) {
    for (const [width, values] of Object.entries(widths ?? {})) {
      for (const [property, value] of Object.entries(values ?? {})) {
        out.push([state, width, property, value]);
      }
    }
  }
  return out;
}

/** Whether any of the block's slots holds a block. */
function holdsBlocks(node: BlockNode): boolean {
  return Object.values(node.slots ?? {}).some(children => children.length > 0);
}

/** The fields kept whatever the type, those the block has. */
function keptFields(node: BlockNode): Partial<BlockNode> {
  const kept: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) {
    if (node[field] !== undefined) kept[field] = structuredClone(node[field]);
  }
  return kept;
}

/**
 * The bindings that move to the new block, under the target prop's name, and
 * the old props whose binding cannot: one the converter does not carry, or
 * whose target prop takes another kind of value.
 */
function carriedBindings(
  node: BlockNode,
  from: AnyBlockDefinition,
  target: AnyBlockDefinition,
  carries: Readonly<Record<string, string>>
): { bindings?: BlockNode["bindings"]; unbound: string[] } {
  const bindings: NonNullable<BlockNode["bindings"]> = {};
  const unbound: string[] = [];
  for (const [prop, binding] of Object.entries(node.bindings ?? {})) {
    const into = landing(prop, carries, bindings, from, target);
    if (into === undefined) unbound.push(prop);
    else bindings[into] = structuredClone(binding);
  }
  return Object.keys(bindings).length === 0
    ? { unbound }
    : { bindings, unbound };
}

/**
 * The target prop a binding on `prop` moves to, or `undefined` when it
 * cannot: the converter does not carry it, the target prop already took
 * another (a second would replace the first), or it takes other values.
 */
function landing(
  prop: string,
  carries: Readonly<Record<string, string>>,
  taken: Readonly<Record<string, unknown>>,
  from: AnyBlockDefinition,
  target: AnyBlockDefinition
): string | undefined {
  const into = Object.hasOwn(carries, prop) ? carries[prop] : undefined;
  if (into === undefined || Object.hasOwn(taken, into)) return undefined;
  return showsTheSame(from.props?.[prop], target.props?.[into])
    ? into
    : undefined;
}

/**
 * Whether a prop can show what a binding to another prop fills: both take the
 * same kind of value, words for words, rich text for rich text.
 */
function showsTheSame(
  from: PropSchema | undefined,
  to: PropSchema | undefined
): boolean {
  const kind = bindablePropKind(from);
  if (kind === undefined || kind !== bindablePropKind(to)) return false;
  // And every kind of field the old prop could be filled from fills the new
  // one too: a text prop fills from a number field, an email prop does not.
  const fills = (schema: PropSchema | undefined) => {
    const type = schema === undefined ? undefined : bindablePropTypeOf(schema);
    return type === undefined ? [] : BINDABLE_KINDS[type];
  };
  const taken = fills(to);
  return fills(from).every(each => taken.includes(each));
}

/** Whether the target block may carry a style property. */
function targetTakes(target: AnyBlockDefinition, property: string): boolean {
  return (
    !CATALOG_PROPERTIES.has(property) ||
    supportsAllowStyleProperty(target.supports, property)
  );
}

/**
 * The block's styles without a property the target does not support, and
 * without a state or breakpoint that leaves empty; `undefined` when nothing
 * is left.
 */
function supportedStyles(
  styles: NodeStyles | undefined,
  target: AnyBlockDefinition
): NodeStyles | undefined {
  if (styles === undefined) return undefined;
  const kept: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [state, breakpoints] of Object.entries(styles)) {
    const keptBreakpoints: Record<string, Record<string, unknown>> = {};
    for (const [breakpoint, values] of Object.entries(breakpoints ?? {})) {
      const keptValues = Object.fromEntries(
        Object.entries(values ?? {}).filter(([property]) =>
          targetTakes(target, property)
        )
      );
      if (Object.keys(keptValues).length > 0) {
        keptBreakpoints[breakpoint] = structuredClone(keptValues);
      }
    }
    if (Object.keys(keptBreakpoints).length > 0) kept[state] = keptBreakpoints;
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}
