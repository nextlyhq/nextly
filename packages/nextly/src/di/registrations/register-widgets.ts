/**
 * Populate the widget registries from the boot config.
 *
 * `clearWidgets()` and `clearSources()` reset a `globalThis`-pinned store
 * rather than a DI container entry, so this does not live beside the other
 * `register*Services` functions in this directory -- there is no service to
 * register, only a clear-then-rebuild to run.
 *
 * Called from `registerServices()`, which both of Nextly's boot paths funnel
 * through (`init.ts`'s instrumentation boot and `createDynamicHandlers`'s lazy
 * request-path boot -- see `route-handler/auth-handler.ts`). That makes it the
 * one choke point where "clear, then re-register" needs to be wired exactly
 * once: CLEARING first means a dev-server hot reload re-registering the same
 * collection slugs never collides with itself (the previous boot's rows are
 * gone before the new ones land), while a genuine duplicate slug WITHIN one
 * boot still fails loudly -- `registerSource` throws on a second call for the
 * same id inside a single `registerBuiltInSources` pass, because nothing
 * clears the store between two collections in that same pass.
 *
 * `clearWidgets()` runs here too even though nothing in this plan calls
 * `registerWidget` yet -- the core widget definitions land in the companion
 * admin-rendering plan. Wiring the clear now means that plan's registrations
 * inherit the same hot-reload safety without anyone having to remember to add
 * it at the one choke point both boot paths already share.
 *
 * @module di/registrations/register-widgets
 */

import { registerBuiltInSources } from "../../domains/widgets/built-in-sources";
import { clearWidgets } from "../../domains/widgets/registry";
import { clearSources } from "../../domains/widgets/sources";

/** The slice of the boot config this needs -- never the whole `NextlyServiceConfig`. */
export interface WidgetBootConfig {
  collections?: Array<{
    slug: string;
    fields?: Array<{ name: string; type: string }>;
  }>;
}

export function registerBuiltInWidgetSources(config: WidgetBootConfig): void {
  clearWidgets();
  clearSources();
  registerBuiltInSources(
    (config.collections ?? []).map(collection => ({
      slug: collection.slug,
      fields: collection.fields ?? [],
    }))
  );
}
