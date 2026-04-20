/**
 * HookSelectorModal Component
 *
 * Modal dialog for selecting a pre-built hook to add to a collection.
 * Hooks are grouped by category with search filtering.
 *
 * @module components/features/schema-builder/HooksEditor/HookSelectorModal
 */

import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@revnixhq/ui";
import { useState, useCallback, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { HookSelectorModalProps } from "../types";

import {
  type PrebuiltHookCategory,
  prebuiltHooks,
  HOOK_CATEGORIES,
  HOOK_TYPE_LABELS,
} from "./utils/prebuiltHooks";

/**
 * Modal for selecting a hook to add
 */
export function HookSelectorModal({
  open,
  onOpenChange,
  onSelect,
  addedHookIds,
}: HookSelectorModalProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Group hooks by category
  const hooksByCategory = useMemo(() => {
    const grouped: Record<PrebuiltHookCategory, typeof prebuiltHooks> = {
      "data-transform": [],
      validation: [],
      notification: [],
      audit: [],
    };

    for (const hook of prebuiltHooks) {
      if (grouped[hook.category]) {
        grouped[hook.category].push(hook);
      }
    }

    return grouped;
  }, []);

  // Filter hooks by search
  const filteredHooksByCategory = useMemo(() => {
    if (!searchQuery) return hooksByCategory;

    const lowerSearch = searchQuery.toLowerCase();
    const filtered: Record<PrebuiltHookCategory, typeof prebuiltHooks> = {
      "data-transform": [],
      validation: [],
      notification: [],
      audit: [],
    };

    for (const [category, hooks] of Object.entries(hooksByCategory)) {
      filtered[category as PrebuiltHookCategory] = hooks.filter(
        hook =>
          hook.name.toLowerCase().includes(lowerSearch) ||
          hook.description.toLowerCase().includes(lowerSearch)
      );
    }

    return filtered;
  }, [hooksByCategory, searchQuery]);

  const handleSelect = useCallback(
    (hookId: string) => {
      onSelect(hookId);
      onOpenChange(false);
      setSearchQuery("");
    },
    [onSelect, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Hook</DialogTitle>
          <DialogDescription>
            Select a pre-built hook to add to this collection. Hooks run
            automatically during document operations.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search hooks..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>

        {/* Hook List by Category */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {(
            Object.entries(HOOK_CATEGORIES) as [
              PrebuiltHookCategory,
              (typeof HOOK_CATEGORIES)[PrebuiltHookCategory],
            ][]
          ).map(([category, categoryInfo]) => {
            const hooks = filteredHooksByCategory[category];
            if (hooks.length === 0) return null;

            const IconComponent = Icons[categoryInfo.icon] || Icons.Zap;

            return (
              <div key={category}>
                {/* Category Header */}
                <div className="flex items-center gap-2 mb-2">
                  <IconComponent className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {categoryInfo.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({hooks.length})
                  </span>
                </div>

                {/* Hooks in Category */}
                <div className="space-y-1">
                  {hooks.map(hook => {
                    const isAdded = addedHookIds.includes(hook.id);

                    return (
                      <button
                        key={hook.id}
                        type="button"
                        onClick={() => !isAdded && handleSelect(hook.id)}
                        disabled={isAdded}
                        className={cn(
                          "w-full text-left p-3 rounded-md border transition-colors",
                          isAdded
                            ? "bg-muted/30 border-border cursor-not-allowed opacity-60"
                            : "bg-background border-border hover:border-primary hover:bg-accent"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {hook.name}
                              </span>
                              {isAdded && (
                                <Badge
                                  variant="default"
                                  className="text-[10px]"
                                >
                                  Added
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {hook.description}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] shrink-0"
                          >
                            {HOOK_TYPE_LABELS[hook.hookType] || hook.hookType}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Empty State */}
          {Object.values(filteredHooksByCategory).every(
            hooks => hooks.length === 0
          ) && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Icons.Search className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">No hooks found</p>
              <p className="text-xs text-muted-foreground">
                Try a different search term
              </p>
            </div>
          )}
        </div>

        {/* Footer Note */}
        <div className="flex items-start gap-2 pt-3 border-t border-border">
          <Icons.Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            For advanced hooks with custom logic, use the code-first approach in
            your collection configuration file.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
