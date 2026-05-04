"use client";

/**
 * SelectOptionsEditor Component
 *
 * Editor for managing select and radio field options.
 * Features:
 * - Add/remove options with + button
 * - Drag to reorder options using @dnd-kit
 * - Label and value inputs per option
 * - Auto-generate value from label
 * - Import from CSV/JSON via textarea modal
 * - hasMany toggle for multi-select (select field only)
 *
 * @module components/features/schema-builder/SelectOptionsEditor
 */

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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@revnixhq/ui";
import { useState, useCallback } from "react";

import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";
import { generateSlug } from "@admin/lib/fields";

import type { SelectOption, SelectOptionsEditorProps } from "./types";

// ============================================================
// Utility Functions
// ============================================================

/**
 * Generate a unique ID for an option
 */
function generateOptionId(): string {
  return `opt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a value from a label (slug format with underscores)
 */
function generateValueFromLabel(label: string): string {
  return generateSlug(label).replace(/-/g, "_");
}

/**
 * Parse CSV data into options
 * Supports formats:
 * - "label,value" per line
 * - "label" per line (value auto-generated)
 */
function parseCSV(csv: string): SelectOption[] {
  const lines = csv
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  return lines.map(line => {
    const parts = line.split(",").map(part => part.trim());
    const label = parts[0] || "";
    const value = parts[1] || generateValueFromLabel(label);
    return {
      id: generateOptionId(),
      label,
      value,
    };
  });
}

/**
 * Parse JSON data into options
 * Supports formats:
 * - Array of { label, value } objects
 * - Array of strings (value auto-generated)
 */
function parseJSON(json: string): SelectOption[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON must be an array");
    }
    return parsed.map(item => {
      if (typeof item === "string") {
        return {
          id: generateOptionId(),
          label: item,
          value: generateValueFromLabel(item),
        };
      }
      if (typeof item === "object" && item !== null) {
        const label = item.label || item.name || "";
        const value = item.value || generateValueFromLabel(label);
        return {
          id: generateOptionId(),
          label,
          value,
        };
      }
      throw new Error("Invalid item format");
    });
  } catch {
    throw new Error("Invalid JSON format");
  }
}

// ============================================================
// SortableOption Component
// ============================================================

interface SortableOptionProps {
  option: SelectOption;
  onUpdate: (id: string, updates: Partial<SelectOption>) => void;
  onDelete: (id: string) => void;
  onLabelChange: (id: string, label: string) => void;
}

function SortableOption({
  option,
  onUpdate,
  onDelete,
  onLabelChange,
}: SortableOptionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 rounded-none  border border-primary/5 bg-background group"
    >
      {/* Drag Handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <Icons.GripVertical className="h-4 w-4" />
      </button>

      {/* Label Input */}
      <div className="flex-1">
        <Input
          value={option.label}
          onChange={e => onLabelChange(option.id, e.target.value)}
          placeholder="Label"
          className="h-7 text-sm"
        />
      </div>

      {/* Value Input */}
      <div className="flex-1">
        <Input
          value={option.value}
          onChange={e => onUpdate(option.id, { value: e.target.value })}
          placeholder="Value"
          className="h-7 text-sm font-mono"
        />
      </div>

      {/* Delete Button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(option.id)}
      >
        <Icons.Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ============================================================
// SelectOptionsEditor Component
// ============================================================

export function SelectOptionsEditor({
  options,
  onOptionsChange,
  hasMany,
  onHasManyChange,
  fieldType,
  isClearable,
  onIsClearableChange,
  placeholder,
  onPlaceholderChange,
  layout,
  onLayoutChange,
}: SelectOptionsEditorProps) {
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importData, setImportData] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importError, setImportError] = useState<string | null>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Add a new empty option
  const handleAddOption = useCallback(() => {
    const newOption: SelectOption = {
      id: generateOptionId(),
      label: "",
      value: "",
    };
    onOptionsChange([...options, newOption]);
  }, [options, onOptionsChange]);

  // Update an option
  const handleUpdateOption = useCallback(
    (id: string, updates: Partial<SelectOption>) => {
      onOptionsChange(
        options.map(opt => (opt.id === id ? { ...opt, ...updates } : opt))
      );
    },
    [options, onOptionsChange]
  );

  // Handle label change with auto-generate value
  const handleLabelChange = useCallback(
    (id: string, label: string) => {
      onOptionsChange(
        options.map(opt => {
          if (opt.id !== id) return opt;
          // Auto-generate value if it was previously auto-generated or empty
          const previousValue = generateValueFromLabel(opt.label);
          const shouldAutoGenerate = !opt.value || opt.value === previousValue;
          return {
            ...opt,
            label,
            value: shouldAutoGenerate
              ? generateValueFromLabel(label)
              : opt.value,
          };
        })
      );
    },
    [options, onOptionsChange]
  );

  // Delete an option
  const handleDeleteOption = useCallback(
    (id: string) => {
      onOptionsChange(options.filter(opt => opt.id !== id));
    },
    [options, onOptionsChange]
  );

  // Handle drag end for reordering
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = options.findIndex(opt => opt.id === active.id);
        const newIndex = options.findIndex(opt => opt.id === over.id);
        onOptionsChange(arrayMove(options, oldIndex, newIndex));
      }
    },
    [options, onOptionsChange]
  );

  // Handle import
  const handleImport = useCallback(() => {
    setImportError(null);
    try {
      let parsedOptions: SelectOption[];
      if (importFormat === "csv") {
        parsedOptions = parseCSV(importData);
      } else {
        parsedOptions = parseJSON(importData);
      }

      if (parsedOptions.length === 0) {
        setImportError("No valid options found in the data");
        return;
      }

      // Append to existing options
      onOptionsChange([...options, ...parsedOptions]);
      setIsImportModalOpen(false);
      setImportData("");
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Failed to parse data"
      );
    }
  }, [importData, importFormat, options, onOptionsChange]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Options</Label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="h-6 text-xs"
            onClick={() => setIsImportModalOpen(true)}
          >
            <Icons.Upload className="h-3 w-3 mr-1" />
            Import
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="h-6 text-xs"
            onClick={handleAddOption}
          >
            <Icons.Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Options List */}
      {options.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={options.map(opt => opt.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {options.map(option => (
                <SortableOption
                  key={option.id}
                  option={option}
                  onUpdate={handleUpdateOption}
                  onDelete={handleDeleteOption}
                  onLabelChange={handleLabelChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        // PR E4: quiet inline empty state. Drops the dashed container,
        // the big icon, and the duplicate "Add first option" button.
        // The header above already shows + Add and Import affordances;
        // we just point the user at them in soft helper copy. Brainstorm
        // 2026-05-04 Option B locked this shape.
        <p className="text-xs text-muted-foreground">
          No options yet -- click + Add or Import above.
        </p>
      )}

      {/* Column Headers (when options exist) */}
      {options.length > 0 && (
        <div className="flex items-center gap-2 px-2 text-[10px] text-muted-foreground">
          <div className="w-6" /> {/* Drag handle spacer */}
          <div className="flex-1">Label (displayed)</div>
          <div className="flex-1">Value (stored)</div>
          <div className="w-7" /> {/* Delete button spacer */}
        </div>
      )}

      {/* hasMany Toggle (only for select, not radio) */}
      {fieldType === "select" && onHasManyChange && (
        <div className="flex items-center justify-between py-2  border-t border-primary/5 mt-3 pt-3">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Multiple"
              description="Users can select more than one option"
            />
          </div>
          <Switch
            checked={hasMany || false}
            onCheckedChange={onHasManyChange}
          />
        </div>
      )}

      {/* PR E3: Select-only admin knobs -- clearable + placeholder.
          Stored as field.admin.isClearable and field.admin.placeholder
          via the patchAdmin helper in TypeSpecificEditor. */}
      {fieldType === "select" && onIsClearableChange && (
        <div className="flex items-center justify-between py-2 border-t border-primary/5 mt-3 pt-3">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Clearable"
              description="Show a clear (X) button next to the picker so users can unset the value"
            />
          </div>
          <Switch
            aria-label="Clearable"
            checked={isClearable !== false}
            onCheckedChange={onIsClearableChange}
          />
        </div>
      )}
      {fieldType === "select" && onPlaceholderChange && (
        <div className="space-y-2 mt-3">
          <FormLabelWithTooltip
            className="text-xs font-medium"
            label="Placeholder"
            description="Text shown in the picker before any option is selected"
          />
          <Input
            value={placeholder ?? ""}
            onChange={e => onPlaceholderChange(e.target.value)}
            placeholder="e.g., Choose a category..."
            className="h-8 text-sm"
          />
        </div>
      )}

      {/* PR E3: Radio-only admin knob -- horizontal vs vertical layout.
          Stored as field.admin.layout. */}
      {fieldType === "radio" && onLayoutChange && (
        <div className="space-y-2 mt-3 border-t border-primary/5 pt-3">
          <FormLabelWithTooltip
            className="text-xs font-medium"
            label="Layout"
            description="Whether radio options stack vertically or sit side-by-side"
          />
          <div className="inline-flex divide-x divide-border rounded-sm border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => onLayoutChange("horizontal")}
              className={`px-3 py-1 text-xs ${
                (layout ?? "horizontal") === "horizontal"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Horizontal
            </button>
            <button
              type="button"
              onClick={() => onLayoutChange("vertical")}
              className={`px-3 py-1 text-xs ${
                layout === "vertical"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Vertical
            </button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Import Options</DialogTitle>
            <DialogDescription>
              Paste your options data below. Options will be appended to the
              existing list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* PR E4: Tabs primitive replaces the two-button format
                toggle. Each tab content shows a short helper line and
                the same textarea. The textarea state is shared across
                tabs (importData) -- importFormat updates as the tab
                changes, but already-typed text is preserved so users
                can paste once and switch formats if they realize they
                pasted the wrong shape. */}
            <Tabs
              value={importFormat}
              onValueChange={v => {
                setImportFormat(v as "csv" | "json");
                setImportError(null);
              }}
            >
              <TabsList>
                <TabsTrigger value="csv">CSV</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="csv" className="space-y-3 mt-3">
                <p className="text-xs text-muted-foreground">
                  One line per option.{" "}
                  <code className="font-mono text-[10px] px-1 py-0.5 rounded-sm bg-muted">
                    Label,value
                  </code>{" "}
                  or just{" "}
                  <code className="font-mono text-[10px] px-1 py-0.5 rounded-sm bg-muted">
                    Label
                  </code>{" "}
                  (value auto-generated).
                </p>
                <Textarea
                  value={importData}
                  onChange={e => {
                    setImportData(e.target.value);
                    setImportError(null);
                  }}
                  placeholder={`Draft,draft\nPublished,published\nArchived`}
                  className="font-mono text-sm min-h-[150px]"
                />
              </TabsContent>

              <TabsContent value="json" className="space-y-3 mt-3">
                <p className="text-xs text-muted-foreground">
                  Array of{" "}
                  <code className="font-mono text-[10px] px-1 py-0.5 rounded-sm bg-muted">
                    {`{label, value}`}
                  </code>{" "}
                  objects, or array of strings (value auto-generated).
                </p>
                <Textarea
                  value={importData}
                  onChange={e => {
                    setImportData(e.target.value);
                    setImportError(null);
                  }}
                  placeholder={`[{"label":"Draft","value":"draft"}]`}
                  className="font-mono text-sm min-h-[150px]"
                />
              </TabsContent>
            </Tabs>

            {/* Error Message */}
            {importError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <Icons.AlertTriangle className="h-3.5 w-3.5" />
                {importError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsImportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={!importData.trim()}
            >
              Import Options
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
