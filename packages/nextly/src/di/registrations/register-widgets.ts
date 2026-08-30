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
 * `clearWidgets()` runs here too even though no core widget definition is
 * registered yet. The widget registry is `globalThis`-pinned exactly as the
 * source registry is, so it needs the same reset at the same choke point; a
 * clear wired only once the first definition exists would be a second boot
 * seam to find, and the reset that keeps a hot reload from colliding would be
 * missing for however long that took.
 *
 * @module di/registrations/register-widgets
 */

import { clearWidgets } from "../../domains/widgets/registry";
import { clearSources } from "../../domains/widgets/sources";

export function resetWidgetRegistries(): void {
  clearWidgets();
  clearSources();
}
