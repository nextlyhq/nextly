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

import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useDashboardLayout } from "@admin/hooks/queries/useDashboardLayout";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import { registerCoreWidgetComponents } from "./core-components";
import { AddWidgetPicker } from "./edit/AddWidgetPicker";
import { ArrangedCell } from "./edit/ArrangedCell";
import { DashboardEditChrome } from "./edit/DashboardEditChrome";
import { useDashboardArrangement } from "./edit/useDashboardArrangement";
import { resolveDashboardWidgets } from "./resolve-widgets";
import { useWidgetBatch } from "./useWidgetBatch";

// At module scope, before any render. `PluginSlot` resolves a path DURING
// render, so registering from an effect would land after the first paint and
// every core card would show its unresolved fallback once on the way in.
registerCoreWidgetComponents();

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

/**
 * What the grid shows when it holds no widget, which is three different facts.
 *
 * Its own component because the distinction is not the grid's job: the grid
 * draws widgets, and "there are none", "we have not been told yet" and "we
 * could not find out" are a separate question with a separate answer each.
 * Separate also because the grid's own body is already long: dispatching
 * widgets and choosing between three fallbacks are different jobs, and folding
 * them together put three more branches in a function that draws.
 *
 * The distinction itself is the branding provider's to make, not this
 * component's: `isUnavailable` means admin-meta never produced an answer, while
 * a failed BACKGROUND refetch over a cached response leaves that response valid
 * and is deliberately not reported.
 */
function NothingToDraw({
  isPending,
  isUnavailable,
}: {
  isPending: boolean;
  isUnavailable: boolean;
}) {
  if (isUnavailable) {
    return (
      <section
        aria-label="Dashboard widgets"
        data-testid="widget-grid-unavailable"
        className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
      >
        Your dashboard could not be loaded. It will reappear once the connection
        recovers.
      </section>
    );
  }

  if (isPending) {
    // Placeholders rather than nothing, so the page does not reflow from empty
    // to full as the answer lands. Three, matching the sections a default
    // install draws; `aria-hidden` because the grid's own live region already
    // speaks for it and a screen reader gains nothing from three empty boxes.
    return (
      <section
        aria-label="Dashboard widgets"
        data-testid="widget-grid-loading"
        className="grid grid-cols-12 gap-6"
      >
        {[0, 1, 2].map(row => (
          <div
            key={row}
            aria-hidden
            className="col-span-12 mb-6 h-32 animate-pulse rounded-lg bg-muted"
          />
        ))}
      </section>
    );
  }

  return null;
}

