"use client";

/**
 * Query Builder Component
 *
 * Visual query parameter builder for API requests.
 * Supports common query parameters and where clause conditions.
 *
 * @module components/entries/APIPlayground/QueryBuilder
 * @since 1.0.0
 */

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@revnixhq/ui";
import { useState, useCallback } from "react";

import { Plus, X, HelpCircle } from "@admin/components/icons";

import type { QueryParams } from "./APIPlayground";

// ============================================================================
// Types
// ============================================================================

export interface QueryBuilderProps {
  /** Current query parameters */
  params: QueryParams;
  /** Callback when parameters change */
  onChange: (params: QueryParams) => void;
  /** Collection slug for context */
  collectionSlug?: string;
  /** Is this query builder for a single? If true, some parameters are hidden. */
  isSingle?: boolean;
}

interface WhereCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Common query parameters with descriptions
 */
const COMMON_PARAMS = [
  {
    key: "depth" as const,
    label: "Depth",
    description: "Relationship population depth (0-10)",
    placeholder: "0",
  },
  {
    key: "limit" as const,
    label: "Limit",
    description: "Max entries to return",
    placeholder: "10",
  },
  {
    key: "page" as const,
    label: "Page",
    description: "Page number (1-indexed)",
    placeholder: "1",
  },
  {
    key: "sort" as const,
    label: "Sort",
    description: "Sort field (prefix with - for desc)",
    placeholder: "-createdAt",
  },
  {
    key: "search" as const,
    label: "Search",
    description: "Full-text search query",
    placeholder: "search term",
  },
  {
    key: "select" as const,
    label: "Select",
    description: "Fields to include (JSON object)",
    placeholder: '{"title":true,"slug":true}',
  },
] as const;

/**
 * Available where clause operators
 */
const OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "greater_than", label: ">" },
  { value: "greater_than_equal", label: ">=" },
  { value: "less_than", label: "<" },
  { value: "less_than_equal", label: "<=" },
  { value: "like", label: "like" },
  { value: "contains", label: "contains" },
  { value: "in", label: "in (comma-separated)" },
  { value: "not_in", label: "not in" },
  { value: "exists", label: "exists" },
] as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique ID for where conditions
 */
const generateId = () => Math.random().toString(36).substring(2, 9);

/**
 * Build where clause JSON from conditions
 */
const buildWhereClause = (conditions: WhereCondition[]): string => {
  const where: Record<string, Record<string, unknown>> = {};

  conditions.forEach(condition => {
    if (condition.field && condition.value) {
      let value: unknown = condition.value;

      // Handle special operators
      if (condition.operator === "in" || condition.operator === "not_in") {
        // Split comma-separated values
        value = condition.value.split(",").map(v => v.trim());
      } else if (condition.operator === "exists") {
        value = condition.value.toLowerCase() === "true";
      }

      where[condition.field] = {
        [condition.operator]: value,
      };
    }
  });

  return Object.keys(where).length > 0 ? JSON.stringify(where) : "";
};

// ============================================================================
// Component
// ============================================================================

/**
 * QueryBuilder - Visual query parameter builder
 *
 * Provides an intuitive interface for building API query parameters:
 * - Common parameters (depth, limit, page, sort, search, select)
 * - Where clause builder with multiple conditions
 *
 * @example
 * ```tsx
 * <QueryBuilder
 *   params={queryParams}
 *   onChange={setQueryParams}
 *   collectionSlug="posts"
 * />
 * ```
 */
