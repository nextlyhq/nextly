/**
 * Site style and variables: what a write of the site style is judged by when
 * it drops a variable or a shared style (the lock, the stored documents it
 * walks, and the in-use check), and
 * the routes for the stored site style, the font catalogue, the shared styles
 * and the variables.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import type { PluginRoute } from "@nextlyhq/plugin-sdk";

import { classUsageIndex } from "../class-usage-reconcile";
import { declaredSingleSlugs } from "../declared-singles";
import { BLOCKS_TYPE, onceAsked } from "../fields/blocksField";
import { registerRetiredSpacingOptionCleanup } from "../retired-spacing-option";
import {
  firstReadableTitle,
  sharedStyleRoutes,
  storedDocumentsOf,
  storedSharedStyleUses,
} from "../shared-styles-routes";
import {
  registerSiteStyleRemovalLock,
  type SiteStyleRemovalLockSetup,
} from "../site-style-removal-lock";
import {
  builderCollectionsIn,
  builderSinglesIn,
  siteLocales as siteLocalesOf,
  siteStyleRoute,
} from "../site-style-route";
import { suppliedVariableIds } from "../site-style-storage";
import { storedDocumentsOnTransaction } from "../stored-documents-on-transaction";
import { tokenUsageIndex } from "../token-usage";
import {
  variableRemovalChecks,
  variableRoutes,
  type VariableCheckSetup,
} from "../variables-routes";

import type { InitContext, siteStyleReads } from "./install-context";
import { componentStoreOf } from "./options";
import type { Definition } from "./state";
import type { UsageParts } from "./usage";

/**
 * The stored documents a removal walks under the composition graph lock,
 * read on its write's transaction: the plugin's own reads for the
 * collections and Singles it declared, the host reads for the others, and
 * the stored read of the blocks type for each working draft. Which hold a
 * blocks field is read from the registry on the same transaction
 * (`listHostTypesInTransaction`, which takes no row locks), once per walk:
 * read from the pool, it would wait for a connection the write's own
 * transaction holds, for good on a pool of one.
 */
function removalDocumentsOn(
  ctx: InitContext
): SiteStyleRemovalLockSetup["documentsOn"] {
  const declared = (slugs: Readonly<Record<string, string | undefined>>) =>
    new Set(
      Object.values(slugs).filter((slug): slug is string => slug !== undefined)
    );
  const ownCollections = declared(ctx.self.collections);
  const ownSingles = declared(ctx.self.singles);
  return write => {
    // One listing per walk, read on the write's transaction: the collections
    // and the Singles both come from it, so they describe one registry.
    const listing = onceAsked(() =>
      ctx.services.ownCollections.listHostTypesInTransaction(write.transaction)
    );
    return storedDocumentsOnTransaction({
      reads: ctx.services.ownCollections,
      transaction: write.transaction,
      readStored: target => write.readStored(BLOCKS_TYPE, target),
      ownCollections,
      ownSingles,
      locales: () => siteLocalesOf(ctx.config),
      collections: async () =>
        builderCollectionsIn((await listing()).collections),
      singles: async () =>
        builderSinglesIn((await listing()).singles, declaredSingleSlugs(ctx)),
    });
  };
}

/**
 * The site style's write locks, once the plugin is installed: the retired
 * spacing option cleared on the next save, and every write dropping a
 * variable or a shared style judged again under the composition lock.
 * Answers what a variable's in-use check reads.
 */
