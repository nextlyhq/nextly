/**
 * The block registry: the single place that knows which block types exist in a
 * running app, and the gate every definition passes through.
 *
 * `globalThis`-pinned and cleared per boot (clear-and-rebuild), so a dev-server
 * hot reload re-registering the same blocks never collides with itself, while a
 * genuine duplicate name inside one boot still fails loudly.
 *
 * Registration is where definition rules are enforced — a malformed block fails
 * at boot with a named error rather than producing broken pages later.
 */
import type { AnyBlockDefinition, BlockSupports } from "./block";
import { COMPONENT_INSTANCE_TYPE, isBlockType, isPartName } from "./document";
import type { MigrationSource } from "./migration";
import { MAX_MIGRATION_STEPS, findMigrationGaps } from "./migration";
import type { NestingSource } from "./nesting";
import { isPlainRecord } from "./plain-record";
import { styleSupportDefinitions } from "./style/supports-map";
import type { BlockTypeLookup } from "./validation";

/**
 * A style capability blocks may opt into.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export interface SupportDefinition {
  /** The key blocks use inside `supports`, e.g. "spacing". */
  key: string;
  /** Human label for editor grouping. */
  label?: string;
  /** Sub-flags this support recognizes, e.g. ["padding", "margin"]. */
  flags?: string[];
}

/** Where a set of blocks came from, for collision messages. */
export interface RegisterOptions {
  /** e.g. a plugin name; surfaced when two sources claim the same block name. */
  source?: string;
}

interface RegistryEntry {
  definition: AnyBlockDefinition;
  source: string;
}

/**
 * Style capabilities available to every app before any extension.
 *
 * The style groups are derived from the style-property catalog rather than
 * listed again here: a support key and a catalog group are the same thing, and
 * a support's sub-flags are exactly the flags its group's properties declare.
 * Deriving them means adding a property, a group, or a flag extends what blocks
 * may declare in the same edit, with no second list that can fall behind.
 */
const BUILT_IN_SUPPORTS: SupportDefinition[] = [
  ...styleSupportDefinitions(),
  // Custom CSS gates a capability rather than a set of style properties, so it
  // has no catalog group and is declared directly.
  { key: "customCss", label: "Custom CSS" },
];

const globalForBlocks = globalThis as unknown as {
  __nextly_blocks?: Map<string, RegistryEntry>;
  __nextly_blockSupports?: Map<string, SupportDefinition>;
};

function blockStore(): Map<string, RegistryEntry> {
  globalForBlocks.__nextly_blocks ??= new Map();
  return globalForBlocks.__nextly_blocks;
}

function supportStore(): Map<string, SupportDefinition> {
  if (!globalForBlocks.__nextly_blockSupports) {
    const map = new Map<string, SupportDefinition>();
    // Seed here rather than at module load so a cleared store always comes
    // back with the built-ins present.
    for (const support of BUILT_IN_SUPPORTS) map.set(support.key, support);
    globalForBlocks.__nextly_blockSupports = map;
  }
  return globalForBlocks.__nextly_blockSupports;
}

/**
 * Whether a string is a well-formed block name: two lowercase slug segments around one `/`.
 *
 * Exported so every registration path asks the SAME question. There were three gates checking
 * block names by the time this was written and one of them tested `includes("/")`, which accepts
 * `core/columns/` — a name no real block can have, so a `parent` naming it matches nothing and
 * every instance of the declaring block becomes unsaveable with the declaration looking correct.
 */
export function isBlockName(value: unknown): value is string {
  return typeof value === "string" && isBlockType(value);
}

/**
 * Whether every index of an array is an OWN element rather than a hole.
 *
 * An explicit index loop, because every callback-based array method skips
 * holes — `every`, `some`, `filter` and `forEach` alike — so a predicate
 * written with one cannot observe the thing it is being asked about. That is
 * not a detail of this check: it is the reason a sparse array survives
 * validation and then reaches a `for...of`, which does NOT skip, and yields
 * `undefined`.
 */
