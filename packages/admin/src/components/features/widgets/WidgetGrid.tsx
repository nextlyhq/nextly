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
 * - **Leaving.** Customise mode keeps its changes on screen until Save, so
 *   moving away with unsaved changes asks first, through the admin's own
 *   unsaved-changes guard, which here also offers to save.
 *
 * @module components/features/widgets/WidgetGrid
 */

import { DndContext, closestCenter } from "@dnd-kit/core";
import type { SizeTier } from "@nextlyhq/ui/format";
import { useMemo, useRef, type ComponentProps } from "react";

import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useDashboardLayout } from "@admin/hooks/queries/useDashboardLayout";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { registerCoreWidgetComponents } from "./core-components";
import {
  AddWidgetPicker,
  type RemovedCardOption,
} from "./edit/AddWidgetPicker";
import { ArrangedGrid } from "./edit/ArrangedGrid";
import { DashboardEditChrome } from "./edit/DashboardEditChrome";
import { RemovalNotice } from "./edit/RemovalNotice";
import { useAnnouncerRelay } from "./edit/useArrangementAnnouncer";
import { useCardRemoval } from "./edit/useCardRemoval";
import {
  useDashboardArrangement,
  type ArrangedWidget,
} from "./edit/useDashboardArrangement";
import { useDashboardFocus } from "./edit/useDashboardFocus";
import type { LayoutEditor } from "./edit/useLayoutEditor";
import { useSaveRequest } from "./edit/useSaveRequest";
import { predictedTier } from "./frame/tier";
import { resolveDashboardWidgets } from "./resolve-widgets";
import { drawnWidth } from "./sizes";
import { useDashboardWidth } from "./useDashboardWidth";
import { useGridAnnouncer } from "./useGridAnnouncer";
import { useWidgetBatch } from "./useWidgetBatch";
import { widgetAsAsked } from "./widget-as-asked";

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
        // The gap in pixels, the GRID_GAP_PX a card's predicted width counts.
        className="grid grid-cols-12 gap-[24px]"
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
 * The cards the batch asks for, with each reader's own settings applied.
 *
 * Applied HERE rather than inside the batch, because the stored config belongs
 * to the placement and the batch has no reason to read a layout. The ROW is
 * carried through rather than the widget alone, so the answer comes back keyed
 * to the placement that asked: the same widget placed twice with different
 * settings asks two different questions, and keying those by widget filed both
 * under one entry.
 *
 * Through `widgetAsAsked`, the rule the card is also drawn from, which returns the
 * widget it was given when nothing applies, so a card with no settings keeps its
 * identity through this map and the batch's memoisation does not see a new
 * object every render.
 */
function askedWith(
  rows: ArrangedWidget[],
  dashboardWidth: number | undefined
): Array<ArrangedWidget & { tier?: SizeTier }> {
  return rows.map(row => {
    // The tier the card will be drawn at, from the dashboard's width and the card's drawn span:
    // the query is asked before the card can measure itself, and sized for that tier.
    const tier = predictedTier(
      drawnWidth(row.width, row.allowedWidths),
      dashboardWidth
    );
    const sized = tier ? { ...row, tier } : row;
    const widget = widgetAsAsked(row.widget, row.config);
    return widget === row.widget ? sized : { ...sized, widget };
  });
}

/** Nothing to ask yet: the batch's input while the dashboard has no width. */
const NO_CARDS: [] = [];

/**
 * The element the dashboard's width is measured from, and the cards to ask, each sized for the
 * tier it will be drawn at. The width is measured before the first paint, and no card is asked
 * before it is known, so every first query is sized for its card's tier.
 */
