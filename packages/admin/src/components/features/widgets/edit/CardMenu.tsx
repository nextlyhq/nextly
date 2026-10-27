"use client";

/**
 * A card's menu at rest, outside customise mode, in the same place on every card: its quick
 * setting, which a small card's header has no room for, Settings, and Refresh, which asks again
 * for this card alone. The customise-mode menu (`CardActionsMenu`) stays as it is.
 *
 * @module components/features/widgets/edit/CardMenu
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { RefreshCw, Settings } from "lucide-react";
import type { JSX } from "react";
import { useRef } from "react";

import * as Icons from "@admin/components/icons";

import type { CardQuickSettingState } from "./useCardQuickSetting";

export interface CardMenuProps {
  title: string;
  /** The card's quick setting, when its widget marks one. */
  quick?: CardQuickSettingState["menu"] | undefined;
  /** Open the card's settings sheet, when its widget offers settings. */
  onOpenSettings?: (() => void) | undefined;
  /** Ask again for this card's data alone, when it asks for any. */
  onRefresh?: (() => void) | undefined;
  /** A layout write is in flight, or the card's settings cannot be saved now. */
  settingsDisabled: boolean;
}

export function CardMenu({
  title,
  quick,
  onOpenSettings,
  onRefresh,
  settingsDisabled,
}: CardMenuProps): JSX.Element {
  // Set by Settings, which sends focus into its sheet: the menu's own close would otherwise
  // return focus to its trigger a tick later and take it back out.
  const focusIsHandled = useRef(false);
  const label = quick ? (quick.setting.label ?? quick.setting.name) : "";

  return (
    // `modal={false}`, as the customise menu: Settings opens a sheet from inside this menu, and a
    // modal menu closing underneath a dialog opening leaves the page refusing pointer input.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          // 28px, past the 24px minimum target WCAG 2.5.8 asks of a control this small.
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={`Card menu for ${title}`}
          data-testid="card-menu"
        >
          <Icons.MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        onCloseAutoFocus={event => {
          if (!focusIsHandled.current) return;
          focusIsHandled.current = false;
          event.preventDefault();
        }}
      >
        {quick?.setting.type === "select" ? (
          <>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={typeof quick.value === "string" ? quick.value : ""}
              onValueChange={next => quick.change(next)}
            >
              {quick.setting.options.map(option => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        {quick?.setting.type === "checkbox" ? (
          <DropdownMenuCheckboxItem
            checked={quick.value === true}
            onCheckedChange={checked => quick.change(checked === true)}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ) : null}
        {quick && (onOpenSettings || onRefresh) ? (
          <DropdownMenuSeparator />
        ) : null}
        {onOpenSettings ? (
          <DropdownMenuItem
            disabled={settingsDisabled}
            onSelect={() => {
              focusIsHandled.current = true;
              onOpenSettings();
            }}
            data-testid="card-menu-settings"
          >
            <Settings aria-hidden className="size-4" />
            Settings…
          </DropdownMenuItem>
        ) : null}
        {onRefresh ? (
          <DropdownMenuItem
            onSelect={() => onRefresh()}
            data-testid="card-menu-refresh"
          >
            <RefreshCw aria-hidden className="size-4" />
            Refresh
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