function hasNoHoles(values: readonly unknown[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) return false;
  }
  return true;
}

/**
 * Whether a slot name can be stored and read back as its own key.
 *
 * The rejected names are the ones `Object.prototype` OWNS. Reading
 * `slots[name]` for one of those answers with an inherited member instead of
 * `undefined`, and assigning it — which a slot-map rebuild does — sets the
 * prototype rather than creating an own property, dropping that whole child
 * list. Asked of `Object.prototype` rather than matched against a written
 * list, because the list everyone writes is `__proto__` and `constructor`
 * while `toString` behaves identically.
 *
 * Exported for the same reason {@link isBlockName} is: a slot name is judged
 * at a block's DECLARATION and again on every op that carries one, and those
 * two gates answering differently is how a name a position could not use gets
 * in through a subtree.
 */
export function isUsableSlotName(name: string): boolean {
  return !Object.prototype.hasOwnProperty.call(Object.prototype, name);
}

/**
 * The highest version a block may declare. Migration chains a bounded number of
 * steps, so a version above this could never carry its oldest stored nodes
 * forward — registration refuses it rather than promise an upgrade path that
 * does not exist.
 */
export const MAX_BLOCK_VERSION = 1 + MAX_MIGRATION_STEPS;

/**
 * Names the engine owns. They identify nodes resolved by the engine's own
 * machinery rather than by a registered block, so a block may not claim one.
 */
const RESERVED_BLOCK_NAMES = new Set<string>([COMPONENT_INSTANCE_TYPE]);

/** A support key is a single lowerCamel/slug token. */
const SUPPORT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

/**
 * How a malformed support value is named in a boot error. The kind rather than
 * the value: what is wrong with `{ padding: "yes" }` is that it is a string
 * where a flag belongs, and printing the string alone reads like a value the
 * flag might have accepted.
 */
function describeSupportValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/**
 * Check one definition against the rules registration enforces. Split out so a
 * caller can validate a definition without committing it to the registry.
 */
