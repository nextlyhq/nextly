/**
 * Open, string-keyed registries — the single extensibility seam (spec §7).
 *
 * The validator, renderer, and inspector all read the SAME block registry, so a
 * third party adds a block with one `registerBlock()` call and no core edit.
 * Types are namespaced (`core/heading`, `acme/pricing-table`) to stay collision-free.
 */
import type { BlockDefinition, ControlDef } from "./types";

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
