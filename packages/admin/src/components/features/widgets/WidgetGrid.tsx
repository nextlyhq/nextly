"use client";

/**
 * The dashboard's widget grid.
 *
 * Twelve columns, rows of one fixed height, one cell per visible widget, and
 * ONE request for all of them.
 * The grid is where the three cross-cutting decisions live, because none of
 * them can be made correctly by a widget on its own:
 *
 * - **Batching.** Every visible card is asked for together, so a dashboard
 *   costs one round trip rather than one per card.
 * - **Gating.** A widget the user may not see is dropped before its card is
 *   asked for, so a denied card causes no request on their behalf.
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

import type { SizeTier } from "@nextlyhq/ui/format";
import {
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type JSX,
} from "react";

import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useDashboardLayout } from "@admin/hooks/queries/useDashboardLayout";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type {
  DashboardLayoutRead,
  DashboardLayoutResponse,
} from "@admin/types/dashboard/widgets";

import { registerCoreWidgetComponents } from "./core-components";
import { DrawFailureContext, useDrawFailures } from "./draw-failures";
import { ArrangedGrid } from "./edit/ArrangedGrid";
import { AtRestSettingsWriteProvider } from "./edit/at-rest-settings-write";
import { DashboardAddPanel, useAddPanelState } from "./edit/DashboardAddPanel";
import { DashboardEditChrome } from "./edit/DashboardEditChrome";
import { CardDragContext } from "./edit/drag/CardDragContext";
import { useCardDrag } from "./edit/drag/useCardDrag";
import { RemovalNotice } from "./edit/RemovalNotice";
import {
  bringRefusedPanelForward,
  useSettingsPanelHoldsChanges,
} from "./edit/settings-panel-registry";
import { useAnnouncerRelay } from "./edit/useArrangementAnnouncer";
import { useCardRemoval } from "./edit/useCardRemoval";
import { useCardSettingsWrite } from "./edit/useCardSettingsWrite";
import {
  useDashboardArrangement,
  type ArrangedWidget,
} from "./edit/useDashboardArrangement";
import { useDashboardFocus } from "./edit/useDashboardFocus";
import type { LayoutEditor } from "./edit/useLayoutEditor";
import { useSaveRequest } from "./edit/useSaveRequest";
import { predictedTier } from "./frame/tier";
import { usePublishGridChrome } from "./grid-chrome";
import {
  HiddenWhileEmptyContext,
  useHiddenWhileEmptyAtFirstPaint,
  type CardAnswers,
} from "./hidden-while-empty";
import { WidenLonePairContext, widensLonePair } from "./lone-pair";
import { resolveDashboardWidgets } from "./resolve-widgets";
import { cardRowStyle, drawnSize, GRID_CLASS } from "./sizes";
import { DashboardWidthProvider, useDashboardWidth } from "./useDashboardWidth";
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
        // The grid the cards will be drawn on, so the placeholders take the rows a card would.
        className={GRID_CLASS}
      >
        {[0, 1, 2].map(row => (
          <div
            key={row}
            aria-hidden
            style={cardRowStyle(2)}
            className="col-span-12 animate-pulse rounded-lg bg-muted"
          />
        ))}
      </section>
    );
  }

  return null;
}

/**
 * The cards the batch asks for, each with the size it is drawn at.
 *
 * The ROW is carried through rather than the widget alone, so the answer comes
 * back keyed to the placement that asked: the same widget placed twice with
 * different settings asks two different questions, and keying those by widget
 * filed both under one entry. A row the dashboard has no width for is passed
 * through as it is, so a card with nothing to size keeps its identity through
 * this map and the batch's memoisation does not see a new object every render.
 */
function askedWith(
  rows: ArrangedWidget[],
  dashboardWidth: number | undefined,
  editing: boolean
): Array<
  ArrangedWidget & { tier?: SizeTier; h?: number; w?: number; editing?: true }
