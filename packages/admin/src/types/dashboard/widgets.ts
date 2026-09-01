/**
 * What the admin knows about a dashboard widget and about the data one asked
 * for.
 *
 * The enum vocabulary (`WidgetSize`, `WidgetArchetype`, `WidgetQuery`) is
 * IMPORTED from core rather than restated, through `nextly/config`: this
 * package's tsconfig maps the bare `nextly` specifier to `../nextly/src`, so
 * importing from `"nextly"` shadows the package exports and drags core's whole
 * source tree in behind internal aliases this project does not declare.
 * Subpaths escape that mapping and resolve through the export map, exactly as a
 * consumer's import would.
 *
 * Two shapes below are declared here rather than imported, because
 * `nextly/config` does not re-export them: core's `WidgetDefinition` and
 * `WidgetResult` live in `domains/widgets`, which the config entry point
 * deliberately keeps out (its barrel carries `executeWidgetQuery`, and through
 * it the Direct API). `WidgetResult` is the wire shape of one slot in
 * `POST /api/dashboard/query`, so it is a client contract regardless of where
 * the server happens to declare it.
 *
 * @module types/dashboard/widgets
 */

import type { WidgetArchetype, WidgetQuery, WidgetSize } from "nextly/config";

/**
 * One executed query's payload, as `POST /api/dashboard/query` sends it.
 *
 * Discriminated on `op` so a body that asked for a count and a body that asked
 * for a list cannot be read as each other — a renderer that reaches for
 * `total` on a list result must fail to compile, not print `undefined`.
 */
/** One column of a list result, as the server described it. */
export interface WidgetResultField {
  name: string;
  /** Absent when the source has no human label for this field. */
  label?: string;
}

export type WidgetResult =
  | { op: "count"; total: number }
  | {
      op: "list";
      items: Record<string, unknown>[];
      /** The selected columns, present only when the query declared `select`. */
      fields?: WidgetResultField[];
    };

/**
 * One slot of the batch response, positionally matched to one query.
 *
 * A failure is a value here, not a thrown error, because the batch answers 200
 * with the other widgets' data intact: one widget's failure must colour one
 * card, not blank the dashboard.
 */
export type WidgetSlot =
  | { ok: true; result: WidgetResult }
  | { ok: false; error: string };

/** The whole batch response body. */
export interface WidgetQueryBatchResponse {
  results: WidgetSlot[];
}

/**
 * A widget as the grid renders it: every field the card and the archetype need,
 * with nothing optional that the renderer would have to invent a default for.
 *
 * Plugin contributions arrive as `PluginWidgetMeta`, whose declarative half is
 * all optional (a widget may still be nothing but a `component`). `resolve`
 * in `resolve-widgets.ts` is the one place that gap is closed, so the renderer
 * below it never has to ask whether a title exists.
 */
export interface DashboardWidget {
  id: string;
  title: string;
  description?: string;
  /** Lucide icon name, resolved to a component by the card. */
  icon?: string;
  archetype: WidgetArchetype;
  size: WidgetSize;
  /** Present for the data archetypes; absent for `text`, `actions`, `custom`. */
  query?: WidgetQuery;
  /** Present for `custom`; the path `PluginSlot` resolves. */
  component?: string;
  link?: { label: string; href: string };
}
