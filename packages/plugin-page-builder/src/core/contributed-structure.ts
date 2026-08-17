/**
 * A contributed block's structure, read from the engine registry it was registered with.
 *
 * A plugin registers its blocks with `@nextlyhq/blocks-engine`. This package's editing side — the
 * drop rules, the write validator, the repair finder, the node constructor — resolves a block
 * through its own registry and its own structure table, and a contributed block is in neither. So a
 * plugin's nesting rules were declared into a registry nothing on this side reads: every plugin
 * container looked like it held no slots, and every plugin block looked placeable anywhere.
 *
 * The direction here is deliberate and is the opposite of the obvious one. Registration does NOT
 * push structure into this package; this package PULLS it from the engine when asked. Pushing would
 * mean a second copy of the same facts with its own lifetime, which has to be cleared on exactly
 * the boots that clear the registry and would silently outlive a removed plugin otherwise — and it
 * would point the block library at `core/`, the implementation it exists to be able to replace.
 *
 * @module core/contributed-structure
 */

import { getBlock, type AnyBlockDefinition } from "@nextlyhq/blocks-engine";

import type { BlockStructure } from "./block-structure";

/**
 * Derived structures, keyed by the definition object they came from.
 *
 * Structure is read on every nesting question, which for a walk over a document is once per node,
 * so deriving it each time would rebuild the same slot array throughout a single validation pass.
 *
 * Keyed on the DEFINITION rather than on its name, and weakly. The engine empties and rebuilds its
 * registry each boot, so a name is only stable within one — a name-keyed cache would answer a boot
 * with the previous boot's structure for any block whose plugin changed it. A definition object
 * cannot outlive its registration, and an entry becomes collectable the moment the registry drops
 * the last reference to it.
 */
const derived = new WeakMap<AnyBlockDefinition, BlockStructure>();

/**
 * One engine definition, as structure.
 *
 * Three fields are translated rather than copied, and each is a place the two vocabularies differ:
 *
 * - `name` is the engine's word for what this package calls `type`.
 * - `isContainer` has no engine counterpart. A block that declares slots holds children and one
 *   that declares none does not, so it is DERIVED here rather than asked for — a separate flag
 *   would be a second statement of the same fact, free to disagree with the slots beside it.
 * - `allow` becomes `allowedBlocks` with its namespace-wildcard syntax intact, which is why
 *   `slotAdmits` reads that syntax rather than testing membership.
 */
export function structureOfContributedBlock(
  definition: AnyBlockDefinition
): BlockStructure {
  const cached = derived.get(definition);
  if (cached) return cached;
  const slots = Object.entries(definition.slots ?? {});
  const structure: BlockStructure = {
    type: definition.name,
    isContainer: slots.length > 0,
    slots: slots.map(([name, spec]) => ({
      name,
      // Spread rather than set to `undefined`, so a slot that states no restriction carries no key
      // at all. `slotAdmits` reads an absent list as "any block", and an explicit `undefined` would
      // answer identically — but the two differ to anything comparing structures, and the structure
      // a core block declares does not carry the key either.
      ...(spec.allow ? { allowedBlocks: [...spec.allow] } : {}),
    })),
    ...(definition.parent ? { parent: [...definition.parent] } : {}),
  };
  derived.set(definition, structure);
  return structure;
}

/**
 * The structure for a type a plugin contributed, or `undefined` where none has.
 *
 * `undefined` here means the engine does not know the type either, which is the same answer the
 * core table gives for a type it has no structure for — so a caller cannot tell a contributed block
 * from a built-in one, and does not have to.
 */
export function contributedStructureOf(
  type: string
): BlockStructure | undefined {
  const definition = getBlock(type);
  return definition ? structureOfContributedBlock(definition) : undefined;
}
