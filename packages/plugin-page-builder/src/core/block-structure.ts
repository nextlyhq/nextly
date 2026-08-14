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
import { contributedStructureOf } from "./contributed-structure";
import type { BlockRegistry } from "./registry";
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
  /**
   * The only types this block may be a DIRECT child of. Omit for "anywhere".
   *
   * The other half of `allowedBlocks`, and not derivable from it. A slot's allowlist is the
   * parent's statement about what it will hold; this is the child's statement about where it makes
   * sense. Both are needed because neither implies the other: a slot naming `core/heading` must not
   * confine headings to it, and a block that is meaningless outside one parent has to say so
   * itself.
   *
   * Named after the same field in Gutenberg's block metadata, which solves this case identically —
   * its `core/column` declares `parent: ["core/columns"]`.
   */
  parent?: string[];
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
 * The structure for a type: this package's own if it has one, otherwise whatever a PLUGIN
 * contributed to the engine.
 *
 * The engine is consulted rather than mirrored. A copy kept here would need clearing on exactly the
 * boots that clear the engine's registry, and a miss in either direction is silent — a stale entry
 * enforces a removed plugin's nesting rules against blocks that no longer exist, and a missing one
 * lets a live plugin's rules go unenforced. Reading through means there is one set, and it is the
 * one registration wrote.
 *
 * Core wins a collision. The engine's registry already refuses a duplicate name, so this cannot
 * arise from a well-formed boot; preferring the contributed side would let a plugin decide what
 * `core/column` means, which is not a question a plugin gets to answer.
 */
function structureOf(type: string): BlockStructure | undefined {
  return CORE_BLOCK_STRUCTURES[type] ?? contributedStructureOf(type);
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
  const structure = structureOf(type);
  return structure ? (structure.slots ?? []) : undefined;
}

/**
 * The parents a type restricts itself to, from structure ALONE — no renderer, no registry.
 *
 * `undefined` means the type states no restriction, which is the common case and is NOT the same
 * as "this build has no structure for it". Both answer "put it anywhere", so the two are collapsed
 * here deliberately: a caller cannot act differently on them, and pretending it could would invite
 * a check that treats an unknown plugin block as forbidden everywhere.
 */
export function declaredParentsOf(type: string): string[] | undefined {
  return structureOf(type)?.parent;
}

/**
 * Where a type may sit, asking the REGISTERED definition first and structure otherwise.
 *
 * The same branch `declaredSlotsOf`'s callers make, and for the same reason: a registered
 * definition is the whole answer about itself, including when it states no restriction, so a
 * fallback to structure there would let a built-in's declaration answer for a plugin block that
 * deliberately restricts nothing. Structure answers where no definition is registered, which is
 * the state the config and server paths run in.
 *
 * One reader rather than the branch written at each call site, because the three that need it —
 * the drop rules, the validator and the repair finder — must agree or the editor and the write
 * path disagree about what a legal document is.
 */
export function parentsOf(
  type: string,
  registry: BlockRegistry
): string[] | undefined {
  const def = registry.get(type);
  return def ? def.parent : declaredParentsOf(type);
}

/**
 * Blocks that hold children, one constant each.
 *
 * Declared here rather than beside each `defineBlock` so this module can be imported without
 * reaching a `.tsx` file — which is the entire point: importing one block's structure must not pull
 * React in behind it. Each definition SPREADS its constant, so the slots a block draws and the
 * slots the validator enforces are one statement rather than two that agree by discipline.
 */
export const containerStructure = declareStructure({
  type: "core/container",
  isContainer: true,
  slots: [{ name: "default" }],
});

export const columnsStructure = declareStructure({
  type: "core/columns",
  isContainer: true,
  // The only container that restricts what its slot takes, and the restriction
  // is what makes a column addressable. A row could hold any block directly and
  // lay each one out as a column, but then a column is a shape the renderer
  // draws rather than a thing in the document — nothing to select, and nowhere
  // to put a width, a background or an alignment. Naming the child makes each
  // column a block an author can reach, which is the same split Gutenberg,
  // Elementor and Bricks all arrived at.
  slots: [
    {
      name: "default",
      allowedBlocks: ["core/column"],
      childLayout: "formatted",
    },
  ],
});

/**
 * One cell of a {@link columnsStructure} row.
 *
 * A container so it can hold anything, and unrestricted so that "what may go in
 * a column" stays the same question as "what may go on a page" — a column that
 * accepted less than the canvas would be a rule authors have to learn for no
 * gain.
 */
export const columnStructure = declareStructure({
  type: "core/column",
  isContainer: true,
  slots: [{ name: "default" }],
  // A column draws a flex ITEM: its width and alignment are instructions to a flex container, and
  // the only block that provides one is the row. Sitting anywhere else — including inside another
  // column, which is where a nearest-accepting search would otherwise put it — it renders as an
  // ordinary div and the author does not get the column they asked for.
  parent: ["core/columns"],
});

