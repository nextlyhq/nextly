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

import { settingsSheetModule } from "./settings-sheet-code";
import type { WidgetSettingsSheetProps } from "./WidgetSettingsSheet";

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
  failure,
}: Pick<
  WidgetSettingsSheetProps,
  "open" | "onOpenChange" | "title" | "renderPreview"
> & {
  /**
   * Set once the fetch has failed: the panel says so, with Try again, or,
   * once a retry has failed as well, Reload the page.
   */
  failure?: { exhausted: boolean; onRetry: () => void };
}): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-busy={failure ? undefined : true}
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
 * {@link WidgetSettingsSheet} once its code has arrived, and {@link SheetLoading}
 * in its place until then, or saying the code could not be fetched.
 */
export function LazyWidgetSettingsSheet(
  props: WidgetSettingsSheetProps
): JSX.Element {
  const { state, attempt, retry } = useRetryableModule(
    settingsSheetModule,
    "The card settings sheet's code"
  );
  if (state.status === "ok") {
    const WidgetSettingsSheet = state.value;
    return <WidgetSettingsSheet {...props} />;
  }
  return (
    <SheetLoading
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      renderPreview={props.renderPreview}
      {...(state.status === "error"
        ? { failure: { exhausted: attempt > 0, onRetry: retry } }
        : {})}
    />
  );
}
