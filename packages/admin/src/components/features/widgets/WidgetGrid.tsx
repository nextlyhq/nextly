"use client";

/**
 * The dashboard's widget grid.
 *
 * Twelve columns, one cell per visible widget, and ONE request for all of them.
 * The grid is where the three cross-cutting decisions live, because none of
 * them can be made correctly by a widget on its own:
 *
 * - **Batching.** Every visible widget's query goes out together, so a
 *   dashboard costs one round trip rather than one per card.
 * - **Gating.** A widget the user may not see is dropped before its query is
 *   collected, so a denied card causes no request on their behalf.
 * - **Announcement.** ONE live region for the whole grid, following
 *   `EntryForm/DocumentStatusLive`. Ten widgets each announcing their own
 *   refresh would interrupt each other, and a reader could not tell which
 *   announcement belonged to what they just did — so the grid speaks once, for
 *   the batch, and the cards stay silent.
 *
 * @module components/features/widgets/WidgetGrid
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import {
  useWidgetQueries,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { cn } from "@admin/lib/utils";

import { coreDraws, resolveWidgetOutcome } from "./outcome";
import { resolveDashboardWidgets } from "./resolve-widgets";
import { widgetSpanClass } from "./sizes";
import { WidgetRenderer } from "./WidgetRenderer";

/**
 * What the grid says once a batch settles, or `null` for a state not worth
 * interrupting a reader for.
 *
 * Mid-flight says nothing, for the same reason `DocumentStatusLive` stays quiet
 * during a save: this grid refetches on every window focus, and announcing the
 * start of each refresh would speak over the reader every time they came back
 * to the tab. What matters is where it came to rest.
 *
 * `failed` counts CARDS THAT SHOW AN ERROR, not slots the server marked bad,
 * and the two are different numbers. There is no separate "the whole request
 * failed" sentence either: a rejected request gives every widget in it a failed
 * slot, so the counts already say so -- and with the requests partitioned, one
 * batch failing does not mean the dashboard did.
 */
function settledAnnouncement(
  isLoading: boolean,
  total: number,
  failed: number
): string | null {
  if (total === 0) return null;
  if (isLoading) return null;
  const loaded = total - failed;
  const noun = total === 1 ? "widget" : "widgets";
  return failed > 0
    ? `${loaded} of ${total} ${noun} updated, ${failed} failed.`
    : `${loaded} of ${total} ${noun} updated.`;
}

export function WidgetGrid() {
  const branding = useBranding();
  const { hasPermission } = useCurrentUserPermissions();

  // Both channels a widget can reach the dashboard by: `contributes.admin.widgets`
  // and the registry `registerWidget` writes to. Reading only the first made the
  // registry invisible to the renderer built around it.
  const widgets = useMemo(
    () =>
      resolveDashboardWidgets(
        branding?.plugins,
        branding?.widgets,
        hasPermission
      ),
    [branding, hasPermission]
  );

  // Every widget that DECLARED a query, archetype notwithstanding. `custom` is
  // included on purpose: core's widget validator puts it in neither the data
  // set nor the query-less set, because a widget that draws its own body may
  // still want the host to run its request -- and `WidgetRenderer` hands the
  // resulting slot to the plugin component. A widget that declares no query
  // contributes nothing here, which is what keeps a dashboard of plugin
  // components from issuing a request at all.
  const requests = useMemo<WidgetQueryRequest[]>(
    () =>
      widgets.flatMap(widget =>
        // A query is only worth running if SOMETHING can draw its result. A
        // widget naming an archetype core cannot draw yet, and shipping no
        // component to draw it instead, resolves to a card that reads "not
        // rendered yet" -- so asking for the data spends an access-checked
        // read, and one of the batch's limited slots, on a result thrown away
        // on arrival. `custom` always draws, because the plugin's component
        // decides what to do with the slot.
        //
        // Asked of `coreDraws` rather than listed here, so the read starts
        // happening on its own the day core learns to draw one -- and asked of
        // the whole DECLARATION, not just the archetype, because a renderer
        // that will refuse this particular widget makes the read just as
        // wasted as no renderer at all.
        widget.query && (widget.archetype === "custom" || coreDraws(widget))
          ? [{ widgetId: widget.id, query: widget.query }]
          : []
      ),
    [widgets]
  );

  const { slots, isFetching, updatedAt } = useWidgetQueries(requests);

  // Which widgets are actually IN the batch, taken from the requests that were
  // sent rather than re-derived from `widget.query`.
  //
  // Those two disagree, and the disagreement is the whole point of this set: a
  // widget declaring a query whose archetype nothing can draw is deliberately
  // left out of the batch above, but it still HAS a `widget.query`. Testing
  // that field again below gave such a card a freshness line for a request that
  // never ran, and marked it `aria-busy` during someone else's refetch.
  const requested = useMemo(
    () => new Set(requests.map(request => request.widgetId)),
    [requests]
  );

  // The same answer the cards are drawn from, so the announcement cannot
  // describe a dashboard other than the one on screen. Counting slots instead
  // said "3 of 3 widgets updated" while a card read "the list archetype is not
  // rendered yet": the response was fine and the card was not.
  //
  // Only widgets that ASKED are counted, and self-drawn ones are dropped even
  // when they did. A plugin component decides what it shows from the slot it
  // was handed, so core cannot say whether it worked, and guessing either way
  // would put a number in the reader's ear that nothing on screen supports.
  const counted = useMemo(
    () =>
      widgets
        .filter(widget => widget.query)
        .map(widget => resolveWidgetOutcome(widget, slots[widget.id]))
        .filter(outcome => outcome.state !== "self-drawn"),
    [widgets, slots]
  );
  const failed = counted.filter(outcome => outcome.state === "failed").length;
  const settling = counted.some(outcome => outcome.state === "loading");

  const [announcement, setAnnouncement] = useState("");
  // What was last spoken, so an unchanged outcome does not re-fire. A ref
  // rather than state because it must not itself cause a render.
  const spoken = useRef("");
  const next = settledAnnouncement(settling, counted.length, failed);

  useEffect(() => {
    if (!next || next === spoken.current) return;
    spoken.current = next;
    setAnnouncement(next);
  }, [next]);

  // Nothing to draw. Returned after the hooks above so the hook order is the
  // same on every render, whatever the branding says.
  if (widgets.length === 0) return null;

  return (
    <section aria-label="Dashboard widgets" className="grid grid-cols-12 gap-6">
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="widget-grid-live"
      >
        {announcement}
      </span>
      {widgets.map(widget => (
        <div
          key={widget.id}
          data-testid={`widget-cell-${widget.id}`}
          className={cn(widgetSpanClass(widget.size))}
        >
          <WidgetRenderer
            definition={widget}
            slot={slots[widget.id]}
            updatedAt={requested.has(widget.id) ? updatedAt : null}
            // Only a widget that actually ASKED can be waiting on an answer. A
            // card drawn entirely by a plugin component took no part in the
            // batch, and neither did one whose archetype nothing can draw, so a
            // refetch says nothing about either.
            isFetching={requested.has(widget.id) ? isFetching : false}
          />
        </div>
      ))}
    </section>
  );
}
