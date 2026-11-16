/**
 * The development preview read's answer, as the admin reads it
 * (`GET /api/_dev/widget-previews`, `{ items, meta }`).
 *
 * Restated here rather than imported: the server's module is not a published
 * entry, and the admin states every wire shape it reads in its own types, as
 * it does for the layout read. The data a case carries is typed by what the
 * card's slot carries (`WidgetResult`), which is published.
 *
 * @module components/features/widgets/preview/types
 */

import type { WidgetSizeBounds } from "nextly/config";
import type { WidgetResult } from "nextly/widget-result";

/** One case a widget declares, as its card's ready state is drawn from it. */
export interface WidgetPreviewCase {
  name: string;
  data: unknown;
  settings?: Record<string, unknown>;
  /** The data as the card's slot carries an answer. */
  result: WidgetResult;
}

/** One widget the reader may see, with what its states are drawn from. */
export interface WidgetPreview {
  id: string;
  title: string;
  /** Who declared it: `core`, a plugin, or the site config. */
  owner?: string;
  size: WidgetSizeBounds;
  /** A core view's name, or the component the widget draws itself with. */
  view: string | { component: string };
  /** Empty for a widget that declares no case. */
  preview: WidgetPreviewCase[];
  empty?: { message?: string; action?: { label: string } };
}
