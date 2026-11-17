/**
 * What the editor shell is given: its props, the part of a panel showing,
 * and the state the host's Settings dialog is drawn with.
 *
 * @module shell-props
 */
import * as React from "react";

import type { CanvasZoom } from "../canvas-zoom";
import type { LeftPanel, PreferenceStore } from "../shell-state";

import type { NoticeQueue } from "./builder-notices";

/**
 * Which part of a panel is showing, for a panel with parts — the Design
 * panel's tabs. The shell keeps it with the other preferences, so the tab an
 * author left open is the one they come back to; what the names mean is the
 * host's business.
 */
export interface PanelView {
  /** The part last chosen, or null for the panel's own default. */
  current: string | null;
  choose: (view: string) => void;
}

/** What the shell hands the host's Settings dialog. */
export interface SettingsDialogState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control focus returns to when the dialog closes: the rail's item. */
  returnFocus: () => HTMLElement | null;
}

export interface BuilderShellProps {
  /** Rendered inside the switched left panel. Keyed by the panel that is open. */
  renderPanel?: (panel: LeftPanel, view: PanelView) => React.ReactNode;
  /**
   * Settings, as a dialog the host draws and the rail's Settings item opens.
   *
   * A dialog rather than a panel: it holds the page's and the site's
   * configuration, which an author visits and leaves, and a panel would take
   * the canvas's room for it. The shell owns whether it is open, as it owns
   * Help's, so the rail shows it pressed and the editor giving way to the
   * narrow-window notice closes it. With this given, `settings` is never a
   * left panel.
   */
  renderSettings?: (dialog: SettingsDialogState) => React.ReactNode;
  /**
   * Opens the host's Settings dialog from outside the rail, as
   * `openPanelRequest` opens a panel: a page's "Settings" in a list the host
   * draws, say. Applied once per `count`, so a host re-rendering with the same
   * request does not reopen a dialog the author has closed. Ignored without
   * `renderSettings`.
   */
  openSettingsRequest?: { readonly count: number };
  /**
   * The host's notice queue, when the host raises notices of its own.
   *
   * The shell owns a queue and renders the region for it, and provides its
   * `raise` to everything it renders — but a host sits ABOVE the shell, and
   * an editor it builds there (the apply that refuses an edit for room, say)
   * has no way to reach that sink. Handed the host's queue, the shell renders
   * and provides THAT one, so a sentence raised above the shell and one raised
   * inside it land in the same region. Absent, the shell's own queue serves.
   */
  notices?: NoticeQueue;
  /**
   * Which panels the host can actually fill.
   *
   * The rail offers only these. A panel outside the list has no item at all
   * rather than a disabled one: an item that does nothing teaches an author
   * that the rail is unreliable, and opening a panel nothing renders into would
   * reserve room and shrink the canvas to display nothing. Omit the prop
   * entirely and every panel is treated as available, which keeps a host that
   * fills all of them from having to enumerate them.
   *
   * Derived from what the host can render rather than declared twice: pass the
   * same set `renderPanel` returns content for, and the rail cannot disagree with
   * the panel body.
   */
  availablePanels?: readonly LeftPanel[];
  /**
   * Opens a panel from OUTSIDE the shell, once per distinct count.
   *
   * The rail is normally the only way to change which panel is open, and its
   * own click handler is a TOGGLE — pressing an already-open panel's item
   * closes it. A control drawn on the canvas itself (the empty-container
   * appender) needs the opposite contract: pressing it must show the insert
   * panel whether or not it is already open, and pressing it again for a
   * DIFFERENT empty container must show it again even if the author closed it
   * by hand in between.
   *
   * A plain boolean or a bare panel name cannot express "again" — the second
   * press would carry the same value as the first, and an effect keyed on it
   * would never re-run. A counter the caller bumps on every press is the same
   * shape {@link PreferencesLoad.count} below has: not the state itself, but a
   * count of how many times the thing behind it happened.
   *
   * The panel travels WITH the count rather than in a second prop. One caller
   * asking for Add and another for Design's variables are the same request
   * with a different subject, and two props would be two answers to one
   * question — free to disagree about which panel a given count refers to.
   * The view travels with them for the same reason; absent, the panel opens
   * on whichever part the author last chose.
   *
   * Left `undefined` this does nothing, which is what every host that has no
   * such control gets by default.
   */
  openPanelRequest?: {
    readonly panel: LeftPanel;
    readonly view?: string;
    readonly count: number;
  };
  /**
   * Reports the canvas zoom, and takes the change back.
   *
   * The shell owns it because the shell owns preferences, and a host owns what
   * to DO with it — the canvas is the host's to render, so only it can apply a
   * scale. Reported on every value, including the first, so a host never has
   * to assume the default.
   */
  onZoomChange?: (zoom: CanvasZoom) => void;
  /**
   * Asks the shell to edit at a breakpoint: an id from the site's breakpoints,
   * or null for the base one.
   *
   * A count travels with it for the reason `openPanelRequest` carries one: the
   * same device asked for twice is two requests, and a value that repeated
   * itself would look unchanged. The shell stores the choice with the author's
   * other preferences and, when it is a different device from the one being
   * edited, puts the zoom back to fitting, since a zoom chosen for one width
   * rarely suits another.
   */
  editingBreakpointRequest?: {
    readonly breakpoint: string | null;
    readonly count: number;
  };
  /**
   * Reports the breakpoint being edited, including the one restored on load
   * and the base one (null) a new author starts on.
   *
   * The host draws the canvas at that breakpoint's width and sends edits to
   * it. It is the author's choice alone: nothing the shell does to the layout,
   * opening a panel or a narrower window, changes it.
   */
  onEditingBreakpointChange?: (breakpoint: string | null) => void;
  /**
   * The scale the canvas is actually painting at, for the zoom control.
   *
   * Travels UP because only the canvas can know it — while fitting it is
   * derived from a region the canvas measures — and the canvas is the host's to
   * render. The zoom itself travels DOWN, because this shell owns preferences
   * and therefore owns the choice.
   *
   * One direction each is the whole design. Holding the zoom on both sides and
   * syncing them is what produced an oscillating write of `fit, 2, fit, 2` on
   * every open: two owners, each correcting the other.
   */
  appliedScale?: number;
  /** The canvas. The shell never looks inside it. */
  children?: React.ReactNode;
  /** The inspector's contents. */
  inspector?: React.ReactNode;
  /**
   * The document's title, shown read-only at the start of the top bar and cut
   * short with its full text in a tooltip when the bar is narrow.
   */
  title?: string;
  /** The top bar's start column, after the exit button and the title. */
  topBar?: React.ReactNode;
  /**
   * The top bar's centre column, before the zoom: the device buttons. Centred
   * between two equal side columns, so it stays in the middle of the editor
   * whatever the sides hold.
   */
  topBarCenter?: React.ReactNode;
  /** The top bar's end column, after the side-panel buttons: the actions. */
  topBarEnd?: React.ReactNode;
  /** The ancestor breadcrumb, along the bottom bar. */
  breadcrumb?: React.ReactNode;
  /**
   * A card floated over the canvas — the getting-started checklist today.
   *
   * Positioned by the shell rather than passed through `Canvas.overlay`,
   * because that overlay lives in the canvas's own content coordinates and
   * would scroll away with the page. This one belongs to the editor's chrome
   * and stays where it is put.
   */
  checklist?: React.ReactNode;
  /**
   * A strip pinned along the top of the canvas, above the page and outside
   * the region that scrolls it, so it stays in view while the page scrolls
   * under it: what the canvas is drawn with, where that is the author's to
   * choose (the entry a template is previewed with). Absent, or a node that
   * draws nothing (`null`, `false`), the canvas keeps the whole region, so
   * conditional JSX never leaves an empty band.
   *
   * @experimental Settles when collection templates ship.
   */
  canvasStrip?: React.ReactNode;
  /**
   * Leaving the editor. Explicit and LABELLED, never an unmarked X: the author
   * is one click from losing a canvas full of work, and an ambiguous glyph is
   * how that happens.
   *
   * **Optional, because not every host has a destination.** The editor mounts
   * both as a standalone view, where leaving means navigating away from unsaved
   * canvas state, and EMBEDDED as a field inside an entry form, where there is
   * nowhere to go — the form is already on screen around it. Omitting this
   * renders no exit affordance anywhere, including in the narrow-viewport
   * notice, whose escape sentence travels with the button.
   *
   * The handler IS the capability rather than a mode flag beside it, so the
   * control cannot exist without something to do. A `standalone` boolean would
   * be a second thing to keep in sync, and the state where the two disagree
   * would be representable.
   */
  onExit?: () => void;
  /**
   * Where chrome preferences live. Defaults to `localStorage` in a browser and
   * to a store that remembers nothing anywhere else, so a server render is a
   * default rather than a crash.
   *
   * **Pass a NEW object whenever the data behind it changes** — a different
   * signed-in user, a different workspace. The shell reloads preferences when
   * this identity changes, and cannot see a store that quietly starts reading
   * somewhere else: it would go on showing the previous user's panel widths and
   * write their preferences into the new target.
   *
   * This is the same contract React puts on any value it compares by identity,
   * and it keeps the port at two methods. The alternative — a subscription or a
   * revision token — is a third method every host has to implement correctly
   * for a case that a new object already solves.
   */
  store?: PreferenceStore;
  className?: string;
}