export const gridStructure = declareStructure({
  type: "core/grid",
  isContainer: true,
  slots: [{ name: "default", childLayout: "formatted" }],
});

export const coverStructure = declareStructure({
  type: "core/cover",
  isContainer: true,
  slots: [{ name: "default" }],
});

export const offCanvasStructure = declareStructure({
  type: "core/off-canvas",
  isContainer: true,
  slots: [{ name: "default" }],
});

export const queryLoopStructure = declareStructure({
  type: "core/query-loop",
  isContainer: true,
  slots: [{ name: "default" }],
});

// A row is flex in both orientations, so its children are flex items whichever way it is
// pointing — the orientation decides the direction, not whether the layout is formatted.
export const rowStructure = declareStructure({
  type: "core/row",
  isContainer: true,
  slots: [{ name: "default", childLayout: "formatted" }],
});

export const contentCarouselStructure = declareStructure({
  type: "core/content-carousel",
  isContainer: true,
  slots: [{ name: "default", childLayout: "formatted" }],
});

/**
 * Blocks that hold no children, declared as data in one list.
 *
 * `slots: []` is a statement, not an omission: a stored document can carry children under any slot
 * name on any node, and a type with NO structure is one the validator must leave to `allowUnknown`
 * — so before this list, junk slots on a heading or an image passed the write check whenever the
 * registry was empty, which is the ordinary state of the config and server paths.
 *
 * No definition spreads these. There is nothing structural to share beyond the type name, and the
 * correspondence is enforced from the other side: `structure-covers-the-catalog.test.ts` asserts
 * every registered definition has a structure AND that their slot lists agree, so a block that
 * later grows slots without moving to a container structure fails there, not silently here.
 */
const PLAIN_BLOCK_TYPES = [
  "core/accordion",
  "core/anchor",
  "core/badge",
  "core/button",
  "core/button-group",
  "core/counter",
  "core/countdown",
  "core/cta-card",
  "core/divider",
  "core/embed",
  "core/flip-box",
  "core/form",
  "core/gallery",
  "core/heading",
  "core/hotspot",
  "core/icon",
  "core/icon-box",
  "core/icon-list",
  "core/image",
  "core/image-box",
  "core/image-carousel",
  "core/list",
  "core/logo-carousel",
  "core/logo-cloud",
  "core/lottie",
  "core/map",
  "core/paragraph",
  "core/price-list",
  "core/pricing-table",
  "core/progress-bar",
  "core/rating",
  "core/ref",
  "core/reviews",
  "core/rich-text",
  "core/slides",
  "core/social-icons",
  "core/spacer",
  "core/table",
  "core/tabs",
  "core/testimonial",
  "core/testimonial-carousel",
  "core/toggle",
  "core/video",
] as const;
for (const type of PLAIN_BLOCK_TYPES) {
  declareStructure({ type, slots: [] });
}

/**
 * Whether this package itself declares the type, as opposed to a plugin contributing it.
 *
 * The distinction matters wherever something is BUILT rather than merely judged. A contributed
 * block is known well enough to enforce its nesting rules, and not well enough to construct: its
 * defaults, its version and its renderer live in the engine registry, which `createNode` and the
 * canvas do not read.
 */
export function isDeclaredHere(type: string): boolean {
  return CORE_BLOCK_STRUCTURES[type] !== undefined;
}

/** Whether a node's type is one this build has structure for. */
export function hasStructure(node: BlockNode): boolean {
  return structureOf(node.type) !== undefined;
}

/**
 * The slots a type offers, asking the REGISTERED definition first and structure otherwise.
 *
 * The slot-side twin of {@link parentsOf}, and it exists for the same reason: a contributed block
 * is absent from this package's registry, so a reader that only asked the registry would treat
 * every plugin container as holding no slots at all. Structure answers for those, and for the
 * config and server paths where no definition is registered.
 */
export function slotsOf(
  type: string,
  registry: BlockRegistry
): SlotSpec[] | undefined {
  const def = registry.get(type);
  return def ? (def.slots ?? []) : declaredSlotsOf(type);
}

/**
 * Whether a type may hold children at all, from the definition or from structure.
 *
 * `undefined` means neither knows the type — which is not "it holds nothing". A caller has to be
 * able to refuse an unknown container rather than silently treat it as a leaf.
 */
export function isContainerType(
  type: string,
  registry: BlockRegistry
): boolean | undefined {
  const def = registry.get(type);
  if (def) return def.isContainer === true;
  const structure = structureOf(type);
  return structure ? structure.isContainer === true : undefined;
}
