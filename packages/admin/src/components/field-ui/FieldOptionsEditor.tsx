"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@nextlyhq/ui";
import { useState, useCallback, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { generateSlug } from "@admin/lib/fields";

/**
 * One choice in a select/radio-style option list. `id` is a stable key the
 * editor uses for drag reordering; it is presentation-only and surfaces that
 * persist plain `{ label, value }` pairs can strip it before writing (see
 * `withOptionIds`). `value` is what gets stored; `label` is what editors see.
 */
export interface FieldOption {
  /** Stable identity for drag-and-drop; not persisted. */
  id: string;
  /** Display text shown to editors. */
  label: string;
  /** Stored value; auto-derived from the label until edited directly. */
  value: string;
}

/**
 * Props for {@link FieldOptionsEditor}. Deliberately narrow: this component
 * edits an option list and nothing else. Field-admin concerns that some
 * surfaces layer on top of options (multi-select, clearable, placeholder,
 * radio layout) are the surface's responsibility, not the kit's — keeping them
 * out is what lets every surface share one options editor without inheriting
 * another surface's storage shape.
 */
export interface FieldOptionsEditorProps {
  /** The current options (controlled). */
  options: readonly FieldOption[];
  /**
   * Called with the next option list on any add, edit, reorder, import, or
   * remove. Always a new array; the editor never mutates the input.
   */
  onOptionsChange: (options: FieldOption[]) => void;
  /** Read-only surfaces: renders values but blocks every edit affordance. */
  disabled?: boolean;
  /** Show the CSV/JSON bulk-import affordance. Default `true`. */
  allowImport?: boolean;
  /**
   * Prefix for ids generated for newly added/imported options, so two editors
   * mounted at once cannot mint colliding ids. Default `"opt"`.
   */
  idPrefix?: string;
}

/** Mint a collision-resistant option id under the given prefix. */
function generateOptionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Seed drag-and-drop ids onto plain `{ label, value }` data. Surfaces that
 * store option lists without ids (e.g. the Form Builder) call this once to
 * feed {@link FieldOptionsEditor} and strip the ids again on write.
 */
export function withOptionIds(
  options: ReadonlyArray<{ label: string; value: string }>,
  idPrefix = "opt"
): FieldOption[] {
  return options.map((option, index) => ({
    id: `${idPrefix}_seed_${index}`,
    label: option.label,
    value: option.value,
  }));
}

/** Slug-with-underscores value auto-generated from a label. */
function valueFromLabel(label: string): string {
  return generateSlug(label).replace(/-/g, "_");
}

/**
 * Parse pasted CSV into options. Each non-empty line is `label,value` or just
 * `label` (value auto-generated). Extra commas beyond the first are ignored.
 */
function parseCsv(csv: string, idPrefix: string): FieldOption[] {
  return csv
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [label = "", value] = line.split(",").map(part => part.trim());
      return {
        id: generateOptionId(idPrefix),
        label,
        value: value || valueFromLabel(label),
      };
    });
}

/**
 * Parse pasted JSON into options. Accepts an array of `{ label, value }`
 * objects or an array of strings (value auto-generated). Throws a
 * human-readable message on malformed input for the import dialog to surface.
 */
function parseJson(json: string, idPrefix: string): FieldOption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON format");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("JSON must be an array");
  }
  return parsed.map(item => {
    if (typeof item === "string") {
      // Reject blank strings rather than importing an empty option row.
      if (!item.trim()) {
        throw new Error("Option labels must be non-empty strings");
      }
      return {
        id: generateOptionId(idPrefix),
        label: item,
        value: valueFromLabel(item),
      };
    }
    // Arrays are objects too; exclude them so `[[]]` is rejected, not coerced.
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as {
        label?: unknown;
        name?: unknown;
        value?: unknown;
      };
      // A malformed object (missing/blank/non-string label, or a non-string
      // value) is reported as invalid instead of importing a blank row — the
      // type guards also keep a nested object from stringifying to
      // "[object Object]".
      const rawLabel = record.label ?? record.name;
      if (typeof rawLabel !== "string" || !rawLabel.trim()) {
        throw new Error("Each object must include a non-empty string label");
      }
      if (record.value !== undefined && typeof record.value !== "string") {
        throw new Error("Option values must be strings");
      }
      const value = record.value ? record.value : valueFromLabel(rawLabel);
      return { id: generateOptionId(idPrefix), label: rawLabel, value };
    }
    throw new Error("Each item must be a string or an object");
  });
}

