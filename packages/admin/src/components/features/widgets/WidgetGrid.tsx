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
 */
function settledAnnouncement(
  isLoading: boolean,
  hasError: boolean,
  total: number,
  failed: number
): string | null {
  if (total === 0) return null;
  if (hasError) return "Dashboard widgets could not be updated.";
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

  // Only the archetypes that ASK for data. A `custom` widget fetches its own,
  // and putting it in the batch would send a query nothing reads.
  const requests = useMemo<WidgetQueryRequest[]>(
    () =>
      widgets.flatMap(widget =>
        widget.query ? [{ widgetId: widget.id, query: widget.query }] : []
      ),
    [widgets]
  );

  const { slots, isLoading, error, updatedAt } = useWidgetQueries(requests);

  const failed = useMemo(
    () => Object.values(slots).filter(slot => !slot.ok).length,
    [slots]
  );

  const [announcement, setAnnouncement] = useState("");
  // What was last spoken, so an unchanged outcome does not re-fire. A ref
  // rather than state because it must not itself cause a render.
  const spoken = useRef("");
  const next = settledAnnouncement(
    isLoading,
    error !== null,
    requests.length,
    failed
  );

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
            updatedAt={widget.query ? updatedAt : null}
          />
        </div>
      ))}
    </section>
  );
}