export function QueryBuilder({
  params,
  onChange,
  isSingle = false,
}: QueryBuilderProps) {
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([]);

  /**
   * Update a common parameter
   */
  const updateParam = useCallback(
    (key: keyof QueryParams, value: string) => {
      const newParams = { ...params };
      if (value) {
        newParams[key] = value;
      } else {
        delete newParams[key];
      }
      onChange(newParams);
    },
    [params, onChange]
  );

  /**
   * Add a new where condition
   */
  const addWhereCondition = useCallback(() => {
    const newCondition: WhereCondition = {
      id: generateId(),
      field: "",
      operator: "equals",
      value: "",
    };
    setWhereConditions(prev => [...prev, newCondition]);
  }, []);

  /**
   * Update a where condition
   */
  const updateWhereCondition = useCallback(
    (id: string, updates: Partial<WhereCondition>) => {
      setWhereConditions(prev => {
        const newConditions = prev.map(c =>
          c.id === id ? { ...c, ...updates } : c
        );

        // Rebuild where clause and update params
        const whereJson = buildWhereClause(newConditions);
        const newParams = { ...params };
        if (whereJson) {
          newParams.where = whereJson;
        } else {
          delete newParams.where;
        }
        onChange(newParams);

        return newConditions;
      });
    },
    [params, onChange]
  );

  /**
   * Remove a where condition
   */
  const removeWhereCondition = useCallback(
    (id: string) => {
      setWhereConditions(prev => {
        const newConditions = prev.filter(c => c.id !== id);

        // Rebuild where clause and update params
        const whereJson = buildWhereClause(newConditions);
        const newParams = { ...params };
        if (whereJson) {
          newParams.where = whereJson;
        } else {
          delete newParams.where;
        }
        onChange(newParams);

        return newConditions;
      });
    },
    [params, onChange]
  );

  return (
    <div className="space-y-6">
      {/* Common Parameters */}
      <div className="space-y-4">
        <Label className="text-fluid-xs uppercase font-bold tracking-widest text-muted-foreground/80 ml-1">
          Common Parameters
        </Label>
        <div className="grid grid-cols-2 gap-4">
          {COMMON_PARAMS.filter(p =>
            isSingle ? ["depth", "select"].includes(p.key) : true
          ).map(({ key, label, description, placeholder }) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-1.5 ml-1">
                <Label
                  htmlFor={`param-${key}`}
                  className="text-fluid-2xs uppercase font-bold tracking-widest text-muted-foreground/60"
                >
                  {label}
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help hover:text-muted-foreground transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-xs rounded-none border-border bg-popover text-popover-foreground shadow-none"
                    >
                      <p className="text-[10px] font-medium leading-relaxed">
                        {description}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id={`param-${key}`}
                value={params[key] || ""}
                onChange={e => updateParam(key, e.target.value)}
                placeholder={placeholder}
                className="h-9 text-xs font-mono rounded-none border-border bg-background focus-visible:ring-0 focus-visible:border-foreground transition-colors placeholder:text-muted-foreground/30"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Where Conditions */}
      {!isSingle && (
        <div className="space-y-4 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <Label className="text-fluid-xs uppercase font-bold tracking-widest text-muted-foreground/80 ml-1">
              Where Conditions
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={addWhereCondition}
              className="gap-1.5 h-7 text-[10px] uppercase font-bold tracking-tighter rounded-none border-border hover-unified transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add Filter
            </Button>
          </div>

          {whereConditions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 border border-dashed border-border/60 bg-muted/20">
              <p className="text-[10px] text-muted-foreground/60 uppercase font-bold tracking-widest">
                No active filters
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {whereConditions.map(condition => (
                <div
                  key={condition.id}
                  className="flex items-center gap-3 p-3 bg-muted/30 border border-border/40 rounded-none group transition-colors hover-unified"
                >
                  {/* Field name */}
                  <Input
                    value={condition.field}
                    onChange={e =>
                      updateWhereCondition(condition.id, {
                        field: e.target.value,
                      })
                    }
                    placeholder="field"
                    className="h-9 w-28 text-xs font-mono rounded-none border-border bg-background focus-visible:ring-0 focus-visible:border-foreground"
                  />

                  {/* Operator */}
                  <Select
                    value={condition.operator}
                    onValueChange={v =>
                      updateWhereCondition(condition.id, { operator: v })
                    }
                  >
                    <SelectTrigger className="h-9 w-32 text-[10px] uppercase font-bold tracking-tighter rounded-none border-border bg-background focus:ring-0 focus:border-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-border">
                      {OPERATORS.map(op => (
                        <SelectItem
                          key={op.value}
                          value={op.value}
                          className="text-[10px] font-medium rounded-none"
                        >
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Value */}
                  <Input
                    value={condition.value}
                    onChange={e =>
                      updateWhereCondition(condition.id, {
                        value: e.target.value,
                      })
                    }
                    placeholder="value"
                    className="h-9 flex-1 text-xs font-mono rounded-none border-border bg-background focus-visible:ring-0 focus-visible:border-foreground"
                  />

                  {/* Remove button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeWhereCondition(condition.id)}
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive transition-colors rounded-none"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Where JSON Preview */}
          {params.where && (
            <div className="space-y-2">
              <Label className="text-fluid-xs uppercase font-bold tracking-widest text-muted-foreground/60 ml-1">
                Generated Where Clause
              </Label>
              <code className="block text-[10px] bg-muted/20 p-3 border border-border/40 rounded-none font-mono break-all text-muted-foreground">
                {params.where}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
