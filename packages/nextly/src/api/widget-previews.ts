/**
 * GET /api/dashboard/widget-previews (development only)
 *
 * Every widget the reader may see, with what the development preview page
 * draws each from: its title, the sizes its cards may take, its view, its
 * declared `preview` cases and its empty state's words.
 *
 * 🔴 It never runs a widget's `load`, `shows`, `isEmpty` or access predicate.
 * A case is the author's own stand-in for an answer, so the page draws the
 * ready state from it as the card would draw a real one, and nothing here
 * reads content. The one piece of a case shaped here is how its card would
 * carry it (`cardAnswerResult`, the function a real answer passes through),
 * so a case and a real answer are drawn by one path.
 *
 * Which widgets are listed is `widgetAudience`'s answer, the one decision the
 * layout read and the workspace payload take: the site's rules, then each
 * widget's permission gate. Nothing here decides access again. What each card
 * shows for one person (`shows`, an access predicate or the collections it
 * reads) is judged per card with that person's data, which a preview has
 * none of; the page draws the "not available" state for every widget instead.
 *
 * Served only while the running server is a development server: the route
 * handler dispatches here only on `isDevServerRuntime()`, and otherwise the
 * request falls through to the built-in router, which knows no such path.
 *
 * @module api/widget-previews
 */

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { sizeFacts, type CanonicalWidget } from "../domains/widgets/canonical";
import { cardAnswerResult } from "../domains/widgets/declaration/card-answer";
import {
  declaredWidget,
  type DeclaredWidget,
} from "../domains/widgets/declaration/declared-widgets";
import {
  viewOfDisplay,
  type ComponentDisplay,
} from "../domains/widgets/declaration/displays";
import type { WidgetSizeBounds } from "../domains/widgets/grid-size";
import { getWidget, widgetSource } from "../domains/widgets/registry";
import type { WidgetResult } from "../domains/widgets/result";
import {
  widgetAudience,
  type WidgetAudience,
} from "../domains/widgets/visibility";

import { readAccessCaller, readCaller } from "./authenticated-read";
import { respondList, withSessionCacheHeaders } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/** One preview case, as the page draws the card's ready state from it. */
export interface WidgetPreviewCaseItem {
  name: string;
  /** The case's data, as declared. */
  data: unknown;
  /** The settings the case is drawn with, when it names any. */
  settings?: Readonly<Record<string, unknown>>;
  /** The data as the card's slot carries an answer (`cardAnswerResult`). */
  result: WidgetResult;
}

/** One widget the reader may see, as the preview page lists it. */
export interface WidgetPreviewItem {
  id: string;
  title: string;
  /** Who declared it: `core`, a plugin, or the site config. */
  owner?: string;
  /** The sizes its cards may take, every end filled in (`sizeFacts`). */
  size: WidgetSizeBounds;
  /** A core view's name, or the component a widget draws itself with. */
  view: string | ComponentDisplay;
  /** Its declared cases; empty for a widget that declares none. */
  preview: WidgetPreviewCaseItem[];
  /** Its empty state's words, as this reader is offered them. */
  empty?: { message?: string; action?: { label: string } };
}

/** The view a widget is listed under: as declared, or its definition's archetype. */
function viewOf(
  widget: CanonicalWidget,
  declared: DeclaredWidget | undefined
): WidgetPreviewItem["view"] {
  if (declared !== undefined) return declared.declaration.view;
  const definition = getWidget(widget.id);
  if (definition?.archetype === "custom" && definition.component) {
    return { component: definition.component };
  }
  return viewOfDisplay(definition?.archetype ?? widget.archetype ?? "custom");
}

/**
 * A declared widget's cases, each shaped as its card carries an answer. The
 * subject names the widget and its owner, as a refused real answer is logged.
 */
function casesOf(
  declared: DeclaredWidget | undefined
): WidgetPreviewCaseItem[] {
  if (declared === undefined) return [];
  const { declaration, display, owner } = declared;
  return (declaration.preview ?? []).map(entry => ({
    name: entry.name,
    data: entry.data,
    ...(entry.settings === undefined ? {} : { settings: entry.settings }),
    result: cardAnswerResult(display, entry.data, {
      widget: declaration.id,
      owner,
    }),
  }));
}

/**
 * The empty state's words as published, with its action's label only where
 * this reader holds the action's permission: the reading the workspace
 * payload withholds an empty action by (`audience.holds`).
 */
function emptyOf(
  id: string,
  audience: WidgetAudience
): WidgetPreviewItem["empty"] | undefined {
  const empty = getWidget(id)?.empty;
  if (empty === undefined) return undefined;
  const { action } = empty;
  const gate =
    action !== undefined && "requiredPermission" in action
      ? action.requiredPermission
      : undefined;
  return {
    ...(empty.message === undefined ? {} : { message: empty.message }),
    ...(action !== undefined && audience.holds(gate)
      ? { action: { label: action.label } }
      : {}),
  };
}

/**
 * What the preview page lists for one reader's audience, in canonical order.
 * Exported for its tests, which hand it an audience directly.
 */
export function widgetPreviewItems(
  audience: WidgetAudience
): WidgetPreviewItem[] {
  return audience.visible.map(widget => {
    const declared = declaredWidget(widget.id);
    const owner = declared?.owner ?? widgetSource(widget.id) ?? widget.plugin;
    const empty = emptyOf(widget.id, audience);
    return {
      id: widget.id,
      // A widget contributed in the old shape may state no title; the admin
      // names it from its own declaration, and the id stands in here.
      title:
        declared?.declaration.title ?? getWidget(widget.id)?.title ?? widget.id,
      ...(owner === undefined ? {} : { owner }),
      size: sizeFacts(widget).size,
      view: viewOf(widget, declared),
      preview: casesOf(declared),
      ...(empty === undefined ? {} : { empty }),
    };
  });
}

/**
 * The read. Authentication first, then the one audience decision, then the
 * list, as one page: the whole set is small and already in memory.
 */
export const getWidgetPreviews = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const caller = readAccessCaller(await readCaller(auth));
  const items = widgetPreviewItems(await widgetAudience(caller));
  // One synthetic page keeps the canonical list shape; the answer is per
  // reader, so it is private to the session asking.
  return withSessionCacheHeaders(
    respondList(items, {
      total: items.length,
      page: 1,
      limit: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    })
  );
});
