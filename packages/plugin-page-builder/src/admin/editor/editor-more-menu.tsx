"use client";

/**
 * The top bar's ⋯ menu, at its far end after Save and Publish: what the
 * document's own form holds that the builder doesn't, one step away.
 *
 * - "Open as form" opens the document's form, where its history, versions,
 *   languages, scheduling, releases and other plugins' panels are. It is the
 *   same move as the editor's own way back to the form, so unsaved work goes
 *   with it and nothing asks: both are views of one document.
 * - "Pin to dashboard" / "Unpin from dashboard" is the editor's own pin
 *   action, found among the document's actions and run through them, so its
 *   words, its toast and its Undo are the entry page's, and so is any reason
 *   it can't run now, which the row shows in place of running.
 *
 * Nothing is drawn where neither is offered.
 *
 * @module admin/editor/editor-more-menu
 */
import {
  PIN_TO_DASHBOARD_ACTION,
  useDocumentActions,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { MoreHorizontal } from "lucide-react";

/** The menu button's name, as the entry page's own ⋯ is named. */
export const MORE_ACTIONS = "More actions";

/** The way to the document's form. */
export const OPEN_AS_FORM = "Open as form";

export function EditorMoreMenu({
  onOpenAsForm,
}: {
  /**
   * Leaves for the document's form, keeping the work; absent where the
   * editor offers no way out (a component's own view, whose banner leads
   * back to the page first).
   */
  readonly onOpenAsForm: (() => void) | undefined;
}): React.JSX.Element | null {
  const actions = useDocumentActions();
  const pin = actions?.actions.find(
    action => action.id === PIN_TO_DASHBOARD_ACTION
  );
  if (onOpenAsForm === undefined && pin === undefined) return null;
  const reason = pin?.disabledReason;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          // A square at the editor's control height, as the bar's other
          // icon buttons are.
          className="w-[var(--nx-builder-control-height)] px-0"
          aria-label={MORE_ACTIONS}
          title={MORE_ACTIONS}
          data-builder-more=""
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {onOpenAsForm === undefined ? null : (
          <DropdownMenuItem onSelect={onOpenAsForm}>
            {OPEN_AS_FORM}
          </DropdownMenuItem>
        )}
        {/* A rule only between the two, never at an edge of the menu. */}
        {onOpenAsForm !== undefined && pin !== undefined ? (
          <DropdownMenuSeparator />
        ) : null}
        {pin === undefined || actions === null ? null : (
          <DropdownMenuItem
            disabled={reason !== undefined}
            // Why it can't run reaches a pointer and a screen reader, since
            // a grey row with no reason reads as broken.
            {...(reason === undefined
              ? {}
              : { title: reason, "aria-description": reason })}
            onSelect={() => {
              void actions.run(pin.id);
            }}
          >
            {pin.label}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