> {
  return rows.map(row => {
    // The tier the card will be drawn at, from the dashboard's width and the card's drawn span:
    // the card is asked before it can measure itself. A card is asked by its id at rest, and
    // with the settings it is drawn with while customising, when they may not be saved yet;
    // with the size it is drawn at, which its widget's `load` is handed (`cardAskFor`).
    const size = drawnSize(row.size, row.widget.size);
    const tier = predictedTier(size.w, dashboardWidth);
    const drawn = tier ? { ...row, tier, w: size.w, h: size.h } : row;
    return editing ? { ...drawn, editing: true as const } : drawn;
  });
}

/** A layout answer's verdict on the cards hidden while empty, as one comparable value. */
function verdictOf(layout: DashboardLayoutResponse | undefined): string {
  const hidden = layout?.hiddenWhileEmpty;
  // Absent is no verdict at all, which is not the verdict that hides nothing.
  return hidden === undefined ? "none" : JSON.stringify([...hidden].sort());
}

/**
 * The token the batch is asked under: the layout answer's, taken from a fresh answer only when
 * that answer's verdict on the cards hidden while empty differs from the one the batch was asked
 * under. Every layout read has a token of its own, and the layout is read again after each of
 * the reader's own writes, so taking every new token asked every card again for one card's
 * change. A fresh answer with the same verdict hides and reveals nothing, so the cards' answers
 * under the token held are as good as any it read ahead; one that reveals or hides a card is a
 * new load, whose cards the batch is asked for again, once, under its token. A held token whose
 * read-ahead has closed is answered fresh by the server, so holding it is always safe.
 */
function useBatchToken(
  layout: DashboardLayoutResponse | undefined
): string | undefined {
  const token = layout?.readAheadToken;
  const verdict = verdictOf(layout);
  const [held, setHeld] = useState({ token, verdict });
  // React's pattern for state that follows a prop, so no render asks under a token it drops.
  const adopt =
    token !== undefined &&
    token !== held.token &&
    (held.token === undefined || verdict !== held.verdict);
  if (adopt) setHeld({ token, verdict });
  return adopt ? token : (held.token ?? token);
}

/** Nothing to ask yet: the batch's input while the dashboard has no width. */
const NO_CARDS: [] = [];

/**
 * The element the dashboard's width is measured from, the one batch of the cards, and dragging
 * the cards.
 *
 * Each card is asked for at the size it will be drawn at. The width is measured before the first
 * paint, and no card is asked before it is known, so every first ask carries its card's size.
 * Dragging is decided from the same width: on wherever more than one column is drawn.
 * The batch is asked under the token of `layout`, the layout answer the cards are drawn from.
 */
function useCardsAtDashboardWidth(
  visible: ArrangedWidget[],
  editing: boolean,
  carry: Pick<
    Parameters<typeof useCardDrag>[0],
    "gridRef" | "say" | "drop" | "requestFocus"
  >,
  layout: DashboardLayoutResponse | undefined
) {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const dashboardWidth = useDashboardWidth(dashboardRef);
  const cards = useMemo(
    () =>
      dashboardWidth === undefined
        ? NO_CARDS
        : askedWith(visible, dashboardWidth, editing),
    [visible, dashboardWidth, editing]
  );
  // Cards whose own component threw drawing a fine answer, counted as failed.
  const draws = useDrawFailures();
  return {
    dashboardRef,
    dashboardWidth,
    drag: useCardDrag({ rows: visible, width: dashboardWidth, ...carry }),
    // Asked under the token of the layout answer the cards are drawn from, and again under a new
    // one that hides or reveals a card: a layout read that lands after the batch started is then
    // the load the cards are drawn from, and the server answers a card that load read ahead only
    // under its token (`useBatchToken`).
    ...useWidgetBatch(cards, draws.failed, useBatchToken(layout)),
    reportDraw: draws.report,
  };
}

/**
 * Whether leaving the dashboard asks first: while customising, when the draft or a card's open
 * settings panel holds a change, since the panel leaves the asking to this prompt then.
 */
function leaveAsks(
  editor: { hasUnsavedChanges: boolean; isEditing: boolean },
  panelHoldsChanges: boolean
): boolean {
  return editor.hasUnsavedChanges || (editor.isEditing && panelHoldsChanges);
}

/**
 * The admin's own unsaved-changes prompt, over the dashboard: Save, Discard and Keep editing
 * before the reader leaves with changes in customise mode.
 */
