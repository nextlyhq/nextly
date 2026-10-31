"use client";

/**
 * The header's New split button as drawn from a {@link NewMenu}: the main
 * part creates its primary type, and the caret opens every creatable type,
 * recent ones first, with a search once there are more than ten.
 *
 * The menu is a command list rather than a dropdown menu so its search box and
 * its arrow keys work together: a dropdown's typeahead takes the keys a search
 * box needs.
 *
 * @module components/features/dashboard/header/NewSplitButtonView
 */
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { type JSX, useRef, useState } from "react";

import { ChevronDown, Plus } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { collectionSingularLabel } from "@admin/lib/collection-label";
import { navigateTo } from "@admin/lib/navigation";
import { collectionDisplayName } from "@admin/lib/sidebar-landing";
import type { ApiCollection } from "@admin/types/entities";

import type { NewMenu } from "./new-menu-model";

function createHref(collection: ApiCollection): string {
  return buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, { slug: collection.name });
}

/**
 * A search matches a type by the names a reader knows it by, never by the
 * item's value: a type listed under Recent and under its section has two
 * values, and a value's prefix would match a search for "recent".
 */
function matchesSearch(
  _value: string,
  search: string,
  keywords?: string[]
): number {
  const needle = search.trim().toLowerCase();
  return (keywords ?? []).some(word => word.toLowerCase().includes(needle))
    ? 1
    : 0;
}

export interface NewSplitButtonViewProps {
  menu: NewMenu;
}

/**
 * Each choice only opens a new entry of its type. The type becomes recent when
 * the entry is created (`useCreateEntry`), so opening a form and leaving it
 * changes nothing.
 */
export function NewSplitButtonView({
  menu,
}: NewSplitButtonViewProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const commandRef = useRef<HTMLDivElement>(null);
  const primary = menu.primary;
  // Nothing creatable: no button, rather than one whose every choice refuses.
  if (!primary) return null;

  const item = (group: string, collection: ApiCollection) => (
    <CommandItem
      key={`${group}:${collection.name}`}
      value={`${group}:${collection.name}`}
      keywords={[
        collectionSingularLabel(collection),
        collectionDisplayName(collection),
        collection.name,
      ]}
      onSelect={() => {
        setOpen(false);
        navigateTo(createHref(collection));
      }}
      data-testid={`dashboard-new-${group}-${collection.name}`}
    >
      {collectionSingularLabel(collection)}
    </CommandItem>
  );

  const primaryLabel = `New ${collectionSingularLabel(primary)}`;
  return (
    // The main part is capped and its label cut short with an ellipsis, so a
    // long type name never widens the header past a narrow screen. The whole
    // label stays the link's text, so it is still the accessible name, and
    // the title shows it to a pointer.
    <div className="inline-flex min-w-0 max-w-full" data-testid="dashboard-new">
      <Button asChild size="sm" className="min-w-0 max-w-64 rounded-r-none">
        <Link
          href={createHref(primary)}
          title={primaryLabel}
          data-testid="dashboard-new-primary"
        >
          <Plus aria-hidden className="mr-2 size-4 shrink-0" />
          <span className="truncate" data-testid="dashboard-new-primary-label">
            {primaryLabel}
          </span>
        </Link>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            // The divider is the label's own colour at a quarter strength, so
            // it reads on the primary fill in both schemes.
            className="rounded-l-none border-l-primary-foreground/25"
            aria-label="Choose what to create"
            data-testid="dashboard-new-more"
          >
            <ChevronDown aria-hidden className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 p-0"
          // Focus the list itself, so the arrow keys move through it at once
          // when there is no search box to land in.
          onOpenAutoFocus={event => {
            if (menu.searchable) return;
            event.preventDefault();
            commandRef.current?.focus();
          }}
        >
          <Command
            ref={commandRef}
            tabIndex={-1}
            label="Create"
            filter={matchesSearch}
            className="focus:outline-none"
          >
            {menu.searchable ? (
              <CommandInput placeholder="Search types" />
            ) : null}
            <CommandList>
              <CommandEmpty>No type matches.</CommandEmpty>
              {menu.recent.length > 0 ? (
                <CommandGroup heading="Recent">
                  {menu.recent.map(collection => item("recent", collection))}
                </CommandGroup>
              ) : null}
              {menu.sections.map(section => (
                <CommandGroup
                  key={section.id}
                  // The list's own name for the section as well, so a search
                  // that reorders sections tells two of one heading apart.
                  value={section.id}
                  heading={section.label}
                >
                  {section.collections.map(collection =>
                    item("type", collection)
                  )}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
