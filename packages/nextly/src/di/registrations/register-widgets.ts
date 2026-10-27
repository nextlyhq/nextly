/**
 * Reset the widget registries at boot.
 *
 * `clearWidgets()` and `clearSources()` reset a `globalThis`-pinned store
 * rather than a DI container entry, so this does not live beside the other
 * `register*Services` functions in this directory -- there is no service to
 * register, only a reset to run.
 *
 * Called from `registerServices()`, which both of Nextly's boot paths funnel
 * through (`init.ts`'s instrumentation boot and `createDynamicHandlers`'s lazy
 * request-path boot -- see `route-handler/auth-handler.ts`). That makes it the
 * one choke point where the reset needs wiring exactly once: a dev-server hot
 * reload re-registering the same widget ids or plugin source ids never
 * collides with itself, because the previous boot's rows are gone before the
 * new ones land -- while a genuine duplicate WITHIN one boot still fails
 * loudly, since nothing clears the store between two registrations in the same
 * pass.
 *
 * It deliberately publishes NO collection sources. Those are derived from the
 * collection registry, which is not populated at this point in boot and which
 * keeps changing afterwards as the Schema Builder is used;
 * `domains/widgets/collection-sources.ts` reads it where the answer is needed
 * and explains why. What is left here is the one thing boot genuinely owns:
 * the store starts empty.
 *
 * `clearWidgets()` then core's OWN cards land here, in that order and in this
 * one function, which is what makes a hot reload safe: the previous boot's rows
 * are gone before these are written, so re-registering the same four ids never
 * collides with itself -- while a genuine duplicate within one boot still fails
 * loudly, since nothing clears the store between two registrations in one pass.
 *
 * Registered rather than special-cased into `publishableWidgets`, so they are
 * ordinary rows a plugin can `extendWidget` or `overrideWidget` like any other.
 * Core going through the same door as a plugin is the whole reason the door is
 * worth trusting.
 *
 * @module di/registrations/register-widgets
 */

import { registerReleasesWidgetSource } from "../../domains/releases/releases-widget-source";
import { registerVersionsWidgetSource } from "../../domains/versions/versions-widget-source";
import { setContributedWidgets } from "../../domains/widgets/canonical";
import { CORE_WIDGETS } from "../../domains/widgets/core-widgets";
import { setAdminComponentPlugins } from "../../domains/widgets/declaration/component-map-store";
import {
  clearDeclaredWidgets,
  registerWidgetDeclarations,
  type DeclaredWidgetGroup,
} from "../../domains/widgets/declaration/declared-widgets";
import {
  SITE_CONFIG,
  siteDashboardContext,
  siteDashboardFaults,
  siteDashboardKeysNotApplied,
  siteDashboardSnapshot,
} from "../../domains/widgets/declaration/site-dashboard";
import { clearWidgets, registerWidget } from "../../domains/widgets/registry";
import { clearSources } from "../../domains/widgets/sources";
import { clearSystemResolvers } from "../../domains/widgets/system-sources";
import { getNextlyLogger } from "../../observability/logger";
import {
  pluginAlternatives,
  pluginDashboardSnapshots,
  pluginLegacyWidgetIds,
  pluginSuggestionFaults,
  pluginWidgetDeclarationGroups,
} from "../../plugins/dashboard-declarations";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { contributedWidgetSummaries } from "../../plugins/validate-admin-widgets";
import { registerActivityWidgetSource } from "../../services/dashboard/activity-widget-source";
import { registerAttentionWidgetSource } from "../../services/dashboard/attention-source";
import { registerRecentEditsWidgetSource } from "../../services/dashboard/recent-edits-widget-source";
import { registerSummaryWidgetSources } from "../../services/dashboard/summary-widget-sources";

