"use client";

/**
 * The dashboard's controls: its breadcrumb at the top bar's left, the cog
 * that opens customise mode, and the mode's own controls.
 *
 * At rest the cog, "Customize dashboard", sits at the right end of the
 * greeting row, beside the cards it changes. In customise mode it leaves the
 * row, and the mode's controls, Reset, Add widget, Cancel and Save, take the
 * bar's right end, while the breadcrumb reads "Dashboard / Customizing", its
 * "Dashboard" a way out of the mode. Where the bar is a phone's width, Reset
 * steps aside and Add widget is drawn as its icon, so Cancel and Save keep
 * their words.
 *
 * The mode's controls are in the bar because it stays put while the cards
 * scroll, so Save and Cancel are in reach however far down the reader has
 * gone.
 *
 * @module components/features/widgets/edit/DashboardBarControls
 */

import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { GreetingAction } from "@admin/components/features/dashboard/GreetingAction";
import * as Icons from "@admin/components/icons";
import {
  TopBarPlace,
  useInTopBar,
} from "@admin/components/layout/header/TopBarPlaces";
import { Breadcrumbs } from "@admin/components/shared/breadcrumbs";

/** A ref callback that registers an element as a place focus can be sent. */
type Register = (element: HTMLElement | null) => void;

/** The name and the tooltip of the control that opens customise mode. */
const CUSTOMIZE_DASHBOARD = "Customize dashboard";

/**
 * The bar's buttons, a step smaller than a form's: the bar is 56px tall and
 * holds four of them beside the breadcrumb.
 */
const BAR_BUTTON = "h-7 rounded-[7px] px-2.5 text-[12.5px]";

/**
 * Below 600px of bar (`@container/topbar`, which the bar declares, the width
 * at which its breadcrumb also narrows): Add widget as a 34px icon button.
 */
const ADD_AS_ICON =
  "@max-[37.5rem]/topbar:size-[34px] @max-[37.5rem]/topbar:rounded-lg @max-[37.5rem]/topbar:border-transparent @max-[37.5rem]/topbar:bg-transparent @max-[37.5rem]/topbar:px-0";

/**
 * The page's place in the bar's left part: "Dashboard", or, in customise mode,
 * "Dashboard / Customizing" with "Dashboard" leaving the mode. While leaving is
 * held (a write on its way), "Dashboard" is drawn as words, not a control.
 * Nothing outside the admin's shell, where there is no bar.
 */
export function DashboardCrumb({
  isEditing = false,
  onLeave,
}: {
  /** Whether customise mode is open. */
  isEditing?: boolean;
  /** Leave customise mode; absent while leaving is held. */
  onLeave?: (() => void) | undefined;
}): JSX.Element | null {
  const inBar = useInTopBar();
  if (!inBar) return null;
  return (
    <Breadcrumbs
      items={
        isEditing
          ? [
              onLeave
                ? { label: "Dashboard", onClick: onLeave }
                : { label: "Dashboard" },
              { label: "Customizing" },
            ]
          : [{ label: "Dashboard" }]
      }
    />
  );
}

export interface DashboardBarControlsProps {
  isEditing: boolean;
  /**
   * Whether customise mode can be opened: the reader's arrangement has been
   * read, since a write echoes its version and scope.
   */
  canBegin: boolean;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  /**
   * Whether any layout write is in flight, including one begun outside this
   * bar. Every control that writes is disabled on it, and so is opening the
   * mode: its draft is seeded with the version it will be saved against.
   */
  isWriting: boolean;
  /** Whether the reader has an arrangement of their own to reset. */
  canReset: boolean;
  onBegin: () => void;
  onSave: () => void;
  /** Leave the mode, asking first when there are unsaved changes. */
  onLeave: () => void;
  onReset: () => void;
  /** Open the add panel. */
  onAddWidget: () => void;
  /** Registers Add widget, where focus returns when the add panel closes with nothing added. */
  addWidgetRef?: Register;
  /** Registers the mode's controls, where focus lands as the mode opens. */
  barRef: Register;
}

/** The cog that opens customise mode, named and tooltipped by what it does. */
function CustomizeCog({
  onBegin,
  isWriting,
}: {
  onBegin: () => void;
  isWriting: boolean;
}): JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={CUSTOMIZE_DASHBOARD}
            onClick={onBegin}
            disabled={isWriting}
            className="size-[34px] rounded-lg text-muted-foreground hover:text-foreground"
            data-testid="dashboard-edit-begin"
          >
            <Icons.Settings aria-hidden className="size-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="rounded-md border-border bg-primary px-2 py-1 text-primary-foreground"
        >
          {CUSTOMIZE_DASHBOARD}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Customise mode's controls: reset, add, abandon, commit. */
function EditControls({
  hasUnsavedChanges,
  isSaving,
  isWriting,
  canReset,
  onSave,
  onLeave,
  onReset,
  onAddWidget,
  addWidgetRef,
  barRef,
}: Omit<DashboardBarControlsProps, "isEditing" | "canBegin" | "onBegin">) {
  return (
    // A labelled group that takes focus as the mode opens, so a keyboard or
    // screen-reader user lands on the controls of the mode they just entered
    // rather than where the cog was. Focusable only programmatically (`-1`).
    <div
      ref={barRef}
      role="group"
      aria-label={CUSTOMIZE_DASHBOARD}
      tabIndex={-1}
      className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      data-testid="dashboard-edit-bar"
    >
      {/* Offered only when there IS an arrangement to reset, and asked
          first; even then it only stages the default. "Reset" on screen; its
          name says what it resets to, and starts with the word shown. Left
          enabled once a reset is staged: staging it again is harmless, and
          disabling the control the question returns focus to would drop
          focus on `body`. */}
      {canReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={isWriting}
          aria-label="Reset to default"
          className={`${BAR_BUTTON} @max-[37.5rem]/topbar:hidden`}
          data-testid="dashboard-edit-reset"
        >
          Reset
        </Button>
      ) : null}
      {/* Opens the add panel, which only stages cards in the draft, so it
          waits for no write. */}
      <Button
        ref={addWidgetRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={onAddWidget}
        aria-haspopup="dialog"
        className={`${BAR_BUTTON} ${ADD_AS_ICON}`}
        data-testid="dashboard-edit-add"
      >
        <Icons.Plus
          aria-hidden
          className="size-3.5 @max-[37.5rem]/topbar:size-[18px]"
        />
        <span className="@max-[37.5rem]/topbar:sr-only">Add widget</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onLeave}
        disabled={isWriting}
        className={BAR_BUTTON}
        data-testid="dashboard-edit-cancel"
      >
        Cancel
      </Button>
      {/* Disabled with nothing to save, so pressing it cannot spend a write:
          a write is guarded, so a pointless one can still come back a
          conflict and send the reader to reload for nothing. */}
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={isWriting || !hasUnsavedChanges}
        className={BAR_BUTTON}
        data-testid="dashboard-edit-save"
      >
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

/**
 * The dashboard's action: the cog at the greeting row's end at rest, the
 * mode's controls at the bar's right end while customising, and nothing
 * before the arrangement is read.
 */
export function DashboardBarControls({
  isEditing,
  canBegin,
  onBegin,
  ...controls
}: DashboardBarControlsProps): JSX.Element | null {
  if (isEditing) {
    return (
      <TopBarPlace name="end">
        <EditControls {...controls} />
      </TopBarPlace>
    );
  }
  if (!canBegin) return null;
  return (
    <GreetingAction>
      <CustomizeCog onBegin={onBegin} isWriting={controls.isWriting} />
    </GreetingAction>
  );
}
