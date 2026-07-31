/**
 * The block manifest: what blocks this app has, as data.
 *
 * A block's definition lives in a plugin and is registered into a per-boot
 * registry, so the only way to ask "what blocks exist here?" has been to boot
 * the app and inspect it. That is not available to the things that most need
 * the answer — an editor build, a docs page, an agent writing a page document —
 * so the manifest states it as a file instead.
 *
 * Emitted from what plugins DECLARED (`contributes.declarations`), never from
 * the runtime registry, which is what lets generation stay a pure read of the
 * config: no plugin boots, no database opens. A block registered imperatively
 * from `init` is deliberately absent — it is not knowable without running the
 * plugin, and a manifest that were sometimes complete would be worse than one
 * whose rule is stated.
 *
 * Pure — no IO. The CLI writes the returned string.
 *
 * @module plugins/codegen/block-manifest
 */

import { join, dirname, basename } from "node:path";

import { NextlyError } from "../../errors";
import { collectDeclarations } from "../declarations";
import type { PluginDefinition } from "../plugin-context";

/** Filename of the generated block manifest. */
export const BLOCK_MANIFEST_FILENAME = "blocks.manifest.json";

/**
 * The consumer key block declarations are addressed to. Stated here rather than
 * imported so core carries no dependency on the page builder; it is the same
 * string that plugin publishes.
 */
export const PAGE_BUILDER_PLUGIN = "@nextlyhq/plugin-page-builder";

/**
 * The manifest's own version, bumped when its SHAPE changes.
 *
 * Separate from any block's `version`, which describes one block's props. A
 * reader checks this to know whether it understands the file at all.
 */
export const BLOCK_MANIFEST_VERSION = 1;

/** One block, as the manifest states it. */
export interface BlockManifestEntry {
  name: string;
  /** The block's own schema version, stamped onto every node of its type. */
  version: number;
  description: string;
  /** The plugin that declared it, so a reader knows what to install. */
  source: string;
  /** A worked instance, for previews and few-shot prompting. */
  example?: unknown;
  /** Prop schemas keyed by prop name. */
  props?: Record<string, unknown>;
  /** Style capabilities the block opts into. */
  supports?: Record<string, unknown>;
  /** Named child regions, for container blocks. */
  slots?: Record<string, unknown>;
}

/** The emitted document. */
export interface BlockManifest {
  manifestVersion: number;
  blocks: BlockManifestEntry[];
}

/**
 * Build the manifest from what plugins declared.
 *
 * Blocks are sorted by name so the emitted file is stable: an artifact that
 * reordered itself when plugins were reordered would show a diff on every
 * unrelated config edit, and a drift test could not tell a real change from a
 * shuffle.
 */
export function buildBlockManifest(
  plugins: readonly PluginDefinition[]
): BlockManifest {
  const blocks: BlockManifestEntry[] = [];
  // Nothing can register when the consumer is absent or disabled: a disabled
  // plugin runs no `init` and contributes no services, so the registry these
  // declarations would fill never exists. Listing them anyway would tell
  // tooling the app has blocks it cannot render.
  if (!isConsumerActive(plugins, PAGE_BUILDER_PLUGIN)) {
    return { manifestVersion: BLOCK_MANIFEST_VERSION, blocks };
  }
  // Where each name came from, so a collision names both plugins rather than
  // just the one that lost.
  const declaredBy = new Map<string, string>();
  for (const declaration of collectDeclarations(plugins, PAGE_BUILDER_PLUGIN)) {
    for (const block of declaredBlocks(declaration.value, declaration.source)) {
      const entry = toEntry(block, declaration.source);
      const firstSource = declaredBy.get(entry.name);
      if (firstSource !== undefined) {
        throw invalidDeclaration(
          `Block "${entry.name}" is declared by both "${firstSource}" and "${declaration.source}". Block names are global, so one of them has to change.`
        );
      }
      declaredBy.set(entry.name, declaration.source);
      blocks.push(entry);
    }
  }
  blocks.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { manifestVersion: BLOCK_MANIFEST_VERSION, blocks };
}

/**
 * Decide whether to emit a manifest and where. Returns `null` when no plugin
 * declared a block, so the caller writes no file rather than an empty one — an
 * empty manifest and an absent one mean the same thing, and only one of them
 * leaves a stale artifact behind when the last block plugin is removed.
 *
 * Placed beside the generated types so it ships with the app. Returning `null`
 * means "this app has no manifest", which the caller must express by REMOVING
 * any previous file: writing nothing would leave the last run's manifest on
 * disk advertising blocks the app no longer has.
 */