interface SortableOptionRowProps {
  option: FieldOption;
  disabled: boolean;
  onLabelChange: (id: string, label: string) => void;
  onValueChange: (id: string, value: string) => void;
  onDelete: (id: string) => void;
}

function SortableOptionRow({
  option,
  disabled,
  onLabelChange,
  onValueChange,
  onDelete,
}: SortableOptionRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 rounded-none border border-border bg-background p-2"
    >
      <button
        type="button"
        aria-label="Reorder option"
        disabled={disabled}
        className="cursor-grab p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        {...attributes}
        {...listeners}
      >
        <Icons.GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1">
        <Input
          aria-label="Option label"
          value={option.label}
          disabled={disabled}
          onChange={event => onLabelChange(option.id, event.target.value)}
          placeholder="Label"
          className="h-7 text-sm"
        />
      </div>
      <div className="flex-1">
        <Input
          aria-label="Option value"
          value={option.value}
          disabled={disabled}
          onChange={event => onValueChange(option.id, event.target.value)}
          placeholder="Value"
          className="h-7 font-mono text-sm"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove option"
        disabled={disabled}
        onClick={() => onDelete(option.id)}
        // Revealed on pointer hover, but also on keyboard focus (focus-within on
        // the row / focus-visible on the button) and always on touch devices
        // (hover: none), so the action is never hidden from those users.
        className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Icons.Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * Controlled, storage-agnostic editor for a list of select/radio-style
 * options. Editors can add, remove, drag to reorder, and bulk-import options;
 * the stored value is auto-derived from the label until edited, and every
 * stored value that collides with another is reported as a group so fixing one
 * duplicate does not surprise the editor with the next on resubmit.
 *
 * This is a kit primitive shared by every field-building surface (the Schema
 * Builder, the Form Builder, and plugin admin UIs via
 * `@nextlyhq/plugin-sdk/admin`). It owns only the option list; a surface that
 * also needs field-admin knobs (multi-select, clearable, placeholder, radio
 * layout) renders those itself around this component.
 */
export function FieldOptionsEditor({
  options,
  onOptionsChange,
  disabled = false,
  allowImport = true,
  idPrefix = "opt",
}: FieldOptionsEditorProps) {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importError, setImportError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Every stored value that appears more than once, reported whole so a batch
  // of collisions is fixed in one pass rather than surfacing one at a time.
  const duplicateValues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const option of options) {
      const value = option.value.trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([value]) => value);
  }, [options]);

  const handleAdd = useCallback(() => {
    onOptionsChange([
      ...options,
      { id: generateOptionId(idPrefix), label: "", value: "" },
    ]);
  }, [options, onOptionsChange, idPrefix]);

  const handleValueChange = useCallback(
    (id: string, value: string) => {
      onOptionsChange(
        options.map(option =>
          option.id === id ? { ...option, value } : option
        )
      );
    },
    [options, onOptionsChange]
  );

  // Editing a label re-derives the value only while the value still tracks the
  // label (blank or previously auto-generated); a hand-edited value is left
  // alone.
  const handleLabelChange = useCallback(
    (id: string, label: string) => {
      onOptionsChange(
        options.map(option => {
          if (option.id !== id) return option;
          const tracksLabel =
            !option.value || option.value === valueFromLabel(option.label);
          return {
            ...option,
            label,
            value: tracksLabel ? valueFromLabel(label) : option.value,
          };
        })
      );
    },
    [options, onOptionsChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      onOptionsChange(options.filter(option => option.id !== id));
    },
    [options, onOptionsChange]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = options.findIndex(option => option.id === active.id);
      const to = options.findIndex(option => option.id === over.id);
      if (from === -1 || to === -1) return;
      onOptionsChange(arrayMove([...options], from, to));
    },
    [options, onOptionsChange]
  );

  const handleImport = useCallback(() => {
    try {
      const parsed =
        importFormat === "csv"
          ? parseCsv(importText, idPrefix)
          : parseJson(importText, idPrefix);
      if (parsed.length === 0) {
        setImportError("No options found in the pasted data");
        return;
      }
      onOptionsChange([...options, ...parsed]);
      setIsImportOpen(false);
      setImportText("");
      setImportError(null);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Failed to parse the data"
      );
    }
  }, [importText, importFormat, idPrefix, options, onOptionsChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Options</Label>
        <div className="flex items-center gap-1">
          {allowImport && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={disabled}
              onClick={() => setIsImportOpen(true)}
              className="h-6 text-xs"
            >
              <Icons.Upload className="mr-1 h-3 w-3" />
              Import
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={disabled}
            onClick={handleAdd}
            className="h-6 text-xs"
          >
            <Icons.Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {options.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={options.map(option => option.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {options.map(option => (
                <SortableOptionRow
                  key={option.id}
                  option={option}
                  disabled={disabled}
                  onLabelChange={handleLabelChange}
                  onValueChange={handleValueChange}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-xs text-muted-foreground">
          No options yet &mdash; use Add or Import above.
        </p>
      )}

      {duplicateValues.length > 0 && (
        <p role="alert" className="text-xs text-destructive">
          Duplicate values:{" "}
          {duplicateValues.map(value => `"${value}"`).join(", ")}. Each
          option&apos;s stored value must be unique.
        </p>
      )}

      {options.length > 0 && (
        <div className="flex items-center gap-2 px-2 text-[10px] text-muted-foreground">
          <div className="w-6" />
          <div className="flex-1">Label (displayed)</div>
          <div className="flex-1">Value (stored)</div>
          <div className="w-7" />
        </div>
      )}

      {allowImport && (
        <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Import options</DialogTitle>
              <DialogDescription>
                Paste your options below. They are appended to the existing
                list.
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={importFormat}
              onValueChange={value => {
                setImportFormat(value as "csv" | "json");
                setImportError(null);
              }}
            >
              <TabsList>
                <TabsTrigger value="csv">CSV</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="csv" className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  One line per option.{" "}
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px]">
                    Label,value
                  </code>{" "}
                  or just{" "}
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px]">
                    Label
                  </code>{" "}
                  (value auto-generated).
                </p>
                <Textarea
                  aria-label="CSV options"
                  value={importText}
                  onChange={event => {
                    setImportText(event.target.value);
                    setImportError(null);
                  }}
                  placeholder={`Draft,draft\nPublished,published\nArchived`}
                  className="min-h-[150px] font-mono text-sm"
                />
              </TabsContent>

              <TabsContent value="json" className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Array of{" "}
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px]">
                    {`{label, value}`}
                  </code>{" "}
                  objects, or array of strings (value auto-generated).
                </p>
                <Textarea
                  aria-label="JSON options"
                  value={importText}
                  onChange={event => {
                    setImportText(event.target.value);
                    setImportError(null);
                  }}
                  placeholder={`[{"label":"Draft","value":"draft"}]`}
                  className="min-h-[150px] font-mono text-sm"
                />
              </TabsContent>
            </Tabs>

            {importError && (
              // role="alert" so the dynamically rendered import error is
              // announced to screen readers when it appears.
              <div
                role="alert"
                className="flex items-center gap-2 text-xs text-destructive"
              >
                <Icons.AlertTriangle className="h-3.5 w-3.5" />
                {importError}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsImportOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleImport}
                disabled={!importText.trim()}
              >
                Import options
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
