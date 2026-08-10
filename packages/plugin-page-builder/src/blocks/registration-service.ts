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
 * **What registration buys today, and what it does not.** A registered block is
 * known to `@nextlyhq/blocks-engine`: validation stops calling its type unknown,
 * and generation, manifests and tooling can see it.
 *
 * Whether it RENDERS depends on which renderer, and there are two:
 *
 * - `PageRenderer` from **`@nextlyhq/blocks-react`** resolves through
 *   `registeredBlocks()`, which reads the engine registry this service writes
 *   to. A contributed block renders there with no bridging step.
 * - `PageRenderer` from **`@nextlyhq/plugin-page-builder/render`** defaults to
 *   this package's own `defaultBlockRegistry`, which holds none of them, so the
 *   same block draws the unknown-block placeholder. A host may pass its own
 *   `registry` prop, but the default does not reach the engine.
 *
 * The editor canvas is on that second side too — it reads `defaultBlockRegistry`
 * — so a contributed block cannot yet be inserted or drawn while editing.
 *
 * So the seam does not sit between registration and rendering in general. It
 * sits between the two registries, and a plugin author following THIS package's
 * own documented render path is on the side that does not see contributed
 * blocks.
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
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { collectDeclarations } from "nextly";

import { blocksIn, supportsIn } from "./declared-blocks";

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
   * The contributing plugin is recorded against each block, so a name collision
   * between two plugins names both culprits instead of failing anonymously. It
   * is taken from the caller's own identity rather than passed in: a plugin that
   * renamed itself, or copied a neighbour's call, would otherwise file its
   * blocks under a plugin that did not register them and send whoever hits the
   * collision to the wrong package.
   */
  register(definitions: AnyBlockDefinition | AnyBlockDefinition[]): void;

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
 * The single service instance the page builder contributes, shared by every
 * contributor.
 *
 * It takes the contributing plugin's name explicitly because one instance
 * serves them all; `blockRegistry` below is what binds each caller's own
 * identity, so the name can never be supplied by hand at a call site.
 */
interface BlockRegistrationBackend {
  register(
    definitions: AnyBlockDefinition | AnyBlockDefinition[],
    source: string
  ): void;
  registerSupport(support: SupportDefinition): void;
}

/**
 * Build the service the page builder contributes.
 *
 * The registry is emptied here, at the moment the first contribution of a boot
 * is about to be made, rather than earlier. That placement is load-bearing in
 * both directions:
 *
 * - Not directly in the page builder's `init`, because init order is not fixed:
 *   a contributor whose init ran first would have its blocks wiped by a later
 *   clear. The page builder does resolve this service from `init`, but that
 *   only triggers the reset on a boot where nothing else has already, since
 *   resolution is memoized.
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
 * A boot on which no plugin contributes still resets, because the page builder
 * resolves this service from its own `init`. Left to contributors alone, a boot
 * whose last contributing plugin had been removed would resolve nothing, and
 * that plugin's blocks would stay registered for the life of the process.
 *
 * The case that remains is a config reload, which re-runs neither
 * `registerServices` nor any `init`: contributions are not re-registered there
 * either, so the registry keeps exactly the blocks the running process
 * registered, and a plugin removed by that reload is visible until a restart.
 * Closing it needs core to re-run `init` on reload, and clearing without that
 * would empty the registry with nothing left to repopulate it.
 */
export function createBlockRegistrationService(): BlockRegistrationBackend {
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
 * Typed handle to the page builder's block registry, bound to the calling
 * plugin.
 *
 * The cross-plugin namespace is typed `Record<string, Record<string, unknown>>`,
 * so reaching it directly costs a cast at every call site and gives block
 * authors no argument checking. This resolves it once and states what came back.
 *
 * Resolving is also what triggers the per-boot reset, so the page builder calls
 * this on itself during `init` to guarantee the reset happens on every boot
 * rather than only on boots where something contributes.
 */
export function blockRegistry(ctx: PluginContext): BlockRegistrationService {
  const service = ctx.services.plugins[PAGE_BUILDER_PLUGIN]?.[BLOCK_SERVICE];
  if (!isBlockRegistrationBackend(service)) {
    // Named rather than a generic missing-service message: the overwhelmingly
    // likely cause is that the page builder is not installed, and a plugin
    // author reading this should not have to infer that.
    throw new Error(
      `Cannot contribute blocks: "${PAGE_BUILDER_PLUGIN}" is not installed, or ` +
        `is registered without its "${BLOCK_SERVICE}" service. Add it to ` +
        `defineConfig({ plugins: [...] }) before any plugin that contributes blocks.`
    );
  }
  // Provenance comes from the plugin's own resolved identity, so it names the
  // plugin that actually registered rather than whatever string reached the
  // call site.
  const source = ctx.self.name;
  return {
    register: definitions => service.register(definitions, source),
    registerSupport: support => service.registerSupport(support),
  };
}

/** Whether a resolved service is the block registry rather than something else. */
function isBlockRegistrationBackend(
  value: unknown
): value is BlockRegistrationBackend {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { register?: unknown }).register === "function"
  );
}

/**
 * Register every block plugins declared for the page builder.
 *
 * Called from the page builder's own `init`, which is also what guarantees the
 * per-boot reset runs: resolving the service is what empties the registry, and
 * that has to happen before anything is registered into it.
 *
 * Each block is attributed to the plugin that DECLARED it, not to the page
 * builder that registered it on its behalf, so a name collision still names the
 * package a reader has to go and fix.
 *
 * A declaration whose `blocks` is not an array throws rather than being skipped.
 * It was addressed to this reader by name, so the author meant it to take
 * effect; silently ignoring it would leave a plugin looking installed while
 * contributing nothing.
 */
/**
 * Register the core primitive library.
 *
 * Called before {@link registerDeclaredBlocks}, and the order is load-bearing
 * twice over. It resolves the registration service first, which is what
 * performs the boot's one-time clear, so the core blocks are added to an empty
 * registry rather than wiped by a later resolution. And registering core first
 * means a contributed block colliding with a `core/` name is the one reported
 * as the duplicate, which is the right way round: the core namespace is this
 * package's.
 *
 * Attributed to the page builder itself, because that is the package a reader
 * would have to go and change.
 */
export function registerCoreBlocks(ctx: PluginContext): void {
  const service = ctx.services.plugins[PAGE_BUILDER_PLUGIN]?.[BLOCK_SERVICE];
  if (!isBlockRegistrationBackend(service)) return;
  service.register(coreBlocks, PAGE_BUILDER_PLUGIN);
}

export function registerDeclaredBlocks(ctx: PluginContext): void {
  const service = ctx.services.plugins[PAGE_BUILDER_PLUGIN]?.[BLOCK_SERVICE];
  if (!isBlockRegistrationBackend(service)) return;
  const declarations = collectDeclarations(
    ctx.config.plugins ?? [],
    PAGE_BUILDER_PLUGIN
  );
  // Supports first, across every declaration, before any block is registered.
  // Registration refuses a block naming a support nothing knows yet, and a
  // block declared by one plugin may use a support declared by another, so
  // interleaving the two would make the outcome depend on plugin order.
  for (const declaration of declarations) {
    const { supports, error } = supportsIn(declaration);
    if (error) throw new Error(error);
    for (const support of supports) service.registerSupport(support);
  }
  for (const declaration of declarations) {
    const { blocks, error } = blocksIn(declaration);
    if (error) throw new Error(error);
    if (blocks.length > 0) service.register(blocks, declaration.source);
  }
}
