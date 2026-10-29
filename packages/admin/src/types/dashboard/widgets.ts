/**
 * What the admin knows about a dashboard widget and about the data one asked
 * for.
 *
 * The shared vocabulary (`WidgetSizeBounds`, `WidgetArchetype`, `WidgetQuery`) is
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
  GetStartedAnswer,
  WidgetAction,
  WidgetArchetype,
  SourcelessWidgetQuery,
  WidgetQuery,
  WidgetQueryCell,
  WidgetSizeBounds,
  WidgetStatCell,
  WidgetDefinition,
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
  /**
   * The sizes this widget's cards may take, in grid units, with every end
   * filled in: the size a new card starts at, and the smallest and largest it
   * may be resized to.
   *
   * Resolved ONCE from the declaration, through core's `sizeBounds`, so the
   * grid, the card menu and the editor read one answer and none of them fills
   * a missing end its own way.
   */
  size: WidgetSizeBounds;
  /**
   * Present for the data archetypes; absent for `text`, `actions`, `custom`.
   * Sourceless for a widget offered per collection until its card is set to
   * one, and then never asked.
   */
  query?: WidgetQuery | SourcelessWidgetQuery;
  /**
   * Set when core builds this card's data on the server from the widget's
   * declaration: the card is asked for by its id, never by a query, and has none.
   */
  serverData?: true;
  /**
   * The display its loading state, and its row in the add panel, are drawn as
   * when that is not its archetype's: a declared widget drawn by its own
   * component says what it most looks like (its declaration's `skeleton`).
   */
  sketch?: string;
  /**
   * What a declared widget's empty state says and offers in place of the
   * frame's own: its action a link already made an href and already one this
   * reader may take (the server withholds one they may not), or the card's own
   * settings, which the card offers only where its reader can change them.
   */
  declaredEmpty?: {
    title?: string;
    action?:
      | { label: string; href: string }
      | { label: string; opensSettings: true };
  };
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
  cells?: WidgetStatCell[] | WidgetQueryCell[];
  /** Present for `custom`; the path `PluginSlot` resolves. */
  component?: string;
  /**
   * Who declared a widget drawn by its own component (`plugin "name"`), as core publishes it,
   * so a card whose component is missing can say whose it is. Absent for any other widget.
   */
  owner?: string;
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
   * Whether the card leaves the grid while its answer is empty, rather than drawing the empty
   * state. Never while it failed or is not available to the reader, and never in customise mode,
   * where it is shown marked so it can still be moved or removed.
   */
  hidesWhenEmpty?: boolean;
  /**
   * Whether this reader may send the card away from the card itself.
   *
   * Carried through because the CONTROL is drawn per card, outside edit mode,
   * and the cell has no other way to know a card offers one. Removing is what
   * it performs -- the placement stays in the arrangement marked removed -- so
   * a dismissed card is recoverable from the same controls as any other.
   */
  dismissible?: boolean;
  /**
   * Whether the batch sizes this `custom` widget's list query to the card, as
   * it does for the lists core draws: the rows the card's size draws and one
   * more. Unstated, a custom widget is asked exactly its declared query.
   */
  sizedQuery?: boolean;
  /**
   * The settings this widget's source narrows by rather than being replaced
   * by, as core published them for a registered widget; the knobs read them
   * when they apply the reader's settings to the query.
   */
  sourceFilters?: WidgetDefinition["sourceFilters"];
}

/**
 * What the server says about one widget's place on this reader's dashboard.
 *
 * Its sizes are not here: they are the widget's own, read from its
 * declaration (`DashboardWidget.size`). What is here is what only the server
 * can answer: whether a second card of the widget may be added, and where the
 * add panel lists it.
 */
export interface WidgetLayoutFacts {
  /** Whether the widget may be placed more than once. */
  allowsSeveral: boolean;
  /**
   * Where the add panel lists the widget, as core assigns it. Absent for a
   * widget the panel does not offer: one already placed is still drawn.
   */
  group?: AddPanelGroup;
  /** The collection a Content widget reads, or the plugin a Plugins one comes from. */
  subgroup?: string;
  /** The declaration's one line, for its row. */
  description?: string;
  /** The declaration's category: searched, and shown as a label, never a group. */
  category?: string;
  /** Which sketch draws its row: the widget's archetype. */
  sketch?: string;
  /**
   * Listed once per collection the reader may read, each row adding a card set to that
   * collection. @experimental
   */
  perCollection?: true;
  /**
   * The widget's place in the add panel's order, as core ranks it. Present for every widget the
   * panel lists, a placed one too, so the panel orders its rows without deciding an order itself.
   */
  rank?: number;
}

/**
 * The add panel's groups as core sends them, in the panel's order. "Removed
 * from your dashboard" is not one: it is the reader's own removed cards, read
 * from the arrangement.
 */
export type AddPanelGroup = "overview" | "content" | "team" | "plugins";

/**
 * One card in a reader's arrangement. Its position is its index in the list.
 *
 * Its size is `w` columns by `h` rows, and nothing else about its size is
 * stored: no position, no named width.
 */
export interface WidgetPlacement {
  /** Opaque, and unique within a layout. Not a widget id, except by default. */
  id: string;
  widgetId: string;
  /**
   * The columns the reader chose, kept as stored even when the widget's bounds
   * no longer allow it: the grid draws the nearest size inside them instead
   * (`drawnSize`), and the stored choice comes back if the widget allows it
   * again.
   */
  w: number;
  /** The rows the reader chose, kept as stored in the same way as `w`. */
  h: number;
  /**
   * A removed card stays in the list, size and settings included, so it can
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
   * Every widget this reader may see, with what the server says of its place
   * on the dashboard. Keyed by widget id.
   */
  widgets: Record<string, WidgetLayoutFacts>;
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
  /**
   * The Get started card's steps, from the computation that decided whether
   * the card is drawn, so the card and its steps cannot disagree. Absent from a
   * server that predates the card.
   *
   * @experimental
   */
  getStarted?: GetStartedLayoutView;
}

/** What the layout read says of the Get started card. */
export interface GetStartedLayoutView {
  /** Whether the reader's card is drawn. */
  drawn: boolean;
  /**
   * The steps with the reader's skips applied, or `null` when the server
   * worked none out: the card is removed (and its answer not asked for), or
   * not in this reader's dashboard.
   */
  answer: GetStartedAnswer | null;
}
