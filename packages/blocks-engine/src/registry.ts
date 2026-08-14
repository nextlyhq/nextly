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
import { COMPONENT_INSTANCE_TYPE } from "./document";
import type { MigrationSource } from "./migration";
import { MAX_MIGRATION_STEPS, findMigrationGaps } from "./migration";
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

/** A block name is a namespaced slug, e.g. "core/heading". */
const BLOCK_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Whether a string is a well-formed block name: two lowercase slug segments around one `/`.
 *
 * Exported so every registration path asks the SAME question. There were three gates checking
 * block names by the time this was written and one of them tested `includes("/")`, which accepts
 * `core/columns/` — a name no real block can have, so a `parent` naming it matches nothing and
 * every instance of the declaring block becomes unsaveable with the declaration looking correct.
 */
export function isBlockName(value: unknown): value is string {
  return typeof value === "string" && BLOCK_NAME_RE.test(value);
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

/** A key/value object — not null, not an array, not a function. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (typeof def.name !== "string" || !BLOCK_NAME_RE.test(def.name)) {
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
      const allow = (spec as { allow?: unknown }).allow;
      if (allow === undefined) continue;
      // A namespace wildcard is permitted here and is not a block NAME, so this cannot reuse
      // `isBlockName`: `core/*` names a set rather than a block.
      const wellFormed =
        Array.isArray(allow) &&
        allow.every(
          entry =>
            typeof entry === "string" &&
            (isBlockName(entry) ||
              (entry.endsWith("/*") && isBlockName(`${entry.slice(0, -2)}/x`)))
        );
      if (!wellFormed) {
        fail(
          "NEXTLY_BLOCK_INVALID",
          `block "${def.name}" slot "${slotName}" allow must be an array of block names like "core/heading" or namespaces like "core/*".`
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
      def.parent.some(
        name => typeof name !== "string" || !BLOCK_NAME_RE.test(name)
      )
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
