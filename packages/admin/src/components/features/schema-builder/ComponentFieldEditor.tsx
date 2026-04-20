/**
 * ComponentFieldEditor Component
 *
 * Editor for configuring component field settings.
 * Features:
 * - Mode toggle (Single component vs Multi-component/Dynamic Zone)
 * - Component selector (dropdown for single, multi-select for multi)
 * - Repeatable toggle (array of instances)
 * - Min/max rows configuration (when repeatable)
 * - initCollapsed toggle (start instances collapsed)
 * - isSortable toggle (allow drag-to-reorder)
 *
 * @module components/features/schema-builder/ComponentFieldEditor
 */

import {
  Badge,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@revnixhq/ui";
import { useCallback, useMemo, useRef } from "react";

import * as Icons from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useComponents } from "@admin/hooks/queries";

import type { ComponentFieldEditorProps, ComponentFieldMode } from "./types";

// ============================================================
// ComponentFieldEditor Component
// ============================================================

export function ComponentFieldEditor({
  component,
  onComponentChange,
  components,
  onComponentsChange,
  repeatable,
  onRepeatableChange,
  minRows,
  onMinRowsChange,
  maxRows,
  onMaxRowsChange,
  initCollapsed,
  onInitCollapsedChange,
  isSortable,
  onIsSortableChange,
}: ComponentFieldEditorProps) {
  const multiSelectionCacheRef = useRef<string[] | undefined>(undefined);

  // Fetch available components
  const { data: componentsData, isLoading } = useComponents({
    pagination: { page: 0, pageSize: 100 },
    sorting: [{ field: "label", direction: "asc" }],
    filters: {},
  });

  const availableComponents = componentsData?.data || [];

  // Determine current mode based on props
  const currentMode: ComponentFieldMode = useMemo(() => {
    if (Array.isArray(components)) return "multi";
    return "single";
  }, [components]);

  // Handle mode change
  const handleModeChange = useCallback(
    (newMode: ComponentFieldMode) => {
      if (newMode === "single") {
        // Cache multi selection so it can be restored if user switches back.
        const selectedComponents =
          components && components.length > 0
            ? components
            : multiSelectionCacheRef.current;

        if (selectedComponents && selectedComponents.length > 0) {
          multiSelectionCacheRef.current = [...selectedComponents];
        }

        // Switch to single mode: keep the first selected component.
        const firstComponent = selectedComponents?.[0] || component;
        onComponentsChange(undefined);
        onComponentChange(firstComponent);
      } else {
        // Switch to multi mode: restore previous selection when available.
        let initialComponents =
          multiSelectionCacheRef.current &&
          multiSelectionCacheRef.current.length > 0
            ? [...multiSelectionCacheRef.current]
            : component
              ? [component]
              : [];

        // Keep currently selected single component in the restored list.
        if (component && !initialComponents.includes(component)) {
          initialComponents = [component, ...initialComponents];
        }

        onComponentChange(undefined);
        onComponentsChange(initialComponents);
      }
    },
    [component, components, onComponentChange, onComponentsChange]
  );

  // Handle single component selection
  const handleSingleComponentChange = useCallback(
    (value: string) => {
      if (value === "__none__") {
        onComponentChange(undefined);
      } else {
        onComponentChange(value);
      }
    },
    [onComponentChange]
  );

  // Handle multi-component toggle
  const handleMultiComponentToggle = useCallback(
    (slug: string, checked: boolean) => {
      const current = components || [];
      if (checked) {
        // Add component
        if (!current.includes(slug)) {
          const updated = [...current, slug];
          multiSelectionCacheRef.current = updated;
          onComponentsChange(updated);
        }
      } else {
        // Remove component
        const filtered = current.filter(c => c !== slug);
        multiSelectionCacheRef.current =
          filtered.length > 0 ? filtered : undefined;
        onComponentsChange(filtered);
      }
    },
    [components, onComponentsChange]
  );

  // Handle min rows change
  const handleMinRowsChange = useCallback(
    (value: string) => {
      const num = value ? parseInt(value, 10) : undefined;
      onMinRowsChange(num && !isNaN(num) && num >= 0 ? num : undefined);
    },
    [onMinRowsChange]
  );

  // Handle max rows change
  const handleMaxRowsChange = useCallback(
    (value: string) => {
      const num = value ? parseInt(value, 10) : undefined;
      onMaxRowsChange(num && !isNaN(num) && num > 0 ? num : undefined);
    },
    [onMaxRowsChange]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Icons.Puzzle className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs font-medium">Component Configuration</Label>
        </div>
        <div className="flex items-center justify-center p-6">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading components...
          </span>
        </div>
      </div>
    );
  }

  // Empty state - no components defined
  if (availableComponents.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Icons.Puzzle className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs font-medium">Component Configuration</Label>
        </div>
        <div className="flex flex-col items-center gap-3 p-6 rounded-md border border-amber-500/20 bg-amber-500/10">
          <Icons.AlertTriangle className="h-8 w-8 text-amber-500" />
          <div className="text-center">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              No Components Available
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create a component first to use component fields.
            </p>
          </div>
          <Link
            href={ROUTES.COMPONENTS_BUILDER}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            <Icons.Plus className="h-4 w-4" />
            Create Component
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Icons.Puzzle className="h-4 w-4 text-muted-foreground" />
        <Label className="text-xs font-medium">Component Configuration</Label>
      </div>

      {/* Mode Toggle */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">
          Field Mode
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleModeChange("single")}
            className={`
              flex items-center gap-3 p-4 rounded-md border transition-all duration-200 cursor-pointer
              ${
                currentMode === "single"
                  ? "border-primary text-primary bg-primary/5"
                  : "border-border bg-background hover-subtle-row hover:border-muted-foreground/30 text-muted-foreground"
              }
            `}
          >
            <Icons.Puzzle
              className={`h-6 w-6 shrink-0 ${currentMode === "single" ? "text-primary" : ""}`}
            />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-sm font-semibold">Single</span>
              <span
                className={`text-xs ${currentMode === "single" ? "text-primary/70" : "text-muted-foreground"}`}
              >
                One type
              </span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("multi")}
            className={`
              flex items-center gap-3 p-4 rounded-md border transition-all duration-200 cursor-pointer
              ${
                currentMode === "multi"
                  ? "border-primary text-primary bg-primary/5"
                  : "border-border bg-background hover-subtle-row hover:border-muted-foreground/30 text-muted-foreground"
              }
            `}
          >
            <Icons.LayoutGrid
              className={`h-6 w-6 shrink-0 ${currentMode === "multi" ? "text-primary" : ""}`}
            />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-sm font-semibold">Dynamic Zone</span>
              <span
                className={`text-xs ${currentMode === "multi" ? "text-primary/70" : "text-muted-foreground"}`}
              >
                Multiple types
              </span>
            </div>
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {currentMode === "single"
            ? "Embed one specific component type"
            : "Allow editors to choose from multiple component types"}
        </p>
      </div>

      {/* Component Selection */}
      <div className="space-y-2 pt-2 border-t border-border">
        <Label className="text-xs font-medium">
          {currentMode === "single" ? "Component" : "Available Components"}
        </Label>

        {currentMode === "single" ? (
          // Single component selector
          <Select
            value={component || "__none__"}
            onValueChange={handleSingleComponentChange}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select a component" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                <span className="text-muted-foreground">
                  No component selected
                </span>
              </SelectItem>
              {availableComponents.map(comp => (
                <SelectItem key={comp.slug} value={comp.slug}>
                  <div className="flex items-center gap-2">
                    <Icons.Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{comp.label || comp.slug}</span>
                    {comp.admin?.category && (
                      <Badge variant="outline" className="text-[10px] ml-1">
                        {comp.admin.category}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // Multi-component selector (checkboxes)
          <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border border-border p-2">
            {availableComponents.map(comp => {
              const isSelected = components?.includes(comp.slug) || false;
              return (
                <label
                  key={comp.slug}
                  className={`
                    flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors
                    ${isSelected ? "bg-primary/5" : "hover:bg-accent"}
                  `}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={checked =>
                      handleMultiComponentToggle(comp.slug, checked === true)
                    }
                  />
                  <Icons.Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm flex-1">
                    {comp.label || comp.slug}
                  </span>
                  {comp.admin?.category && (
                    <Badge variant="outline" className="text-[10px]">
                      {comp.admin.category}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {currentMode === "multi" && (
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs">
              {components?.length || 0} selected
            </Badge>
            {(!components || components.length === 0) && (
              <span className="text-xs text-amber-500">
                Select at least one component
              </span>
            )}
          </div>
        )}
      </div>

      {/* Repeatable Toggle */}
      <div className="space-y-3 pt-2 border-t border-border">
        <Label className="text-xs font-medium text-muted-foreground">
          Instance Options
        </Label>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Repeatable</Label>
            <p className="text-xs text-muted-foreground">
              Allow multiple instances
            </p>
          </div>
          <Switch
            checked={repeatable || false}
            onCheckedChange={onRepeatableChange}
          />
        </div>

        {/* Min/Max Rows (when repeatable) */}
        {repeatable && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="min-rows" className="text-xs font-medium">
                Min Instances
              </Label>
              <Input
                id="min-rows"
                type="number"
                min={0}
                value={minRows ?? ""}
                onChange={e => handleMinRowsChange(e.target.value)}
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-rows" className="text-xs font-medium">
                Max Instances
              </Label>
              <Input
                id="max-rows"
                type="number"
                min={1}
                value={maxRows ?? ""}
                onChange={e => handleMaxRowsChange(e.target.value)}
                placeholder="No limit"
                className="h-8 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Admin Options */}
      <div className="space-y-3 pt-2 border-t border-border">
        <Label className="text-xs font-medium text-muted-foreground">
          Admin Options
        </Label>

        {/* Init Collapsed Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Collapsed by Default</Label>
            <p className="text-xs text-muted-foreground">
              Start with instances collapsed
            </p>
          </div>
          <Switch
            checked={initCollapsed || false}
            onCheckedChange={onInitCollapsedChange}
          />
        </div>

        {/* Is Sortable Toggle (when repeatable) */}
        {repeatable && (
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Allow Reordering</Label>
              <p className="text-xs text-muted-foreground">
                Drag to reorder instances
              </p>
            </div>
            <Switch
              checked={isSortable !== false}
              onCheckedChange={onIsSortableChange}
            />
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/30">
        <Icons.Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          <strong>Tip:</strong> Components are reusable field groups. Each
          instance stores its own data in a separate table.
        </p>
      </div>
    </div>
  );
}