export function installSiteStyleLocks(
  ctx: InitContext,
  def: Definition,
  siteStyle: ReturnType<typeof siteStyleReads>,
  parts: Pick<UsageParts, "usageSourceOf" | "uncoveredPagesOf">
): VariableCheckSetup {
  const { opts, configStyle, configClassIds, bootedNextly } = def;
  const { usageSourceOf, uncoveredPagesOf } = parts;
  // The spacing model an earlier release recorded, cleared with the site
  // style's next save, inside that save's transaction.
  registerRetiredSpacingOptionCleanup(ctx);
  // What a variable's in-use check reads: the variable index, the block
  // types the pages are rendered with (read per check), and the stored
  // documents. It names no document, since the write's author is not a
  // caller this can ask.
  const variableCheckSetup = {
    usage: usageSourceOf(
      ctx.self.collections,
      tokenUsageIndex,
      ctx.services.jobs
    ),
    blocks: () => def.blocks.all(),
    documents: async () => storedDocumentsOf(ctx, await bootedNextly()),
    limits: opts.limits ?? DEFAULT_LIMITS,
    pathOf: () => "tokens",
    uncovered: uncoveredPagesOf(ctx),
  };
  // And every write of the site style dropping a variable or a shared
  // style takes the same lock and reads the stored documents again under
  // it, so a page cannot commit a first use of what it removes. Read on
  // the write's own transaction, by the walks the remove routes' rescans
  // make.
  registerSiteStyleRemovalLock(ctx, {
    suppliedVariables: () => suppliedVariableIds(configStyle),
    // The set the code tier refresh keeps current.
    suppliedClasses: () => configClassIds,
    defaults: () => configStyle,
    siteStyleOn: siteStyle.documentOn,
    documentsOn: removalDocumentsOn(ctx),
    variableUses: (ids, documents) =>
      variableRemovalChecks({
        ...variableCheckSetup,
        documents: () => Promise.resolve(documents),
      }).stillUsed.uses(ids),
    sharedStyleUses: (ids, documents) =>
      storedSharedStyleUses(documents, opts.limits ?? DEFAULT_LIMITS)(ids),
  });
  return variableCheckSetup;
}

/** The routes site style and variables contribute, by name. */
export function routesForSiteStyle(
  def: Definition,
  parts: Pick<UsageParts, "usageSourceOf" | "uncoveredPagesOf">
): {
  readonly siteStyle: PluginRoute;
  readonly fonts: PluginRoute[];
  readonly sharedStyles: PluginRoute[];
  readonly variables: PluginRoute[];
} {
  const { opts, configStyle, configClassIds, fonts, bootedNextly } = def;
  const { usageSourceOf, uncoveredPagesOf } = parts;
  return {
    // The editor's read of the stored site style, for anyone who may
    // edit something the builder opens: the canvas cannot draw without it.
    siteStyle: siteStyleRoute(componentStoreOf(opts)),
    // Design → Fonts' catalogue: read it, and add a family to the site.
    fonts: fonts.routes,
    // The Design panel's shared styles: lock and unlock one, how widely
    // each is used and where, and removing the unused. Usage is read from
    // the class usage index the installed host maintains.
    sharedStyles: sharedStyleRoutes({
      configClassIds,
      usage: ctx =>
        usageSourceOf(ctx.self.collections, classUsageIndex, ctx.services.jobs),
      // The bounds the class index and the renderer read a page under.
      limits: opts.limits ?? DEFAULT_LIMITS,
    }),
    // The Variables panel: how widely each variable is used and where,
    // from the variable usage index and the site's shared styles, and
    // removing the ones the site added that nothing uses. A count now is
    // the shared styles' count route: one sweep fills every index.
    variables: variableRoutes({
      defaults: configStyle,
      usage: ctx =>
        usageSourceOf(ctx.self.collections, tokenUsageIndex, ctx.services.jobs),
      // A block type's own default styles are a use, read per request.
      blocks: () => def.blocks.all(),
      inUse: (ctx, readNamed) =>
        variableRemovalChecks({
          usage: usageSourceOf(
            ctx.self.collections,
            tokenUsageIndex,
            ctx.services.jobs
          ),
          blocks: () => def.blocks.all(),
          documents: async () => storedDocumentsOf(ctx, await bootedNextly()),
          limits: opts.limits ?? DEFAULT_LIMITS,
          uncovered: uncoveredPagesOf(ctx),
          // The first use named only if this caller may open it.
          firstReadable: uses =>
            firstReadableTitle(
              uses,
              readNamed,
              async slug => (await ctx.caller?.can("read", slug)) ?? false
            ),
          pathOf: id => id,
        }),
    }),
  };
}
