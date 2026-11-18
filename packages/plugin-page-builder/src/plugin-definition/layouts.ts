/**
 * Layouts: the guard refusing to delete a component a Layout still names, the
 * notice for a page published naming an unpublished Layout, and the routes
 * that choose the site's default Layout, remove a Layout, and list the
 * Layouts an author may choose.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import type { PluginRoute } from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { createInAreaRoute } from "../default-layout/create-in-area-route";
import { fillNoticesRoute } from "../default-layout/fill-notice-route";
import { makeDefaultRoute } from "../default-layout/make-default-route";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import { layoutAreaRoutes } from "../layout-area-route";
import { layoutChoicesRoute } from "../layout-choices-route";
import { registerLayoutComponentGuard } from "../layout-component-guard";
import { layoutCountsRoute } from "../layout-counts-route";
import { registerLayoutReadinessNotice } from "../layout-readiness-hook";
import { removeLayoutRoute } from "../layout-removal/remove-route";
import { layoutWriteRoutes } from "../layout-writes-route";

import type { InitContext } from "./install-context";
import { componentStoreOf } from "./options";
import type { Definition } from "./state";

/**
 * Both ends of a Layout's component references: a component a Layout still
 * names can't be deleted or unpublished, and a Layout can't be saved naming a
 * component that is missing or being deleted (`layout-area-guard.ts`).
 */
export function installLayoutComponentGuard(ctx: InitContext): void {
  registerLayoutComponentGuard({
    ctx,
    // RESOLVED slugs. A host may rename either, and a guard holding the
    // declared name would register on a collection nothing deletes from
    // and scan one that does not exist — refusing nothing, silently.
    componentsCollection:
      ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG,
    layoutsCollection: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
  });
}

/** The notice for a page published naming a Layout that is not. */
export function installLayoutReadinessNotice(ctx: InitContext): void {
  // A page published naming a Layout that is not: it is served inside the
  // site's default until its own is published, and the author is told.
  registerLayoutReadinessNotice({
    ctx,
    pages: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    settings:
      ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
      PAGE_BUILDER_SETTINGS_SLUG,
  });
}

/** The routes Layouts contribute, by name. */
export function routesForLayouts(def: Definition): {
  readonly makeDefault: PluginRoute;
  readonly removeLayout: PluginRoute;
  readonly layoutChoices: PluginRoute;
  readonly layoutCounts: PluginRoute;
  readonly fillNotices: PluginRoute;
  readonly layoutWrites: PluginRoute[];
  readonly layoutArea: PluginRoute[];
  readonly createInArea: PluginRoute;
} {
  const { opts } = def;
  return {
    // The one write that chooses the site's default Layout. A route rather
    // than an edit to the settings Single, because choosing a default has
    // preconditions (the Layout is published, the caller may publish
    // Layouts) that a plain Single write cannot state.
    makeDefault: makeDefaultRoute(),
    // Remove Layout: the one way a Layout is deleted or unpublished, fenced
    // and checked so no page and not the site's default is taken from
    // under it. The Layout's own delete and unpublish refuse every write
    // that does not come through here.
    removeLayout: removeLayoutRoute(),
    // The Layouts an author may choose for a page, with the published
    // regions the editor draws around it, read as the author from the
    // component store the editor's library reads, under the bounds the
    // published renderer draws with.
    layoutChoices: layoutChoicesRoute(
      componentStoreOf(opts),
      () => opts.limits ?? DEFAULT_LIMITS
    ),
    // How many pages use each set the caller may read, counted as the
    // system and answered as numbers only.
    layoutCounts: layoutCountsRoute(),
    // The publisher of the first header or footer, told once that it now
    // fills the default: asked by the screen they published from.
    fillNotices: fillNoticesRoute(),
    // A set's rename and copy from the builder's Pages panel, each gated by
    // the set write it makes and written as the caller.
    layoutWrites: layoutWriteRoutes(),
    // The components marked for an area, and the write putting one in a
    // set's area: the builder's "Use a component" menu on the starter.
    layoutArea: layoutAreaRoutes(
      componentStoreOf(opts),
      () => opts.limits ?? DEFAULT_LIMITS
    ),
    // "Create a header" on the band the canvas draws where the default set
    // has no header (or footer): the starter design, created as the caller
    // and put in the default.
    createInArea: createInAreaRoute(componentStoreOf(opts)),
  };
}
