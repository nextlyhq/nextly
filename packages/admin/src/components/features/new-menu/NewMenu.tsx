"use client";

/**
 * "+ New": one flat, searchable list of every type the reader may create, in
 * the order the sidebar shows them, with no headings and no recent types
 * first. Two placements draw it:
 * - `rail`: a square button whose list opens in a popover to its right;
 * - `drawer`: a full-width row at the top of the phone's menu drawer, whose
 *   list opens in place below it.
 *
 * The list is a command list so its search box and the arrow keys work
 * together. The option the keys or the pointer reach has a light fill (the
 * accent token) with the foreground colour for its text, the same for both,
 * and no outline.
 *
 * @module components/features/new-menu/NewMenu
 */
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { type JSX, useId, useState } from "react";

import { ChevronDown, ChevronUp, Plus } from "@admin/components/icons";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCreatableCollections } from "@admin/hooks/useCreatableCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useSidebarCollectionPins } from "@admin/hooks/useSidebarContentLists";
import { collectionSingularLabel } from "@admin/lib/collection-label";
import { navigateTo } from "@admin/lib/navigation";
import { collectionDisplayName } from "@admin/lib/sidebar-landing";
import { cn } from "@admin/lib/utils";
import type { ApiCollection } from "@admin/types/entities";

import { newMenuTypes } from "./new-menu-model";

export interface NewMenuProps {
  /** Where the menu is drawn: the rail's button, or the phone drawer's row. */
  variant: "rail" | "drawer";
  className?: string;
}

/** The button's name, and what the search and the list are called. */
const NEW_LABEL = "New";
const SEARCH_LABEL = "Search what to create";
const LIST_LABEL = "Types you can create";

/**
 * The reached option: the accent fill with its own text colour, overriding
 * the shared item's faint primary tint, plus a 1px inset ring in the control
 * border colour. The fill alone is too faint to mark the state (WCAG 1.4.11
 * asks 3:1); the ring holds about 3.5:1 against the popover in light and dark
 * without the weight of a full-strength outline, and it does not follow the
 * brand colour, so a brand near the popover's colour cannot hide it. The
 * theme's contrast checks hold `--nx-accent-foreground` on `--nx-accent` at
 * 4.5:1 (`packages/ui/src/styles/contrast/pairings.ts`).
 */
const NEW_MENU_OPTION_CLASS =
  "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-control-border";

/**
 * Focus in the search, drawn on the whole search row (cmdk's input wrapper,
 * magnifier included) as a frame inset 4px from the popover's edges, in the
 * control border colour like the reached option's ring: the shared input draws
 * no focus of its own here, and the search takes focus whenever the menu
 * opens, so the frame follows `focus-within`, not only a keyboard's focus.
 */
const SEARCH_ROW_FOCUS_CLASS =
  "[&_[cmdk-input-wrapper]]:relative [&_[cmdk-input-wrapper]:focus-within]:after:pointer-events-none [&_[cmdk-input-wrapper]:focus-within]:after:absolute [&_[cmdk-input-wrapper]:focus-within]:after:inset-1 [&_[cmdk-input-wrapper]:focus-within]:after:rounded-md [&_[cmdk-input-wrapper]:focus-within]:after:border-2 [&_[cmdk-input-wrapper]:focus-within]:after:border-control-border [&_[cmdk-input-wrapper]:focus-within]:after:content-['']";

function createHref(collection: ApiCollection): string {
  return buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, { slug: collection.name });
}

/** A search matches a type by the names a reader knows it by. */
function matchesSearch(
  _value: string,
  search: string,
  keywords?: string[]
): number {
  const needle = search.trim().toLowerCase();
  if (needle === "") return 1;
  return (keywords ?? []).some(word => word.toLowerCase().includes(needle))
    ? 1
    : 0;
}

