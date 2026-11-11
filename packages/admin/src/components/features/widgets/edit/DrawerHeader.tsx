"use client";

/**
 * The card settings drawer's header, the same whether its form has loaded or not.
 *
 * @module components/features/widgets/edit/DrawerHeader
 */

import {
  Button,
  SheetClose,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import * as Icons from "@admin/components/icons";

/**
 * The drawer's header: the card's title, "Widget settings" under it, and the close button,
 * which discards the drawer's changes as Cancel does. Shared with the drawer drawn while its code
 * loads (`LazyWidgetSettingsSheet`), so the two look the same.
 */
export function DrawerHeader({
  title,
  saving = false,
}: {
  title: string;
  /** A save is in flight, which the drawer waits for before it can close. */
  saving?: boolean;
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border py-3 pr-3 pl-5">
      <SheetHeader className="min-w-0 flex-1 space-y-0.5 text-left">
        <SheetTitle className="truncate text-[15px] leading-5 font-semibold">
          {title}
        </SheetTitle>
        <SheetDescription className="text-xs">Widget settings</SheetDescription>
      </SheetHeader>
      <SheetClose asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={saving}
          aria-label="Close"
          data-testid="widget-settings-close"
        >
          <Icons.X aria-hidden className="size-4" />
        </Button>
      </SheetClose>
    </div>
  );
}
