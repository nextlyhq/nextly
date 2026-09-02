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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useDashboardLayout } from "@admin/hooks/queries/useDashboardLayout";
import {
  useWidgetQueries,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { cn } from "@admin/lib/utils";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { registerCoreWidgetComponents } from "./core-components";
import { AddWidgetPicker } from "./edit/AddWidgetPicker";
import { DashboardEditBar } from "./edit/DashboardEditBar";
import { useLayoutEditor } from "./edit/useLayoutEditor";
import { WidgetEditControls } from "./edit/WidgetEditControls";
import { moveAffordance } from "./layout-editor";
import { coreDraws, resolveWidgetOutcome } from "./outcome";
import { resolveDashboardWidgets } from "./resolve-widgets";
import { widgetSpanClass } from "./sizes";
import { WidgetRenderer } from "./WidgetRenderer";

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

  // The DECLARATIONS, by id. The arrangement says which cards and in what
  // order; this says what each one actually is. Two questions, two sources:
  // the server owns the arrangement because only it can filter by permission
  // authoritatively, and branding owns the declaration because that is what
  // carries the archetype, the query and the component.
  const byId = useMemo(
    () => new Map(declared.map(widget => [widget.id, widget])),
    [declared]
  );

  const layout = useDashboardLayout();

  // What an added card inherits. Read from the declaration rather than
  // defaulted here, so a card the reader adds is the size its author intended.
  const geometryFor = useCallback(
    (widgetId: string) => {
      const declaration = byId.get(widgetId);
      if (!declaration) return undefined;
      // `size` on a resolved declaration IS its declared default — the admin's
      // resolver has already applied it. Reading it here rather than defaulting
      // means a card the reader adds arrives the size its author intended.
      return { size: declaration.size };
    },
    [byId]
  );

  const editor = useLayoutEditor(layout, geometryFor);

  // The cards to draw, in the arrangement's order.
  //
  // A placement whose declaration this admin cannot resolve is SKIPPED rather
  // than drawn as an empty cell: the server filtered by permission and by the
  // registry, but a plugin's client bundle can still be absent, and a titled
  // card with nothing under it reads as a product bug rather than as a missing
  // plugin. While editing, hidden cards are drawn too — greyed — because a
  // reader cannot bring back something they cannot see.
  // 🔴 Whether an arrangement has been READ, which is not the same as whether
  // it holds anything. Absent means the request is still in flight or it
  // failed; empty means this reader has arranged their dashboard down to
  // nothing. Folding the two together blanks the entire dashboard for the
  // duration of every page load and for the whole of any outage — the grid
  // drew from branding alone before this, and a personalization feature must
  // not be able to take the page down when its own endpoint is unavailable.
  const hasArrangement = layout.layout !== undefined;

  const visible = useMemo(() => {
    // No arrangement yet: draw the declarations in their declared order, which
    // is exactly what this dashboard did before it could be arranged at all.
    if (!hasArrangement) {
      return declared.map(widget => ({
        placementId: widget.id,
        widget,
        hidden: false,
      }));
    }
    const rows: Array<{
      placementId: string;
      widget: DashboardWidget;
      hidden: boolean;
    }> = [];
    for (const placement of editor.placements) {
      const widget = byId.get(placement.widgetId);
      if (!widget) continue;
      if (placement.hidden && !editor.isEditing) continue;
      rows.push({
        placementId: placement.id,
        widget,
        hidden: placement.hidden,
      });
    }
    return rows;
  }, [hasArrangement, declared, editor.placements, editor.isEditing, byId]);

  const widgets = useMemo(() => visible.map(row => row.widget), [visible]);

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
      {hasArrangement ? (
        <DashboardEditBar
          isEditing={editor.isEditing}
          hasUnsavedChanges={editor.hasUnsavedChanges}
          isSaving={editor.isSaving}
          canReset={layout.layout?.source === "own"}
          onBegin={editor.begin}
          onSave={editor.save}
          onCancel={editor.cancel}
          onReset={editor.reset}
        />
      ) : null}

      {editor.isConflict ? (
        // Both guards refuse the same way and the remedy is the same, so this
        // is one message rather than two. It does NOT clear the draft: the
        // reader's work stays on screen while they decide, because discarding
        // it at the moment they are told to try again is the worst possible
        // time to throw it away.
        <div
          role="alert"
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
          data-testid="dashboard-edit-conflict"
        >
          Your dashboard changed somewhere else while you were editing. Reload
          to pick up the current arrangement — your unsaved changes here will be
          lost.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void layout.reload()}
            data-testid="dashboard-edit-reload"
          >
            Reload
          </button>
        </div>
      ) : null}

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
        {visible.map((row, index) => {
          const widget = row.widget;
          const { canMoveUp, canMoveDown } = moveAffordance(
            index,
            visible.length
          );
          return (
            <div
              key={row.placementId}
              data-testid={`widget-cell-${widget.id}`}
              // `empty:hidden` so a widget that drew NOTHING costs no row. A framed
              // widget always renders its card, so this can never hide one; it
              // reaches only an unframed widget whose component returned null --
              // which core's conditional sections do, and did before they were
              // widgets. Without it each becomes a blank cell with a `gap-6` on
              // either side, which is the empty-slot bug rather than the hiding
              // those components have always performed.
              //
              // CSS rather than asking the component to declare its own emptiness:
              // a declaration is a second statement of what the render already
              // decided, and the two drift.
              className={cn(
                widgetSpanClass(widget.size),
                "empty:hidden",
                // An unframed widget is a SECTION, and sections on this page have
                // always been 48px apart -- the `space-y-12` the dashboard used
                // before these became widgets. The grid's own `gap-6` is a card
                // rhythm and right for cards, so the difference belongs to the
                // widgets that are not cards: 24px of trailing margin plus the
                // 24px row gap puts two adjacent sections back at 48px.
                //
                // BOTTOM only. A symmetric `my-3` also pushed the FIRST row down,
                // and the page's outer `space-y-12` already places the grid 48px
                // below the welcome header -- so every dashboard gained 12px there
                // while the inter-section gaps looked correct. Measuring the gaps
                // alone could not see it; only the header-to-first-section distance
                // could.
                //
                // Margins, not padding: a hidden cell contributes neither, but
                // padding would also inset a body that draws its own background.
                widget.chrome === "none" && "mb-6",
                // A hidden card is drawn while editing so it can be brought
                // back, and dimmed so it is not mistaken for a live one. The
                // dimming is presentational only: the controls above it stay at
                // full contrast, because they are what the reader needs to act
                // on and a faded button is a button people cannot read.
                row.hidden && "opacity-50"
              )}
            >
              {editor.isEditing ? (
                <WidgetEditControls
                  title={widget.title}
                  position={index + 1}
                  count={visible.length}
                  hidden={row.hidden}
                  canMoveUp={canMoveUp}
                  canMoveDown={canMoveDown}
                  onMoveUp={() => {
                    editor.moveBy(index, -1);
                    announceMove(widget.title, index + 1 - 1, visible.length);
                  }}
                  onMoveDown={() => {
                    editor.moveBy(index, 1);
                    announceMove(widget.title, index + 1 + 1, visible.length);
                  }}
                  onToggleHidden={() => editor.toggleHidden(row.placementId)}
                  onRemove={() => editor.remove(row.placementId)}
                />
              ) : null}
              <WidgetRenderer
                definition={widget}
                slot={slots[widget.id]}
                updatedAt={requested.has(widget.id) ? updatedAt : null}
                // Only a widget that actually ASKED can be waiting on an answer.
                // A card drawn entirely by a plugin component took no part in
                // the batch, and neither did one whose archetype nothing can
                // draw, so a refetch says nothing about either.
                isFetching={requested.has(widget.id) ? isFetching : false}
              />
            </div>
          );
        })}
      </section>

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
