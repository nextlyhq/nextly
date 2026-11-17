"use client";

import {
  PortalProvider,
  ShortcutProvider,
  TooltipProvider,
} from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import * as React from "react";

import { CanvasFrameShortcuts } from "../canvas/canvas-frame-context";
import { FIT_ZOOM, type CanvasZoom } from "../canvas/canvas-zoom";
import { HoveredBlockProvider } from "../canvas/hovered-block";
import { CssNamesContext, type CssNames } from "../css-names-context";
import type { SectionFolds } from "../panel-folds";
import { PanelFoldsContext, type PanelFolds } from "../panel-folds-context";
import {
  browserStore,
  BUILDER_CHROME_CLASS,
  BUILDER_TOKENS_CLASS,
  DEFAULT_PREFERENCES,
  fitsFullShell,
  MIN_SHELL_WIDTH,
  SHELL_PREFERENCES_KEY,
  type PreferenceStore,
} from "../shell-state";

import {
  BuilderNoticeRegion,
  NoticeSinkProvider,
  useNoticeQueue,
} from "./builder-notices";
import { ShellActiveContext, useShellIsActive } from "./shell-active";
import { usePreferences } from "./shell-preferences";
import type { BuilderShellProps } from "./shell-props";
import { SettingsRequestContext } from "./shell-rail-dialogs";
import { ShellRegions } from "./shell-regions";

export type {
  BuilderShellProps,
  PanelView,
  SettingsDialogState,
} from "./shell-props";

/** No section folded, shared so its identity is stable. */
const NO_FOLDS: SectionFolds = {};

/**
 * The editor shell: rail, one switched panel, canvas, inspector, bars.
 *
 * PURELY PRESENTATIONAL, and that is a contract rather than a current state.
 * It owns which panel is open and how wide the regions are — chrome state, its
 * own business — and owns nothing about the document. Selection arrives as a
 * prop and leaves as a callback.
 *
 * The reason is not tidiness. Document ops INVALIDATE selection: a remove
 * deletes the selected node, a move relocates it. If the shell held selection it
 * would have to be updated in step with every op, which is two things changing
 * together — the drift this codebase keeps paying for. Held outside, selection
 * can be DERIVED from the post-op document ("does this id still resolve?"),
 * which cannot go out of step because there is only one thing to read.
 *
 * Content is passed as slots rather than rendered here, so the layers panel, the
 * inserter and the inspector can be built independently without this file
 * changing. It knows the SHAPE of the editor, never what fills it.
 *
 * This module holds the shell itself; each of its areas is a module of its
 * own: the props (`shell-props`), the preferences (`shell-preferences`), the
 * design system's stylesheet (`shell-stylesheet`), keyboard movement between
 * regions (`shell-region-cycling`), the rail and its dialogs
 * (`shell-rail-dialogs`), the top bar (`shell-top-bar`), the side panels
 * (`shell-side-panels`), the canvas region (`shell-canvas-region`) and the
 * regions laid out (`shell-regions`).
 *
 * @module builder-shell
 */

/**
 * Whether the shell's own CONTAINER can carry the full layout, as it changes.
 *
 * The container rather than the viewport, because that is what the shell sizes
 * to — `h-full w-full`, no viewport units anywhere. The two agree only when the
 * shell happens to fill the window, so an editor embedded in a narrow column on
 * a wide display was told it fitted and compressed its regions past their
 * minimums.
 *
 * Starts as `true` on purpose. The alternative is measuring during render,
 * which the server cannot do — it would emit the narrow-viewport message and the
 * client would replace it, a hydration mismatch on every desktop load. Assuming
 * the supported case and correcting after mount makes both first renders
 * identical.
 */
