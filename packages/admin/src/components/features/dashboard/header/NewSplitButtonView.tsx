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
  buttonVariants,
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
import { type JSX, type RefObject, useRef, useState } from "react";

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

/**
 * The main part's width, the same whatever type it leads with: New is drawn
 * before that type is known (`NewSplitButtonPlaceholder`), so a width taken
 * from the label would move Customize beside it once the label arrived. A
 * longer label is cut short inside it; a narrow header narrows it further.
 */
const MAIN_PART_WIDTH = "w-44";

/**
 * New's place, held at the size New is drawn at while what it leads with is
 * not known yet, unseen and out of reach: New then appears where it stays,
 * and nothing beside it moves.
 */
export function NewSplitButtonPlaceholder(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      inert
      className="invisible inline-flex min-w-0 max-w-full"
      data-testid="dashboard-new-reserve"
    >
      <span
        className={buttonVariants({
          size: "sm",
          className: `${MAIN_PART_WIDTH} min-w-0 rounded-r-none`,
        })}
      />
      <span
        className={buttonVariants({
          size: "icon-sm",
          className: "shrink-0 rounded-l-none",
        })}
      />
    </div>
  );
}

export interface NewSplitButtonViewProps {
  menu: NewMenu;
}

/** The popover's name, the caret's name, and what the list and its search are called. */
const CHOOSE_LABEL = "Choose what to create";
const LIST_LABEL = "Types to create";
const SEARCH_LABEL = "Search types to create";

/**
 * Where the keys are in the list, drawn so it can be seen: the option the arrow keys have reached
 * is outlined in the foreground colour, the popover's own text colour, so it holds 3:1 against
 * the popover in both schemes whatever brand colour an installation sets (branding writes its
 * primary into the ring token, and a primary near the popover's colour would hide a ring-coloured
 * outline). The shared item removes its outline (`outline-none` sets the outline style to none),
 * so the style is put back with the width and colour. The shared item's own mark (a 5% tint) is
 * all but invisible on its own, and its text stays in the foreground colour: the shared item's
 * primary falls under 4.5:1 on the popover when a brand colour replaces the default primary.
 */
const SELECTED_OPTION_CLASS =
  "data-[selected=true]:outline-solid data-[selected=true]:outline-2 data-[selected=true]:-outline-offset-2 data-[selected=true]:outline-foreground aria-selected:text-foreground data-[selected=true]:text-foreground";

/**
 * The search box, focused, outlined as the reached option is, in the foreground colour for the
 * same reason. The shared input removes its outline too, so the style is put back here as well;
 * without it a caret is all that marks focus.
 */
const SEARCH_FOCUS_CLASS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground";

/**
 * What the button says when its main part starts creating another type while it is drawn, as
 * when the reader's recent types arrive or change: "New button changed to New Page." The type
 * it is first drawn with says nothing, since the reader meets that as the main part's own name.
 * Worked out during render (React's pattern for state that follows a prop), so the sentence
 * arrives with the label it describes.
 */
function useMainPartVoice(label: string | null): string {
  const [voice, setVoice] = useState({ label, said: "" });
  if (voice.label !== label) {
    setVoice({
      label,
      said:
        voice.label === null || label === null
          ? ""
          : `New button changed to ${label}.`,
    });
  }
  return voice.said;
}

/**
 * The list behind the caret: a listbox named for what it holds, its options grouped under
 * Recent and each section's heading (each group named by its heading), with a labelled search
 * once there are more than ten types.
 */
