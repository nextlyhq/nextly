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
  AnyWidgetSetting,
  WidgetAction,
  WidgetArchetype,
  WidgetHeight,
  WidgetQuery,
  WidgetSize,
  WidgetStatCell,
  WidgetChrome,
  WidgetWidth,
} from "nextly/config";

/*
 * 🔴 RE-EXPORTED from core, not restated here. These describe what
 * `POST /api/dashboard/query` sends, so the server that sends them declares
 * them; this package and every plugin are consumers of one definition.
 *
 * They were declared here for a real reason that has since been answered:
 * `nextly/config` deliberately excludes the widget barrel, because it carries
 * `executeWidgetQuery` and through it the Direct API graph. So a copy was made,
 * and the copies drifted -- this one was STRICTER than the server's own, which
 * declared a slot as `ok: boolean` with an optional `result?: unknown`, and so
 * promised readers a guarantee the producer had never made. `nextly/widget-result`
 * is a leaf entry carrying exactly these shapes and emitting a zero-byte
 * runtime chunk, which is what makes importing them cost nothing.
 */
export type {
  WidgetQueryBatchResponse,
  WidgetResult,
  WidgetResultField,
  WidgetSlot,
} from "nextly/widget-result";

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
   * What a reader may change about this card, as the widget declared it.
   *
   * The OFFER, not one reader's answer: the stored values live on the
   * placement, and `applyWidgetSettings` reads one against the other. Carried
   * here because the declaration is what says whether a stored key means
   * anything at all. Field settings and the four content settings alike.
   */
  settings?: AnyWidgetSetting[];
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
  /** Present for `text`: the markdown the host draws, validated non-blank at boot. */
  content?: string;
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
  /**
   * Whether this reader may send the card away from the card itself.
   *
   * Carried through because the CONTROL is drawn per card, outside edit mode,
   * and the cell has no other way to know a card offers one. Removing is what
   * it performs -- the placement stays in the arrangement marked removed -- so
   * a dismissed card is recoverable from the same controls as any other.
   */
  dismissible?: boolean;
}

/**
 * The five widths a card may be drawn at, narrowest first: core's own type,
 * from `nextly/config`, so a width core adds or renames reaches every table
 * keyed by it here as a type error rather than a card drawn wrongly.
 */
export type { WidgetWidth };

/**
 * What the server says about one widget's widths, for this reader.
 *
 * The admin never works a width out for itself: which widths a card may take,
 * where a new card starts and whether a second card of the widget may be added
 * are all answered by the server from the widget's declaration.
 */
export interface WidgetWidthFacts {
  /** Narrowest first, never empty. */
  allowedWidths: WidgetWidth[];
  /** The width a newly added card starts at. */
  defaultWidth: WidgetWidth;
  /** Whether the widget may be placed more than once. */
  allowsSeveral: boolean;
}

/**
 * One card in a reader's arrangement. Its position is its index in the list.
 *
 * 🔴 `width` is `string`, not {@link WidgetWidth}, and that is load-bearing
 * rather than sloppy. A newer core may store a width this admin has never heard
 * of, so the type promises only what this client can keep; the grid draws an
 * unknown width full, through the one function that decides a drawn width.
 */
export interface WidgetPlacement {
  /** Opaque, and unique within a layout. Not a widget id, except by default. */
  id: string;
  widgetId: string;
  /**
   * The width the reader chose, kept as stored even when the widget no longer
   * allows it: the grid draws the nearest allowed width instead, and the stored
   * choice comes back if the widget allows it again.
   */
  width: string;
  /**
   * A removed card stays in the list, width and settings included, so it can
   * be put back exactly where it was. It is not drawn.
   */
  removed: boolean;
  config?: Record<string, unknown>;
}

/** Which arrangement a read handed the reader. */
export type DashboardLayoutSource = "own" | "default" | "unreadable";

/** What `GET /api/dashboard/layout` answers. */
export interface DashboardLayoutResponse {
  /** The reader's cards, IN ORDER: the array order is the dashboard's order. */
  placements: WidgetPlacement[];
  /**
   * Every widget this reader may see, with the widths its cards may take.
   *
   * Keyed by widget id. A placement whose widget is missing here is drawn at
   * its stored width and offers no width choice.
   */
  widgets: Record<string, WidgetWidthFacts>;
  /**
   * Widget ids this reader may add: not placed, or allowed several times.
   *
   * The server's answer, not something to re-derive here: it is the only party
   * that filters by permission authoritatively. A newly installed widget is
   * never inserted into an arrangement behind the reader's back, so this is
   * what makes it reachable at all.
   */
  available: string[];
  /**
   * The default dashboard as this reader would see it, in order.
   *
   * Computed by the server, so a staged reset draws exactly the dashboard the
   * reader returns to once the reset is saved.
   */
  defaultPlacements: WidgetPlacement[];
  version: number;
  /**
   * Which layer the arrangement came from: their own row, the default, or the
   * default shown in place of a stored row the server could not read.
   */
  source: DashboardLayoutSource;
  /**
   * An opaque token for the set of widgets this reader could see when the
   * arrangement was read. Echoed back on write; a mismatch is a 409.
   */
  scope: string;
  /**
   * An opaque token for the audience the workspace payload is built for --
   * the cards this reader may see and the shortcut gates they hold inside
   * them. The workspace payload carries the same token as `widgetAudience`;
   * when the two differ, the payload was built for a different reader state
   * than this layout, and is read again.
   */
  audience: string;
}
