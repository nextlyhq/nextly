"use client";

/**
 * A card's settings panel (`CellSettings`), with its code loaded when a reader
 * is about to open it rather than with the dashboard.
 *
 * The panel draws its form with the entry editor's field renderer, and that
 * renderer reaches the whole editor (a relationship field can create the entry
 * it links to, in the editor's own form). Imported statically, every dashboard
 * visit loaded the editor for a panel most visits never open. Its code is
 * asked for on the first sign a reader is heading for it (`preloadWidgetSettingsSheet`:
 * a pointer over, or focus on, a control that opens it), so it has usually
 * arrived by the time it opens. The fetch and those handlers live in
 * `settings-sheet-code`, so a card that only starts the fetch does not carry
 * this panel.
 *
 * @module components/features/widgets/edit/LazyWidgetSettingsSheet
 */

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { useRetryableModule } from "@admin/hooks/useRetryableModule";

import type { CellSettingsProps } from "./CellSettings";
import { closeFocusTo } from "./panel-close-focus";
import { settingsSheetModule } from "./settings-sheet-code";

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
  returnFocusTo,
  failure,
}: Pick<CellSettingsProps, "open" | "onOpenChange" | "returnFocusTo"> & {
  /** The card's title, which names the panel as the loaded one names it. */
  title: string;
  /**
   * Set once the fetch has failed: the panel says so, with Try again, or,
   * once a retry has failed as well, Reload the page.
   */
  failure?: { exhausted: boolean; onRetry: () => void };
}): JSX.Element {
  return (
    // Not modal, as the loaded panel is not: the dashboard beside it stays usable while it loads.
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        aria-busy={failure ? undefined : true}
        // The loaded panel's width, so it does not jump once the form arrives.
        className="flex w-full flex-col overflow-hidden sm:w-[520px] sm:min-w-[480px] sm:max-w-[560px]"
        onInteractOutside={event => event.preventDefault()}
        // Closed before the code arrives, focus goes back where the loaded panel's would. Gone
        // while still open, it was replaced by the loaded panel, which is no close: focus stays
        // where that panel puts it, on the field it was opened for where there is one.
        onCloseAutoFocus={event => {
          if (open) {
            event.preventDefault();
            return;
          }
          closeFocusTo(returnFocusTo)(event);
        }}
      >
        <SheetHeader>
          <SheetTitle>{title} settings</SheetTitle>
          <SheetDescription>
            These apply to this card only. Another copy of the same widget keeps
            its own.
          </SheetDescription>
        </SheetHeader>
        {failure ? (
          // Contained in the panel: a failed fetch leaves the dashboard and
          // its cards as they were, and closing the panel still works.
          <div role="alert" className="flex flex-col items-start gap-3 px-4">
            <p className="text-sm text-muted-foreground">
              {failure.exhausted
                ? "Settings still could not be loaded. Reload to start over."
                : "Settings could not be loaded. Check your connection and try again."}
            </p>
            {failure.exhausted ? (
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload the page
              </Button>
            ) : (
              <Button variant="outline" onClick={failure.onRetry}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <p role="status" className="px-4 text-sm text-muted-foreground">
            Loading settings…
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The card's settings panel (`CellSettings`) once its code has arrived, and
 * {@link SheetLoading} in its place until then, or saying the code could not be
 * fetched.
 */
export function LazyWidgetSettingsSheet(props: CellSettingsProps): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    settingsSheetModule,
    "The card settings panel's code"
  );
  if (state.status === "ok") {
    const CellSettings = state.value;
    return <CellSettings {...props} />;
  }
  return (
    <SheetLoading
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.widget.title}
      returnFocusTo={props.returnFocusTo}
      {...(state.status === "error"
        ? { failure: { exhausted: attempt > 0, onRetry: retry } }
        : {})}
    />
  );
}