function NewMenuList({
  menu,
  listRef,
  onChoose,
}: {
  menu: NewMenu;
  listRef: RefObject<HTMLDivElement | null>;
  onChoose: (collection: ApiCollection) => void;
}): JSX.Element {
  const item = (group: string, collection: ApiCollection) => (
    <CommandItem
      key={`${group}:${collection.name}`}
      value={`${group}:${collection.name}`}
      keywords={[
        collectionSingularLabel(collection),
        collectionDisplayName(collection),
        collection.name,
      ]}
      onSelect={() => onChoose(collection)}
      className={SELECTED_OPTION_CLASS}
      data-testid={`dashboard-new-${group}-${collection.name}`}
    >
      {collectionSingularLabel(collection)}
    </CommandItem>
  );
  return (
    // The root's `label` is what names the search box (cmdk labels its input with it).
    <Command label={SEARCH_LABEL} filter={matchesSearch}>
      {menu.searchable ? (
        <CommandInput
          placeholder="Search types"
          className={SEARCH_FOCUS_CLASS}
        />
      ) : null}
      {/* Focusable, and named: with no search box, focus lands here, on the element that
        carries `aria-activedescendant`, so each option the arrow keys reach is announced. */}
      <CommandList
        ref={listRef}
        label={LIST_LABEL}
        className="focus:outline-none"
      >
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
            {section.collections.map(collection => item("type", collection))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

/**
 * Each choice only opens a new entry of its type. The type becomes recent when
 * the entry is created (`useCreateEntry`), so opening a form and leaving it
 * changes nothing.
 *
 * Closed by Escape or by a choice, the popover hands focus back to the caret
 * it opened from (Radix's own return to its trigger); a choice then opens the
 * create form, which takes the page.
 */
export function NewSplitButtonView({
  menu,
}: NewSplitButtonViewProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const primary = menu.primary;
  const primaryLabel = primary
    ? `New ${collectionSingularLabel(primary)}`
    : null;
  const said = useMainPartVoice(primaryLabel);
  // Nothing creatable: no button, rather than one whose every choice refuses.
  if (!primary) return null;

  return (
    // The main part is one fixed width and its label cut short with an
    // ellipsis, so a long type name never widens the header past a narrow
    // screen, and no label moves what is beside it. The whole label stays the
    // link's text, so it is still the accessible name, and the title shows it
    // to a pointer.
    <div className="inline-flex min-w-0 max-w-full" data-testid="dashboard-new">
      <Button
        asChild
        size="sm"
        className={`${MAIN_PART_WIDTH} min-w-0 rounded-r-none`}
      >
        <Link
          href={createHref(primary)}
          title={primaryLabel ?? undefined}
          data-testid="dashboard-new-primary"
        >
          <Plus aria-hidden className="mr-2 size-4 shrink-0" />
          <span className="truncate" data-testid="dashboard-new-primary-label">
            {primaryLabel}
          </span>
        </Link>
      </Button>
      {/* Polite, and drawn from the first render, so the sentence a later change of type puts
        here is said without moving the reader. */}
      <span
        aria-live="polite"
        className="sr-only"
        data-testid="dashboard-new-said"
      >
        {said}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            // The divider is the label's own colour at a quarter strength, so
            // it reads on the primary fill in both schemes.
            // Never narrowed: the label gives way first, so the caret stays
            // whole on the narrowest header.
            className="shrink-0 rounded-l-none border-l-primary-foreground/25"
            aria-label={CHOOSE_LABEL}
            data-testid="dashboard-new-more"
          >
            <ChevronDown aria-hidden className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          // The popover is a dialog: named, so it is announced as what it is for.
          aria-label={CHOOSE_LABEL}
          // Held inside the viewport with a gutter on each side, so on a phone
          // the menu neither runs off the screen nor widens the page.
          collisionPadding={16}
          className="w-64 max-w-[calc(100vw_-_2rem)] p-0"
          // With no search box, focus goes to the list itself, the element whose
          // `aria-activedescendant` names the option the arrow keys reach: on
          // the root around it, the keys would move a selection nothing says.
          onOpenAutoFocus={event => {
            if (menu.searchable) return;
            event.preventDefault();
            listRef.current?.focus();
          }}
        >
          <NewMenuList
            menu={menu}
            listRef={listRef}
            onChoose={collection => {
              setOpen(false);
              navigateTo(createHref(collection));
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
