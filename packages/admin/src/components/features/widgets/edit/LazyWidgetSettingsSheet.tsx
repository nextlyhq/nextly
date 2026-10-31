"use client";

/**
 * A card's settings sheet, with its code loaded when a reader is about to
 * open it rather than with the dashboard.
 *
 * The sheet draws its form with the entry editor's field renderer, and that
 * renderer reaches the whole editor (a relationship field can create the entry
 * it links to, in the editor's own form). Imported statically, every dashboard
 * visit loaded the editor for a sheet most visits never open. Its code is
 * asked for on the first sign a reader is heading for it (`preloadWidgetSettingsSheet`:
 * a pointer over, or focus on, a control that opens it), so it has usually
 * arrived by the time it opens.
 *
 * @module components/features/widgets/edit/LazyWidgetSettingsSheet
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nextlyhq/ui";
import { lazy, Suspense, type JSX } from "react";

import type { WidgetSettingsSheetProps } from "./WidgetSettingsSheet";

/** The sheet's module. The module loader fetches it once, so a preload and an opening share it. */
function loadSheet() {
  return import("./WidgetSettingsSheet");
}

const WidgetSettingsSheet = lazy(() =>
  loadSheet().then(m => ({ default: m.WidgetSettingsSheet }))
);

/**
 * Start fetching the sheet's code ahead of its opening. A failed fetch says
 * nothing here: opening the sheet asks again.
 */
export function preloadWidgetSettingsSheet(): void {
  loadSheet().catch(() => undefined);
}

/**
 * The handlers that preload the sheet from a control that opens it, or opens the menu or
 * popover it is opened from: a pointer over it, or focus on it.
 */
export const settingsIntent = {
  onPointerEnter: preloadWidgetSettingsSheet,
  onFocus: preloadWidgetSettingsSheet,
} as const;

/**
 * The sheet as it stands while its code is still arriving: the same panel and
 * heading, saying it is loading. Opening can outrun the preload (a tap, or a
 * screen reader's activation, gives it little or no lead), and the menu and
 * popover that open the sheet close themselves without handing focus back, so
 * without a panel here focus would fall to the page and the action would seem
 * lost. The sheet takes focus into itself as it opens, and the status says why
 * the form is not there yet. `Sheet` is already part of the shell, so this
 * adds nothing to what every page loads.
 */
function SheetLoading({
  open,
  onOpenChange,
  title,
  renderPreview,
}: Pick<
  WidgetSettingsSheetProps,
  "open" | "onOpenChange" | "title" | "renderPreview"
>): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-busy="true"
        // The loaded sheet's width, so the panel does not jump once the form arrives.
        className={
          renderPreview
            ? "flex w-full flex-col overflow-hidden sm:max-w-md lg:max-w-4xl"
            : "flex w-full flex-col overflow-hidden sm:max-w-md"
        }
      >
        <SheetHeader>
          <SheetTitle>{title} settings</SheetTitle>
          <SheetDescription>
            These apply to this card only. Another copy of the same widget keeps
            its own.
          </SheetDescription>
        </SheetHeader>
        <p role="status" className="px-4 text-sm text-muted-foreground">
          Loading settings…
        </p>
      </SheetContent>
    </Sheet>
  );
}

/**
 * {@link WidgetSettingsSheet} once its code has arrived, and {@link SheetLoading}
 * in its place until then.
 */
export function LazyWidgetSettingsSheet(
  props: WidgetSettingsSheetProps
): JSX.Element {
  return (
    <Suspense
      fallback={
        <SheetLoading
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={props.title}
          renderPreview={props.renderPreview}
        />
      }
    >
      <WidgetSettingsSheet {...props} />
    </Suspense>
  );
}
