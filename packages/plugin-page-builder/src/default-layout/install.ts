/**
 * Wiring the default Layout into an installed plugin.
 *
 * Kept beside the feature rather than inline in the plugin's `init` and
 * `onReady`, so those stay a list of one call per feature and everything this
 * feature resolves at install time is stated in one place.
 *
 * @module default-layout/install
 */
import type {
  FieldRewriteRequest,
  FieldRewriteResult,
} from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { registerLayoutRemovalGuard } from "../layout-removal/layout-removal-guard";
import { registerPageReferenceGuard } from "../layout-removal/page-reference-guard";
import { fenceOnExecutor, layoutRemovalStore } from "../layout-removal/store";

import { registerDefaultLayoutGuard } from "./default-layout-guard";
import {
  emptySeedMark,
  moveEmptySeedPages,
  type EmptySeedParts,
} from "./empty-seed";
import { registerEmptySeedWriteHook } from "./empty-seed-write";
import { ensureDefaultLayout, type EnsureDefaultDeps } from "./ensure-default";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./settings-single";

/**
 * What the repair needs from the installed plugin, the Direct API aside, with
 * what the move of pages off the empty seed writes with, always.
 */
export type DefaultLayoutSetup = Omit<
  EnsureDefaultDeps,
  "nextly" | "emptySeed"
> & { readonly emptySeed: EmptySeedParts };

/** The parts of the plugin context this wiring reads, named structurally. */
interface InstallContext {
  self: {
    collections: Record<string, string | undefined>;
    singles: Record<string, string | undefined>;
  };
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
  logger: { warn(message: string, meta?: Record<string, unknown>): void };
  db: PluginDatabase;
  dialect: Parameters<typeof layoutRemovalStore>[1];
  services: {
    collections: {
      rewriteField(
        request: FieldRewriteRequest,
        opts: { as: "system" }
      ): Promise<FieldRewriteResult>;
    };
  };
}

/**
 * Resolve the slugs, register the guards on the Layouts collection, and answer
 * what the repair needs. RESOLVED slugs: a host may rename the Layouts
 * collection or the Single, and a guard holding the declared name would guard a
 * collection nothing writes to.
 *
 * The default guard is registered first, so a delete or unpublish of the
 * default is told to choose another default before it is told to use Remove
 * Layout: that is what the author has to do either way.
 */
export function installDefaultLayout(ctx: InstallContext): DefaultLayoutSetup {
  const setup: DefaultLayoutSetup = {
    slugs: {
      layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
      settings:
        ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
        PAGE_BUILDER_SETTINGS_SLUG,
    },
    pagesSlug: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    removals: layoutRemovalStore(ctx.db, ctx.dialect),
    warn: (message, meta) => ctx.logger.warn(message, meta),
    emptySeed: {
      mark: emptySeedMark(ctx.db, ctx.dialect),
      // As the system, through the service bound to this plugin, so each
      // moved page's history names the Page Builder and no person.
      rewrite: request =>
        ctx.services.collections.rewriteField(request, { as: "system" }),
    },
  };
  registerDefaultLayoutGuard({ ctx, slugs: setup.slugs, warn: setup.warn });
  registerLayoutRemovalGuard({
    ctx,
    layouts: setup.slugs.layouts,
    store: () => setup.removals,
    inTransaction: executor => fenceOnExecutor(ctx.db, executor),
    warn: setup.warn,
  });
  // And the page side: no page write puts a page on a Layout being removed.
  registerPageReferenceGuard({
    ctx,
    pages: setup.pagesSlug,
    layouts: setup.slugs.layouts,
    store: () => setup.removals,
    inTransaction: executor => fenceOnExecutor(ctx.db, executor),
    warn: setup.warn,
  });
  // After the page side of the fence, so a write naming the empty seed is
  // judged by the fence as sent and then stored as "Site default".
  registerEmptySeedWriteHook({
    ctx,
    pages: setup.pagesSlug,
    slugs: setup.slugs,
    emptySeed: setup.emptySeed,
    warn: setup.warn,
  });
  return setup;
}

/**
 * Seed the default Layout once the boot has finished, so a fresh site has one
 * before its first page is drawn, and then move pages off the empty seed
 * until that has finished once.
 *
 * NOT awaited by the caller, and that is required rather than a shortcut:
 * `onReady` runs inside service registration, before the Direct API will serve,
 * so the seed waits for the boot to finish (`getCachedNextly` shares the boot's
 * own promise) and then runs. Awaiting that from `onReady` would wait on the
 * boot the hook is part of. Every failure is caught and logged, because a throw
 * from `onReady` fails the boot, and the repair sweep runs the same check on
 * every jobs pass, so a seed that could not run here is not lost.
 */
export async function seedDefaultLayoutAtStart(
  setup: DefaultLayoutSetup
): Promise<void> {
  try {
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    const nextly = await getCachedNextly();
    await ensureDefaultLayout({ ...setup, nextly });
    await moveEmptySeedPages({ ...setup, nextly });
  } catch (error) {
    setup.warn(
      "[page-builder] the default Layout, or the move of pages off the empty seeded set, could not be run at start; the jobs sweep will run it",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}
