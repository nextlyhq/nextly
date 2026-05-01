"use client";

/**
 * Options Editor Component
 *
 * Shared component for editing options arrays in Select and Radio fields.
 * Features:
 * - Add/edit/remove options
 * - Drag-and-drop reordering with @dnd-kit
 * - Auto-generate value from label
 *
 * @module admin/fields/OptionsEditor
 * @since 0.1.0
 */

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
import { Input } from "@revnixhq/ui";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

/** Option interface for Select/Radio fields */
export interface FieldOption {
  label: string;
  value: string;
}

/** Internal option with ID for drag-and-drop */
interface OptionWithId extends FieldOption {
  id: string;
}

export interface OptionsEditorProps {
  /** Current options array */
  options: FieldOption[];
  /** Callback when options change */
  onOptionsChange: (options: FieldOption[]) => void;
  /** Disable editing */
  disabled?: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a value from a label (snake_case format)
 */
function generateValueFromLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Add IDs to options for DnD tracking
 */
function addIdsToOptions(options: FieldOption[]): OptionWithId[] {
  return options.map((opt, index) => ({
    ...opt,
    id: `opt_${index}_${opt.value}`,
  }));
}

/**
 * Remove IDs from options when saving
 */
function removeIdsFromOptions(options: OptionWithId[]): FieldOption[] {
  return options.map(({ label, value }) => ({ label, value }));
}

// ============================================================================
// SortableOption Component
// ============================================================================

interface SortableOptionProps {
  option: OptionWithId;
  index: number;
  onLabelChange: (id: string, label: string) => void;
  onValueChange: (id: string, value: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

function SortableOption({
  option,
  index,
  onLabelChange,
  onValueChange,
  onDelete,
  disabled,
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
      className={`options-editor__option ${isDragging ? "options-editor__option--dragging" : ""}`}
    >
      {/* Drag Handle */}
      <button
        type="button"
        className="options-editor__drag-handle"
        disabled={disabled}
        aria-label={`Drag to reorder option ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="options-editor__drag-icon" />
      </button>

      {/* Label Input */}
      <div className="options-editor__input-group">
        <Input
          type="text"
          value={option.label}
          onChange={e => onLabelChange(option.id, e.target.value)}
          placeholder="Label"
          disabled={disabled}
          className="options-editor__input"
        />
      </div>

      {/* Value Input */}
      <div className="options-editor__input-group">
        <Input
          type="text"
          value={option.value}
          onChange={e => onValueChange(option.id, e.target.value)}
          placeholder="value"
          disabled={disabled}
          className="options-editor__input options-editor__input--mono"
        />
      </div>

      {/* Delete Button */}
      <button
        type="button"
        className="options-editor__delete-btn"
        onClick={() => onDelete(option.id)}
        disabled={disabled}
        aria-label={`Delete option ${option.label || index + 1}`}
      >
        <Trash2 className="options-editor__delete-icon" />
      </button>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * OptionsEditor - Manage options for Select/Radio fields
 *
 * Provides a list of editable options with:
 * - Drag-and-drop reordering
 * - Add/remove options
 * - Auto-generate value from label
 *
 * @example
 * ```tsx
 * <OptionsEditor
 *   options={field.options}
 *   onOptionsChange={(options) => onUpdate({ options })}
 * />
 * ```
 */
export function OptionsEditor({
  options,
  onOptionsChange,
  disabled = false,
}: OptionsEditorProps) {
  // Convert options to internal format with IDs for DnD
  const optionsWithIds = addIdsToOptions(options);

  // DnD sensors with activation distance to prevent accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Add a new option
  const handleAddOption = useCallback(() => {
    const newIndex = options.length + 1;
    const newOption: FieldOption = {
      label: `Option ${newIndex}`,
      value: `option_${newIndex}`,
    };
    onOptionsChange([...options, newOption]);
  }, [options, onOptionsChange]);

  // Handle label change with auto-generate value
  const handleLabelChange = useCallback(
    (id: string, newLabel: string) => {
      const updatedOptions = optionsWithIds.map(opt => {
        if (opt.id !== id) return opt;

        // Auto-generate value if it matches the old auto-generated value or is empty
        const previousAutoValue = generateValueFromLabel(opt.label);
        const shouldAutoGenerate =
          !opt.value || opt.value === previousAutoValue;

        return {
          ...opt,
          label: newLabel,
          value: shouldAutoGenerate
            ? generateValueFromLabel(newLabel)
            : opt.value,
        };
      });

      onOptionsChange(removeIdsFromOptions(updatedOptions));
    },
    [optionsWithIds, onOptionsChange]
  );

  // Handle value change (manual override)
  const handleValueChange = useCallback(
    (id: string, newValue: string) => {
      const updatedOptions = optionsWithIds.map(opt =>
        opt.id === id ? { ...opt, value: newValue } : opt
      );
      onOptionsChange(removeIdsFromOptions(updatedOptions));
    },
    [optionsWithIds, onOptionsChange]
  );

  // Delete an option
  const handleDeleteOption = useCallback(
    (id: string) => {
      const updatedOptions = optionsWithIds.filter(opt => opt.id !== id);
      onOptionsChange(removeIdsFromOptions(updatedOptions));
    },
    [optionsWithIds, onOptionsChange]
  );

  // Handle drag end for reordering
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = optionsWithIds.findIndex(opt => opt.id === active.id);
        const newIndex = optionsWithIds.findIndex(opt => opt.id === over.id);
        const reorderedOptions = arrayMove(optionsWithIds, oldIndex, newIndex);
        onOptionsChange(removeIdsFromOptions(reorderedOptions));
      }
    },
    [optionsWithIds, onOptionsChange]
  );

  return (
    <div className="options-editor">
      {/* Header */}
      <div className="options-editor__header">
        <label className="options-editor__label">Options</label>
        <button
          type="button"
          className="options-editor__add-btn"
          onClick={handleAddOption}
          disabled={disabled}
        >
          <Plus className="options-editor__add-icon" />
          Add Option
        </button>
      </div>

      {/* Options List */}
      {options.length > 0 ? (
        <>
          {/* Column Headers */}
          <div className="options-editor__column-headers">
            <div className="options-editor__column-spacer" />
            <div className="options-editor__column-label">
              Label (displayed)
            </div>
            <div className="options-editor__column-label">Value (stored)</div>
            <div className="options-editor__column-spacer" />
          </div>

          {/* Sortable List */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={optionsWithIds.map(opt => opt.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="options-editor__list">
                {optionsWithIds.map((option, index) => (
                  <SortableOption
                    key={option.id}
                    option={option}
                    index={index}
                    onLabelChange={handleLabelChange}
                    onValueChange={handleValueChange}
                    onDelete={handleDeleteOption}
                    disabled={disabled}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      ) : (
        /* Empty State */
        <div className="options-editor__empty">
          <p className="options-editor__empty-text">No options defined</p>
          <button
            type="button"
            className="options-editor__add-first-btn"
            onClick={handleAddOption}
            disabled={disabled}
          >
            <Plus className="options-editor__add-icon" />
            Add first option
          </button>
        </div>
      )}

      {/* Help Text */}
      <p className="options-editor__hint">
        Drag options to reorder. Value is auto-generated from label.
      </p>
    </div>
  );
}

export default OptionsEditor;
