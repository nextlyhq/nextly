/**
 * The gallery read a dashboard test's layout fixture implies, for the suites that drive the
 * whole grid: a row for each widget the layout describes or offers, under the server's rule (a
 * widget the reader may add, or one it holds a card of, removed or not), with the size its
 * declaration states.
 *
 * Only what those suites read: they test the grid's side of an add (where it lands, what it
 * rings, where focus goes), not what the server offers, which the gallery's own integration
 * tests cover.
 */
import { sizeBounds, type WidgetSizeDeclaration } from "nextly/config";

import type { DashboardLayoutResponse } from "@admin/types/dashboard/widgets";

import type { GalleryRead, GalleryTile } from "../add-panel-model";

/** A widget as the suites' branding fixtures declare it. */
interface FixtureWidget {
  id: string;
  title?: string;
  size?: WidgetSizeDeclaration;
}

export function galleryFromLayout(
  layout: Pick<DashboardLayoutResponse, "placements" | "widgets" | "available">,
  widgets: readonly FixtureWidget[]
): GalleryRead {
  const ids = [
    ...new Set([
      ...layout.available,
      ...Object.keys(layout.widgets),
      ...layout.placements.map(p => p.widgetId),
    ]),
  ];
  // Removed cards count: a one-card widget's removed card comes back from its row.
  const held = (id: string) => layout.placements.some(p => p.widgetId === id);
  const tiles = ids.flatMap((id): GalleryTile[] => {
    const offered = layout.available.includes(id);
    if (!offered && !held(id)) return [];
    const widget = widgets.find(each => each.id === id);
    return [
      {
        id,
        name: widget?.title ?? id,
        size: sizeBounds(widget?.size ?? { default: { w: 12, h: 3 } }),
        allowsSeveral: layout.widgets[id]?.allowsSeveral ?? false,
      },
    ];
  });
  return { tiles, collections: [] };
}

/** Whether a GET is the gallery read. */
export function isGalleryPath(path: string): boolean {
  return path.startsWith("/dashboard/gallery");
}
