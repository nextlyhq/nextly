/**
 * Form Canvas
 *
 * Drop zone where form fields are arranged and can be reordered.
 * Styled to match the Collection Builder's FieldList:
 * - Full-width horizontal rows
 * - Blue icon boxes (matching FieldPalette items)
 * - GripVertical drag handle on the left
 * - Type badge + Required badge on the right
 * - Dashed-border empty state
 *
 * @module admin/components/builder/FormCanvas
 * @since 0.1.0
 */

"use client";

import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { FormField } from "../../../types";

// ============================================================================
// Types
// ============================================================================

export interface FormCanvasProps {
  fields: FormField[];
  selectedFieldId: string | null;
  onFieldSelect: (fieldName: string | null) => void;
  onFieldDelete: (fieldName: string) => void;
}

// ============================================================================
// Field Type Icon SVG paths (inline Lucide-compatible)
// ============================================================================

const FIELD_ICON_PATHS: Record<string, string> = {
  text: "M4 7h16M4 12h16M4 17h10",
  email:
    "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  number: "M7 20l4-16m2 16l4-16M6 9h14M4 15h14",
  phone:
    "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 15.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  url: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  textarea: "M4 6h16M4 12h16M4 18h7",
  select: "M8 9l4-4 4 4m0 6l-4 4-4-4",
  checkbox: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  radio:
    "M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-6a4 4 0 100-8 4 4 0 000 8z",
  file: "M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13",
  date: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  time: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  hidden:
    "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21",
};

const DEFAULT_ICON_PATH = "M4 7h16M4 12h16M4 17h10";

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  email: "Email",
  number: "Number",
  phone: "Phone",
  url: "URL",
  textarea: "Textarea",
  select: "Dropdown",
  checkbox: "Checkbox",
  radio: "Radio",
  file: "File Upload",
  date: "Date",
  time: "Time",
  hidden: "Hidden",
};

// ============================================================================
// SortableFieldItem — Full-width horizontal row (mirrors FieldList)
// ============================================================================

function SortableFieldItem({
  field,
  isSelected,
  onSelect,
  onDelete,
}: {
  field: FormField;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const iconPath = FIELD_ICON_PATHS[field.type] || DEFAULT_ICON_PATH;
  const typeLabel = FIELD_TYPE_LABELS[field.type] || field.type;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex items-center gap-3 py-3 px-4 border border-solid rounded-md cursor-pointer transition-all duration-150 group outline-none focus:outline-none focus:ring-0 ${
        isSelected
          ? "bg-transparent dark:bg-transparent shadow-none ring-0"
          : "border-slate-200 dark:border-slate-800 dark:bg-transparent dark:hover:bg-transparent"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      {/* Drag Handle — GripVertical */}
      <button
        type="button"
        className="p-1 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors"
        aria-label={`Drag to reorder ${field.label || field.name}`}
        onClick={e => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {/* GripVertical dots */}
          <circle cx="9" cy="5" r="1" fill="currentColor" />
          <circle cx="9" cy="12" r="1" fill="currentColor" />
          <circle cx="9" cy="19" r="1" fill="currentColor" />
          <circle cx="15" cy="5" r="1" fill="currentColor" />
          <circle cx="15" cy="12" r="1" fill="currentColor" />
          <circle cx="15" cy="19" r="1" fill="currentColor" />
        </svg>
      </button>

      {/* Field type icon box — blue, matches FieldPalette */}
      <div
        className="shrink-0 flex items-center justify-center w-9 h-9 bg-primary/10 text-primary dark:bg-primary/20 dark:text-white mr-1"
        style={{
          borderRadius: "6px",
          border: "1px solid hsl(var(--primary) / 0.25)",
        }}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={iconPath} />
        </svg>
      </div>

      {/* Field info */}
      <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
        <span className="text-sm font-medium text-foreground truncate">
          {field.label || field.name || "Unnamed Field"}
        </span>
        <span className="text-muted-foreground/40 text-xs shrink-0">•</span>
        <span className="text-[10px] font-medium shrink-0 px-2 py-0 leading-5 rounded-full border border-border/60 bg-muted text-muted-foreground capitalize">
          {typeLabel}
        </span>
        {field.required && (
          <span className="text-[10px] px-2 py-0 leading-5 bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-400 font-normal rounded-full border border-red-200 dark:border-red-500/30 shrink-0">
            Required
          </span>
        )}
      </div>

      {/* Delete button — visible on hover */}
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          onDelete();
        }}
        title={`Delete ${field.label || field.name}`}
        aria-label={`Delete ${field.label || field.name}`}
        className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all duration-150 opacity-0 group-hover:opacity-100"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" />
        </svg>
      </button>
    </div>
  );
}

// ============================================================================
// FormCanvas Component
// ============================================================================

export function FormCanvas({
  fields,
  selectedFieldId,
  onFieldSelect,
  onFieldDelete,
}: FormCanvasProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: "canvas-drop-zone",
  });

  // Empty state — dashed border, centred icon + text (mirrors Collection Builder)
  if (fields.length === 0) {
    return (
      <div
        ref={setNodeRef}
        id="canvas-drop-zone"
        className={`min-h-[320px] flex flex-col items-center justify-center border-2 border-dashed rounded-md transition-all duration-200 ${
          isOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
        }`}
      >
        <div className="text-center px-6 py-12">
          {/* Arrow-down icon */}
          <div
            className={`mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-md border transition-colors ${
              isOver
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-muted text-muted-foreground/40"
            }`}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </div>
          <p
            className={`text-sm font-medium mb-1 ${
              isOver ? "text-primary" : "text-foreground"
            }`}
          >
            {isOver ? "Release to add field" : "No fields yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isOver
              ? "Drop the field here"
              : "Drag a field from the panel on the right to add it here"}
          </p>
        </div>
      </div>
    );
  }

  // Fields present
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[120px] transition-all duration-200 ${
        isOver ? "bg-primary/5 rounded-md" : ""
      }`}
    >
      {/* Field rows */}
      <div className="space-y-2">
        {fields.map(field => (
          <SortableFieldItem
            key={field.name}
            field={field}
            isSelected={selectedFieldId === field.name}
            onSelect={() => onFieldSelect(field.name)}
            onDelete={() => onFieldDelete(field.name)}
          />
        ))}
      </div>

      {/* Drop-here strip at bottom when dragging */}
      {isOver && (
        <div className="mt-2 flex items-center justify-center py-3 rounded-md border-2 border-dashed border-primary bg-primary/5">
          <p className="text-xs font-medium text-primary">
            Release to add field here
          </p>
        </div>
      )}
    </div>
  );
}

export default FormCanvas;
