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
import { applyWidgetSettings } from "nextly/config";
import { useMemo } from "react";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useDashboardLayout } from "@admin/hooks/queries/useDashboardLayout";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { registerCoreWidgetComponents } from "./core-components";
import { AddWidgetPicker } from "./edit/AddWidgetPicker";
import { ArrangedColumns } from "./edit/ArrangedColumns";
import { DashboardEditChrome } from "./edit/DashboardEditChrome";
import {
  useAnnouncerRelay,
  useGridFocus,
} from "./edit/useArrangementAnnouncer";
import {
  useDashboardArrangement,
  type ArrangedWidget,
} from "./edit/useDashboardArrangement";
import { useDismissPlacement } from "./edit/useDismissPlacement";
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

/**
 * The cards the batch asks for, with each reader's own settings applied.
 *
 * Applied HERE rather than inside the batch, because the stored config belongs
 * to the placement and the batch has no reason to read a layout. The ROW is
 * carried through rather than the widget alone, so the answer comes back keyed
 * to the placement that asked: the same widget placed twice with different
 * settings asks two different questions, and keying those by widget filed both
 * under one entry.
 *
 * `applyWidgetSettings` returns the query it was given when nothing applies, so
 * a card with no settings keeps its identity through this map and the batch's
 * memoisation does not see a new object every render.
 */
function askedWith(rows: ArrangedWidget[]): ArrangedWidget[] {
  return rows.map(row =>
    row.widget.query
      ? {
          ...row,
          widget: {
            ...row.widget,
            query: applyWidgetSettings(
              row.widget.query,
              row.widget.settings,
              row.config
            ),
          },
        }
      : row
  );
}

/**
 * The widgets the picker offers, each under the name a reader will recognise.
 *
 * The declaration's own title where the admin can resolve it. The id is a poor
 * label and it is TRUE, which an invented one would not be — a widget whose
 * client bundle is absent still has to be addable by name.
 */
function offerable(
  available: readonly string[],
  byId: ReadonlyMap<string, DashboardWidget>
): Array<{ widgetId: string; title: string }> {
  return available.map(widgetId => ({
    widgetId,
    title: byId.get(widgetId)?.title ?? widgetId,
  }));
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

  // The arrangement needs somewhere to announce a gesture before the announcer
  // exists; the relay is that somewhere. Its own hook because the cycle it
  // resolves takes a paragraph to explain and has nothing to do with drawing.
  const { announce, attach } = useAnnouncerRelay();

  const layout = useDashboardLayout();
  const {
    visible,
    columns,
    columnCount,
    editor,
    moveWithinColumn,
    moveColumn,
    hasArrangement,
    sensors,
    announcements,
    handleDragEnd,
    toggleHidden,
    remove,
  } = useDashboardArrangement(declared, layout, announce);

  // The STANDING dismiss, which is a different write from the toolbar's hide:
  // outside edit mode there is no draft to mutate, so it commits on its own
  // against the read's own guards. Given the announcer directly rather than
  // through the arrangement, because it is the one gesture whose outcome is not
  // known until the server answers -- and `undefined` until an arrangement has
  // been read, which is what withholds the control itself.
  // Where focus lands when a dismissed card takes the focused button with it.
  const focus = useGridFocus();
  const dismiss = useDismissPlacement(
    layout,
    editor,
    announce.hidden,
    focus.restore
  );

  const byId = useMemo(
    () => new Map(declared.map(widget => [widget.id, widget])),
    [declared]
  );

  const cards = useMemo(() => askedWith(visible), [visible]);

  const {
    slots,
    cellSlots,
    fetchingPlacementIds,
    updatedAt,
    requested,
    counted,
    failed,
    settling,
  } = useWidgetBatch(cards);

  const gridAnnouncer = useGridAnnouncer(settling, counted, failed);
  const { announcement } = gridAnnouncer;
  attach(gridAnnouncer);

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
        // The read's own answer. The rule is subtler than it looks and it
        // belongs with the data it is about; `hasStoredRow` carries it.
        canReset={layout.hasStoredRow}
        columnCount={columnCount}
        onColumnCount={editor.setColumnCount}
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
        accessibility={{ announcements }}
      >
        <ArrangedColumns
          columns={columns}
          columnCount={columnCount}
          visible={visible}
          isEditing={editor.isEditing}
          slots={slots}
          cellSlots={cellSlots}
          requested={requested}
          updatedAt={updatedAt}
          fetchingPlacementIds={fetchingPlacementIds}
          announcement={announcement}
          onMove={moveWithinColumn}
          onMoveColumn={moveColumn}
          onToggleHidden={toggleHidden}
          onDismiss={dismiss}
          isDismissing={layout.dismiss.isPending}
          sectionRef={focus.ref}
          onRemove={remove}
          onSaveSettings={editor.setConfig}
        />
      </DndContext>

      {editor.isEditing ? (
        <AddWidgetPicker
          options={offerable(editor.available, byId)}
          onAdd={editor.add}
          atCapacity={editor.atCapacity}
        />
      ) : null}
    </div>
  );
}
