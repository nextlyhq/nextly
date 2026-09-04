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
import { setContributedWidgets } from "../../domains/widgets/canonical";
import { CORE_WIDGETS } from "../../domains/widgets/core-widgets";
import { clearWidgets, registerWidget } from "../../domains/widgets/registry";
import { clearSources } from "../../domains/widgets/sources";
import { clearSystemResolvers } from "../../domains/widgets/system-sources";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { contributedWidgetSummaries } from "../../plugins/validate-admin-widgets";

export function resetWidgetRegistries(
  plugins: readonly PluginDefinition[] = []
): void {
  clearWidgets();
  clearSources();
  // 🔴 Cleared WITH the source store, never apart from it. The two are halves
  // of one registration and both are pinned to `globalThis`, so a reset that
  // took only the sources left every previous boot's resolver addressable —
  // holding the domain services its closure captured for the process lifetime,
  // and ready to answer again the moment anything republished that id through
  // the generic `registerSource` door.
  clearSystemResolvers();

  // The OTHER channel a widget arrives by. A contribution never passes through
  // `registerWidget`, so without this the server's canonical set holds core's
  // cards alone -- and every server-side question about which widgets exist
  // answers differently from the grid, which has always resolved both.
  // Replaced rather than merged, for the same reason the registry is cleared
  // above: a hot reload must not accumulate the previous boot's plugins.
  setContributedWidgets(contributedWidgetSummaries(plugins));

  for (const definition of CORE_WIDGETS) {
    registerWidget(definition);
  }

  // The domains that answer a source of their own publish it here, after the
  // stores are empty. PUSHED from the composition root rather than pulled by
  // the widgets domain, which knows nothing about releases and must not have to
  // import it — that inversion is what would make the widgets package depend on
  // most of the codebase in order to offer a card.
  registerReleasesWidgetSource();
}
