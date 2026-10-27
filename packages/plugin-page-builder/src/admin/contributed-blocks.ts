/**
 * The blocks other plugins contribute, as the BROWSER's registry receives
 * them.
 *
 * A plugin declares its blocks for the page builder in
 * `contributes.declarations`, and the server registers them at boot. That
 * registration happens in the server process; the engine's registry the admin
 * bundle reads is a different copy and starts empty, so a declared block was
 * valid on save and absent from the editor. The browser needs the definitions
 * themselves, render functions included, and only the app's bundler can load
 * plugin code into the admin.
 *
 * So a plugin also names an `editorEntry`: a component path to a module that
 * exports the same definitions (`{ blocks, supports }`). The app's generated
 * component map imports that module, and each block's own inspector
 * (`editor.component`), and hands them here through
 * {@link registerBlockEditorModules}. The editor then registers the entries
 * beside the core blocks when it mounts ({@link ensureEditorBlocksRegistered}).
 *
 * Only DECLARED blocks can arrive this way. A block registered from a plugin's
 * `init` exists on the server alone: nothing can name its module before the
 * plugin runs, which is why the server warns about one in development.
 *
 * @module @nextlyhq/plugin-page-builder/admin/contributed-blocks
 */
import {
  allBlocks,
  allSupports,
  clearBlocks,
  getBlock,
  getBlockSource,
  getSupport,
  registerBlocks,
  registerSupport,
  type AnyBlockDefinition,
  type BlockInspectorProps,
  type SupportDefinition,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { ComponentType } from "react";

import type { PageBuilderEditorEntry } from "../blocks/declared-blocks";

import { PLUGIN_SOURCE } from "./editor/stored-document";

/** What the generated component map hands over. */
export interface BlockEditorModules {
  /** Each declared `editorEntry`'s export, keyed by its component path. */
  readonly entries?: Readonly<Record<string, unknown>>;
  /** Each declared block's own inspector (`editor.component`), by its path. */
  readonly components?: Readonly<Record<string, unknown>>;
}

/**
 * What has been handed over, by path.
 *
 * Module state, as the component registry beside it is, because the map
 * registers once when the admin loads and the editor reads at every mount. A
 * later call for the same path replaces the module, which is what a hot
 * reload of the map does.
 */
const entries = new Map<string, unknown>();
const components = new Map<string, ComponentType<BlockInspectorProps>>();

/**
 * Hand the editor the block modules the site's plugins declared.
 *
 * Called by the generated component map (`nextly generate:types`), never by
 * hand: the map is what knows every declared path and imports each module
 * statically, which is the only way plugin code reaches a bundled admin.
 *
 * @experimental The page builder's contribution contract is still settling.
 */
export function registerBlockEditorModules(modules: BlockEditorModules): void {
  for (const [path, value] of Object.entries(modules.entries ?? {})) {
    entries.set(path, value);
  }
  for (const [path, value] of Object.entries(modules.components ?? {})) {
    if (isComponent(value)) components.set(path, value);
    else {
      console.warn(
        `[page-builder] "${path}" is declared as a block's inspector, but it ` +
          `exports ${describe(value)}, not a React component. The block keeps ` +
          `its generated controls.`
      );
    }
  }
}

/**
 * A block's own inspector, by the path its definition names, or `undefined`
 * when nothing registered it, in which case the editor keeps the generated
 * controls.
 */
export function contributedInspector(
  path: string
): ComponentType<BlockInspectorProps> | undefined {
  return components.get(path);
}

/** The names of the core library, which a contributed block may not take. */
const CORE_NAMES = new Set(coreBlocks.map(block => block.name));

/** Every block and support the entries carry, with the path each came from. */
interface ReadEntries {
  readonly supports: {
    readonly path: string;
    readonly support: SupportDefinition;
  }[];
  readonly blocks: {
    readonly path: string;
    readonly blocks: AnyBlockDefinition[];
  }[];
}

/**
 * The entries as the editor can use them: well-formed ones read, malformed
 * ones named once and skipped.
 */
function readEntries(): ReadEntries {
  const read: ReadEntries = { supports: [], blocks: [] };
  for (const [path, value] of entries) {
    if (!isEntry(value)) {
      warnOnce(
        `entry:${path}`,
        `[page-builder] The editor entry "${path}" exports ${describe(value)}. ` +
          `It must export { blocks, supports }, the definitions its plugin ` +
          `declares; its blocks are not offered in the editor.`
      );
      continue;
    }
    for (const support of value.supports ?? []) {
      if (isSupport(support)) read.supports.push({ path, support });
      else malformed(path, "support", support);
    }
    const blocks = (value.blocks ?? []).filter(block => {
      if (isRecord(block)) return true;
      malformed(path, "block", block);
      return false;
    });
    read.blocks.push({ path, blocks });
  }
  return read;
}

/**
 * Name an element of an entry that is not a definition, once per entry and
 * kind, and leave it out.
 *
 * The entry's arrays are read element by element because each element is the
 * plugin's own JavaScript, typed by nothing at runtime: one `null` among the
 * definitions would otherwise throw on its first property read, before any
 * refusal could catch it, and take the editor down with it.
 */
function malformed(
  path: string,
  kind: "block" | "support",
  value: unknown
): void {
  warnOnce(
    `${kind}-shape:${path}`,
    `[page-builder] The editor entry "${path}" lists ${describe(value)} among ` +
      `its ${kind === "block" ? "blocks" : "supports"}, which is not a ` +
      `${kind} definition. It is skipped.`
  );
}

/** Whether a value is a plain object a definition could be. */
function isRecord(value: unknown): value is AnyBlockDefinition {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value has a support's one required field. */
function isSupport(value: unknown): value is SupportDefinition {
  return (
    isRecord(value) && typeof (value as { key?: unknown }).key === "string"
  );
}

/**
 * Put the core blocks and every contributed block in the BROWSER's registry,
 * the contributed supports before any block that may use one.
 *
 * Everything the editor asks flows through that registry: the Add panel and
 * its search, the inspector, the nesting rule and the renderer. Registering
 * once, here, rather than handing each of those its own list is what keeps
 * them agreeing. An empty registry fails SILENTLY in the permissive
 * direction, because a block nobody has heard of declares no parent and is
 * therefore allowed everywhere.
 *
 * Idempotent, because it runs on every mount and every hot reload: a name or
 * support already registered by the same source, as the same object, is
 * skipped. An entry a hot reload replaced is registered again from its new
 * definitions, so an edited block shows without reloading the page. A contributed
 * block taking a core block's name is refused, with a warning naming both, and
 * the core block keeps the name: the core namespace is this package's, and a
 * collision must not replace what every stored page means by that name.
 * Nothing here throws. A plugin's mistake costs that plugin's blocks, never
 * the editor.
 */
export function ensureEditorBlocksRegistered(): void {
  const read = readEntries();
  const replaced = replacedEntries(read);
  if (replaced.size > 0) rebuildWithout(replaced, read);
  const missingCore = coreBlocks.filter(
    block => getBlock(block.name) === undefined
  );
  if (missingCore.length > 0) {
    registerBlocks(missingCore, { source: PLUGIN_SOURCE });
  }
  for (const { path, support } of read.supports)
    registerSupportOnce(path, support);
  for (const { path, blocks } of read.blocks) registerEntryBlocks(path, blocks);
}

/**
 * The entries whose registered blocks or supports are no longer the ones they
 * export: a hot reload handed over a new module for the same path, with new
 * definitions, or with one taken out.
 *
 * Compared by identity, which is what separates a remount (the same objects,
 * nothing to do) from a replacement.
 */
function replacedEntries(read: ReadEntries): Set<string> {
  const replaced = new Set<string>();
  for (const { path, blocks } of read.blocks) {
    const exported = new Set<unknown>(blocks);
    for (const registered of allBlocks()) {
      if (getBlockSource(registered.name) !== path) continue;
      if (!exported.has(registered)) replaced.add(path);
    }
  }
  // The supports each entry registered, judged the same way. An entry whose
  // blocks are unchanged may still have changed a support another plugin's
  // blocks rely on, and only the support's identity says so.
  const declared = new Set<unknown>(read.supports.map(each => each.support));
  for (const [key, { path, support }] of supportSources) {
    if (getSupport(key) !== support) continue;
    if (!declared.has(support)) replaced.add(path);
  }
  return replaced;
}

/**
 * Which entry registered each support, by key: the engine records no source
 * for a support, and a hot reload has to know whose supports went stale.
 */
const supportSources = new Map<
  string,
  { readonly path: string; readonly support: SupportDefinition }
>();

/**
 * Empty the registry and put back everything except the replaced entries'
 * blocks and supports, which the caller then registers from their new
 * definitions.
 *
 * Rebuilt rather than patched because the engine's registry refuses a second
 * definition for a name and offers no removal: clearing is its one way to let
 * a name go. Everything else is kept, with its own source, including blocks a
 * host registered in the browser itself. The supports go back first, the
 * entries' own included, since a kept block may use one.
 */
function rebuildWithout(
  replaced: ReadonlySet<string>,
  read: ReadEntries
): void {
  const keptSupports = allSupports().filter(
    support => !ownedByReplaced(support, replaced)
  );
  const keptBlocks = blocksBySource(replaced);
  clearBlocks();
  const declared = new Set(read.supports.map(({ support }) => support.key));
  for (const support of keptSupports) {
    // The built-ins are back already, and an entry's own is registered from
    // its current export just below.
    if (getSupport(support.key) === undefined && !declared.has(support.key)) {
      registerSupport(support);
    }
  }
  for (const { path, support } of read.supports) {
    registerSupportOnce(path, support);
  }
  for (const [source, definitions] of keptBlocks) {
    try {
      registerBlocks(definitions, { source });
    } catch (error) {
      warnOnce(`rebuild:${source}`, refusal(source, error));
    }
  }
}

/**
 * Whether a registered support belongs to a replaced entry, which takes it
 * along: its new export declares whichever it still has.
 */
function ownedByReplaced(
  support: SupportDefinition,
  replaced: ReadonlySet<string>
): boolean {
  const source = supportSources.get(support.key);
  return source?.support === support && replaced.has(source.path);
}

/** Every registered block except the replaced entries', grouped by source. */
function blocksBySource(
  replaced: ReadonlySet<string>
): Map<string, AnyBlockDefinition[]> {
  const kept = new Map<string, AnyBlockDefinition[]>();
  for (const definition of allBlocks()) {
    const source = getBlockSource(definition.name);
    if (source === undefined || replaced.has(source)) continue;
    kept.set(source, [...(kept.get(source) ?? []), definition]);
  }
  return kept;
}

/** One contributed support, unless it is already known. */
function registerSupportOnce(path: string, support: SupportDefinition): void {
  const known = getSupport(support.key);
  if (known === support) return;
  if (known !== undefined) {
    warnOnce(
      `support:${support.key}`,
      `[page-builder] "${path}" declares the support "${support.key}", which ` +
        `is already registered. The first registration is kept.`
    );
    return;
  }
  try {
    registerSupport(support);
    supportSources.set(support.key, { path, support });
  } catch (error) {
    warnOnce(`support:${support.key}`, refusal(path, error));
  }
}

/** One entry's blocks, less any already registered or colliding. */
function registerEntryBlocks(
  path: string,
  blocks: readonly AnyBlockDefinition[]
): void {
  const fresh: AnyBlockDefinition[] = [];
  for (const block of blocks) {
    const name: unknown = (block as { name?: unknown }).name;
    if (typeof name !== "string") {
      fresh.push(block); // left for registration to refuse, by its own rule
      continue;
    }
    const source = getBlockSource(name);
    if (source === undefined) {
      fresh.push(block);
    } else if (source === path) {
      continue; // registered on an earlier mount
    } else if (CORE_NAMES.has(name) && source === PLUGIN_SOURCE) {
      warnOnce(
        `block:${name}`,
        `[page-builder] "${path}" contributes a block named "${name}", which ` +
          `is a core block's name. The core block is kept; rename the ` +
          `contributed one.`
      );
    } else {
      warnOnce(
        `block:${name}`,
        `[page-builder] "${path}" contributes a block named "${name}", which ` +
          `"${source}" already registered. The first is kept.`
      );
    }
  }
  if (fresh.length === 0) return;
  try {
    registerBlocks(fresh, { source: path });
  } catch (error) {
    warnOnce(`blocks:${path}`, refusal(path, error));
  }
}

/**
 * A contributed block's definition by name, from the entries themselves, for
 * a reader that cannot rely on the registry having been filled: the entry
 * screen's miniature renders before the editor ever mounts.
 */
export function contributedBlock(name: string): AnyBlockDefinition | undefined {
  for (const value of entries.values()) {
    if (!isEntry(value)) continue;
    // Read defensively, as the registration above is: an element may be
    // anything the plugin's JavaScript put there.
    const found = value.blocks?.find(
      block => isRecord(block) && block.name === name
    );
    if (found !== undefined && !CORE_NAMES.has(name)) return found;
  }
  return undefined;
}

/** Whether a value has the shape an editor entry exports. */
function isEntry(value: unknown): value is PageBuilderEditorEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const { blocks, supports } = value as Record<string, unknown>;
  return (
    (blocks === undefined || Array.isArray(blocks)) &&
    (supports === undefined || Array.isArray(supports))
  );
}

/**
 * Whether a value can be rendered as a component: a function, or one of the
 * objects `memo` and `forwardRef` return.
 */
function isComponent(
  value: unknown
): value is ComponentType<BlockInspectorProps> {
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in value;
}

/** A short account of a value, for a warning a person reads. */
function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** The sentence for a registration the engine refused. */
function refusal(path: string, error: unknown): string {
  return (
    `[page-builder] The blocks from "${path}" could not be registered in the ` +
    `editor: ${error instanceof Error ? error.message : String(error)}`
  );
}

/** Warnings already given, so a remount does not repeat them. */
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}
