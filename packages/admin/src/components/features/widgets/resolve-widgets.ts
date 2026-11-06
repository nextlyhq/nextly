/**
 * Turns the widgets the workspace payload publishes into what the grid can
 * render.
 *
 * Every widget reaches the payload through the registry: core's own, a
 * plugin's `contributes.dashboard.widgets` and the site config's. A
 * `RegisteredWidgetMeta` arrives over the wire, while `DashboardWidget` is the
 * shape the renderer works from, with no field it would have to invent a
 * default for. Closing that gap in ONE function is what keeps the defaults out
 * of the renderer, where "title ?? id" would end up written once per archetype
 * and would drift.
 *
 * @module components/features/widgets/resolve-widgets
 */

import {
  sizeBounds,
  sizeDeclarationProblems,
  UNSTATED_WIDGET_SIZE,
  type WidgetSizeBounds,
  type WidgetSizeDeclaration,
} from "nextly/config";
import { widgetGateHolds } from "nextly/widget-gate";

import { adminHref } from "@admin/constants/routes";
import type { RegisteredWidgetMeta } from "@admin/types/branding";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

/**
 * A title with visible text, falling back to the widget's id.
 *
 * TRIMMED, not merely nullish-checked, though the registry refuses a blank
 * title: the payload arrives over the wire from a server that may be another
 * version. The title is the card region's `aria-labelledby` target, so an
 * empty one makes a landmark with no accessible name, which is worse for a
 * screen-reader user than having no landmark at all. The id is a poor title
 * and it NAMES the widget, which is the one thing a card in that state has to
 * be able to do.
 */
function resolveTitle(title: string | undefined, id: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : id;
}

/**
 * A widget's size bounds, every end filled in, through core's own `sizeBounds`.
 *
 * Read permissively, as everything here is: a widget arrives over the wire from
 * a server that may be another version. One stating none, and one the grid
 * could not use (no default, a minimum above the default), take core's
 * `UNSTATED_WIDGET_SIZE`, the size the server gives a widget stating none,
 * rather than sizes no check ever accepted; the boot check is what refuses a
 * malformed one to its author.
 */
function boundsOf(
  declared: WidgetSizeDeclaration | undefined
): WidgetSizeBounds {
  return declared !== undefined &&
    sizeDeclarationProblems(declared).length === 0
    ? sizeBounds(declared)
    : sizeBounds(UNSTATED_WIDGET_SIZE);
}

/**
 * One registered widget as the grid renders it, or `undefined` when the user
 * may not see it.
 *
 * A registered widget is a `defineWidget` declaration as the registry
 * publishes it: its title, archetype and size, with a component for `custom`.
 * Nothing here has a default to invent, and giving it one would quietly
 * accept a definition the registry would have refused.
 *
 * `hasPermission` is the `useCurrentUserPermissions` predicate, which is
 * closed-until-loaded: an undeclared permission renders, a declared one does
 * not render until the grant is known. Gating HERE rather than inside the card
 * is what keeps a denied widget's card out of the batch: a card that is never
 * mounted must not cause a request on the user's behalf.
 */
function resolveRegistered(
  meta: RegisteredWidgetMeta,
  hasPermission: (permission: string) => boolean
): DashboardWidget | undefined {
  if (!widgetGateHolds(meta.requiredPermission, hasPermission)) {
    return undefined;
  }

  return {
    id: meta.id,
    title: resolveTitle(meta.title, meta.id),
    description: meta.description,
    icon: meta.icon,
    archetype: meta.archetype,
    // A size that arrived malformed over the wire takes the unstated size.
    size: boundsOf(meta.size),
    // What its loading state is drawn as, where it is not its archetype's.
    ...(meta.sketch === undefined ? {} : { sketch: meta.sketch }),
    ...declaredEmptyOf(meta.empty),
    settings: meta.settings,
    component: meta.component,
    ...(meta.owner === undefined ? {} : { owner: meta.owner }),
    defaultOrder: meta.defaultOrder,
    hidesWhenEmpty: meta.hidesWhenEmpty,
  };
}

/**
 * The visible widgets, each id appearing once, in the order the registry
 * publishes them, sorted by any order a widget states.
 *
 * The id is what keys a batch result back to its card, so a duplicate in a
 * malformed payload would hand both cards the same slot -- one of them showing
 * the other's number, with nothing visibly wrong. The FIRST entry for an id
 * names it, and the id is claimed before its permission is judged, so a later
 * duplicate never takes the place of one this reader may not see.
 */
export function resolveDashboardWidgets(
  registered: RegisteredWidgetMeta[] | undefined,
  hasPermission: (permission: string) => boolean
): DashboardWidget[] {
  const seen = new Set<string>();
  const widgets = (registered ?? []).flatMap(meta => {
    if (seen.has(meta.id)) return [];
    seen.add(meta.id);
    const widget = resolveRegistered(meta, hasPermission);
    return widget ? [widget] : [];
  });

  // The sentinel is INFINITY, not `MAX_SAFE_INTEGER`. `validateDefaultOrder`
  // accepts any finite number, and `Number.MAX_VALUE` is finite and far above
  // `MAX_SAFE_INTEGER` -- so that sentinel let a widget with a perfectly valid
  // order sort BELOW widgets claiming none. Infinity is above the whole
  // accepted range by construction, and nothing can tie with it because
  // non-finite values are refused at declaration.
  //
  // STABLE, which `Array.prototype.sort` has guaranteed since ES2019: widgets
  // stating no order compare equal and keep the order they were published in.
  return widgets.sort(
    (a, b) =>
      (a.defaultOrder ?? Number.POSITIVE_INFINITY) -
      (b.defaultOrder ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * A declared widget's empty state as its card draws it: the declared message as
 * the empty state's title, and its action with its link made an href, or the
 * card's settings. An action whose link is not a path relative to the admin is
 * not drawn.
 */
/** A declared empty action as the card offers it, or none when its link leads nowhere here. */
function declaredActionOf(
  action: NonNullable<RegisteredWidgetMeta["empty"]>["action"]
): NonNullable<DashboardWidget["declaredEmpty"]>["action"] {
  if (action === undefined) return undefined;
  // By the value, as the server published it; never by the key alone.
  if ("opens" in action && action.opens === "settings") {
    return { label: action.label, opensSettings: true };
  }
  if (!("link" in action)) return undefined;
  const href = adminHref(action.link);
  return href === undefined ? undefined : { label: action.label, href };
}

function declaredEmptyOf(
  empty: RegisteredWidgetMeta["empty"]
): Pick<DashboardWidget, "declaredEmpty"> {
  if (empty === undefined) return {};
  const action = declaredActionOf(empty.action);
  const declared = {
    ...(empty.message === undefined ? {} : { title: empty.message }),
    ...(action === undefined ? {} : { action }),
  };
  return Object.keys(declared).length === 0 ? {} : { declaredEmpty: declared };
}