function assertValidDefinition(def: AnyBlockDefinition): void {
  if (typeof def.name !== "string" || !isBlockType(def.name)) {
    fail(
      "NEXTLY_BLOCK_INVALID",
      `block name "${String(def.name)}" must be a namespaced slug like "core/heading".`
    );
  }
  if (RESERVED_BLOCK_NAMES.has(def.name)) {
    fail(
      "NEXTLY_BLOCK_RESERVED_NAME",
      `block name "${def.name}" is reserved by the engine and cannot be registered.`
    );
  }
  if (
    !Number.isInteger(def.version) ||
    def.version < 1 ||
    // A version further above 1 than migration will chain cannot have an
    // upgrade path for its oldest stored nodes, so accepting it here would
    // promise something migration cannot honor.
    def.version > MAX_BLOCK_VERSION
  ) {
    fail(
      "NEXTLY_BLOCK_INVALID",
      `block "${def.name}" must declare an integer version between 1 and ${MAX_BLOCK_VERSION}.`
    );
  }
  // description and example are required so generated documentation, palette
  // entries, and previews are never empty for a registered block.
  if (typeof def.description !== "string" || def.description.trim() === "") {
    fail(
      "NEXTLY_BLOCK_INVALID",
      `block "${def.name}" must declare a non-empty description.`
    );
  }
  if (
    typeof def.example !== "object" ||
    def.example === null ||
    // Props must be a plain record: a stored node's props are a key/value map,
    // and document validation rejects an array, so an array-shaped example
    // could never become a valid node.
    !isPlainRecord(def.example.props)
  ) {
    fail(
      "NEXTLY_BLOCK_INVALID",
      `block "${def.name}" must declare an example whose props are a plain object.`
    );
  }
  if (def.defaultProps !== undefined && !isPlainRecord(def.defaultProps)) {
    fail(
      "NEXTLY_BLOCK_INVALID",
      `block "${def.name}" defaultProps must be a plain object.`
    );
  }
  // A slot's `allow` is read by every nesting decision, and a malformed one does not degrade — a
  // reader spreading `allow: 42` throws `TypeError: spec.allow is not iterable` at the first
  // validation, repair or insertion lookup, a long way from the definition that caused it and
  // naming neither. Checked here for the same reason `parent` is: the type rejects it at the
  // authoring site, and definitions also arrive from JavaScript plugins and from JSON.
  // Same reason as `parts` and `slots` below: the TYPE rejects a bad
  // declaration at the authoring site, and definitions also arrive from
  // JavaScript plugins and from JSON, where nothing has. An empty or missing
  // reason is refused rather than defaulted, because the whole value of this
  // field is the sentence — a block that declares interactivity without saying
  // what it is for records the cost and hides the justification.
  if (def.island !== undefined) {
    if (!isPlainRecord(def.island)) {
      fail(
        "NEXTLY_BLOCK_INVALID",
        `block "${def.name}" island must be a plain object stating why it needs JavaScript.`
      );
    }
    const reason = (def.island as { reason?: unknown }).reason;
    if (typeof reason !== "string" || reason.trim() === "") {
      fail(
        "NEXTLY_BLOCK_INVALID",
        `block "${def.name}" island must state a non-empty reason for needing JavaScript.`
      );
    }
  }
  // Checked here for the reason `slots` below is: the TYPE rejects a bad
  // declaration at the authoring site, and definitions also arrive from
  // JavaScript plugins and from JSON, where nothing has. Unchecked, a `null`
  // reaches the compile context and `Object.keys` throws during page-style
  // resolution — a long way from the definition that caused it, naming neither
  // the block nor the field, and at render time rather than at boot.
  if (def.parts !== undefined) {
    if (!isPlainRecord(def.parts)) {
      fail(
        "NEXTLY_BLOCK_INVALID",
        `block "${def.name}" parts must be a plain object keyed by part name.`
      );
    }
    for (const [partName, spec] of Object.entries(def.parts)) {
      // Bound before the check rather than read after it. `isPartName` narrows
      // a `string` to `never` on its false branch, so the failure message —
      // the one place the name has to be readable — would hold a value the
      // template cannot render.
      const named = `${partName}`;
      // The SAME predicate the compiler emits against, so the two gates cannot
      // answer differently: a name accepted here and refused there registers a
      // block whose part is silently never styled.
      if (!isPartName(partName)) {
        fail(
          "NEXTLY_BLOCK_INVALID",
          `block "${def.name}" part "${named}" must be a lowercase slug such as "caption", with no doubled dash.`
        );
      }
      if (!isPlainRecord(spec)) {
        fail(
          "NEXTLY_BLOCK_INVALID",
          `block "${def.name}" part "${named}" must be a plain object.`
        );
      }
    }
  }
  if (def.slots !== undefined) {
    if (!isPlainRecord(def.slots)) {
      fail(
        "NEXTLY_BLOCK_INVALID",
        `block "${def.name}" slots must be a plain object keyed by slot name.`
      );
    }
    for (const [slotName, spec] of Object.entries(def.slots)) {
      if (!isPlainRecord(spec)) {
        fail(
          "NEXTLY_BLOCK_INVALID",
          `block "${def.name}" slot "${slotName}" must be a plain object.`
        );
      }
      // A slot whose NAME cannot hold children is not a slot. The op layer
      // refuses any node carrying one, so a block declaring it offers a
      // palette row whose insert is always refused — and, where the slot
      // declares starting children, that refusal is silent: the row is
      // clicked and nothing appears.
      if (!isUsableSlotName(slotName)) {
        fail(
          "NEXTLY_BLOCK_INVALID",
          `block "${def.name}" slot "${slotName}" is a name Object.prototype owns, so it cannot be stored and read back. Rename the slot.`
        );
      }
      const allow = (spec as { allow?: unknown }).allow;
      // Each field is validated on its own rather than behind the other's
      // presence: a slot may declare `defaultBlock` and no `allow` at all,
      // which is the ordinary case, and a `continue` here would carry the
      // defaultBlock check past every one of them.
      if (allow !== undefined) {
        // A namespace wildcard is permitted here and is not a block NAME, so this cannot reuse
        // `isBlockName`: `core/*` names a set rather than a block.
        const wellFormed =
          Array.isArray(allow) &&
          allow.every(entry => {
            if (typeof entry !== "string") return false;
            // A wildcard is checked by substituting a placeholder segment, so the name grammar is
            // asked ONCE. Testing both forms as alternatives narrows the value to `never` on the
            // second branch, because the predicate is a type guard.
            const asName = entry.endsWith("/*")
              ? `${entry.slice(0, -2)}/x`
              : entry;
            return isBlockName(asName);
          });
        if (!wellFormed) {
          fail(
            "NEXTLY_BLOCK_INVALID",
            `block "${def.name}" slot "${slotName}" allow must be an array of block names like "core/heading" or namespaces like "core/*".`
          );
        }
      }
      // `defaultBlock` is read when an author INSERTS this block, which is the
      // worst place for a definition error to surface: a non-array is iterated
      // by the expansion and throws `TypeError: declared is not iterable` at
      // the click, naming neither the plugin nor the block that declared it.
      // Checked here for exactly the reason `allow` above is — the type rejects
      // it at the authoring site, and definitions also arrive from JavaScript
      // plugins and from JSON, where it does not.
      const defaultBlock = (spec as { defaultBlock?: unknown }).defaultBlock;
      if (defaultBlock === undefined) continue;
      // A HOLE is not a missing element to `Array.prototype.every`, which skips
      // it, while `for...of` visits it and yields `undefined` — so a sparse
      // array validated by the first is read by the second. Checked by index
      // because no callback-based method can see what it does not visit.
      const dense = Array.isArray(defaultBlock) && hasNoHoles(defaultBlock);
      const entriesWellFormed =
        dense &&
        defaultBlock.every(entry => {
          if (!isPlainRecord(entry)) return false;
          // Only `type` is required. `props` is optional and the child's own
          // defaults stand underneath it, so an entry naming just a type is the
          // ordinary case rather than an incomplete one.
          if (!isBlockName((entry as { type?: unknown }).type)) return false;
          const props = (entry as { props?: unknown }).props;
          return props === undefined || isPlainRecord(props);
        });
      if (!entriesWellFormed) {
        fail(
          "NEXTLY_BLOCK_INVALID",
          `block "${def.name}" slot "${slotName}" defaultBlock must be an array of entries like { type: "core/column" }, each with an optional plain-object props.`
        );
      }
    }
  }
  // `parent` restricts where instances may sit, so a malformed one does not
  // degrade — it forbids. A bare string is the shape to fear: it is iterable,
  // so a reader spreading it produces one-character "block names", every real
  // placement is refused as the wrong parent, and documents already using the
  // block stop saving. Nothing in the failure names this declaration.
  //
  // Checked at REGISTRATION rather than trusted from the type. TypeScript
  // rejects it at the authoring site, and the definitions that reach here also
  // arrive from JavaScript plugins, from JSON, and from builds where the types
  // were never run.
  if (def.parent !== undefined) {
    if (
      !Array.isArray(def.parent) ||
      def.parent.some(name => !isBlockType(name))
    ) {
      fail(
        "NEXTLY_BLOCK_INVALID",
        `block "${def.name}" parent must be an array of namespaced block names like "core/columns".`
      );
    }
    // An EMPTY list is refused for the same reason a malformed one is, and it is the easier of the
    // two to write by accident — a list built by filtering or by a config lookup that matched
    // nothing. Every reader treats a DEFINED array as a restriction, so an empty one permits no
    // placement at all: the block cannot be a root and cannot be a child, so no document holding
    // it can ever save, and nothing in that failure names this declaration.
    //
    // Omitting `parent` is how a block says it may sit anywhere. There is no arrangement an empty
    // list expresses that omission does not, so refusing it removes an unusable state rather than
    // a capability.
    if (def.parent.length === 0) {
      fail(
        "NEXTLY_BLOCK_INVALID",
        `block "${def.name}" declares an empty parent list, which permits no placement at all. Omit parent to allow the block anywhere.`
      );
    }
  }
  if (typeof def.render !== "function") {
    fail(
      "NEXTLY_BLOCK_INVALID",
      `block "${def.name}" must declare a render function.`
    );
  }

  // A version above 1 means stored nodes exist at older versions; every step
  // between must be covered or those nodes could never be upgraded.
  const gaps = findMigrationGaps(1, def.version, def.migrate);
  if (gaps.length > 0) {
    fail(
      "NEXTLY_BLOCK_MIGRATION_GAP",
      `block "${def.name}" is at version ${def.version} but has no migration from version${
        gaps.length > 1 ? "s" : ""
      } ${gaps.join(", ")}. Add the missing step(s) so stored blocks can be upgraded.`
    );
  }

  assertKnownSupports(def.name, def.supports);
}

