/**
 * The seam another plugin contributes blocks through.
 *
 * Core deliberately knows nothing about blocks — it carries no `contributes.blocks`
 * key and does not depend on the engine — so a plugin adding blocks is adding
 * them to the page builder, not to Nextly. That makes the page builder's own
 * service the contribution channel, reached through the cross-plugin namespace
 * every plugin already has.
 *
 * Registering through here rather than by importing the engine's `registerBlocks`
 * is what makes the timing safe. The engine's registry is cleared and rebuilt on
 * every boot, so a direct call can land before the rebuild and lose the blocks
 * with no error. Resolving this service cannot: services are recorded in boot
 * pass 1 and `init` runs in pass 2, so a contributor calling from `init` is
 * guaranteed to reach a live registry whatever order the plugins load in.
 *
 * @module blocks/registration-service
 */

import {
  clearBlocks,
  registerBlocks,
  registerSupport,
  type AnyBlockDefinition,
  type SupportDefinition,
} from "@nextlyhq/blocks-engine";
import type { PluginContext } from "@nextlyhq/plugin-sdk";

/** The page builder's own name, as the cross-plugin namespace keys it. */
export const PAGE_BUILDER_PLUGIN = "@nextlyhq/plugin-page-builder";

/** The service name this is registered under. */
export const BLOCK_SERVICE = "blocks";

/**
 * What a contributing plugin may do with the page builder's block registry.
 *
 * Deliberately narrow: contributing is additive. Reading the registry back, or
 * removing another plugin's blocks, are not offered — a plugin that could
 * unregister a sibling's block would make a page's contents depend on plugin
 * order, which is the property the registry exists to prevent.
 */
export interface BlockRegistrationService {
  /**
   * Add block definitions to the page builder.
   *
   * `source` is recorded against each block so a name collision between two
   * plugins names both culprits instead of failing anonymously.
   */
  register(
    definitions: AnyBlockDefinition | AnyBlockDefinition[],
    source: string
  ): void;

  /**
   * Add a custom support — a capability key blocks may declare.
   *
   * Offered here rather than left to the engine's own `registerSupport` because
   * supports share the block registry's per-boot lifecycle. Registered outside
   * this service they either survive a reset that should have cleared them, and
   * collide when the next boot re-registers, or are wiped by a reset that runs
   * between the support and the blocks declaring it.
   */
  registerSupport(support: SupportDefinition): void;
}

/**
 * Build the service the page builder contributes.
 *
 * The registry is emptied here, at the moment the first contribution of a boot
 * is about to be made, rather than earlier. That placement is load-bearing in
 * both directions:
 *
 * - Not in the page builder's `init`, because init order is not fixed: a
 *   contributor whose init ran first would have its blocks wiped by a later
 *   clear.
 * - Not in `setup`, which is the one hook a config reload DOES re-run. A reload
 *   never goes back through `registerServices`, so no `init` runs afterwards to
 *   repopulate — clearing there empties the registry for the rest of the
 *   process, and contributed blocks disappear on the first unrelated save.
 *
 * This factory is memoized per boot, so the reset happens exactly once, in the
 * same lifecycle as every registration that follows it.
 *
 * Blocks AND supports are reset together, because both are per-boot: a support
 * kept across boots collides when the next boot registers it again, and a
 * support cleared independently of the blocks declaring it leaves those blocks
 * refused as using an unknown one. Both are contributed through this service,
 * so both are registered after the reset and neither can be caught by it.
 *
 * The cost is that a contributor removed mid-process leaves its blocks behind:
 * with nothing resolving this service, nothing clears them. That is the smaller
 * problem — the registry lives on `globalThis`, so it does not outlive the
 * process and a restart begins empty.
 */
export function createBlockRegistrationService(): BlockRegistrationService {
  clearBlocks();
  return {
    registerSupport,
    register(definitions, source) {
      const list = Array.isArray(definitions) ? definitions : [definitions];
      // Nothing to do rather than an error: a plugin whose block list is
      // configuration-dependent may legitimately contribute none.
      if (list.length === 0) return;
      registerBlocks(list, { source });
    },
  };
}

/**
 * Typed handle to the page builder's block registry.
 *
 * The cross-plugin namespace is typed `Record<string, Record<string, unknown>>`,
 * so reaching it directly costs a cast at every call site and gives block
 * authors no argument checking. This resolves it once and states what came back.
 */
export function blockRegistry(ctx: PluginContext): BlockRegistrationService {
  const service = ctx.services.plugins[PAGE_BUILDER_PLUGIN]?.[BLOCK_SERVICE];
  if (!isBlockRegistrationService(service)) {
    // Named rather than a generic missing-service message: the overwhelmingly
    // likely cause is that the page builder is not installed, and a plugin
    // author reading this should not have to infer that.
    throw new Error(
      `Cannot contribute blocks: "${PAGE_BUILDER_PLUGIN}" is not installed, or ` +
        `is registered without its "${BLOCK_SERVICE}" service. Add it to ` +
        `defineConfig({ plugins: [...] }) before any plugin that contributes blocks.`
    );
  }
  return service;
}

/** Whether a resolved service is the block registry rather than something else. */
function isBlockRegistrationService(
  value: unknown
): value is BlockRegistrationService {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { register?: unknown }).register === "function"
  );
}