export function resetWidgetRegistries(
  plugins: readonly PluginDefinition[] = [],
  // The site config's `admin.dashboard`, as given: startup checks it.
  dashboard?: unknown
): void {
  clearWidgets();
  // Cleared with the registry it publishes into, so a reload's declarations
  // are checked against this boot's alone.
  clearDeclaredWidgets();
  clearSources();
  // 🔴 Cleared WITH the source store, never apart from it. The two are halves
  // of one registration and both are pinned to `globalThis`, so a reset that
  // took only the sources left every previous boot's resolver addressable —
  // holding the domain services its closure captured for the process lifetime,
  // and ready to answer again the moment anything republished that id through
  // the generic `registerSource` door.
  clearSystemResolvers();
  // 🔴 The deferral store is NOT cleared here, and that is deliberate. It
  // records which entities a reload found to disagree with their tables, and
  // this function runs BEFORE the boot has synced any metadata -- so clearing
  // here publishes "nothing is withheld" on the strength of work that has not
  // happened yet. The boot's own sync can then fail and be caught, leaving the
  // registry exactly as stale as the previous reload found it while the set
  // says otherwise.
  //
  // Each kind replaces its own set from its own sync path instead, once that
  // sync has actually succeeded -- which clears a previous boot's refusal on
  // the pass that earns the right to, and retains it when the sync fails. See
  // `publishBootDeferrals` in `di/register`.

  // The OTHER channel a widget arrives by. A contribution never passes through
  // `registerWidget`, so without this the server's canonical set holds core's
  // cards alone -- and every server-side question about which widgets exist
  // answers differently from the grid, which has always resolved both.
  // Replaced rather than merged, for the same reason the registry is cleared
  // above: a hot reload must not accumulate the previous boot's plugins.
  setContributedWidgets(contributedWidgetSummaries(plugins));
  // The resolved list the admin's component-map check reads, so it judges
  // the generated map against the plugins this boot runs.
  setAdminComponentPlugins(plugins);

  // The domains that answer a source of their own publish it here, after the
  // stores are empty and BEFORE core's widgets: a widget's settings are
  // admitted against the filters its source declares (`knobSourceFor`), so a
  // source registered after the widget naming it would refuse its settings.
  // PUSHED from the composition root rather than pulled by the widgets domain,
  // which knows nothing about releases and must not have to import it — that
  // inversion is what would make the widgets package depend on most of the
  // codebase in order to offer a card.
  registerReleasesWidgetSource();
  registerVersionsWidgetSource();
  registerActivityWidgetSource();
  // Needs attention's source, which combines the releases' and versions' reads
  // with the entry list's counts and so belongs to no one domain.
  registerAttentionWidgetSource();
  registerSummaryWidgetSources();
  registerRecentEditsWidgetSource();

  for (const definition of CORE_WIDGETS) {
    registerWidget(definition);
  }

  // Plugins' widgets declared with `defineWidget()`, after core's, so an id
  // that collides with one of core's fails here, by name. Every declaration is
  // checked together with everything that names one (the site config's
  // dashboard, the plugins' suggestions and alternatives), and startup stops on
  // any fault, all of them reported at once; today's shape is passed for the id
  // rules it still keeps (`declared-widgets.ts`). Each plugin's contribution
  // and the site config are read once, here, and every check reads the copy.
  // The site's own widgets are checked with the plugins' but not registered yet.
  const coreIds = new Set(CORE_WIDGETS.map(widget => widget.id));
  const dashboards = pluginDashboardSnapshots(plugins);
  const site = siteDashboardSnapshot(dashboard);
  registerWidgetDeclarations(
    pluginWidgetDeclarationGroups(dashboards),
    pluginLegacyWidgetIds(plugins),
    (declared, groups) => [
      ...pluginSuggestionFaults(dashboards, groups, coreIds),
      ...siteDashboardFaults(
        site,
        siteDashboardContext(declared, pluginAlternatives(dashboards))
      ),
    ],
    siteWidgetGroup(site)
  );
  warnSiteDashboardKeysNotApplied(site);

  // 🔴 A plugin's sources are NOT registered here, and the reason is a hard
  // ordering fact rather than a preference: this runs before any plugin
  // context exists (`initializePlugins` builds them later in the same boot),
  // and a contributed resolver is useless without its context -- a plugin's
  // data services are reachable through nothing else.
  //
  // They register from `initializePlugins`, bound to their own plugin's
  // context, exactly as contributed services already do. That keeps the
  // ordering this function's own registrations rely on: core publishes its
  // sources HERE, first, so a plugin naming a built-in id is refused by
  // `registerSource` on the PLUGIN's registration -- naming the plugin an
  // operator can act on, rather than dying inside core's own publication.
}

/**
 * The site config's own widgets, as one more owner's declarations: checked
 * with the plugins', and not registered until the admin's component map also
 * reads them.
 */
function siteWidgetGroup(dashboard: unknown): DeclaredWidgetGroup[] {
  const widgets =
    typeof dashboard === "object" && dashboard !== null
      ? (dashboard as { widgets?: unknown }).widgets
      : undefined;
  return widgets === undefined
    ? []
    : [{ owner: SITE_CONFIG, declarations: widgets }];
}

/**
 * One startup warning naming the `admin.dashboard` keys the site sets that
 * this version checks but does not apply yet, so a setting never appears to do
 * nothing in silence.
 */
function warnSiteDashboardKeysNotApplied(dashboard: unknown): void {
  const keys = siteDashboardKeysNotApplied(dashboard);
  if (keys.length === 0) return;
  getNextlyLogger().warn({
    kind: "site-dashboard-keys-not-applied",
    keys,
    message: `${keys.map(key => `admin.dashboard.${key}`).join(", ")} ${keys.length === 1 ? "is" : "are"} accepted but not applied yet in this version.`,
  });
}
