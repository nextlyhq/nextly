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
import type { AnyBlockDefinition, PropSchema } from "./block";
import type { BlockDocument, BlockNode, NodeStyles } from "./document";
import type { BuilderOp } from "./ops-vocabulary";
import { getBlock } from "./registry";
import { STYLE_CATALOG } from "./style/catalog";
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
 * Whether a lock allows the edit is the apply's question and the editor's,
 * asked of the op this returns.
 *
 * @experimental Settles with the editor's "Turn into".
 */
export function planTurnInto(
  document: BlockDocument,
  id: string,
  to: string,
  definitions: TurnIntoDefinitions = getBlock
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
  const converted = converter.convert(node.props);
  if ("refused" in converted) return { refused: converted.refused };

  const { bindings, unbound } = carriedBindings(
    node,
    from,
    target,
    converter.carries ?? {}
  );
  const styles = supportedStyles(node.styles, target);
  const turned: BlockNode = {
    id: node.id,
    type: to,
    version: target.version,
    props: converted.props,
    ...(bindings === undefined ? {} : { bindings }),
    ...(styles === undefined ? {} : { styles }),
    ...keptFields(node),
  };
  return {
    op: { kind: "turnInto", id: node.id, node: turned },
    ...(converted.dropped === undefined ? {} : { dropped: converted.dropped }),
    unbound,
  };
}

/** What an author calls a block type: its label, else its name. */
function labelOf(
  definition: AnyBlockDefinition | undefined,
  name: string
): string {
  return definition?.editor?.label ?? name;
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
    const into = Object.hasOwn(carries, prop) ? carries[prop] : undefined;
    if (
      into !== undefined &&
      showsTheSame(from.props?.[prop], target.props?.[into])
    ) {
      bindings[into] = structuredClone(binding);
    } else {
      unbound.push(prop);
    }
  }
  return Object.keys(bindings).length === 0
    ? { unbound }
    : { bindings, unbound };
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
  return kind !== undefined && kind === bindablePropKind(to);
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