function useCardsAtDashboardWidth(visible: ArrangedWidget[]) {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const dashboardWidth = useDashboardWidth(dashboardRef);
  const cards = useMemo(
    () =>
      dashboardWidth === undefined
        ? NO_CARDS
        : askedWith(visible, dashboardWidth),
    [visible, dashboardWidth]
  );
  return { dashboardRef, cards };
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

/**
 * The cards the reader removed in this draft, each under its widget's title.
 *
 * Only ones this admin can draw: putting back a card whose widget has no
 * declaration here would restore a card the grid then skips.
 */
function removedCards(
  editor: LayoutEditor,
  byId: ReadonlyMap<string, DashboardWidget>
): RemovedCardOption[] {
  return editor.placements.flatMap(placement => {
    const widget = byId.get(placement.widgetId);
    return placement.removed && widget
      ? [{ placementId: placement.id, title: widget.title }]
      : [];
  });
}

/** Why a single-card write is unavailable while the stored layout is unreadable. */
const UNREADABLE_SINGLE_CARD =
  "Unavailable: your saved dashboard couldn't be loaded. Save it from Customize first.";

/** Why a single-card write is unavailable now, or nothing when it is available. */
function singleCardWriteBlocked(isUnreadable: boolean): string | undefined {
  return isUnreadable ? UNREADABLE_SINGLE_CARD : undefined;
}

/**
 * What each card's controls do. Built here rather than inline so the grid's
 * render reads as layout, and so the one optional action (a standing dismiss,
 * which exists only outside customise mode) is decided in one place.
 */
function cardActions(
  arrangement: ReturnType<typeof useDashboardArrangement>,
  removal: ReturnType<typeof useCardRemoval>,
  editor: LayoutEditor
): ComponentProps<typeof ArrangedGrid>["on"] {
  return {
    move: arrangement.moveCard,
    setWidth: arrangement.setCardWidth,
    remove: removal.remove,
    ...(removal.dismiss ? { dismiss: removal.dismiss } : {}),
    saveSettings: editor.setConfig,
  };
}

/** The add picker, which exists only in customise mode. */
function CustomizePicker({
  editor,
  byId,
  onRestore,
  sectionRef,
}: {
  editor: LayoutEditor;
  byId: ReadonlyMap<string, DashboardWidget>;
  onRestore: ComponentProps<typeof AddWidgetPicker>["onRestore"];
  sectionRef: ComponentProps<typeof AddWidgetPicker>["sectionRef"];
}) {
  if (!editor.isEditing) return null;
  return (
    <AddWidgetPicker
      options={offerable(editor.available, byId)}
      onAdd={editor.add}
      removed={removedCards(editor, byId)}
      onRestore={onRestore}
      sectionRef={sectionRef}
      atCapacity={editor.atCapacity}
    />
  );
}

/**
 * What the grid's place holds while the first arrangement read is in flight.
 *
 * A line of text, not card-shaped placeholders: which cards there will be,
 * and how wide, is exactly what is not known yet, and a guessed block that
 * the real dashboard then differs from is itself the jump this avoids.
 */
function ArrangementLoading() {
  return (
    <p
      role="status"
      aria-label="Loading your dashboard"
      className="text-sm text-muted-foreground"
      data-testid="widget-grid-loading"
    >
      Loading your dashboard…
    </p>
  );
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
  // Where focus goes when a gesture moves or removes the element holding it.
  const focus = useDashboardFocus();

  const layout = useDashboardLayout();
  const arrangement = useDashboardArrangement(
    declared,
    layout,
    announce,
    focus
  );
  const { visible, editor, hasArrangement } = arrangement;

  // Removing a card, while customising or from the card itself, and the one
  // notice that offers it back.
  const removal = useCardRemoval(layout, editor, visible, announce, focus);

  const byId = useMemo(
    () => new Map(declared.map(widget => [widget.id, widget])),
    [declared]
  );

  // The dashboard's own width, and the cards asked at it.
  const { dashboardRef, cards } = useCardsAtDashboardWidth(visible);

  const {
    slots,
    cellSlots,
    fetchingPlacementIds,
    updatedAtFor,
    fetchedTierFor,
    requested,
    counted,
    failed,
    settling,
    retry,
  } = useWidgetBatch(cards);

  const gridAnnouncer = useGridAnnouncer(settling, counted, failed);
  const { announcement } = gridAnnouncer;
  attach(gridAnnouncer);

  // Saving from the bar and from the unsaved-changes prompt alike.
  const saveRequest = useSaveRequest(arrangement.save, layout.isUnreadable);

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
  //
  // Both returns draw the dashboard's container as their root, ONE element of one type, so
  // React keeps the same node across them and the width observed on it stays attached when
  // the first declarations arrive.
  if (declared.length === 0) {
    return (
      <div
        ref={dashboardRef}
        data-testid="dashboard-container"
        className="@container/dashboard"
      >
        <NothingToDraw isPending={isPending} isUnavailable={isUnavailable} />
      </div>
    );
  }

  // Until this person's arrangement is known: no card, no card's data, and
  // one status where the grid will be. Nothing sits below the grid, so the
  // cards arriving in its place move nothing that was already drawn. Inside
  // the measured container all the same: the dashboard's width is observed
  // from the element mounted first, and a card's first query waits for that
  // width, so a container drawn only once the arrangement lands would never
  // be measured and no card would ever be asked for.
  if (arrangement.awaitingArrangement) {
    return (
      <div
        ref={dashboardRef}
        data-testid="dashboard-container"
        className="@container/dashboard"
      >
        <ArrangementLoading />
      </div>
    );
  }

  return (
    // The element every card's span answers to, and the one the dashboard's width is measured
    // from, so a predicted tier and a drawn span read the same width.
    <div
      ref={dashboardRef}
      data-testid="dashboard-container"
      className="@container/dashboard"
    >
      {/* Asks before the reader leaves with unsaved changes: Save, Discard or
          Keep editing. 🔴 Still on while a save is on its way: until it has
          landed the changes exist only here, and a leave let through while it
          was pending lost them when it failed. Discarding says nothing, because
          the page is leaving and the next one speaks for itself; reload and
          close get the browser's own prompt. */}
      <UnsavedChangesGuard
        isDirty={editor.hasUnsavedChanges}
        onDiscard={editor.cancel}
        onSave={saveRequest.request}
      >
        <div className="space-y-4">
          <DashboardEditChrome
            editor={editor}
            writeError={layout.writeError}
            hasArrangement={hasArrangement}
            // The read's own answer. The rule is subtler than it looks and it
            // belongs with the data it is about; `hasStoredRow` carries it.
            canReset={layout.hasStoredRow}
            isUnreadable={layout.isUnreadable}
            onStageReset={arrangement.stageReset}
            on={{
              begin: arrangement.begin,
              cancel: arrangement.cancel,
              addWidget: () => focus.request({ kind: "add" }),
            }}
            saveRequest={saveRequest}
            focus={focus}
          />

          <DndContext
            sensors={arrangement.sensors}
            // `closestCenter`: the cards are one list laid out as a grid, so the
            // nearest card centre is the card the pointer is aiming at.
            collisionDetection={closestCenter}
            onDragEnd={arrangement.handleDragEnd}
            accessibility={{ announcements: arrangement.announcements }}
          >
            <ArrangedGrid
              rows={visible}
              placements={editor.placements}
              isDrawn={arrangement.isDrawn}
              isEditing={editor.isEditing}
              isWriting={editor.isWriting}
              singleCardWriteBlocked={singleCardWriteBlocked(
                layout.isUnreadable
              )}
              slots={slots}
              cellSlots={cellSlots}
              requested={requested}
              updatedAtFor={updatedAtFor}
              fetchedTierFor={fetchedTierFor}
              fetchingPlacementIds={fetchingPlacementIds}
              retry={retry}
              announcement={announcement}
              focus={focus}
              gridRef={focus.gridRef}
              on={cardActions(arrangement, removal, editor)}
            />
          </DndContext>

          <CustomizePicker
            editor={editor}
            byId={byId}
            onRestore={removal.restore}
            sectionRef={focus.addRef}
          />

          <RemovalNotice
            title={removal.notice?.title}
            isWriting={editor.isWriting}
            undoRef={focus.undoRef}
            onUndo={removal.undo}
            onClose={removal.close}
          />
        </div>
      </UnsavedChangesGuard>
    </div>
  );
}