/** Every type the reader may create, in sidebar order, and whether that is known yet. */
function useNewMenuTypes(): {
  types: readonly ApiCollection[];
  isReady: boolean;
} {
  const { collections, isReady, failed } = useCreatableCollections();
  const { capabilities } = useCurrentUserPermissions();
  const { pinned } = useSidebarCollectionPins();
  const branding = useBranding();
  return {
    types: newMenuTypes({
      creatable: collections,
      branding,
      capabilities,
      pinnedCollections: pinned,
    }),
    isReady: isReady || failed,
  };
}

/** The search and the list, the same in both placements. */
function NewMenuList({
  types,
  isReady,
  onChoose,
}: {
  types: readonly ApiCollection[];
  isReady: boolean;
  onChoose: (collection: ApiCollection) => void;
}): JSX.Element {
  return (
    // The root's `label` names the search box (cmdk labels its input with it).
    <Command
      label={SEARCH_LABEL}
      filter={matchesSearch}
      className={SEARCH_ROW_FOCUS_CLASS}
    >
      <CommandInput placeholder="Create…" data-testid="new-menu-search" />
      <CommandList label={LIST_LABEL} data-testid="new-menu-list">
        {isReady ? (
          <CommandEmpty>Nothing matches.</CommandEmpty>
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>
        )}
        {types.map(collection => (
          <CommandItem
            key={collection.name}
            value={collection.name}
            keywords={[
              collectionSingularLabel(collection),
              collectionDisplayName(collection),
              collection.name,
            ]}
            onSelect={() => onChoose(collection)}
            className={NEW_MENU_OPTION_CLASS}
            data-testid={`new-menu-type-${collection.name}`}
          >
            {collectionSingularLabel(collection)}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

/**
 * "+ New" in either placement, fed by what the reader may create. Opened by a click (never by hover); a choice
 * opens a new entry of its type. Escape closes the list and hands focus back
 * to the control that opened it. Nothing is drawn once it is known the reader
 * may create nothing.
 */
export function NewMenu(props: NewMenuProps): JSX.Element | null {
  const { types, isReady } = useNewMenuTypes();
  return <NewMenuView {...props} types={types} isReady={isReady} />;
}

export interface NewMenuViewProps extends NewMenuProps {
  /** Every type the reader may create, in sidebar order. */
  types: readonly ApiCollection[];
  /** Whether the types are known yet: until then the list says it is loading. */
  isReady: boolean;
}

/** {@link NewMenu} as drawn from the types it is given. */
export function NewMenuView({
  variant,
  className,
  types,
  isReady,
}: NewMenuViewProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (isReady && types.length === 0) return null;

  const choose = (collection: ApiCollection) => {
    setOpen(false);
    navigateTo(createHref(collection));
  };

  if (variant === "drawer") {
    return (
      <div
        className={cn("flex flex-col gap-2", className)}
        data-testid="new-menu"
      >
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-start gap-2"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen(value => !value)}
          data-testid="new-menu-trigger"
        >
          <Plus aria-hidden className="size-4" />
          <span>{NEW_LABEL}</span>
          {open ? (
            <ChevronUp
              aria-hidden
              className="ml-auto size-4 text-muted-foreground"
            />
          ) : (
            <ChevronDown
              aria-hidden
              className="ml-auto size-4 text-muted-foreground"
            />
          )}
        </Button>
        {open ? (
          <div
            id={listId}
            className="overflow-hidden rounded-md border border-border bg-popover"
            onKeyDown={event => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              setOpen(false);
              const trigger = event.currentTarget.previousElementSibling;
              if (trigger instanceof HTMLElement) trigger.focus();
            }}
          >
            <NewMenuList types={types} isReady={isReady} onChoose={choose} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("size-9", className)}
          aria-label={NEW_LABEL}
          data-testid="new-menu-trigger"
        >
          <Plus aria-hidden className="size-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        aria-label="Create"
        // Held inside the viewport with a gutter, so the list never runs off
        // the screen.
        collisionPadding={16}
        className="w-72 max-w-[calc(100vw_-_2rem)] p-0"
        data-testid="new-menu"
      >
        <NewMenuList types={types} isReady={isReady} onChoose={choose} />
      </PopoverContent>
    </Popover>
  );
}