function useFitsFullShell(): [(node: HTMLElement | null) => void, boolean] {
  const [fits, setFits] = React.useState(true);
  const observer = React.useRef<ResizeObserver | null>(null);

  /*
   * A CALLBACK ref, not an effect over a `useRef`.
   *
   * The observed element is REPLACED when the answer flips — the notice and the
   * shell root are different nodes, and only one of them is on screen at a time
   * — so an effect keyed on mount would observe whichever rendered first and go
   * on observing it after React swapped it out.
   */
  const measure = React.useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (node === null) return;
    // jsdom implements no `ResizeObserver`. Falling back to `fits` rather than
    // to a notice matches the initial state's reasoning: a shell that cannot
    // measure renders fully rather than showing a message it has no evidence
    // for.
    if (typeof ResizeObserver === "undefined") {
      setFits(true);
      return;
    }
    const next = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      // The CONTENT box of the measuring wrapper, which is by construction the
      // space the regions are laid out in.
      //
      // Two properties make that the right quantity, and both are easy to lose:
      //
      // The wrapper carries the caller's `className` and nothing else, so its
      // content box is the space INSIDE whatever padding or border the host
      // applied — decoration the regions never receive. A border box would
      // report a 1280px root with `p-6` as fitting while leaving 1232px to lay
      // out in.
      //
      // It is also the SAME element whichever branch renders, so no branch's
      // own padding can move the threshold. The notice is `p-6` and sits inside
      // this box, where it is invisible to the measurement; measuring a branch
      // instead would make the answer depend on which one happened to be up.
      //
      // `contentRect` rather than `getBoundingClientRect`: both are layout
      // sizes, so a transformed ancestor — this editor has canvas zoom — does
      // not scale the number against a minimum expressed in CSS pixels.

      // The comparison itself comes from `shell-state`, which exports and tests
      // it. Repeating `>= MIN_SHELL_WIDTH` here would be a second answer to one
      // question, and the two would first disagree exactly at the boundary the
      // helper's tests pin.
      setFits(fitsFullShell(entry.contentRect.width));
    });
    next.observe(node);
    observer.current = next;
  }, []);

  React.useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    []
  );

  return [measure, fits];
}

/**
 * Re-exported from the leaf that declares it, so the shell stays the name callers reach for.
 *
 * The declaration moved out because `builder-notices` consumes it and the shell imports
 * `builder-notices`, which would make the two import each other.
 */
export { useShellIsActive };

/**
 * The shell, or a message saying where to edit instead.
 *
 * Below the supported width the shell does not try to compress: the rail, both
 * panels and a usable canvas do not fit at their minimums, and an editor that
 * merely gets cramped is worse than one that says it needs more width — the
 * author otherwise discovers the limit by failing at a task.
 *
 * @experimental
 */
