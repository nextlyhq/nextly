"use client";

/**
 * The submissions list's toolbar: the form picker (on the list of every form),
 * the status tabs with their counts, the date filter, and at its end the
 * columns menu and whatever the list adds there.
 *
 * @module admin/components/submissions/SubmissionsToolbar
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { Columns3 } from "lucide-react";
import type { JSX, ReactNode } from "react";

import type { DateChoice } from "./date-filter";
import { DateFilter } from "./DateFilter";
import type { FormOption } from "./submission-columns";
import type { StatusTab } from "./submission-list-scope";

const STATUS_TABS: ReadonlyArray<{ value: StatusTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
  { value: "spam", label: "Spam" },
];

/** The picker's value for every form: a form's id is never this. */
const ALL_FORMS = "__all";

/** The form picker of the list of every form. */
function FormPicker({
  forms,
  value,
  onChange,
}: {
  forms: readonly FormOption[];
  value: string;
  onChange: (formId: string) => void;
}): JSX.Element {
  return (
    <Select
      value={value || ALL_FORMS}
      onValueChange={next => onChange(next === ALL_FORMS ? "" : next)}
    >
      <SelectTrigger aria-label="Filter by form" className="w-full sm:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_FORMS}>All forms</SelectItem>
        {forms.map(form => (
          <SelectItem key={form.id} value={form.id}>
            {form.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The status filter, each with how many it holds once that is known. A
 * segmented control of pressed buttons rather than tabs: choosing one
 * filters the one list below, and there are no panels for tabs to control.
 */
function StatusFilter({
  value,
  counts,
  onChange,
}: {
  value: StatusTab;
  counts: Record<StatusTab, number> | undefined;
  onChange: (tab: StatusTab) => void;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Status"
      className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-secondary p-0.5"
    >
      {STATUS_TABS.map(tab => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={value === tab.value}
          onClick={() => onChange(tab.value)}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-sm sm:gap-1.5 sm:px-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border"
        >
          {tab.label}
          {counts === undefined ? null : (
            <span className="text-xs tabular-nums">{counts[tab.value]}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Which of a form's fields have columns: a menu of its labels to tick. */
export function ColumnsMenu({
  fields,
  hidden,
  onToggle,
}: {
  fields: FormOption["fields"];
  hidden: ReadonlySet<string>;
  onToggle: (name: string, shown: boolean) => void;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="gap-2 px-3">
          <Columns3 className="h-4 w-4" aria-hidden="true" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {fields.map(field => (
          <DropdownMenuCheckboxItem
            key={field.name}
            checked={!hidden.has(field.name)}
            onCheckedChange={checked => onToggle(field.name, checked === true)}
            // Keep the menu open while toggling several columns.
            onSelect={event => event.preventDefault()}
          >
            {field.label || field.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SubmissionsToolbar({
  forms,
  formId,
  onFormChange,
  status,
  counts,
  onStatusChange,
  date,
  onDateChange,
  end,
}: {
  /** The forms to pick from; none on a list fixed to one form. */
  forms: readonly FormOption[] | undefined;
  formId: string;
  onFormChange: (formId: string) => void;
  status: StatusTab;
  counts: Record<StatusTab, number> | undefined;
  onStatusChange: (tab: StatusTab) => void;
  date: DateChoice;
  onDateChange: (choice: DateChoice) => void;
  /** Drawn at the toolbar's end: the columns menu, and export where it goes. */
  end: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {forms === undefined ? null : (
        <FormPicker forms={forms} value={formId} onChange={onFormChange} />
      )}
      <StatusFilter value={status} counts={counts} onChange={onStatusChange} />
      <DateFilter choice={date} onChoose={onDateChange} />
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{end}</div>
    </div>
  );
}