function DashboardLeaveGuard({
  editor,
  saveRequest,
  children,
}: {
  editor: LayoutEditor;
  saveRequest: ReturnType<typeof useSaveRequest>;
  children: ReactNode;
}): JSX.Element {
  // Whether a card's settings panel holds a change Done has not kept.
  const panelHoldsChanges = useSettingsPanelHoldsChanges();
  return (
    <UnsavedChangesGuard
      // A card's settings panel holding a change counts while customising, where the panel
      // leaves the asking to this prompt: one leave, one question.
      isDirty={leaveAsks(editor, panelHoldsChanges)}
      onDiscard={editor.cancel}
      // The bar's Save and this prompt's are one request, which keeps an open settings
      // panel's change with the draft (`useSaveRequest`).
      onSave={saveRequest.request}
      // A Save the prompt could not make, because a settings panel refused its change, leaves
      // the reader in that panel, on what it refused.
      onCancel={bringRefusedPanelForward}
    >
      {children}
    </UnsavedChangesGuard>
  );
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
    setSize: arrangement.setCardSize,
    // A removal is the next change, so the card ringed for the last one is no longer news.
    remove: placementId => {
      arrangement.ring.highlight(null);
      removal.remove(placementId);
    },
    ...(removal.dismiss ? { dismiss: removal.dismiss } : {}),
    saveSettings: editor.setConfig,
  };
}

/**
 * The writes a reader makes to one card from the card itself: removing it, and its settings.
 * One hook so the grid reads both from one place.
 */
function useStandingCardWrites(
  layout: ReturnType<typeof useDashboardLayout>,
  editor: LayoutEditor,
  visible: ReturnType<typeof useDashboardArrangement>["visible"],
  announce: ReturnType<typeof useAnnouncerRelay>["announce"],
  focus: ReturnType<typeof useDashboardFocus>,
  /** Rings the card a gesture just placed, as a put-back card is. */
  highlight: (placementId: string | null) => void
) {
  // Removing a card, while customising or from the card itself, and the one notice that offers
  // it back.
  const removal = useCardRemoval(
    layout,
    editor,
    visible,
    announce,
    focus,
    highlight
  );
  const settingsWrite = useSettingsWriteAtRest(layout, editor, announce);
  return { removal, settingsWrite };
}

/**
 * A card's settings and size saved at once, outside customise mode: its quick setting, its quick
 * popover, its menu's Size and its sheet.
 * Offered only at rest, where there is no draft to hold a change, and once an arrangement has
 * been read, for the reason the standing dismiss waits for one.
 */
