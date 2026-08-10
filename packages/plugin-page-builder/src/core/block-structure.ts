/**
 * What a block IS, separately from how it draws.
 *
 * The write path has to know a block's slots — that is the whole of the allowlist it enforces — and
 * it cannot reach them today. Built-in definitions are registered by a side-effect import of
 * `render/blocks`, which pulls React and the entire block library; the core entry deliberately does
 * not perform it, so `pageBuilderField`'s validator runs against an EMPTY registry. Measured: with
 * no renderer import, `defaultBlockRegistry.all()` is `[]`, `get("core/container")` is `undefined`,
 * and a document carrying an undeclared slot validates as `true`.
 *
 * That is not only the validator's problem. Generation, manifests and any future CLI check want the
 * same facts and would each have to solve it again.
 *
 * So a block's STRUCTURE — what it is called, whether it nests, which slots it declares and what
 * they admit — lives here, React-free, and `render/blocks` composes it with a `render` function to
 * make a full definition. One source of truth: a definition is BUILT from its structure rather than
 * repeating it, so the two cannot drift.
 *
 * @module core/block-structure
 */
import type { BlockNode, SlotSpec } from "./types";

/**
 * The React-free half of a block definition.
 *
 * Deliberately not `Pick<BlockDefinition, ...>`: this is the SOURCE, and deriving it from the
 * fuller type would invert the dependency it exists to create.
 */
export interface BlockStructure {
  /** Namespaced type, e.g. `core/heading`. */
  type: string;
  /** Whether the block may hold children at all. */
  isContainer?: boolean;
  /** The slots it declares, in the order it declares them. */
  slots?: SlotSpec[];
}

/**
 * Every block structure this package knows, keyed by type.
 *
 * A plain record rather than a registry object: it is data, available at import time, and nothing
 * needs to mutate it. Plugin-contributed blocks arrive through `blocks/declared-blocks.ts`, which
 * already carries structure as data for the same reason — generation cannot boot a plugin either.
 */
export const CORE_BLOCK_STRUCTURES: Record<string, BlockStructure> = {};

/**
 * Declare a block's structure and get it back for the definition to build on.
 *
 * The return value is what makes this one source rather than two: `render/blocks` spreads it into
 * `defineBlock`, so a definition cannot state a slot the structure does not, and the structural
 * lookup a validator performs cannot disagree with what the renderer draws.
 */
export function declareStructure(structure: BlockStructure): BlockStructure {
  CORE_BLOCK_STRUCTURES[structure.type] = structure;
  return structure;
}

/**
 * The slots a type declares, from structure ALONE — no renderer, no registry.
 *
 * `undefined` means "this build has no structure for that type", which is not the same as "that
 * type declares no slots" and must not be collapsed into it: the first is a statement about what
 * this process knows, the second about the block. Callers that can be permissive about the unknown
 * case have to be able to tell them apart.
 */
export function declaredSlotsOf(type: string): SlotSpec[] | undefined {
  const structure = CORE_BLOCK_STRUCTURES[type];
  return structure ? (structure.slots ?? []) : undefined;
}

/**
 * The first migrated batch.
 *
 * Declared here rather than beside each `defineBlock` so this module can be imported without
 * reaching a `.tsx` file — which is the entire point: importing one block's structure must not pull
 * React in behind it.
 */
export const containerStructure = declareStructure({
  type: "core/container",
  isContainer: true,
  slots: [{ name: "default" }],
});

export const columnsStructure = declareStructure({
  type: "core/columns",
  isContainer: true,
  slots: [{ name: "default" }],
});

export const gridStructure = declareStructure({
  type: "core/grid",
  isContainer: true,
  slots: [{ name: "default" }],
});

/** Whether a node's type is one this build has structure for. */
export function hasStructure(node: BlockNode): boolean {
  return CORE_BLOCK_STRUCTURES[node.type] !== undefined;
}
