"use client";

/**
 * HooksEditor Component
 *
 * Collapsible panel for configuring collection-level hooks.
 * Displays below the CollectionSettings panel in the Collection Builder.
 *
 * Features:
 * - Add hooks from pre-built templates via modal selector
 * - Configure hook parameters via Zod-schema-driven forms
 * - Drag-and-drop to reorder hooks (execution order)
 * - Enable/disable toggle per hook
 * - Remove hooks without losing other hooks
 *
 * @module components/features/schema-builder/HooksEditor/HooksEditor
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@revnixhq/ui";
import { useState, useCallback, useEffect, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { EnabledHook, HooksEditorProps } from "../types";

import { HookSelectorModal } from "./HookSelectorModal";
import { SortableHookCard } from "./SortableHookCard";
import { getPrebuiltHook, generateHookInstanceId } from "./utils/prebuiltHooks";
import { getDefaultConfig } from "./utils/zodIntrospection";

export function HooksEditor({
  hooks,
  onHooksChange,
  fieldNames,
  isExpanded = false,
  onExpandedChange,
}: HooksEditorProps) {
  const [localExpanded, setLocalExpanded] = useState(isExpanded);
  const [expandedHookIds, setExpandedHookIds] = useState<Set<string>>(
    new Set()
  );
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);

  // Sync with external expanded state
  useEffect(() => {
    setLocalExpanded(isExpanded);
  }, [isExpanded]);

  const handleExpandedChange = useCallback(
    (expanded: boolean) => {
      setLocalExpanded(expanded);
      onExpandedChange?.(expanded);
    },
    [onExpandedChange]
  );

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Toggle hook expansion
  const toggleHookExpand = useCallback((hookId: string) => {
    setExpandedHookIds(prev => {
      const next = new Set(prev);
      if (next.has(hookId)) {
        next.delete(hookId);
      } else {
        next.add(hookId);
      }
      return next;
    });
  }, []);

  // Add a new hook
  const handleAddHook = useCallback(
    (hookId: string) => {
      const hookConfig = getPrebuiltHook(hookId);
      if (!hookConfig) return;

      const newHook: EnabledHook = {
        id: generateHookInstanceId(),
        hookId,
        config: getDefaultConfig(hookConfig.configSchema),
        enabled: true,
      };

      onHooksChange([...hooks, newHook]);
      // Auto-expand new hook
      setExpandedHookIds(prev => new Set(prev).add(newHook.id));
    },
    [hooks, onHooksChange]
  );

  // Update a hook
  const handleUpdateHook = useCallback(
    (id: string, updates: Partial<EnabledHook>) => {
      onHooksChange(
        hooks.map(hook => (hook.id === id ? { ...hook, ...updates } : hook))
      );
    },
    [hooks, onHooksChange]
  );

  // Update hook config
  const handleConfigChange = useCallback(
    (id: string, config: Record<string, unknown>) => {
      onHooksChange(
        hooks.map(hook => (hook.id === id ? { ...hook, config } : hook))
      );
    },
    [hooks, onHooksChange]
  );

  // Delete a hook
  const handleDeleteHook = useCallback(
    (id: string) => {
      onHooksChange(hooks.filter(hook => hook.id !== id));
      setExpandedHookIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [hooks, onHooksChange]
  );

  // Handle drag end for reordering
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = hooks.findIndex(hook => hook.id === active.id);
        const newIndex = hooks.findIndex(hook => hook.id === over.id);
        onHooksChange(arrayMove(hooks, oldIndex, newIndex));
      }
    },
    [hooks, onHooksChange]
  );

  // Get list of already added hook IDs
  const addedHookIds = useMemo(() => hooks.map(h => h.hookId), [hooks]);

  // Count enabled hooks
  const enabledCount = useMemo(
    () => hooks.filter(h => h.enabled).length,
    [hooks]
  );

  return (
    <Collapsible
      open={localExpanded}
      onOpenChange={handleExpandedChange}
      className="border-b border-border bg-primary/5 hidden"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-between w-full px-6 py-3 text-left hover-subtle-row transition-colors"
        >
          <div className="flex items-center gap-2">
            <Icons.Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Hooks</span>
            {hooks.length > 0 && (
              <Badge variant="default" className="text-xs">
                {enabledCount}/{hooks.length} active
              </Badge>
            )}
          </div>
          <Icons.ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              localExpanded && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-6 pb-6 pt-2 space-y-4">
          {/* Add Hook Button */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Hooks run automatically during document operations. Drag to
              reorder.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setIsSelectorOpen(true)}
            >
              <Icons.Plus className="h-3 w-3 mr-1" />
              Add Hook
            </Button>
          </div>

          {/* Hooks List */}
          {hooks.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={hooks.map(hook => hook.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {hooks.map(hook => (
                    <SortableHookCard
                      key={hook.id}
                      hook={hook}
                      isExpanded={expandedHookIds.has(hook.id)}
                      onToggleExpand={() => toggleHookExpand(hook.id)}
                      onUpdate={handleUpdateHook}
                      onDelete={handleDeleteHook}
                      onConfigChange={handleConfigChange}
                      fieldNames={fieldNames}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 rounded-none border border-dashed border-border">
              <Icons.Zap className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium text-foreground mb-1">
                No hooks configured
              </p>
              <p className="text-xs text-muted-foreground text-center mb-3">
                Add hooks to run custom logic during operations
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setIsSelectorOpen(true)}
              >
                <Icons.Plus className="h-3 w-3 mr-1" />
                Add first hook
              </Button>
            </div>
          )}

          {/* Info Note */}
          <div className="flex items-start gap-2 p-3 rounded-none bg-primary/5">
            <Icons.Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              <strong>Note:</strong> For advanced hooks with custom logic, use
              the code-first approach in your collection configuration file.
            </p>
          </div>
        </div>
      </CollapsibleContent>

      {/* Hook Selector Modal */}
      <HookSelectorModal
        open={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        onSelect={handleAddHook}
        addedHookIds={addedHookIds}
      />
    </Collapsible>
  );
}