export function BuilderShell({
  store,
  openPanelRequest,
  onZoomChange,
  editingBreakpointRequest,
  onEditingBreakpointChange,
  appliedScale = 1,
  notices: supplied,
  ...props
}: BuilderShellProps): React.JSX.Element {
  // The browser store is built once: rebuilt each render it would change
  // `usePreferences`' callback identity every render, and the write effect with
  // it. Only the FALLBACK needs that treatment though. Capturing the caller's
  // `store` alongside it pinned whichever one arrived first, so a host that
  // swaps stores — signing into a second workspace, promoting a memory store to
  // a persisted one — went on reading and writing the store it had replaced.
  const fallbackStore = React.useRef<PreferenceStore | null>(null);
  fallbackStore.current ??= browserStore(SHELL_PREFERENCES_KEY);
  const resolvedStore = store ?? fallbackStore.current;
  const [preferences, update, loadCount, loadedFromCurrentStore] =
    usePreferences(resolvedStore);
  const [measureShell, shellFits] = useFitsFullShell();

  /*
   * Applies an `openPanelRequest` change AT MOST ONCE — a ref rather than
   * state, because recording that a token was handled is not itself something a
   * re-render should follow from.
   *
   * The ref deliberately survives a store swap. A token already applied belongs
   * to the session the author pressed the control in, so re-applying it to the
   * store that replaced it would open a panel nobody asked this store for.
   *
   * FORCES `leftPanel` to the requested panel rather than routing through
   * `panelAfterRailClick`: that helper TOGGLES, and toggling is exactly wrong
   * for a control whose contract is "show the panel this fills" — never
   * "close it if it happens to already be open", which is what a second rail
   * click on the same item means.
   *
   * No availability check against `availablePanels` here: `ShellRegions`
   * below already normalises `preferences.leftPanel` against it when deriving
   * the panel it actually renders, so a request naming a panel the host
   * cannot fill is absorbed there rather than needing a second check here.
   */
  const handledPanelRequest = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (openPanelRequest === undefined) return;
    /*
     * Nothing is applied until THIS store's read has landed, and that ordering
     * is the whole of this guard.
     *
     * `update` takes the newest preferences this hook has seen and writes the
     * result straight back through the store it currently holds. Reading a
     * store is itself an effect, so in the commit a store first arrives in it
     * has only SCHEDULED that store's record — what `update` would spread here
     * is still whatever `preferences` held before. Both ways that happens end
     * in a write of the wrong record:
     *
     * - at MOUNT, `preferences` is `DEFAULT_PREFERENCES`, so a token defined on
     *   the first render persists the defaults over the author's own panel
     *   widths and zoom.
     * - after a store SWAP — signing into a second workspace, promoting a
     *   memory store to a persisted one — `preferences` is the PREVIOUS store's
     *   record, so a token arriving in the same render writes one user's or
     *   workspace's saved layout into another's.
     *
     * Either way the panel the token asked for opens and looks entirely
     * correct, which is what makes the write invisible until the next load.
     *
     * So the arrival this waits on is store-specific rather than "some read has
     * happened": a COUNT of reads is already nonzero for the outgoing store at
     * the moment of a swap, which is precisely the window the second case sits
     * in. Once it is true, it stays true for as long as the store does — a read
     * cannot fail (`readPreferences` answers with the defaults for unreadable
     * or malformed storage) and one that remembers nothing still answers — so
     * this delays a token by a single render and can never hold one
     * indefinitely. A token arriving any later than that render applies in the
     * same flush it arrived in.
     */
    if (!loadedFromCurrentStore) return;
    if (handledPanelRequest.current === openPanelRequest.count) return;
    handledPanelRequest.current = openPanelRequest.count;
    const { panel, view } = openPanelRequest;
    update(current => ({
      ...current,
      leftPanel: panel,
      leftPanelHidden: false,
      leftPanelView: view ?? current.leftPanelView,
    }));
  }, [openPanelRequest, update, loadedFromCurrentStore]);

  /*
   * Applies an `editingBreakpointRequest` at most once per count, and only
   * once this store's own preferences have loaded, for the reasons the panel
   * request above waits: applied earlier it would write the defaults, or
   * another store's record, over the author's own.
   */
  const handledDeviceRequest = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (editingBreakpointRequest === undefined) return;
    if (!loadedFromCurrentStore) return;
    if (handledDeviceRequest.current === editingBreakpointRequest.count) return;
    handledDeviceRequest.current = editingBreakpointRequest.count;
    const breakpoint = editingBreakpointRequest.breakpoint;
    update(current =>
      current.editingBreakpoint === breakpoint
        ? current
        : { ...current, editingBreakpoint: breakpoint, zoom: FIT_ZOOM }
    );
  }, [editingBreakpointRequest, update, loadedFromCurrentStore]);

  /*
   * A zoom chosen outside this shell, stored here.
   *
   * Compared by VALUE rather than by object identity: a host rebuilding the
   * object each render — which the conventional inline handler does — would
   * write preferences on every render, and every write reports back out, which
   * is a loop rather than a preference.
   */
  /*
   * The zoom picker, resolved here rather than where it is drawn.
   *
   * `undefined` when the host has wired nothing, which is what makes the
   * control render nothing — see its own documentation for why a dead one is
   * worse than none. Deciding it at the render site put the branch inside a
   * region that is already the largest function in this file.
   */
  const onZoomPick = React.useMemo(
    () =>
      onZoomChange === undefined
        ? undefined
        : (next: CanvasZoom) => update(current => ({ ...current, zoom: next })),
    [onZoomChange, update]
  );

  /*
   * The zoom, reported on every value it takes, including the first, so a host
   * never has to assume the default.
   *
   * The callback is held in a ref rather than read straight from the prop. A
   * host passing the conventional inline callback hands this a NEW function
   * identity on every one of its own renders; as a dependency, that identity
   * would re-run the effect with nothing changed and call the host back again,
   * and a host whose state update itself re-renders closes that into a loop.
   *
   * Whether a listener EXISTS is a dependency, though.
   *
   * A host can resolve `onZoomChange` from its own state, so the prop moves
   * from `undefined` to a callback after the first render. Keyed on the value
   * alone, the effect would not re-run at that moment and the host would carry
   * the default zoom until the author happened to pick another — its canvas
   * drawn at a scale the control does not claim.
   */
  const onZoomChangeRef = React.useRef(onZoomChange);
  React.useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  });
  const reportingZoom = onZoomChange !== undefined;
  React.useEffect(() => {
    onZoomChangeRef.current?.(preferences.zoom);
  }, [reportingZoom, preferences.zoom]);

  // The device, reported the way the zoom is and for the same reasons.
  const onEditingBreakpointChangeRef = React.useRef(onEditingBreakpointChange);
  React.useEffect(() => {
    onEditingBreakpointChangeRef.current = onEditingBreakpointChange;
  });
  const reportingDevice = onEditingBreakpointChange !== undefined;
  React.useEffect(() => {
    onEditingBreakpointChangeRef.current?.(preferences.editingBreakpoint);
  }, [reportingDevice, preferences.editingBreakpoint]);

  /*
   * Where overlays inside this shell portal to. State rather than a ref,
   * because `PortalProvider` has to RE-RENDER once the node exists; a ref
   * mutation would leave the provider holding `null` for the life of the mount.
   */
  const [overlayHost, setOverlayHost] = React.useState<HTMLDivElement | null>(
    null
  );
  /*
   * Reports from controls that could not make one themselves. Owned at this
   * level because it must survive everything below it being unmounted, which
   * is exactly what the inspector's per-node keys do on every selection change.
   */
  // The shell's own queue is built whether or not the host supplied one — a
  // hook cannot be skipped — and the host's wins, so the region below and the
  // sink provided to every region report through the queue the host raises
  // into.
  const own = useNoticeQueue();
  const notices = supplied ?? own;
  // The block panel's section folds, kept with the other preferences and lent
  // to the inspector, which is rendered below as a prop.
  // "Show CSS names", kept with the other preferences and lent to the panel.
  const showCssNames = preferences.showCssNames === true;
  const cssNames = React.useMemo<CssNames>(
    () => ({
      shown: showCssNames,
      set: shown => update(current => ({ ...current, showCssNames: shown })),
    }),
    [showCssNames, update]
  );
  const sectionFolds = preferences.sectionFolds ?? NO_FOLDS;
  const panelFolds = React.useMemo<PanelFolds>(
    () => ({
      folds: sectionFolds,
      change: next =>
        update(current => ({
          ...current,
          sectionFolds: next(current.sectionFolds ?? NO_FOLDS),
        })),
    }),
    [sectionFolds, update]
  );

  return (
    <ShellProviders>
      {/* The same manager, listening in the canvas's frame as well, so a key
          pressed with focus inside the page reaches every binding above. */}
      <CanvasFrameShortcuts />
      {/* Provided here rather than required of the host: the shell's own
          controls carry tooltips, so a shell that renders them depends on this
          and should not make it someone else's setup step. Radix nests
          providers safely — a host with its own keeps its delay. */}
      <TooltipProvider delayDuration={300}>
        {/*
         * THE measured element, and the only one.
         *
         * Always rendered, whichever branch is showing, so it always has a box
         * to measure — which is what makes the decision reversible. Observing a
         * branch instead made the answer depend on that branch's own padding
         * and, in the editor's case, on a wrapper that is `display: contents`
         * when visible and `hidden` when narrow and therefore reports 0.
         *
         * It carries the caller's `className` and nothing else of its own, so
         * its CONTENT box is the space inside whatever padding, border or grid
         * area the host gave the shell — which is precisely the space its
         * children have to lay out in. Both branches are sized from it rather
         * than from the host directly, so neither can disagree with the
         * measurement.
         */}
        <div
          ref={measureShell}
          className={cn("h-full w-full", props.className)}
        >
          {/*
           * The notice surface, mounted OUTSIDE the wrapper the shell makes
           * `hidden` and `inert`, and mounted unconditionally.
           *
           * Both properties are load-bearing and they fix different failures.
           *
           * Outside, because inert content is excluded from the accessibility
           * tree and `hidden` takes it out of paint — so a region inside the
           * wrapper is unreachable by eye AND by screen reader exactly when the
           * narrow-width notice is up. A refusal that arrives while an author
           * is narrowing the window has to land somewhere they can still read.
           *
           * Unconditionally, rather than switched between the two branches
           * below, because a live region has to EXIST before the text is put
           * into it: a region inserted and populated together is routinely
           * missed, and one that remounts every time the width crosses the
           * threshold is inserted at the worst possible moment. A single
           * permanent mount also keeps there being exactly one — two live
           * regions interfere and some messages are announced by neither.
           *
           * The token scope is what the old placement inside the chrome was
           * for: `--nx-builder-*` inherit down and never across, so a surface
           * outside the chrome needs them declared on an ancestor of its own.
           * It takes the TOKEN class rather than the chrome class, because the
           * chrome class also identifies the editor's root — a second element
           * carrying it would be matched by every selector and query that means
           * "the editor", the empty-slot selector among them.
           *
           * `display: contents` declares the tokens while generating no box, so
           * nothing is added to the layout the branches below measure — and the
           * region is `position: fixed` regardless, since nothing here creates
           * a containing block.
           */}
          <div className={cn(BUILDER_TOKENS_CLASS, "contents")}>
            <BuilderNoticeRegion
              notices={notices.notices}
              onDismiss={notices.dismiss}
            />
          </div>
          {!shellFits ? (
            <div
              // No caller `className` here: the wrapper above owns the host's
              // positioning now, and repeating it would apply a grid area or a
              // border twice.
              className={cn(
                BUILDER_CHROME_CLASS,
                "flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
              )}
            >
              {/*
               * Worded as WIDTH rather than as a screen, because the shell
               * measures the space it was given. An editor embedded in a narrow
               * column on a large display is the case that named the wrong
               * cause: the author's screen is fine and widening it changes
               * nothing.
               */}
              <p className="text-sm font-medium">
                The page editor needs more width
              </p>
              {/*
               * The escape sentence and the button below it are ONE UNIT with the
               * handler: all three present, or all three absent.
               *
               * Keeping the copy while dropping the control would instruct the
               * author to go somewhere and then offer nothing to get there — and
               * keeping a button with no handler is worse, because it looks
               * operable. A host that supplies no `onExit` has no destination to
               * offer, and an embedded one needs none: the author is already
               * inside the surrounding form and can scroll to the rest of it.
               */}
              {props.onExit ? (
                <>
                  <p className="text-[color:var(--nx-builder-text-muted)] max-w-sm text-sm">
                    The editor needs at least {MIN_SHELL_WIDTH}px of width. In a
                    narrower space you can still edit this page&apos;s content
                    from the admin.
                  </p>
                  <button
                    type="button"
                    onClick={props.onExit}
                    className="border-[color:var(--nx-builder-border)] focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Exit editor
                  </button>
                </>
              ) : (
                <p className="text-[color:var(--nx-builder-text-muted)] max-w-sm text-sm">
                  The editor needs at least {MIN_SHELL_WIDTH}px of width.
                </p>
              )}
            </div>
          ) : null}

          {/* The editor stays MOUNTED while the notice is up, rather than being
            swapped out for it.

            Returning the notice instead unmounted every slot the caller had
            given us — canvas, inspector, panels — and React discards the state
            inside them: a half-written caption, an open picker, whatever the
            host was holding locally. Narrowing a window or rotating a tablet is
            a transient act, and widening it again produced fresh, empty slot
            instances with no way for the host to have saved anything, because
            nothing told it the subtree was going away.

            `hidden` takes it out of layout and paint; `inert` takes it out of
            the tab order and the accessibility tree, so nothing behind the
            notice is reachable by keyboard or screen reader. The cost is that
            the editor goes on occupying memory while hidden, which is the
            deliberate trade: an author's unsaved work is worth more than the
            allocation. */}
          <div
            hidden={!shellFits}
            inert={!shellFits}
            // `display: contents` while visible, so this wrapper adds no box of
            // its own and the shell keeps sizing against the caller's container.
            // Omitted while hidden, where the `hidden` attribute's own
            // `display: none` has to be the one that applies.
            className={shellFits ? "contents" : undefined}
          >
            {/* Published as context as well as applied as attributes, because `hidden` and `inert`
              only reach what renders INSIDE this wrapper. Slot content that reads this answers for
              itself; content that PORTALS is contained by `overlayHost` below instead. */}
            <ShellActiveContext.Provider value={shellFits}>
              {/*
               * Overlays portal to a host INSIDE the inert wrapper, so `hidden`
               * and `inert` reach them.
               *
               * A portalled dropdown is not a descendant of the region that
               * opened it, so neither attribute could ever reach it: an open
               * `Select` stayed visible and clickable on top of the notice
               * saying the editor was unavailable. Redirecting the portal is a
               * boundary rather than a rule each control has to remember, which
               * matters because the set of portalling components is open ended
               * and the next one added would not know to check.
               *
               * WHERE it sits is the whole design, and two placements are wrong
               * for different reasons. Inside a region clips it: the panel, the
               * canvas and the inspector are each `overflow-auto`, so a dropdown
               * opened near a panel edge would be cut off — a silent visual
               * failure, worse than the interactive one being fixed. Inside the
               * shell ROOT is also wrong, because that root is
               * `overflow-hidden`. Here it is a sibling of the shell root:
               * within the element carrying `hidden`/`inert`, and outside every
               * box that clips.
               *
               * Taken out of flow so it can never affect the layout it sits
               * beside. It stays a DOM descendant of the inert wrapper, which is
               * what `inert` follows, and nothing here creates a containing
               * block, so the fixed-position content each overlay renders is
               * still positioned against the viewport.
               */}
              <div
                ref={setOverlayHost}
                data-slot="builder-overlay-host"
                className="absolute h-0 w-0"
              />
              {/*
               * `null` until the host mounts, which `usePortalContainer` reads
               * as "use the default". That is one commit of the old behaviour
               * rather than a crash, and no overlay can be open that early.
               */}
              <PortalProvider container={overlayHost}>
                {/* Wraps the regions rather than sitting beside them: the
                    inspector and the panels are `ReactNode` props, so they
                    become descendants of this provider by being RENDERED here,
                    wherever the host created them. */}
                <NoticeSinkProvider raise={notices.raise}>
                  <SettingsRequestContext.Provider
                    value={props.openSettingsRequest}
                  >
                    <PanelFoldsContext.Provider value={panelFolds}>
                      <CssNamesContext.Provider value={cssNames}>
                        <ShellRegions
                          appliedScale={appliedScale}
                          onZoomPick={onZoomPick}
                          {...props}
                          preferences={preferences}
                          update={update}
                          active={shellFits}
                          loadCount={loadCount}
                          /*
                           * The caller's `className` stops here: the measuring wrapper
                           * above carries it. Passing it on would apply the host's grid
                           * area, height or border a second time, on a box nested inside
                           * the one already carrying it.
                           */
                          className={undefined}
                        />
                      </CssNamesContext.Provider>
                    </PanelFoldsContext.Provider>
                  </SettingsRequestContext.Provider>
                </NoticeSinkProvider>
              </PortalProvider>
            </ShellActiveContext.Provider>
          </div>
        </div>
      </TooltipProvider>
    </ShellProviders>
  );
}

/**
 * What every shell provides to everything inside it: the shortcut manager,
 * and one hovered block for its panels and its canvas, so a Layers row the
 * pointer is over outlines its block on the page.
 */
function ShellProviders({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ShortcutProvider>
      <HoveredBlockProvider>{children}</HoveredBlockProvider>
    </ShortcutProvider>
  );
}

export { DEFAULT_PREFERENCES };
