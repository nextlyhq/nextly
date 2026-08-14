/**
 * Open, string-keyed registries — the single extensibility seam (spec §7).
 *
 * The validator, renderer, and inspector all read the SAME block registry, so a
 * third party adds a block with one `registerBlock()` call and no core edit.
 * Types are namespaced (`core/heading`, `acme/pricing-table`) to stay collision-free.
 */
import { isBlockName } from "@nextlyhq/blocks-engine";

import { slotsOf } from "./block-structure";
import { isAllowList } from "./slot-allow";
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

/** The declared slot map with a caller's own entries laid over it. */
function mergeSlots(
  declared: Record<string, BlockNode[]> | undefined,
  given: Record<string, BlockNode[]> | undefined
): Record<string, BlockNode[]> | undefined {
  if (!given) return declared;
  if (!declared) return given;
  return { ...declared, ...given };
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
      // `parent` restricts where instances may sit, so a malformed value does not degrade — it
      // FORBIDS. A bare string is the shape to fear: it is iterable, so a reader spreading it
      // produces one-character names and every real placement is refused, and `validate` calls
      // `.join()` on it and throws instead of returning a message. An empty array permits no
      // placement at all, so no document holding the block can ever save.
      //
      // Checked here as well as in the engine's own gate because this registry is a SEPARATE
      // door: the package root still exports `defineBlock`, and a JavaScript consumer reaches it
      // without passing the engine at all.
      if (def.parent !== undefined) {
        const named =
          Array.isArray(def.parent) &&
          def.parent.length > 0 &&
          // The CANONICAL predicate, imported rather than restated. A local `includes("/")`
          // accepted `core/columns/`, which no real block can be called — so the parent matched
          // nothing, every instance became unsaveable, and the declaration looked correct.
          def.parent.every(isBlockName);
        if (!named) {
          throw new Error(
            `Block type "${def.type}" parent must be a non-empty array of namespaced block names like "core/columns".`
          );
        }
      }
      // A slot's `allowedBlocks` is read as STRUCTURE by every nesting decision, and a malformed
      // one does not degrade: a reader calling `.some()` on the string `"core/heading"` throws a
      // TypeError at the first insertion or document validation, a long way from the declaration
      // that caused it and naming neither. The same door as `parent` above — the package root
      // exports `defineBlock`, so a JavaScript consumer reaches this registry without ever
      // passing the engine's own gate, which is the only place this was checked.
      for (const spec of def.slots ?? []) {
        if (
          spec.allowedBlocks !== undefined &&
          !isAllowList(spec.allowedBlocks)
        ) {
          throw new Error(
            `Block type "${def.type}" slot "${spec.name}" allowedBlocks must be an array of namespaced block names like "core/heading" or namespaces like "core/*".`
          );
        }
      }
      // Defaults are CLONED for every instance, so a value `structuredClone` cannot copy — a
      // function, a class instance, a DOM node — does not fail here, it fails later at
      // `createNode`, as a `DataCloneError` raised while an author was inserting a block or
      // taking a repair. That error names neither the block nor the prop.
      //
      // Cloned once at registration instead, which is where a definition's own promises are
      // checked and where the failure can name the block making them. The cost is one clone per
      // block per boot, against a clone per instance either way.
      for (const [field, value] of [
        ["defaultProps", def.defaultProps],
        ["defaultStyle", def.defaultStyle],
      ] as const) {
        if (value === undefined) continue;
        try {
          structuredClone(value);
        } catch {
          throw new Error(
            `Block type "${def.type}" has a ${field} value that cannot be copied. Every instance is built by cloning it, so it must hold only JSON-like data.`
          );
        }
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
    // MERGED over the declared map, not substituted for it. A caller wrapping a child supplies
    // only the slot it is placing into, and a wrapper that declares more than one would otherwise
    // lose the rest — the canvas builds its regions from STORED keys, so a declared region with no
    // key is one an author cannot see or drag into.
    mergeSlots(initialSlots(type, registry), slots)
  );
  // Stamped so a later migration can tell what wrote this instance. Without it every node reads
  // as version 1 and a block already past its first version re-runs migrations it never needed.
  return def ? { ...node, definitionVersion: def.version } : node;
}
