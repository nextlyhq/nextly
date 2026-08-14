/**
 * Open, string-keyed registries — the single extensibility seam (spec §7).
 *
 * The validator, renderer, and inspector all read the SAME block registry, so a
 * third party adds a block with one `registerBlock()` call and no core edit.
 * Types are namespaced (`core/heading`, `acme/pricing-table`) to stay collision-free.
 */
import { slotsOf } from "./block-structure";
import { makeNode } from "./tree";
import { type BlockDefinition, type BlockNode, type ControlDef } from "./types";

/**
 * The empty slot map a freshly created block starts with, one key per DECLARED slot.
 *
 * Derived from the declaration rather than assumed, because the assumption was wrong in both
 * directions for a block that does not open exactly one slot named `default`. A container
 * declaring only `sidebar` was created carrying a `default` key it never declared, which the write
 * validator rejects — so the block could be inserted and the page could then never be saved, with
 * the fault named against a slot the author never chose. A container declaring `left` and `right`
 * got neither.
 *
 * Resolved through `slotsOf` so a block a plugin CONTRIBUTED is created from its own declaration
 * too; it is absent from this package's registry, and reading only the registry would give every
 * contributed container the same invented `default`.
 */
function initialSlots(
  type: string,
  registry: BlockRegistry
): Record<string, BlockNode[]> | undefined {
  const declared = slotsOf(type, registry);
  // A type nothing knows, and a block that declares no slots, both get none. Inventing a slot for
  // the first would be guessing at a block this build cannot describe.
  if (!declared || declared.length === 0) return undefined;
  const slots: Record<string, BlockNode[]> = {};
  for (const spec of declared) slots[spec.name] = [];
  return slots;
}

export interface BlockRegistry {
  register(def: BlockDefinition): void;
  get(type: string): BlockDefinition | undefined;
  has(type: string): boolean;
  all(): BlockDefinition[];
}

export function createBlockRegistry(): BlockRegistry {
  const map = new Map<string, BlockDefinition>();
  return {
    register(def) {
      if (!def.type.includes("/")) {
        throw new Error(
          `Block type "${def.type}" must be namespaced, e.g. "core/${def.type}".`
        );
      }
      map.set(def.type, def);
    },
    get(type) {
      return map.get(type);
    },
    has(type) {
      return map.has(type);
    },
    all() {
      return [...map.values()];
    },
  };
}

/** The default registry that built-in `core/*` blocks register into on import. */
export const defaultBlockRegistry: BlockRegistry = createBlockRegistry();

/**
 * Declare a block and register it into the default registry. This is the Puck-style
 * declarative model: one definition drives validator + renderer + inspector.
 */
export function defineBlock<P>(def: BlockDefinition<P>): BlockDefinition<P> {
  defaultBlockRegistry.register(def as BlockDefinition);
  return def;
}

export interface ControlRegistry {
  register(control: ControlDef): void;
  get(type: string): ControlDef | undefined;
  all(): ControlDef[];
}

export function createControlRegistry(): ControlRegistry {
  const map = new Map<string, ControlDef>();
  return {
    register(control) {
      map.set(control.type, control);
    },
    get(type) {
      return map.get(type);
    },
    all() {
      return [...map.values()];
    },
  };
}

/** The default style/visual control registry (extensible — novel controls register here). */
export const defaultControlRegistry: ControlRegistry = createControlRegistry();

/**
 * A new instance of `type`, built from the definition the registry holds.
 *
 * The one place a block is brought into existence, because every field here is a promise the
 * definition makes about its own instances: the props its render reads, the style it ships with,
 * whether it opens a slot, and which version of the definition the instance was written by. A
 * second construction path fills in what its author happened to remember, and a block whose
 * `validate` needs an initialized prop is then created already unsaveable.
 *
 * An unregistered type still yields a node. Retaining what this build cannot describe is the
 * behaviour the whole document model is built on, and refusing here would make a repair that
 * reaches for a plugin block throw instead.
 */
export function createNode(
  type: string,
  registry: BlockRegistry,
  slots?: Record<string, BlockNode[]>
): BlockNode {
  const def = registry.get(type);
  const node = makeNode(
    type,
    def ? structuredClone(def.defaultProps) : {},
    def?.defaultStyle ? structuredClone(def.defaultStyle) : undefined,
    slots ?? initialSlots(type, registry)
  );
  // Stamped so a later migration can tell what wrote this instance. Without it every node reads
  // as version 1 and a block already past its first version re-runs migrations it never needed.
  return def ? { ...node, definitionVersion: def.version } : node;
}
