/**
 * Turns what plugins DECLARED into what the grid can render.
 *
 * A `PluginWidgetMeta` is almost entirely optional — a widget may legally be
 * nothing but an id and a component path — while `DashboardWidget` is the shape
 * the renderer works from, with no field it would have to invent a default for.
 * Closing that gap in ONE function is what keeps the defaults out of the
 * renderer, where "title ?? id" would end up written once per archetype and
 * would drift.
 *
 * @module components/features/widgets/resolve-widgets
 */

import type {
  PluginMetadata,
  PluginWidgetMeta,
  RegisteredWidgetMeta,
} from "@admin/types/branding";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { legacySizeToWidgetSize } from "./sizes";

/**
 * The archetype a declaration means, or `undefined` when it means nothing
 * renderable.
 *
 * A widget with neither an archetype nor a component describes no body at all.
 * It is skipped rather than rendered as an empty card: a definition whose
 * plugin half has gone missing must never break the grid, and a card with a
 * title and nothing under it reads as a product bug rather than as a missing
 * plugin.
 */
function resolveArchetype(
  meta: PluginWidgetMeta
): DashboardWidget["archetype"] | undefined {
  if (meta.archetype) return meta.archetype;
  return meta.component ? "custom" : undefined;
}

/**
 * Every widget declared by any plugin, flattened, with no filtering.
 *
 * Separate from the decisions below so the two `?? []` defaults — a project
 * with no plugins, a plugin with no widgets — sit in the one place that is
 * about SHAPE rather than about visibility.
 */
function declaredWidgets(
  plugins: PluginMetadata[] | undefined
): PluginWidgetMeta[] {
  return (plugins ?? []).flatMap(plugin => plugin.widgets ?? []);
}

/**
 * One declaration as the grid renders it, or `undefined` when it is not
 * renderable at all.
 *
 * `hasPermission` is the `useCurrentUserPermissions` predicate, which is
 * closed-until-loaded: an undeclared permission renders, a declared one does
 * not render until the grant is known. Gating HERE rather than inside the card
 * is what keeps a denied widget's query out of the batch — a card that is never
 * mounted must not cause a request on the user's behalf.
 */
function resolveOne(
  meta: PluginWidgetMeta,
  hasPermission: (permission: string) => boolean
): DashboardWidget | undefined {
  if (meta.requiredPermission && !hasPermission(meta.requiredPermission)) {
    return undefined;
  }
  const archetype = resolveArchetype(meta);
  if (!archetype) return undefined;

  return {
    id: meta.id,
    // The id is a poor title, but it names the widget, which is the one thing
    // an error card has to be able to do.
    title: meta.title ?? meta.id,
    description: meta.description,
    icon: meta.icon,
    archetype,
    // `defaultSize` is the enum; `size` is the deprecated two-value alias. The
    // enum wins where both are declared, because a plugin that adopted the new
    // field meant it.
    size: meta.defaultSize ?? legacySizeToWidgetSize(meta.size),
    query: meta.query,
    component: meta.component,
    link: meta.link,
  };
}

/**
 * One REGISTERED widget as the grid renders it, or `undefined` when the user
 * may not see it.
 *
 * Separate from `resolveOne` above rather than folded into it, because the two
 * inputs are different contracts rather than two spellings of one. A
 * contribution is almost entirely optional and needs every default that
 * function supplies; a registered definition passed `validateWidgetDefinition`,
 * which requires the title, the archetype and the size, requires a query for
 * every data archetype and a component for `custom`, and forbids each where it
 * does not belong. Nothing here has a default to invent, and giving it one
 * would quietly accept a definition the registry would have refused.
 *
 * The permission gate IS shared, and deliberately: a denied widget's query must
 * stay out of the batch whichever channel declared it.
 */
function resolveRegistered(
  meta: RegisteredWidgetMeta,
  hasPermission: (permission: string) => boolean
): DashboardWidget | undefined {
  if (meta.requiredPermission && !hasPermission(meta.requiredPermission)) {
    return undefined;
  }

  return {
    id: meta.id,
    title: meta.title,
    description: meta.description,
    icon: meta.icon,
    archetype: meta.archetype,
    size: meta.defaultSize,
    query: meta.query,
    component: meta.component,
    link: meta.link,
  };
}

/**
 * The visible widgets, each id appearing once: contributions in declaration
 * order, then registrations.
 *
 * BOTH channels, because they are two ways into the same grid and neither
 * subsumes the other. `contributes.admin.widgets` is declarative and travels
 * with the plugin's config; `registerWidget` is the imperative API the widget
 * registry exists for. Reading only the first left an app that used the public
 * registration API invisible to the renderer built around that registry.
 *
 * Contributions FIRST, so an id declared in both keeps the card the dashboard
 * already drew for it. An app that worked around the gap by declaring a
 * registered widget twice therefore sees no change, and the registry only ever
 * ADDS what was previously missing.
 */
export function resolveDashboardWidgets(
  plugins: PluginMetadata[] | undefined,
  registered: RegisteredWidgetMeta[] | undefined,
  hasPermission: (permission: string) => boolean
): DashboardWidget[] {
  // Widget ids are plugin-local, so two plugins can ship the same one -- and a
  // registration can collide with a contribution. The id is what keys a batch
  // result back to its card, so a duplicate would hand both widgets the same
  // slot -- one of them showing the other's number, with nothing visibly wrong.
  // First declaration wins and the rest are dropped.
  const seen = new Set<string>();

  const take = (
    id: string,
    resolve: () => DashboardWidget | undefined
  ): DashboardWidget[] => {
    if (seen.has(id)) return [];
    const widget = resolve();
    if (!widget) return [];
    seen.add(id);
    return [widget];
  };

  return [
    ...declaredWidgets(plugins).flatMap(meta =>
      take(meta.id, () => resolveOne(meta, hasPermission))
    ),
    ...(registered ?? []).flatMap(meta =>
      take(meta.id, () => resolveRegistered(meta, hasPermission))
    ),
  ];
}