export function assertManifestPathIsFree(typesOutputPath: string): void {
  // The manifest sits beside the generated types, so a types file named
  // `blocks.manifest.json` resolves to the same path. With blocks declared the
  // manifest is written and then overwritten by the types; with none, the
  // cleanup deletes the types output the user asked for. Both are silent, and
  // one destroys work, so the collision is refused before either happens.
  if (basename(typesOutputPath) === BLOCK_MANIFEST_FILENAME) {
    throw NextlyError.validation({
      errors: [
        {
          path: "typescript.outputFile",
          code: "OUTPUT_PATH_COLLISION",
          message: `The generated types output cannot be named "${BLOCK_MANIFEST_FILENAME}": the block manifest is written to that name in the same directory, and one would overwrite or delete the other.`,
        },
      ],
    });
  }
}

export function buildBlockManifestArtifact(
  plugins: readonly PluginDefinition[],
  typesOutputPath: string
): { path: string; code: string } | null {
  const manifest = buildBlockManifest(plugins);
  if (manifest.blocks.length === 0) return null;
  return {
    path: join(dirname(typesOutputPath), BLOCK_MANIFEST_FILENAME),
    // Trailing newline so the file is well-formed for line-based tooling and
    // does not show a no-newline marker in every diff.
    code: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

/**
 * A generation-time refusal, addressed at the declaration that caused it.
 *
 * Generation must not be more permissive than boot. Anything the page builder
 * would reject when it registers has to fail here too, or `generate:types`
 * reports success -- and may delete the previous manifest -- for a
 * configuration that cannot start.
 */
function invalidDeclaration(message: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: `contributes.declarations.${PAGE_BUILDER_PLUGIN}.blocks`,
        code: "INVALID_BLOCK_DECLARATION",
        message,
      },
    ],
  });
}

/** Whether the plugin these declarations are addressed to will actually run. */
function isConsumerActive(
  plugins: readonly PluginDefinition[],
  consumer: string
): boolean {
  const found = plugins.find(plugin => plugin.name === consumer);
  return found !== undefined && found.enabled !== false;
}

/**
 * The block list inside one declaration.
 *
 * A `blocks` value that is present but not an array is refused rather than read
 * as empty. The runtime refuses it too, so treating it as "no blocks" here
 * would emit — or delete — a manifest describing a configuration that cannot
 * boot, and the first sign of trouble would be a failing start rather than a
 * failing generate.
 *
 * A declaration carrying no `blocks` key at all is not an error: another
 * version of the page builder may read keys this one does not.
 */
function declaredBlocks(
  value: unknown,
  source: string
): Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const blocks = (value as { blocks?: unknown }).blocks;
  if (blocks === undefined) return [];
  if (!Array.isArray(blocks)) {
    throw invalidDeclaration(
      `Plugin "${source}" declared blocks for the page builder as ${typeof blocks}; it must be an array of block definitions.`
    );
  }
  return blocks.map((block, index) => {
    // Filtering a bad element would drop a block the author meant to ship and
    // leave the manifest quietly short; the engine rejects the same element at
    // registration, so it fails here instead.
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      throw invalidDeclaration(
        `Plugin "${source}" declared a block at index ${index} that is ${describeKind(block)}; each entry must be a block definition.`
      );
    }
    const definition = block as Record<string, unknown>;
    if (typeof definition.name !== "string" || definition.name.length === 0) {
      throw invalidDeclaration(
        `Plugin "${source}" declared a block at index ${index} with no name.`
      );
    }
    if (typeof definition.version !== "number") {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" has no numeric version.`
      );
    }
    if (
      typeof definition.description !== "string" ||
      definition.description.length === 0
    ) {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" has no description. Every block needs one, for the palette, the docs and the manifest.`
      );
    }
    // A worked instance is what makes a block usable by something that has
    // never seen it: a preview renders it, and a generator few-shots from it.
    // The block API requires one, so a declaration without it describes a block
    // that could not have been built with `defineBlock`.
    if (
      typeof definition.example !== "object" ||
      definition.example === null ||
      Array.isArray(definition.example)
    ) {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" has no example. Every block needs a worked instance, for previews and for generating content.`
      );
    }
    return definition;
  });
}

/**
 * One declared block as a manifest entry.
 *
 * `render` and `resolve` are functions and are deliberately dropped: they
 * cannot be serialized, and a manifest is a description of what a block accepts
 * rather than of how it draws. Everything kept is data the declaration already
 * holds, copied rather than reshaped, so the file and the definition cannot
 * drift into different vocabularies.
 */
function toEntry(
  block: Record<string, unknown>,
  source: string
): BlockManifestEntry {
  const entry: BlockManifestEntry = {
    name: typeof block.name === "string" ? block.name : "",
    version: typeof block.version === "number" ? block.version : 0,
    description: typeof block.description === "string" ? block.description : "",
    source,
  };
  if (block.example !== undefined) entry.example = block.example;
  if (isRecord(block.props)) entry.props = block.props;
  if (isRecord(block.supports)) entry.supports = block.supports;
  if (isRecord(block.slots)) entry.slots = block.slots;
  return entry;
}

/** A short, safe description of a bad value, for an error a human reads. */
function describeKind(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
