/**
 * Binds core's dashboard components to the `core#` paths its widgets name.
 *
 * Core's widget definitions live in `nextly` and can only name a component as a
 * STRING; the components themselves are React and live here. This is the one
 * place the two meet, and it is why `core#` is reserved in the component
 * registry -- the definition names the path, so anything else able to claim it
 * could replace the body drawn for a card the registry still attributes to
 * core.
 *
 * Called at MODULE scope by `WidgetGrid`, not from an effect. `PluginSlot`
 * resolves a path during render, so a registration that ran in `useEffect`
 * would arrive after the first paint and every core card would draw its
 * unresolved fallback once before appearing. A static import runs before any
 * render of the grid, and `Map.set` makes repeat calls harmless.
 *
 * @module components/features/widgets/core-components
 */

import { CollectionQuickLinks } from "@admin/components/features/dashboard/CollectionQuickLinks";
import { QuickCreate } from "@admin/components/features/dashboard/QuickCreate";
import { SeedDemoContentCard } from "@admin/components/features/dashboard/SeedDemoContentCard";
import { SinglesQuickLinks } from "@admin/components/features/dashboard/SinglesQuickLinks";
import { TeamSummary } from "@admin/components/features/dashboard/TeamSummary";
import { registerCoreComponent } from "@admin/lib/plugins/component-registry-internal";

/**
 * Every `core#` path core's widget definitions name, bound to its component.
 *
 * Keyed by the exact path so the two sides are comparable by eye. A card whose
 * definition names a path missing here draws the unresolved fallback rather
 * than crashing, which is `PluginSlot`'s existing behaviour and the right one:
 * one card reports itself and the dashboard stands.
 */
export function registerCoreWidgetComponents(): void {
  registerCoreComponent("core#SeedDemoContentCard", SeedDemoContentCard);
  registerCoreComponent("core#CollectionQuickLinks", CollectionQuickLinks);
  registerCoreComponent("core#SinglesQuickLinks", SinglesQuickLinks);
  registerCoreComponent("core#QuickCreate", QuickCreate);
  registerCoreComponent("core#TeamSummary", TeamSummary);
}
