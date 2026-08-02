/**
 * Blocks a plugin declares statically, rather than registering by hand.
 *
 * `blockRegistry(ctx).register(...)` inside `init` is a runtime call, so what a
 * plugin contributes is knowable only once that plugin has booted. Generation
 * never boots anything — it reads the config and writes its artifacts — so a
 * block registered that way cannot appear in an import map, a manifest, or
 * generated types.
 *
 * A declared block is plain data on the plugin definition, so both readers see
 * the same thing: generation reads it from the config, and boot registers from
 * it here. The imperative call remains for a plugin whose block list genuinely
 * depends on runtime state.
 *
 * @module blocks/declared-blocks
 */

import type {
  AnyBlockDefinition,
  SupportDefinition,
} from "@nextlyhq/blocks-engine";
import type { PluginDeclaration } from "@nextlyhq/plugin-sdk";

/** What a plugin puts under the page builder's key in `contributes.declarations`. */
export interface PageBuilderDeclaration {
  /** Block definitions to register at boot. */
  blocks?: AnyBlockDefinition[];
  /**
   * Custom supports the declared blocks opt into.
   *
   * Declared rather than registered from the contributing plugin's `init`,
   * because that runs AFTER the page builder's own, which is where declared
   * blocks are registered. A block opting into a support registered later than
   * itself is refused for naming a support nothing knows yet, and no ordering
   * of plugins fixes it: the two happen in different passes. Declared, both are
   * data the page builder reads at once, and it can register supports first.
   */
  supports?: SupportDefinition[];
}

/**
 * The blocks in one declaration, with the plugin that declared them.
 *
 * Returns nothing rather than throwing for a declaration that is not the shape
 * this plugin expects: another version of the page builder may understand keys
 * this one does not, and refusing to boot over an unread key would make every
 * such pairing fatal. A malformed `blocks` value is the one case worth naming,
 * because the author meant it for exactly this reader.
 */
export function blocksIn(declaration: PluginDeclaration): {
  blocks: AnyBlockDefinition[];
  error?: string;
} {
  const value = declaration.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { blocks: [] };
  }
  const declared = (value as PageBuilderDeclaration).blocks;
  if (declared === undefined) return { blocks: [] };
  if (!Array.isArray(declared)) {
    return {
      blocks: [],
      error:
        `"${declaration.source}" declared blocks for the page builder as ` +
        `${typeof declared}; it must be an array of block definitions.`,
    };
  }
  return { blocks: declared };
}

/**
 * The custom supports in one declaration, with the plugin that declared them.
 *
 * Returns nothing rather than throwing for a declaration that is not the shape
 * this plugin expects, for the same reason `blocksIn` does: another version of
 * the page builder may understand keys this one does not.
 */
export function supportsIn(declaration: PluginDeclaration): {
  supports: SupportDefinition[];
  error?: string;
} {
  const value = declaration.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { supports: [] };
  }
  const declared = (value as PageBuilderDeclaration).supports;
  if (declared === undefined) return { supports: [] };
  if (!Array.isArray(declared)) {
    return {
      supports: [],
      error:
        `"${declaration.source}" declared supports for the page builder as ` +
        `${typeof declared}; it must be an array of support definitions.`,
    };
  }
  return { supports: declared };
}