export function WidgetGrid() {
  const branding = useBranding();
  const { isPending, isUnavailable } = useBrandingStatus();
  const { hasPermission } = useCurrentUserPermissions();

  // Both channels a widget can reach the dashboard by: `contributes.admin.widgets`
  // and the registry `registerWidget` writes to. Reading only the first made the
  // registry invisible to the renderer built around it.
  const declared = useMemo(
    () =>
      resolveDashboardWidgets(
        branding?.plugins,
        branding?.widgets,
        hasPermission
      ),
    [branding, hasPermission]
  );

  const announceMove = useCallback(
    (title: string, position: number, count: number) => {
      // The zero-width space alternates the string, because a live region does
      // not re-announce text that did not change -- and moving a card up twice
      // produces the same sentence both times. Same device as the builder's
      // `keyboard-actions`, which is where this grid's convention comes from.
      setAnnouncement(
        current =>
          `${title} moved to position ${position} of ${count}.${
            current.endsWith("\u200b") ? "" : "\u200b"
          }`
      );
    },
    []
  );

  const layout = useDashboardLayout();
  const {
    visible,
    editor,
    hasArrangement,
    sortableItems,
    sensors,
    handleDragEnd,
  } = useDashboardArrangement(declared, layout, announceMove);

  const byId = useMemo(
    () => new Map(declared.map(widget => [widget.id, widget])),
    [declared]
  );

  const widgets = useMemo(() => visible.map(row => row.widget), [visible]);

  const { slots, isFetching, updatedAt, requested, counted, failed, settling } =
    useWidgetBatch(widgets);

  const [announcement, setAnnouncement] = useState("");

  // A reorder speaks through the grid's ONE region, not a second one.
  //
  // The reason is the reason that region exists: several announcers on one
  // surface interrupt each other, and a reader cannot tell which announcement
  // belonged to what they just did. That argument does not weaken because the
  // second announcer is the grid itself rather than a card.
  //
  // Nothing is clobbered by sharing it. The batch effect below fires only when
  // its OWN sentence changes, and a move does not change it — so a move
  // message survives until the batch has something new to say, which is
  // precisely when it should stop being the latest news.

  // The drag path and the button path move a card through the SAME function.
  // Two implementations of "where does this land" agree until one of them is
  // edited, and a grid whose drag and whose buttons disagreed would be
  // impossible to reason about from either.

  // What was last spoken, so an unchanged outcome does not re-fire. A ref
  // rather than state because it must not itself cause a render.
  const spoken = useRef("");
  const next = settledAnnouncement(settling, counted, failed);

  useEffect(() => {
    if (!next || next === spoken.current) return;
    spoken.current = next;
    setAnnouncement(next);
  }, [next]);

  // Nothing to draw. Returned after the hooks above so the hook order is the
  // same on every render, whatever the branding says.
  // THREE outcomes, not two. Every card on the dashboard now arrives through
  // the workspace query, so an empty list is no longer proof that there is
  // nothing to draw -- it is equally the shape of a request still in flight and
  // of one that never answered. Collapsing all three into `return null` blanked
  // the entire page on first paint and on any transient failure, where the
  // sections used to mount immediately and draw their own states.
  if (widgets.length === 0) {
    return (
      <NothingToDraw isPending={isPending} isUnavailable={isUnavailable} />
    );
  }

  return (
    <div className="space-y-4">
      <DashboardEditChrome
        editor={editor}
        hasArrangement={hasArrangement}
        canReset={layout.layout?.source === "own"}
        onReload={() => void layout.reload()}
      />

      <DndContext
        sensors={sensors}
        // `closestCenter` rather than pointer-within: the cells are different
        // widths, so a small card dragged over a full-width one never contains
        // the pointer and the drop target reads as nothing.
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortableItems}
          // The grid wraps, so cards move in two dimensions. The list strategy
          // assumes a single column and animates neighbours the wrong way.
          strategy={rectSortingStrategy}
        >
          <section
            aria-label="Dashboard widgets"
            className="grid grid-cols-12 gap-6"
          >
            <span
              role="status"
              aria-live="polite"
              className="sr-only"
              data-testid="widget-grid-live"
            >
              {announcement}
            </span>
            {visible.map((row, index) => (
              <ArrangedCell
                key={row.placementId}
                row={row}
                index={index}
                count={visible.length}
                isEditing={editor.isEditing}
                slot={slots[row.widget.id]}
                // Only a widget that actually ASKED can be waiting on an answer. A
                // card drawn entirely by a plugin component took no part in the
                // batch, and neither did one whose archetype nothing can draw, so a
                // refetch says nothing about either.
                updatedAt={requested.has(row.widget.id) ? updatedAt : null}
                isFetching={requested.has(row.widget.id) ? isFetching : false}
                onMove={(from, delta) => {
                  editor.moveBy(from, delta);
                  announceMove(
                    row.widget.title,
                    from + 1 + delta,
                    visible.length
                  );
                }}
                onToggleHidden={editor.toggleHidden}
                onRemove={editor.remove}
              />
            ))}
          </section>
        </SortableContext>
      </DndContext>

      {editor.isEditing ? (
        <AddWidgetPicker
          options={editor.available.map(widgetId => ({
            widgetId,
            // The declaration's own title where the admin can resolve it. The
            // id is a poor label and it is TRUE, which an invented one would
            // not be — a widget whose client bundle is absent still has to be
            // addable by name.
            title: byId.get(widgetId)?.title ?? widgetId,
          }))}
          onAdd={editor.add}
        />
      ) : null}
    </div>
  );
}