function assertKnownSupports(
  blockName: string,
  supports: BlockSupports | undefined
): void {
  if (!supports) return;
  const known = supportStore();
  for (const [key, value] of Object.entries(supports)) {
    const support = known.get(key);
    if (!support) {
      fail(
        "NEXTLY_BLOCK_UNKNOWN_SUPPORT",
        `block "${blockName}" declares unknown support "${key}". Register it with registerSupport() first.`
      );
    }
    // The VALUE is checked, not only the key. A definition can arrive from
    // plain JavaScript or through the deliberately untyped declarations
    // channel, where the authoring types never ran, and the style mapping
    // enables a group only on exactly `true`: `{ spacing: { padding: "yes" } }`
    // would register without complaint and then style nothing at all, which is
    // the silent failure the key check already exists to prevent.
    if (typeof value !== "boolean" && !isPlainRecord(value)) {
      fail(
        "NEXTLY_BLOCK_INVALID",
        `block "${blockName}" declares support "${key}" as ${describeSupportValue(value)}. Use true, false, or an object of sub-flags.`
      );
    }
    if (!isPlainRecord(value)) continue;
    for (const [flag, flagValue] of Object.entries(value)) {
      // When a support enumerates its sub-flags, an unrecognized nested flag is
      // as much a typo as an unknown support key and would silently enable
      // nothing, so it is rejected the same way.
      if (support.flags && !support.flags.includes(flag)) {
        fail(
          "NEXTLY_BLOCK_UNKNOWN_SUPPORT",
          `block "${blockName}" declares unknown "${key}" flag "${flag}". Known flags: ${support.flags.join(", ")}.`
        );
      }
      if (typeof flagValue !== "boolean") {
        fail(
          "NEXTLY_BLOCK_INVALID",
          `block "${blockName}" declares "${key}" flag "${flag}" as ${describeSupportValue(flagValue)}. Use true or false.`
        );
      }
    }
  }
}

