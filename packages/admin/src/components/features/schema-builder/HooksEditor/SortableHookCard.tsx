/**
 * SortableHookCard Component
 *
 * A draggable card representing a single enabled hook.
 * Supports expand/collapse for configuration, enable/disable toggle,
 * and drag-and-drop reordering.
 *
 * @module components/features/schema-builder/HooksEditor/SortableHookCard
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Button, Switch } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { EnabledHook } from "../types";

import { HookConfigForm } from "./HookConfigForm";
import {
  getPrebuiltHook,
  HOOK_CATEGORIES,
  HOOK_TYPE_LABELS,
} from "./utils/prebuiltHooks";

interface SortableHookCardProps {
  hook: EnabledHook;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (id: string, updates: Partial<EnabledHook>) => void;
  onDelete: (id: string) => void;
  onConfigChange: (id: string, config: Record<string, unknown>) => void;
  fieldNames: string[];
}

export function SortableHookCard({
  hook,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onDelete,
  onConfigChange,
  fieldNames,
}: SortableHookCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: hook.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hookConfig = getPrebuiltHook(hook.hookId);

  if (!hookConfig) {
    return null;
  }

  const categoryInfo = HOOK_CATEGORIES[hookConfig.category];
  const CategoryIcon = Icons[categoryInfo?.icon || "Zap"] || Icons.Zap;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-none  border border-primary/5 bg-background",
        hook.enabled ? "border-primary/5" : "border-primary/5 opacity-60"
      )}
    >
      {/* Hook Header */}
      <div className="flex items-center gap-2 p-2">
        {/* Drag Handle */}
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <Icons.GripVertical className="h-4 w-4" />
        </button>

        {/* Hook Icon */}
        <div className="w-6 h-6 rounded-none bg-primary/5 flex items-center justify-center">
          <CategoryIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        {/* Hook Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {hookConfig.name}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {HOOK_TYPE_LABELS[hookConfig.hookType] || hookConfig.hookType}
            </Badge>
          </div>
        </div>

        {/* Enable/Disable Toggle */}
        <Switch
          checked={hook.enabled}
          onCheckedChange={checked => onUpdate(hook.id, { enabled: checked })}
          className="data-[state=unchecked]:bg-primary/5"
        />

        {/* Expand/Collapse Button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleExpand}
        >
          {isExpanded ? (
            <Icons.ChevronUp className="h-4 w-4" />
          ) : (
            <Icons.ChevronDown className="h-4 w-4" />
          )}
        </Button>

        {/* Delete Button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(hook.id)}
        >
          <Icons.Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-primary/5 p-3 space-y-3">
          {/* Description */}
          <p className="text-xs text-muted-foreground">
            {hookConfig.description}
          </p>

          {/* Configuration Form */}
          <HookConfigForm
            hookId={hook.hookId}
            config={hook.config}
            onConfigChange={config => onConfigChange(hook.id, config)}
            fieldNames={fieldNames}
          />
        </div>
      )}
    </div>
  );
}
