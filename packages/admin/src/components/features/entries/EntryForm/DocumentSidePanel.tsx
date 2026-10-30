"use client";

/**
 * The document panel's frame, in the mode the editor's width calls for.
 *
 * - Docked: a 320px column beside the fields, its content sticking under the
 *   document bar for the editor's whole height.
 * - Floating: the same column lifted over the fields' right edge, with a
 *   shadow, a heading and its own close button. Not modal: the fields stay
 *   usable beside it, and Escape inside it closes it.
 * - Sheet: a sheet from the bottom of a phone's screen, modal as a sheet over
 *   a page is, with the same heading and close button.
 *
 * What the panel says is the caller's (`EntryFormSidebar`); this decides only
 * where it is drawn, so the entry and Single editors frame it identically.
 *
 * @module components/features/entries/EntryForm/DocumentSidePanel
 */

import type { JSX, KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";

import { X } from "@admin/components/icons";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import type { DocumentPanelMode } from "./document-panel-mode";
import { DOCUMENT_PANEL_STICKY } from "./DocumentEditorLayout";

/** The panel's accessible name, in every mode. */
const DOCUMENT_PANEL_LABEL = "Document panel";

/**
 * Marks the bar's panel toggle, where focus returns once a floating panel
 * closes: the control that opened it, so a keyboard is put back where it was.
 */
export const DOCUMENT_PANEL_TOGGLE_ATTRIBUTE = "data-document-panel-toggle";

/** Hides a scrollbar while keeping the column scrollable, as it always has. */
const QUIET_SCROLL =
  "overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]";

/**
 * The floating panel's height: as tall as what it says, and never taller than
 * the scroll area under the bar, where it scrolls inside itself. Not capped by
 * the editor's row: a short document's row ends well above the screen's foot,
 * and a panel held to it would cut its own sections off.
 */
const FLOATING_HEIGHT =
  "max-h-[calc(var(--editor-scrollport,calc(100vh-4rem))-var(--document-bar-height,3.25rem))]";

export interface DocumentSidePanelProps {
  mode: DocumentPanelMode;
  /** Whether the panel is on screen. */
  shown: boolean;
  /** Closes it, from its close button, Escape, or the sheet's scrim. */
  onClose: () => void;
  children: ReactNode;
}

export function DocumentSidePanel({
  mode,
  shown,
  onClose,
  children,
}: DocumentSidePanelProps): JSX.Element | null {
  // The sheet stays mounted while closed, so it can animate out.
  if (mode === "sheet") {
    return (
      <Sheet open={shown} onOpenChange={open => (open ? null : onClose())}>
        <SheetContent
          side="bottom"
          data-document-panel="sheet"
          className="flex max-h-[80dvh] flex-col gap-0 rounded-t-xl p-0"
        >
          <PanelHeading
            onClose={onClose}
            title={
              <SheetTitle className="text-sm font-semibold">
                Document
              </SheetTitle>
            }
          />
          <SheetDescription className="sr-only">
            Where this document stands, its languages and its details.
          </SheetDescription>
          <div
            className={cn(
              "min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]",
              QUIET_SCROLL
            )}
          >
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!shown) return null;

  if (mode === "floating") {
    return <FloatingPanel onClose={onClose}>{children}</FloatingPanel>;
  }

  return (
    <aside
      aria-label={DOCUMENT_PANEL_LABEL}
      data-document-panel="docked"
      className="relative z-10 flex w-[320px] shrink-0 flex-col border-l border-border bg-background"
    >
      {/* Sticks under the document bar, as tall as the scroll area less it. */}
      <div className={cn(DOCUMENT_PANEL_STICKY, QUIET_SCROLL, "flex flex-col")}>
        {children}
      </div>
    </aside>
  );
}

/**
 * The panel over the fields. Its column spans the editor's row out of the
 * flow, so the fields keep the whole width; the panel itself sticks under the
 * bar inside that column as the fields scroll.
 */
function FloatingPanel({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);

  // Opened by the toggle, so focus follows it in: a keyboard would otherwise
  // have to travel the whole form to reach what it just opened.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  const close = () => {
    onClose();
    // Back to the control that opened it, which stays in the bar.
    document
      .querySelector<HTMLElement>(`[${DOCUMENT_PANEL_TOGGLE_ATTRIBUTE}]`)
      ?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Escape here closes the panel and goes no further: the editor's own
    // Escape (back to the list) is for a page with nothing open on it.
    // Prevented as well as stopped, so a shortcut layer reading the event
    // elsewhere sees it was handled.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-[320px] max-w-full">
      <aside
        ref={panel}
        tabIndex={-1}
        aria-label={DOCUMENT_PANEL_LABEL}
        data-document-panel="floating"
        onKeyDown={onKeyDown}
        className={cn(
          // A sheet hung from under the bar at the editor's right edge: its
          // open sides are drawn, and its free corner rounded.
          "pointer-events-auto sticky top-[var(--document-bar-height,3.25rem)] flex flex-col rounded-bl-lg border-b border-l border-border bg-background shadow-lg outline-none",
          FLOATING_HEIGHT
        )}
      >
        <PanelHeading
          onClose={close}
          title={
            <h2 className="text-sm font-semibold text-foreground">Document</h2>
          }
        />
        <div className={cn("min-h-0 flex-1", QUIET_SCROLL)}>{children}</div>
      </aside>
    </div>
  );
}

/** The heading and close button an overlaid panel carries; docked, none. */
function PanelHeading({
  title,
  onClose,
}: {
  title: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border pl-5 pr-2">
      {title}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onClose}
        aria-label="Close document panel"
        title="Close document panel"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
