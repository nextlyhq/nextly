/**
 * SortableFieldItem Component
 *
 * Sortable field row with drag handle using @dnd-kit.
 * Used for top-level and nested fields that support reordering.
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";

import type {
  BuilderField,
  FieldListDragData,
  FieldValidationError,
} from "../types";
import { isNestedFieldType } from "../types";

import {
  FIELD_TYPE_ICONS,
  iconMap,
  formatFieldType,
  countNestedFields,
} from "./constants";

export interface SortableFieldItemProps {
  field: BuilderField;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  depth?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  validationError?: FieldValidationError;
  isSystem?: boolean;
}

export function SortableFieldItem({
  field,
  isSelected,
  onSelect,
  onDelete,
  depth = 0,
  isCollapsed = false,
  onToggleCollapse,
  validationError,
  isSystem = false,
}: SortableFieldItemProps) {
  const dragData: FieldListDragData = {
    source: "field-list",
    field,
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: field.id,
    data: dragData,
    disabled: isSystem,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 50, position: "relative" as const } : {}),
  };

  const iconName = FIELD_TYPE_ICONS[field.type] || "FileText";
  const IconComponent = iconMap[iconName] || Icons.FileText;
  const hasNestedFields = isNestedFieldType(field.type);
  const nestedCount = hasNestedFields ? countNestedFields(field) : 0;
  const hasError = validationError?.type === "error";
  const hasWarning = validationError?.type === "warning";

  // Indentation for nested display
  const indentPx = depth * 24;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, marginLeft: `${indentPx}px` }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={isSystem ? -1 : 0}
      onClick={isSystem ? undefined : onSelect}
      onKeyDown={e => {
        if (!isSystem && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`
        group relative flex items-center gap-4 py-3 px-4 border-b outline-none select-none
        touch-none transition-colors duration-150 focus-visible:bg-primary/5 focus-visible:ring-inset focus-visible:ring-1 focus-visible:ring-primary
        ${isSystem ? "bg-muted/30 opacity-60 cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover-subtle-row"}
        ${isDragging ? "opacity-0" : ""}
        ${isSelected && !isSystem ? "bg-primary/5 border-transparent" : "border-border"}
        ${hasError && !isDragging ? "bg-destructive/5" : ""}
        ${hasWarning && !isDragging ? "bg-yellow-500/5" : ""}
      `}
      aria-selected={isSelected}
      aria-label={`${field.label || field.name} field, ${formatFieldType(field.type)} type`}
    >
      {/* Drag handle */}
      {!isSystem && (
        <div className="p-1.5 shrink-0">
          <Icons.GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </div>
      )}
      {isSystem && <div className="p-1.5 shrink-0 w-[28px]" />}

      {/* Field type icon */}
      <div
        className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-[6px] border transition-colors ${isSystem ? "border-muted-foreground/20 bg-muted/50 text-muted-foreground/60" : "border-primary/25 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground/80"} mr-1`}
      >
        <IconComponent className="h-4 w-4" />
      </div>

      {/* Expand/Collapse toggle for nested fields */}
      {hasNestedFields && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
          className="p-1 rounded hover-unified shrink-0 transition-colors"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? (
            <Icons.ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Icons.ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      )}

      {/* Field info - all in one row */}
      <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
        {/* Field label / title */}
        <span className="text-sm font-medium text-foreground truncate">
          {field.label || field.name || "Unnamed Field"}
        </span>

        {/* Divider dot */}
        <span className="text-muted-foreground/40 text-xs shrink-0">•</span>

        {/* Field type as a gray pill matching Required badge style */}
        <span className="text-[10px] font-medium shrink-0 px-2 py-0 leading-5 rounded-full border border-border/60 bg-muted text-muted-foreground">
          {formatFieldType(field.type)}
        </span>

        {/* Required badge */}
        {field.validation?.required && (
          <Badge
            variant="outline"
            className="text-[10px] px-2 py-0 bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 font-normal rounded-full border-red-200 dark:border-red-900/50 shrink-0"
          >
            Required
          </Badge>
        )}

        {/* Nested count badge */}
        {hasNestedFields && nestedCount > 0 && (
          <Badge
            variant="default"
            className="text-[10px] px-1.5 py-0 h-4 rounded-full shrink-0"
          >
            {nestedCount} {nestedCount === 1 ? "field" : "fields"}
          </Badge>
        )}

        {/* Validation error inline */}
        {validationError && (
          <span
            className={`text-xs ${hasError ? "text-destructive" : "text-yellow-600"}`}
          >
            {validationError.message}
          </span>
        )}
      </div>

      {/* Right side actions & badges */}
      <div className="shrink-0 flex items-center gap-3">
        {hasError && <Icons.AlertCircle className="h-4 w-4 text-destructive" />}
        {hasWarning && !hasError && (
          <Icons.AlertTriangle className="h-4 w-4 text-yellow-500" />
        )}

        {isSystem ? (
          <Badge
            variant="outline"
            className="text-[10px] px-2 py-0.5 shrink-0 bg-muted/50 border-muted-foreground/20 text-muted-foreground/70 font-medium gap-1"
          >
            <Icons.Lock className="h-2.5 w-2.5" />
            System
          </Badge>
        ) : (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-md hover-unified"
            aria-label="Delete field"
          >
            <Icons.Trash className="h-4 w-4 text-muted-foreground hover:text-destructive transition-colors delay-75" />
          </button>
        )}
      </div>
    </div>
  );
}
