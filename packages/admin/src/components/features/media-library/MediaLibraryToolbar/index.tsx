"use client";

/**
 * MediaLibraryToolbar
 *
 * The library's one row of controls: the page title with its count, search,
 * type, sort, grid or list, and Upload. It used to take two rows, a header and
 * then a filter bar, before the first image.
 *
 * The row is sized by the toolbar's OWN width, through a container query, as
 * the admin's list toolbar is: the folder tree and the sidebars take width
 * from the library without the window changing, so a window breakpoint would
 * promise room the row doesn't have. As the row narrows it gives up width in
 * a fixed order rather than wrapping:
 *
 * - from 64rem, every control is in the row, with Columns in the list view;
 * - below that, type, sort and Columns fold into one View options menu;
 * - below 48rem, Upload keeps its icon and drops its words;
 * - below 36rem, which is a phone, the title and Upload take the first line
 *   and the other controls the second, the search filling what the buttons
 *   leave.
 *
 * Each control is its own small part below, so the row reads as the list of
 * what it holds.
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import {
  Columns,
  LayoutGrid,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Upload,
} from "@admin/components/icons";
import { SearchBar } from "@admin/components/shared/search-bar";
import { MEDIA_SORT_OPTIONS } from "@admin/constants/media";
import { cn } from "@admin/lib/utils";
import type { MediaType } from "@admin/types/media";

/** The list view's optional columns, in the order the menu lists them. */
const TOGGLEABLE_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "mimeType", label: "Type" },
  { key: "size", label: "Size" },
  { key: "width", label: "Dimensions" },
  { key: "uploadedAt", label: "Uploaded Date" },
];

/** Type filter options; `allowedTypes` narrows them. */
const TYPE_OPTIONS: ReadonlyArray<{ value: MediaType; label: string }> = [
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "document", label: "Documents" },
  { value: "audio", label: "Audio" },
  { value: "other", label: "Other" },
];

type ViewMode = "grid" | "list";

/**
 * The toolbar's inputs, grouped by the control each group drives, so each
 * part below takes one group whole.
 */
export interface MediaLibraryToolbarProps {
  /** Files in the current listing, for the count under the title. */
  total: number;
  inFolder: boolean;
  /** Where focus goes when there is no tile to return it to. */
  headingRef?: React.Ref<HTMLHeadingElement>;
  search: {
    value: string;
    onChange: (value: string) => void;
    isLoading: boolean;
  };
  typeFilter: {
    value: MediaType | "all";
    onChange: (value: string) => void;
    allowedTypes?: MediaType[];
  };
  /** `<field>-<order>`, as the sort menu's values are written. */
  sort: { value: string; onChange: (value: string) => void };
  view: {
    mode: ViewMode;
    onChange: (mode: ViewMode) => void;
    hiddenColumns: Set<string>;
    onToggleColumn: (key: string) => void;
  };
  folderTree: { visible: boolean; onToggle: () => void };
  /**
   * `allowed` is false for a reader: no Upload is offered. `onUpload` opens
   * the file chooser; what is chosen goes to the upload tray.
   */
  upload: { allowed: boolean; onUpload: () => void };
}

/**
 * Shows or hides the folder tree beside the page; the folders above the grid
 * stay either way.
 */
function FolderTreeToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = visible ? "Hide folder tree" : "Show folder tree";
  const Icon = visible ? PanelLeftClose : PanelLeftOpen;
  return (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0"
      onClick={onToggle}
      aria-pressed={visible}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

/** The page's title and how many files the listing holds. */
function ToolbarTitle({
  total,
  inFolder,
  headingRef,
}: {
  total: number;
  inFolder: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
}): React.JSX.Element {
  return (
    // Gives up width, truncating, on a row too narrow for everything, and
    // takes the whole first line on a phone.
    <div className="min-w-0 flex-1 px-1 @xl/media-toolbar:flex-initial">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="truncate text-xl font-semibold tracking-tight text-foreground outline-none"
      >
        Media Library
      </h1>
      <p className="truncate text-sm text-muted-foreground">
        {total} {total === 1 ? "file" : "files"}
        {inFolder && " in this folder"}
      </p>
    </div>
  );
}

/** The type options this library offers, narrowed by `allowedTypes`. */
function typeOptions(
  allowedTypes: MediaType[] | undefined
): ReadonlyArray<{ value: MediaType; label: string }> {
  return TYPE_OPTIONS.filter(
    option => !allowedTypes || allowedTypes.includes(option.value)
  );
}

/** Shown on a row wide enough for it; the View options menu holds it below. */
const WIDE_ROW_ONLY = "hidden @5xl/media-toolbar:flex";

function TypeFilter({
  value,
  onChange,
  allowedTypes,
}: {
  value: MediaType | "all";
  onChange: (value: string) => void;
  allowedTypes?: MediaType[];
}): React.JSX.Element {
  const options = typeOptions(allowedTypes);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="File type"
        className={cn(
          WIDE_ROW_ONLY,
          "w-36 shrink-0 bg-background text-foreground"
        )}
      >
        <SelectValue placeholder="All types" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All types</SelectItem>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The sort menu, from the list the media picker uses too. */
function SortMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Sort"
        className={cn(
          WIDE_ROW_ONLY,
          "w-40 shrink-0 bg-background text-foreground"
        )}
      >
        <SelectValue placeholder="Sort by" />
      </SelectTrigger>
      <SelectContent>
        {MEDIA_SORT_OPTIONS.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Grid or list, as a pair of pressed-or-not buttons. */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}): React.JSX.Element {
  const modes = [
    { mode: "grid", label: "Grid view", Icon: LayoutGrid },
    { mode: "list", label: "List view", Icon: List },
  ] as const;
  return (
    <div className="flex shrink-0 items-center rounded-md border border-border bg-background p-0.5">
      {modes.map(({ mode, label, Icon }) => (
        <Button
          key={mode}
          variant="ghost"
          size="icon-sm"
          className={cn(
            "h-8 w-8 rounded-sm",
            value === mode
              ? "bg-accent text-foreground hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          aria-label={label}
          title={label}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}

/** The list view's columns, in the same row rather than a row of their own. */
function ColumnsMenu({
  hiddenColumns,
  onToggleColumn,
}: {
  hiddenColumns: Set<string>;
  onToggleColumn: (key: string) => void;
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="hidden shrink-0 @5xl/media-toolbar:inline-flex"
          aria-label="Columns"
          title="Columns"
        >
          <Columns className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 border-border">
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          Columns
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TOGGLEABLE_COLUMNS.map(column => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={!hiddenColumns.has(column.key)}
            onCheckedChange={() => onToggleColumn(column.key)}
            className="text-sm"
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Type, sort and, in the list view, Columns, in one menu: what a row too
 * narrow for the separate controls offers in their place. The same choices,
 * from the same lists, so the two forms can't offer different ones.
 */
function ViewOptionsMenu({
  typeFilter,
  sort,
  view,
}: Pick<
  MediaLibraryToolbarProps,
  "typeFilter" | "sort" | "view"
>): React.JSX.Element {
  const filtered = typeFilter.value !== "all";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative shrink-0 @5xl/media-toolbar:hidden"
          aria-label="View options"
          title="View options"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {filtered && (
            // The list is narrowed to one type, which a closed menu would
            // otherwise give no sign of; the list toolbar marks its filter
            // the same way.
            <span className="absolute -right-1 -top-1 flex h-3 w-3 rounded-full bg-primary" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 border-border">
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          File type
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={typeFilter.value}
          onValueChange={typeFilter.onChange}
        >
          <DropdownMenuRadioItem value="all" className="text-sm">
            All types
          </DropdownMenuRadioItem>
          {typeOptions(typeFilter.allowedTypes).map(option => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="text-sm"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          Sort
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort.value}
          onValueChange={sort.onChange}
        >
          {MEDIA_SORT_OPTIONS.map(option => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="text-sm"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {view.mode === "list" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              Columns
            </DropdownMenuLabel>
            {TOGGLEABLE_COLUMNS.map(column => (
              <DropdownMenuCheckboxItem
                key={column.key}
                checked={!view.hiddenColumns.has(column.key)}
                onCheckedChange={() => view.onToggleColumn(column.key)}
                className="text-sm"
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MediaLibraryToolbar({
  total,
  inFolder,
  headingRef,
  search,
  typeFilter,
  sort,
  view,
  folderTree,
  upload,
}: MediaLibraryToolbarProps): React.JSX.Element {
  return (
    // The container the row's widths are read from.
    <div className="@container/media-toolbar mb-6">
      <div
        role="group"
        aria-label="Library controls"
        className="flex flex-wrap items-center gap-x-2 gap-y-3 @xl/media-toolbar:flex-nowrap"
        suppressHydrationWarning
      >
        <FolderTreeToggle
          visible={folderTree.visible}
          onToggle={folderTree.onToggle}
        />
        <ToolbarTitle
          total={total}
          inFolder={inFolder}
          headingRef={headingRef}
        />
        {/* The controls: the rest of the row, pushed to its end, wherever the
            title fits beside them, and a line of their own on a phone, after
            the title's line with Upload at its end. */}
        <div className="order-last flex w-full min-w-0 items-center gap-2 @xl/media-toolbar:order-none @xl/media-toolbar:w-auto @xl/media-toolbar:flex-1 @xl/media-toolbar:justify-end">
          <SearchBar
            value={search.value}
            onChange={search.onChange}
            placeholder="Search media"
            aria-label="Search files"
            isLoading={search.isLoading}
            className="min-w-0 flex-1 @5xl/media-toolbar:max-w-sm"
          />
          <TypeFilter
            value={typeFilter.value}
            onChange={typeFilter.onChange}
            allowedTypes={typeFilter.allowedTypes}
          />
          <SortMenu value={sort.value} onChange={sort.onChange} />
          <ViewOptionsMenu typeFilter={typeFilter} sort={sort} view={view} />
          <ViewModeToggle value={view.mode} onChange={view.onChange} />
          {view.mode === "list" && (
            <ColumnsMenu
              hiddenColumns={view.hiddenColumns}
              onToggleColumn={view.onToggleColumn}
            />
          )}
        </div>
        {upload.allowed && (
          <Button
            size="icon"
            onClick={upload.onUpload}
            // Named here because the words below are hidden on a narrow row,
            // and an icon alone names nothing.
            aria-label="Upload files"
            title="Upload files"
            className="shrink-0 gap-2 @3xl/media-toolbar:w-auto @3xl/media-toolbar:px-6"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span className="hidden @3xl/media-toolbar:inline">
              Upload files
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}
