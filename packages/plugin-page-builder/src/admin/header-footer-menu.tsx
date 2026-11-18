"use client";

/**
 * The "Header & footer" menu: one choice per page, with pictures.
 *
 * The site default by name, a separator, every other set, then "None"; a
 * second separator, then "Manage headers & footers ↗". Each item has a small
 * picture of the set (its header above its footer), its name in bold and a
 * muted note saying what it holds or why it is not offered. The trigger shows
 * the current choice the same way, so the menu reads the same in Page
 * settings, the right panel and on the entry page.
 *
 * Presentational: what is offered and what each says is the pure view's
 * (`layout-choice-view.ts`), and the reads, the search and the pictures are
 * the caller's (`page-layout.tsx`). A select-only combobox in the ARIA sense:
 * a button that opens a list of options, moved through with the arrow keys,
 * and a search field above the list once there are more than ten sets.
 *
 * @module admin/header-footer-menu
 */
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { Check, ChevronDown } from "lucide-react";
import {
  useContext,
  useRef,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import { ManageSetsContext } from "./editor/manage-sets";
import {
  SITE_DEFAULT_VALUE,
  type LayoutPickerView,
  type PickerOption,
} from "./layout-choice-view";

/** What a search above the list has found, as the caller's read answers. */
export interface MenuSearch {
  /** What is typed in the search field. */
  readonly typed: string;
  readonly setTyped: (typed: string) => void;
  /** Whether anything is typed: the list then holds the matches only. */
  readonly searching: boolean;
  /** Whether the answer for what is typed has arrived. */
  readonly answered: boolean;
  /** Whether the search failed. */
  readonly failed: boolean;
  /** The sets that matched, once answered. */
  readonly options: readonly PickerOption[];
  readonly retry: () => void;
  /** A line under the list saying how to reach sets past it, if any. */
  readonly note?: string;
}

export interface HeaderFooterMenuProps {
  /** The trigger's id, which the field's label names. */
  readonly id: string;
  /** The ids describing the trigger: the line under it, and a refusal. */
  readonly describedBy: string;
  readonly invalid: boolean;
  readonly view: LayoutPickerView;
  /** Whether the choices are still on their way: nothing to open yet. */
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChoose: (value: string) => void;
  /** An option's picture, 30×20. */
  readonly picture: (option: PickerOption) => ReactNode;
  /** The search above the list, when the site has more than ten sets. */
  readonly search?: MenuSearch;
  /** Where "Manage headers & footers ↗" opens, or none to leave it out. */
  readonly manageHref?: string;
}

/** The value of the "Manage headers & footers" row, which is no choice. */
const MANAGE_VALUE = "manage-headers-footers";

/** An option's picture, name and note, as the trigger and each row show it. */
function OptionFace({
  option,
  picture,
}: {
  option: PickerOption;
  picture: ReactNode;
}): JSX.Element {
  return (
    <>
      <span className="nx-pb-hf-picture" aria-hidden="true">
        {picture}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        {/* Named by slot, so a reader past the picture finds the words. */}
        <span data-slot="hf-name" className="truncate font-medium">
          {option.label}
        </span>
        {option.note === undefined ? null : (
          <span
            data-slot="hf-note"
            className="text-xs font-normal text-muted-foreground"
          >
            {option.note}
          </span>
        )}
      </span>
    </>
  );
}

/** An option's whole reason, as its tooltip and accessible description. */
function optionDescription(option: PickerOption): {
  title?: string;
  "aria-description"?: string;
} {
  return option.description === undefined
    ? {}
    : { title: option.description, "aria-description": option.description };
}

/** What the list says when it shows no sets: why, and what to do. */
function SearchNote({ search }: { search: MenuSearch }): JSX.Element {
  if (search.failed) {
    return (
      <span className="flex items-center justify-center gap-2">
        Couldn&apos;t search headers & footers
        <Button type="button" variant="ghost" size="sm" onClick={search.retry}>
          Try again
        </Button>
      </span>
    );
  }
  return (
    <>
      {search.searching && !search.answered
        ? "Searching…"
        : "No header & footer sets match."}
    </>
  );
}

/**
 * One option's row: its face, and a check on the current choice. Shared with
 * the starter's "Use a component ▾" menu, so a choice with a picture reads
 * the same in both.
 */
export function OptionRow({
  option,
  current,
  picture,
  onSelect,
}: {
  option: PickerOption;
  current: boolean;
  picture: ReactNode;
  onSelect: () => void;
}): JSX.Element {
  return (
    <CommandItem
      value={option.value}
      disabled={option.disabled === true}
      {...optionDescription(option)}
      onSelect={onSelect}
      className="items-center gap-2.5 px-2 py-1.5"
    >
      <OptionFace option={option} picture={picture} />
      {current ? (
        <>
          <Check aria-hidden="true" className="size-4 shrink-0" />
          <span className="sr-only">(current)</span>
        </>
      ) : null}
    </CommandItem>
  );
}

/** The trigger's face: the current choice, or what stands in for it. */
function TriggerFace({
  current,
  pending,
  picture,
}: {
  current: PickerOption | undefined;
  pending: boolean;
  picture: (option: PickerOption) => ReactNode;
}): JSX.Element {
  if (current === undefined) {
    return (
      <span className="min-w-0 truncate text-muted-foreground">
        {pending ? "Loading headers & footers…" : "Choose a header & footer"}
      </span>
    );
  }
  // The name alone in the trigger, as the prototype draws it: the note is
  // read in the list, and the line under the menu says why it applies.
  return (
    <OptionFace
      option={{ ...current, note: undefined }}
      picture={picture(current)}
    />
  );
}

export function HeaderFooterMenu({
  id,
  describedBy,
  invalid,
  view,
  pending,
  disabled,
  open,
  onOpenChange,
  onChoose,
  picture,
  search,
  manageHref,
}: HeaderFooterMenuProps): JSX.Element {
  const listRoot = useRef<HTMLDivElement>(null);
  const current = view.options.find(option => option.value === view.value);
  const listId = `${id}-list`;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          disabled={disabled || pending}
          className="h-auto min-h-9 w-full justify-between gap-2 px-2 py-1.5 font-normal"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <TriggerFace
              current={current}
              pending={pending}
              picture={picture}
            />
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 opacity-50"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // As wide as the trigger, and never narrower than a name and its
        // note read comfortably.
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
        onOpenAutoFocus={event => {
          // Into the list, so the arrow keys move through it at once: the
          // search field when there is one, else the list's own root.
          event.preventDefault();
          const root = listRoot.current;
          const input = root?.querySelector<HTMLInputElement>("[cmdk-input]");
          (input ?? root)?.focus();
        }}
      >
        <MenuList
          listRoot={listRoot}
          listId={listId}
          view={view}
          picture={picture}
          search={search}
          manageHref={manageHref}
          onChoose={value => {
            onChoose(value);
            onOpenChange(false);
          }}
          onLeave={() => onOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The open list: the search field when there is one, the options (or the
 * matches), and "Manage headers & footers ↗".
 */
function MenuList({
  listRoot,
  listId,
  view,
  picture,
  search,
  manageHref,
  onChoose,
  onLeave,
}: {
  listRoot: RefObject<HTMLDivElement | null>;
  listId: string;
  view: LayoutPickerView;
  picture: (option: PickerOption) => ReactNode;
  search: MenuSearch | undefined;
  manageHref: string | undefined;
  onChoose: (value: string) => void;
  onLeave: () => void;
}): JSX.Element {
  const searching = search?.searching === true;
  const shown = searching ? (search?.options ?? []) : view.options;
  return (
    <Command
      ref={listRoot}
      shouldFilter={false}
      // Names the search field, which reads it by reference.
      label="Search headers & footers"
      // The current choice is the one highlighted when the list opens.
      defaultValue={view.value}
      className="rounded-md"
    >
      {search === undefined ? null : (
        <CommandInput
          placeholder="Search headers & footers"
          value={search.typed}
          onValueChange={search.setTyped}
        />
      )}
      <CommandList id={listId} label="Header & footer" className="max-h-80 p-1">
        {search === undefined ? null : (
          <CommandEmpty>
            <SearchNote search={search} />
          </CommandEmpty>
        )}
        {shown.map(option => (
          <MenuRow
            key={option.value}
            option={option}
            current={option.value === view.value}
            picture={picture(option)}
            onSelect={() => onChoose(option.value)}
          />
        ))}
        {searching || manageHref === undefined ? null : (
          <ManageRow href={manageHref} onLeave={onLeave} />
        )}
      </CommandList>
      {searching || search?.note === undefined ? null : (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {search.note}
        </p>
      )}
    </Command>
  );
}

/**
 * "Manage headers & footers", after a separator: the list of sets. Inside the
 * builder it is the Pages panel's Header & footer group, in this window;
 * elsewhere the admin's list, in a new tab.
 */
function ManageRow({
  href,
  onLeave,
}: {
  href: string;
  onLeave: () => void;
}): JSX.Element {
  const openSets = useContext(ManageSetsContext);
  return (
    <>
      <CommandSeparator className="my-1" />
      <CommandItem
        value={MANAGE_VALUE}
        onSelect={() => {
          onLeave();
          if (openSets !== null) openSets();
          else window.open(href, "_blank", "noopener");
        }}
        className="px-2 py-1.5 text-sm"
      >
        {openSets !== null ? (
          "Manage headers & footers"
        ) : (
          <>
            Manage headers & footers ↗
            <span className="sr-only">(opens in a new tab)</span>
          </>
        )}
      </CommandItem>
    </>
  );
}

/** A row, and the separator after the site default that sets it apart. */
function MenuRow(props: {
  option: PickerOption;
  current: boolean;
  picture: ReactNode;
  onSelect: () => void;
}): JSX.Element {
  if (props.option.value !== SITE_DEFAULT_VALUE)
    return <OptionRow {...props} />;
  return (
    <>
      <OptionRow {...props} />
      <CommandSeparator className="my-1" />
    </>
  );
}