/**
 * Register block definitions. Called once per boot per source; a duplicate name
 * within a boot is a collision, naming both sources so the conflict is
 * actionable. Registration is all-or-nothing per call: the batch is validated
 * before anything is stored, so a bad definition cannot leave the registry
 * half-populated.
 */
export function registerBlocks(
  definitions: AnyBlockDefinition[],
  options: RegisterOptions = {}
): void {
  const source = options.source ?? "app";
  const map = blockStore();

  const seenInBatch = new Set<string>();
  for (const def of definitions) {
    assertValidDefinition(def);
    const existing = map.get(def.name);
    if (existing) {
      fail(
        "NEXTLY_BLOCK_COLLISION",
        `block "${def.name}" is already registered by "${existing.source}" and cannot be redefined by "${source}".`
      );
    }
    if (seenInBatch.has(def.name)) {
      fail(
        "NEXTLY_BLOCK_COLLISION",
        `block "${def.name}" is registered twice by "${source}".`
      );
    }
    seenInBatch.add(def.name);
  }

  for (const def of definitions) map.set(def.name, { definition: def, source });
}

/**
 * Add a style capability blocks may opt into. Third parties extend the support
 * vocabulary through this rather than by editing the engine.
 */
export function registerSupport(support: SupportDefinition): void {
  if (typeof support.key !== "string" || !SUPPORT_KEY_RE.test(support.key)) {
    fail(
      "NEXTLY_SUPPORT_INVALID",
      `support key "${String(support.key)}" must be a single alphanumeric token.`
    );
  }
  const map = supportStore();
  if (map.has(support.key)) {
    fail(
      "NEXTLY_SUPPORT_COLLISION",
      `support "${support.key}" is already registered.`
    );
  }
  map.set(support.key, support);
}

