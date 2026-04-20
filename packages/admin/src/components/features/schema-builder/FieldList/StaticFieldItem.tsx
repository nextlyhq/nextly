/**
 * StaticFieldItem Component
 *
 * Non-sortable field row for display inside block types and arrays.
 * Prevents dnd-kit collision detection from interfering with nested drops.
 */

import { Badge, Button } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";

import type { BuilderField, FieldValidationError } from "../types";
import { isNestedFieldType } from "../types";

import { FIELD_TYPE_ICONS, iconMap } from "./constants";

export interface StaticFieldItemProps {
  field: BuilderField;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  depth?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  nestedCount?: number;
  validationError?: FieldValidationError;
  isSystem?: boolean;
}

export function StaticFieldItem({
  field,
  isSelected,
  onSelect,
  onDelete,
  depth = 0,
  isCollapsed = false,
  onToggleCollapse,
  nestedCount = 0,
  validationError,
  isSystem = false,
}: StaticFieldItemProps) {
  const iconName = FIELD_TYPE_ICONS[field.type] || "FileText";
  const IconComponent = iconMap[iconName] || Icons.FileText;
  const hasNestedFields = isNestedFieldType(field.type);
  const hasError = validationError?.type === "error";
  const hasWarning = validationError?.type === "warning";

  const indentPx = depth * 24;

  return (
    <div
      style={{ marginLeft: `${indentPx}px` }}
      className={`
        group flex items-center gap-3 p-2 rounded-md border transition-all
        ${isSystem ? "bg-muted/30 border-border/50 opacity-60 cursor-not-allowed" : isSelected ? "border-primary bg-primary/5" : "border-border bg-background hover-subtle-row"}
        ${hasError ? "border-destructive bg-destructive/5" : ""}
        ${hasWarning ? "border-yellow-500 bg-yellow-500/5" : ""}
      `}
    >
      {/* Expand/Collapse toggle for nested fields */}
      {hasNestedFields && onToggleCollapse && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="p-1 rounded hover-subtle-row shrink-0"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? (
            <Icons.ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Icons.ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      )}

      {/* Field info - clickable */}
      <button
        type="button"
        onClick={isSystem ? undefined : onSelect}
        className={`flex-1 flex items-center gap-2 text-left min-w-0 ${isSystem ? "cursor-not-allowed" : ""}`}
      >
        {/* Field type icon */}
        <div
          className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-[6px] border transition-colors ${isSystem ? "border-muted-foreground/20 bg-muted/50 text-muted-foreground/60" : "border-primary/25 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground/80"}`}
        >
          <IconComponent className="h-3.5 w-3.5" />
        </div>

        {/* Field details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs font-medium text-foreground truncate">
              {field.label || field.name || "Unnamed"}
            </span>
            {field.validation?.required && (
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                Req
              </Badge>
            )}
            {hasNestedFields && nestedCount > 0 && (
              <Badge variant="default" className="text-[10px] px-1 py-0">
                {nestedCount} {nestedCount === 1 ? "field" : "fields"}
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground font-mono truncate block">
            {field.name || "unnamed"} · {field.type}
          </span>
        </div>
      </button>

      {/* Delete button (hidden for system fields) */}
      {!isSystem && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 h-6 w-6"
        >
          <Icons.Trash className="h-3 w-3 text-muted-foreground hover:text-destructive" />
        </Button>
      )}
      {isSystem && (
        <Badge
          variant="outline"
          className="text-[10px] px-2 py-0.5 shrink-0 bg-muted/50 border-muted-foreground/20 text-muted-foreground/70 font-medium gap-1"
        >
          <Icons.Lock className="h-2.5 w-2.5" />
          System
        </Badge>
      )}
    </div>
  );
}