function useSettingsWriteAtRest(
  layout: ReturnType<typeof useDashboardLayout>,
  editor: LayoutEditor,
  announce: ReturnType<typeof useAnnouncerRelay>["announce"]
): ComponentProps<typeof ArrangedGrid>["writes"]["settings"] {
  const cardSettingsWrite = useCardSettingsWrite(layout);
  if (!layout.layout || editor.isEditing) return undefined;
  return {
    write: (placementId, title, config, callbacks, ownTitle) =>
      cardSettingsWrite.write(
        {
          placementId,
          title,
          change: {
            kind: "settings",
            config,
            ...(ownTitle === undefined ? {} : { ownTitle }),
          },
        },
        callbacks
      ),
    // The same write, of the card's size: the request customise mode's Save sends for it.
    resize: (placementId, title, size, bounds, callbacks) =>
      cardSettingsWrite.write(
        { placementId, title, change: { kind: "size", size, bounds } },
        callbacks
      ),
    isWriting: editor.isWriting,
    ...(cardSettingsWrite.unavailable === undefined
      ? {}
      : { unavailable: cardSettingsWrite.unavailable }),
    announce: announce.settingChanged,
  };
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

/**
 * What every card under the grid reads beside its props: where a card that fails to draw reports
 * it, and which cards the dashboard is drawn without while empty: those the first layout answer
 * found empty, less any a later layout answer, or the card's own batch answer (`answers`), finds
 * with something waiting (`hidden-while-empty`).
 * Mounted with the grid, which waits for that answer, and taken at the dashboard's width, which
 * is measured before the first paint, so the verdict is in place before any card is painted.
 */
function CardContexts({
  reportDraw,
  layout,
  dashboardWidth,
  answers,
  children,
}: {
  reportDraw: ComponentProps<typeof DrawFailureContext.Provider>["value"];
  layout: DashboardLayoutRead | undefined;
  /** The dashboard's width, which the verdict is taken at once it has one. */
  dashboardWidth: number | undefined;
  answers: CardAnswers;
  children: ReactNode;
}): JSX.Element {
  const hiddenWhileEmpty = useHiddenWhileEmptyAtFirstPaint(
    layout,
    dashboardWidth,
    answers
  );
  return (
    <DrawFailureContext.Provider value={reportDraw}>
      <HiddenWhileEmptyContext.Provider value={hiddenWhileEmpty}>
        {/* The width a card's settings panel previews it at (`cardOuterWidth`). */}
        <DashboardWidthProvider value={dashboardWidth}>
          {/* The lone card of the pair is drawn across its row where the default gives the pair
              a row of their own and the reader follows it: a reader's own arrangement, and a
              site's default that places them otherwise, keep their sizes. */}
          <WidenLonePairContext.Provider value={widensLonePair(layout)}>
            {children}
          </WidenLonePairContext.Provider>
        </DashboardWidthProvider>
      </HiddenWhileEmptyContext.Provider>
    </DrawFailureContext.Provider>
  );
}

/**
 * What the dashboard's container holds while there are no cards to draw, or `null` once there
 * are. Drawn inside the measured container either way, by the one return that draws it.
 *
 * - **Nothing declared:** the empty grid says so in place, and the recovery chrome outlives
 *   the rows, so an arrangement can never reach a state it cannot leave.
 * - **The arrangement still on its way:** no card, no card's data, and one status where the grid
 *   will be. Nothing sits below the grid, so the cards arriving in its place move nothing that
 *   was already drawn. Inside the measured container all the same: the dashboard's width is
 *   observed from the element mounted first, and a card's first ask waits for that width, so
 *   a container drawn only once the arrangement lands would never be measured and no card would
 *   ever be asked for.
 */
function holdingBody({
  declared,
  awaitingArrangement,
  isPending,
  isUnavailable,
}: {
  declared: number;
  awaitingArrangement: boolean;
  isPending: boolean;
  isUnavailable: boolean;
}): ReactNode | null {
  if (declared === 0) {
    return (
      <NothingToDraw isPending={isPending} isUnavailable={isUnavailable} />
    );
  }
  return awaitingArrangement ? <ArrangementLoading /> : null;
}

/**
 * The reader's stored layout and the arrangement drawn from it, read together:
 * the arrangement is the layout's, and the card writes outside customise mode
 * need the layout itself.
 */
function useLayoutArrangement(
  declared: Parameters<typeof useDashboardArrangement>[0],
  announce: Parameters<typeof useDashboardArrangement>[2],
  focus: Parameters<typeof useDashboardArrangement>[3]
) {
  const layout = useDashboardLayout();
  const arrangement = useDashboardArrangement(
    declared,
    layout,
    announce,
    focus
  );
  return { layout, arrangement };
}

export function WidgetGrid(): JSX.Element {
  const branding = useBranding();
  const { isPending, isUnavailable } = useBrandingStatus();
  const { hasPermission } = useCurrentUserPermissions();

  // The widgets the registry publishes: core's, the plugins' and the site's.
  const declared = useMemo(
    () => resolveDashboardWidgets(branding?.widgets, hasPermission),
    [branding, hasPermission]
  );

  // The arrangement needs somewhere to announce a gesture before the announcer
  // exists; the relay is that somewhere. Its own hook because the cycle it
  // resolves takes a paragraph to explain and has nothing to do with drawing.
  const { announce, attach } = useAnnouncerRelay();
  // Where focus goes when a gesture moves or removes the element holding it.
  const focus = useDashboardFocus();

  const { layout, arrangement } = useLayoutArrangement(
    declared,
    announce,
    focus
  );
  const { visible, editor, hasArrangement } = arrangement;

  // What a reader changes on one card from the card itself: removing it, and
  // its settings outside customise mode.
  const { removal, settingsWrite } = useStandingCardWrites(
    layout,
    editor,
    visible,
    announce,
    focus,
    arrangement.ring.highlight
  );

  const byId = useMemo(
    () => new Map(declared.map(widget => [widget.id, widget])),
    [declared]
  );

  // The add panel, open or not; the card it places is ringed by the arrangement's `ring`.
  const addPanel = useAddPanelState(editor.isEditing);
  const { ring } = arrangement;

  // The dashboard's own width, the cards asked at it, and dragging them by their handles.
  const {
    dashboardRef,
    dashboardWidth,
    drag,
    slots,
    fetchingPlacementIds,
    updatedAtFor,
    answeredAtFor,
    fetchedAskFor,
    requested,
    counted,
    failed,
    settling,
    retry,
    refresh,
    reportDraw,
  } = useCardsAtDashboardWidth(
    visible,
    editor.isEditing,
    {
      gridRef: focus.gridRef,
      say: announce.drag,
      drop: arrangement.dropCard,
      requestFocus: focus.request,
    },
    layout.layout
  );

  // What the page's header draws from the grid.
  usePublishGridChrome({
    arrangement,
    requested,
    updatedAtFor,
    refresh,
    customizeRef: focus.customizeRef,
  });

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
  // the edit bar, the Reset control and Add widget along with the grid --
  // the whole page blank, with no way back to the one control that could undo
  // it. An arrangement must never be able to reach a state it cannot leave, so
  // the recovery chrome outlives the rows and the empty grid says so in place.
  //
  // Both returns draw the dashboard's container as their root, ONE element of one type, so
  // React keeps the same node across them and the width observed on it stays attached when
  // the first declarations arrive.
  const holding = holdingBody({
    declared: declared.length,
    awaitingArrangement: arrangement.awaitingArrangement,
    isPending,
    isUnavailable,
  });
  if (holding !== null) {
    return (
      <div
        ref={dashboardRef}
        data-testid="dashboard-container"
        className="@container/dashboard"
      >
        {holding}
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
      <DashboardLeaveGuard editor={editor} saveRequest={saveRequest}>
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
              cancel: arrangement.cancel,
              addWidget: () => addPanel.setOpen(true),
            }}
            saveRequest={saveRequest}
            focus={focus}
          />

          <CardDragContext drag={drag}>
            <AtRestSettingsWriteProvider value={settingsWrite}>
              <CardContexts
                reportDraw={reportDraw}
                layout={layout.layout}
                answers={{ slots, fetching: fetchingPlacementIds }}
                dashboardWidth={dashboardWidth}
              >
                <ArrangedGrid
                  rows={visible}
                  placements={editor.placements}
                  isDrawn={arrangement.isDrawn}
                  isEditing={editor.isEditing}
                  writes={{
                    isWriting: editor.isWriting,
                    sources: branding?.widgetSources,
                    singleCardWriteBlocked: singleCardWriteBlocked(
                      layout.isUnreadable
                    ),
                    settings: settingsWrite,
                  }}
                  slots={slots}
                  requested={requested}
                  updatedAtFor={updatedAtFor}
                  answeredAtFor={answeredAtFor}
                  // Each card's held answer is drawn by the size and density it was fetched at.
                  fetchedAskFor={fetchedAskFor}
                  fetchingPlacementIds={fetchingPlacementIds}
                  retry={retry}
                  announcement={announcement}
                  focus={focus}
                  gridRef={focus.gridRef}
                  highlightedId={ring.highlightedId}
                  drag={drag}
                  on={cardActions(arrangement, removal, editor)}
                />
              </CardContexts>
            </AtRestSettingsWriteProvider>
          </CardDragContext>

          <DashboardAddPanel
            open={addPanel.open}
            onOpenChange={addPanel.setOpen}
            editor={editor}
            byId={byId}
            restore={removal.restore}
            highlight={ring.highlight}
            focus={focus}
          />

          <RemovalNotice
            title={removal.notice?.title}
            isWriting={editor.isWriting}
            undoRef={focus.undoRef}
            onUndo={removal.undo}
            onClose={removal.close}
          />
        </div>
      </DashboardLeaveGuard>
    </div>
  );
}
