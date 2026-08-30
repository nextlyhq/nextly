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
 * `clearWidgets()` runs here too even though no core widget definition is
 * registered yet. The widget registry is `globalThis`-pinned exactly as the
 * source registry is, so it needs the same reset at the same choke point; a
 * clear wired only once the first definition exists would be a second boot
 * seam to find, and the reset that keeps a hot reload from colliding would be
 * missing for however long that took.
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
