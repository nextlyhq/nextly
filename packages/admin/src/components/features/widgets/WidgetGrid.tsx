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

import { DndContext, closestCorners } from "@dnd-kit/core";
import { useCallback, useMemo, useRef } from "react";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useDashboardLayout } from "@admin/hooks/queries/useDashboardLayout";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import { registerCoreWidgetComponents } from "./core-components";
import { AddWidgetPicker } from "./edit/AddWidgetPicker";
import { ArrangedColumns } from "./edit/ArrangedColumns";
import { DashboardEditChrome } from "./edit/DashboardEditChrome";
import { useDashboardArrangement } from "./edit/useDashboardArrangement";
import { resolveDashboardWidgets } from "./resolve-widgets";
import { useGridAnnouncer } from "./useGridAnnouncer";
import { useWidgetBatch } from "./useWidgetBatch";

// At module scope, before any render. `PluginSlot` resolves a path DURING
// render, so registering from an effect would land after the first paint and
// every core card would show its unresolved fallback once on the way in.
registerCoreWidgetComponents();

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

/**
 * What the grid shows when the arrangement has emptied it out.
 *
 * A different question from {@link NothingToDraw}, which is about a dashboard
 * that has no widgets to offer at all. This one is about a reader who HAS
 * widgets and has put every one of them away -- so it says which way is back
 * rather than what went wrong.
 *
 * Its own component, and it decides for itself whether to draw, so the grid
 * body carries neither branch. Rendered inside the widgets section, so the
 * landmark and the live region stay where a reader left them.
 */

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

  // 🔴 A stable indirection, because these three hooks form a cycle: the
  // announcer needs the batch's outcome, the batch needs the widgets the
  // arrangement resolved, and the arrangement needs somewhere to announce a
  // move. The ref is the one link that can be filled in after the fact — the
  // wrapper's identity never changes, so nothing downstream re-renders on it,
  // and by the time a reader can move a card the announcer is long since
  // assigned.
  const announcer = useRef<(t: string, p: number, c: number) => void>(() => {});
  const announceMove = useCallback(
    (title: string, position: number, count: number) =>
      announcer.current(title, position, count),
    []
  );

  const layout = useDashboardLayout();
  const {
    visible,
    columns,
    columnCount,
    editor,
    moveBy,
    moveColumn,
    hasArrangement,
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

  const { announcement, announceMove: announceSettledMove } = useGridAnnouncer(
    settling,
    counted,
    failed
  );
  announcer.current = announceSettledMove;

  // Nothing DECLARED. Returned after the hooks above so the hook order is the
  // same on every render, whatever the branding says.
  // THREE outcomes, not two. Every card on the dashboard now arrives through
  // the workspace query, so an empty list is no longer proof that there is
  // nothing to draw -- it is equally the shape of a request still in flight and
  // of one that never answered. Collapsing all three into `return null` blanked
  // the entire page on first paint and on any transient failure, where the
  // sections used to mount immediately and draw their own states.
  //
  // 🔴 Asked of the DECLARATIONS, not of the arranged rows. `visible` is empty
  // in a fourth case that is none of these three: a reader who has put every
  // card away, or removed every card and saved. Returning here for that unmounted
  // the edit bar, the Reset control and the add picker along with the grid --
  // the whole page blank, with no way back to the one control that could undo
  // it. An arrangement must never be able to reach a state it cannot leave, so
  // the recovery chrome outlives the rows and the empty grid says so in place.
  if (declared.length === 0) {
    return (
      <NothingToDraw isPending={isPending} isUnavailable={isUnavailable} />
    );
  }

  return (
    <div className="space-y-4">
      <DashboardEditChrome
        editor={editor}
        writeError={layout.writeError}
        hasArrangement={hasArrangement}
        // 🔴 A stored row exists whenever the VERSION is non-zero, which is not
        // the same as `source === "own"`. A row the service could not decode is
        // reported as `source: "default"` — the dashboard falls back to the
        // registry's order — while keeping its real, non-zero version. Gating
        // Reset on the source therefore hid the one control that could clear
        // the bad row, and with an untouched draft Save is disabled too, so the
        // reader had no way out and every read went on logging the same decode
        // failure. The version is what says a row is there.
        canReset={(layout.layout?.version ?? 0) > 0}
      />

      <DndContext
        sensors={sensors}
        // `closestCenter` rather than pointer-within: the cells are different
        // widths, so a small card dragged over a full-width one never contains
        // the pointer and the drop target reads as nothing.
        // `closestCorners` rather than `closestCenter`: with several droppable
        // containers the nearest CENTRE is often a tall card's centre rather
        // than the column the pointer is actually over, so a drop near the top
        // of one column resolves to its neighbour.
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <ArrangedColumns
          columns={columns}
          columnCount={columnCount}
          visible={visible}
          isEditing={editor.isEditing}
          slots={slots}
          requested={requested}
          updatedAt={updatedAt}
          isFetching={isFetching}
          announcement={announcement}
          onMove={moveBy}
          onMoveColumn={moveColumn}
          onToggleHidden={editor.toggleHidden}
          onRemove={editor.remove}
        />
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
          atCapacity={editor.atCapacity}
        />
      ) : null}
    </div>
  );
}
