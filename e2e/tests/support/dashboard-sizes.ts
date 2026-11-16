/**
 * The sizes a dashboard widget's cards may take, as the admin reads them.
 *
 * A spec that writes a layout puts each card at a size its widget allows: the
 * layout write holds a changed size to the widget's bounds. The bounds are read
 * from where the admin itself reads them, the workspace payload's widget
 * declarations, with every end filled in by core's own `sizeBounds`, and a
 * contributed widget that states no size given core's `UNSTATED_WIDGET_SIZE`,
 * as the admin gives it: one rule, imported rather than restated.
 */
import { expect, type Page } from "@playwright/test";
import { sizeBounds, UNSTATED_WIDGET_SIZE } from "nextly/config";

export interface GridSize {
  w: number;
  h: number;
}

export interface SizeBounds {
  default: GridSize;
  min: GridSize;
  max: GridSize;
}

interface DeclaredSize {
  default: GridSize;
  min?: GridSize;
  max?: GridSize;
}

interface Workspace {
  widgets?: Array<{ id: string; size?: DeclaredSize }>;
  plugins?: Array<{ widgets?: Array<{ id: string; size?: DeclaredSize }> }>;
}

/** The size bounds of `widgetId`, or a failure naming it when the reader is not shown it. */
export async function sizeBoundsOf(
  page: Page,
  widgetId: string
): Promise<SizeBounds> {
  const read = await page.request.get("/admin/api/admin-meta/workspace");
  expect(read.ok()).toBe(true);
  const workspace = (await read.json()) as Workspace;
  const registered = (workspace.widgets ?? []).find(
    widget => widget.id === widgetId
  );
  if (registered?.size !== undefined) return sizeBounds(registered.size);
  // A contributed widget may state no size; the admin starts it at core's own
  // unstated size, so a spec writes it there too.
  const contributed = (workspace.plugins ?? [])
    .flatMap(plugin => plugin.widgets ?? [])
    .find(widget => widget.id === widgetId);
  if (contributed !== undefined) {
    return sizeBounds(contributed.size ?? UNSTATED_WIDGET_SIZE);
  }
  throw new Error(`${widgetId} declares no size this reader is shown`);
}

/** The size a new card of `widgetId` starts at. */
export async function defaultSizeOf(
  page: Page,
  widgetId: string
): Promise<GridSize> {
  return (await sizeBoundsOf(page, widgetId)).default;
}

/** The widest size a card of `widgetId` may take, at its default height. */
export async function widestSizeOf(
  page: Page,
  widgetId: string
): Promise<GridSize> {
  const bounds = await sizeBoundsOf(page, widgetId);
  return { w: bounds.max.w, h: bounds.default.h };
}

/** The height of a card `h` rows high: 72 px rows with 16 px between them. */
export function cardHeightPx(h: number): number {
  return h * 72 + (h - 1) * 16;
}
