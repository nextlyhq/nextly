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

import type {
  WidgetAction,
  WidgetArchetype,
  WidgetHeight,
  WidgetQuery,
  WidgetSize,
  WidgetStatCell,
  WidgetChrome,
} from "nextly/config";

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
  /**
   * The DECLARED default height, when its author stated one.
   *
   * Carried for the same reason as `defaultOrder`: it is the value a placement
   * seeds its own geometry FROM. The server already copies it onto a default
   * placement, so an admin that dropped it here could not re-create a card the
   * reader removed with the height it was declared with.
   */
  height?: WidgetHeight;
  /** Present for the data archetypes; absent for `text`, `actions`, `custom`. */
  query?: WidgetQuery;
  /**
   * Present for `stats`: one entry per number the card draws.
   *
   * Each carries its own query, so the card's numbers are ordinary
   * access-controlled reads rather than one composite answer.
   */
  cells?: WidgetStatCell[];
  /** Present for `custom`; the path `PluginSlot` resolves. */
  component?: string;
  /**
   * Present for `actions`, already filtered to the shortcuts this reader may
   * use — `resolve-widgets` drops the rest, so the renderer never sees one it
   * must hide.
   */
  actions?: WidgetAction[];
  link?: { label: string; href: string };
  /**
   * The DECLARED default position, ascending; absent means "after everything
   * that states one".
   *
   * Carried through rather than consumed and dropped, because it is the value a
   * stored layout defaults each placement's own order FROM. Resolving it here
   * and discarding it would make that a second derivation of the same fact.
   */
  defaultOrder?: number;
  /**
   * Whether the host frames this widget; `"card"` when unstated.
   *
   * `"none"` belongs to a widget that is already a designed surface -- core's
   * dashboard sections carry their own heading and rules, so framing one draws
   * a second heading around the first.
   */
  chrome?: WidgetChrome;
}

/**
 * One card's place in a reader's arrangement.
 *
 * 🔴 `size` and `height` are `string`, not the size/height unions, and that is
 * load-bearing rather than sloppy. A placement's geometry is seeded from a
 * widget's declaration, and that widget may come from a plugin built against a
 * NEWER core — so a stored arrangement can legitimately name a size this admin
 * has never heard of. `widgetSpanClass` already survives one by falling back;
 * a narrower type here would be a promise this client cannot keep, and would
 * push the lie into every consumer.
 */
export interface WidgetPlacement {
  /** Opaque, and unique within a layout. Not a widget id, except by default. */
  id: string;
  widgetId: string;
  /**
   * Which column this card sits in, 0-based.
   *
   * Optional on the wire because a row written before columns existed carries
   * none, and the server migrates those on read rather than refusing them — so
   * a client that treats absent as column 0 agrees with the server instead of
   * inventing a second answer.
   */
  column?: number;
  order: number;
  hidden: boolean;
  size?: string;
  height?: string;
  config?: Record<string, unknown>;
}

/** What `GET /api/dashboard/layout` answers. */
export interface DashboardLayoutResponse {
  placements: WidgetPlacement[];
  /**
   * How many columns this reader's arrangement is drawn in.
   *
   * The SERVER's answer, not a client default: the count decides which column
   * a placement's coordinate names, so drawing a stored arrangement in a count
   * the client picked would render something the reader never arranged — and
   * then save it back on their next edit.
   */
  columnCount?: number;
  /**
   * Widget ids this reader may see and has not placed.
   *
   * The server's answer, not something to re-derive here: it is the only party
   * that filters by permission authoritatively. A newly installed widget is
   * never inserted into an arrangement behind the reader's back, so this is
   * what makes it reachable at all.
   */
  available: string[];
  version: number;
  /** Which layer the arrangement came from: their own row, or the registry. */
  source: "own" | "default";
  /**
   * An opaque token for the set of widgets this reader could see when the
   * arrangement was read. Echoed back on write; a mismatch is a 409.
   */
  scope: string;
}
