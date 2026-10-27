"use client";

/**
 * MediaLibraryToolbar
 *
 * The library's one row of controls: the page title with its count, search,
 * type, sort, grid or list, and Upload. It used to take two rows, a header and
 * then a filter bar, before the first image; on a narrow library the row wraps
 * rather than splitting into two blocks.
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
  /** `allowed` is false for a reader: no Upload is offered. */
  upload: { allowed: boolean; open: boolean; onToggle: () => void };
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
    <div className="mr-auto min-w-0">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="truncate text-xl font-semibold tracking-tight text-foreground outline-none"
      >
        Media Library
      </h1>
      <p className="text-sm text-muted-foreground">
        {total} {total === 1 ? "file" : "files"}
        {inFolder && " in this folder"}
      </p>
    </div>
  );
}

function TypeFilter({
  value,
  onChange,
  allowedTypes,
}: {
  value: MediaType | "all";
  onChange: (value: string) => void;
  allowedTypes?: MediaType[];
}): React.JSX.Element {
  const options = TYPE_OPTIONS.filter(
    option => !allowedTypes || allowedTypes.includes(option.value)
  );
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="File type"
        className="w-[calc(50%-0.375rem)] bg-background text-foreground sm:w-36"
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
        className="w-[calc(50%-0.375rem)] bg-background text-foreground sm:w-40"
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
          className="shrink-0"
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
    <div
      role="group"
      aria-label="Library controls"
      className="mb-6 flex flex-wrap items-center gap-3"
      suppressHydrationWarning
    >
      <FolderTreeToggle
        visible={folderTree.visible}
        onToggle={folderTree.onToggle}
      />
      <ToolbarTitle total={total} inFolder={inFolder} headingRef={headingRef} />
      <SearchBar
        value={search.value}
        onChange={search.onChange}
        placeholder="Search by name or alt text"
        aria-label="Search files"
        isLoading={search.isLoading}
        className="w-full sm:w-60"
      />
      <TypeFilter
        value={typeFilter.value}
        onChange={typeFilter.onChange}
        allowedTypes={typeFilter.allowedTypes}
      />
      <SortMenu value={sort.value} onChange={sort.onChange} />
      <ViewModeToggle value={view.mode} onChange={view.onChange} />
      {view.mode === "list" && (
        <ColumnsMenu
          hiddenColumns={view.hiddenColumns}
          onToggleColumn={view.onToggleColumn}
        />
      )}
      {upload.allowed && (
        <Button
          onClick={upload.onToggle}
          aria-expanded={upload.open}
          className="shrink-0 gap-2"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Upload files
        </Button>
      )}
    </div>
  );
}
