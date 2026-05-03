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
            size="sm"
            className="h-6 text-xs"
            onClick={() => setIsImportModalOpen(true)}
          >
            <Icons.Upload className="h-3 w-3 mr-1" />
            Import
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
        <div className="flex flex-col items-center justify-center p-4 rounded-none  border border-primary/5 border-dashed border-primary/5">
          <Icons.List className="h-6 w-6 text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground text-center">
            No options defined
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={handleAddOption}
          >
            <Icons.Plus className="h-3 w-3 mr-1" />
            Add first option
          </Button>
        </div>
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
            {/* Format Selection */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={importFormat === "csv" ? "default" : "outline"}
                size="sm"
                onClick={() => setImportFormat("csv")}
              >
                CSV
              </Button>
              <Button
                type="button"
                variant={importFormat === "json" ? "default" : "outline"}
                size="sm"
                onClick={() => setImportFormat("json")}
              >
                JSON
              </Button>
            </div>

            {/* Format Help */}
            <div className="text-xs text-muted-foreground p-2 rounded-none bg-primary/5">
              {importFormat === "csv" ? (
                <>
                  <p className="font-medium mb-1">CSV Format:</p>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap">
                    {`Draft,draft
Published,published
Archived,archived

Or just labels (values auto-generated):
Draft
Published
Archived`}
                  </pre>
                </>
              ) : (
                <>
                  <p className="font-medium mb-1">JSON Format:</p>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap">
                    {`[
  { "label": "Draft", "value": "draft" },
  { "label": "Published", "value": "published" }
]

Or just strings (values auto-generated):
["Draft", "Published", "Archived"]`}
                  </pre>
                </>
              )}
            </div>

            {/* Textarea */}
            <Textarea
              value={importData}
              onChange={e => {
                setImportData(e.target.value);
                setImportError(null);
              }}
              placeholder={
                importFormat === "csv"
                  ? "Label,value\nDraft,draft\nPublished,published"
                  : '[{"label": "Draft", "value": "draft"}]'
              }
              className="font-mono text-sm min-h-[150px]"
            />

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