/** A registered block definition, or `undefined`. */
export function getBlock(name: string): AnyBlockDefinition | undefined {
  return blockStore().get(name)?.definition;
}

export function hasBlock(name: string): boolean {
  return blockStore().has(name);
}

/** Every registered block definition. */
export function allBlocks(): AnyBlockDefinition[] {
  return [...blockStore().values()].map(entry => entry.definition);
}

/** Which source registered a block, for diagnostics. */
export function getBlockSource(name: string): string | undefined {
  return blockStore().get(name)?.source;
}

export function getSupport(key: string): SupportDefinition | undefined {
  return supportStore().get(key);
}

export function allSupports(): SupportDefinition[] {
  return [...supportStore().values()];
}

/**
 * Drop every registered block and reset supports to the built-ins. Called at
 * the start of each boot (and by tests) so re-registration is idempotent.
 */
export function clearBlocks(): void {
  blockStore().clear();
  globalForBlocks.__nextly_blockSupports = undefined;
}

/**
 * The registry as the block-type lookup validation expects, so validating a
 * document against the running app's blocks needs no adapter at the call site.
 * Reads through to the live registry, so it stays correct across a re-register.
 */
export function registryLookup(): BlockTypeLookup {
  return { has: hasBlock };
}

/**
 * The registry as the nesting source, exposing each block's declared parents so
 * a document can be checked against where its blocks say they belong.
 *
 * A block the registry does not hold answers `undefined`, which the rule reads
 * as "declares no restriction" rather than as "unknown". That is deliberate: an
 * unregistered type is reported by the block-type lookup, and refusing its
 * placement as well would describe a missing registration as a layout mistake.
 *
 * Reads through to the live registry on every call, so it stays correct across a
 * re-register rather than capturing the definitions present when it was built.
 */
export function registryNestingSource(): NestingSource {
  return {
    parentsOf: name => getBlock(name)?.parent,
    // The parent's half, read from the container's own slot declaration. An
    // unregistered parent or an undeclared slot answers `undefined` for the same
    // reason `parentsOf` does: the missing registration is reported by the
    // block-type lookup, and refusing the placement as well would describe it as
    // a layout mistake.
    slotAllowOf: (parentType, slot) =>
      getBlock(parentType)?.slots?.[slot]?.allow,
  };
}

/**
 * The registry as the migration source, exposing each block's current version
 * and upgrade steps so a stored document can be brought up to date.
 */
export function registryMigrationSource(): MigrationSource {
  return {
    get: name => {
      const definition = getBlock(name);
      if (!definition) return undefined;
      return { version: definition.version, migrate: definition.migrate };
    },
  };
}
