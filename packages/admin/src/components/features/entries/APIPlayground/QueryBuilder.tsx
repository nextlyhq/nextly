"use client";

/**
 * The query parameters, built from the collection's own schema.
 *
 * Every control here names something the collection actually has. The
 * playground loads the schema anyway, so a free-text box asking you to
 * remember whether the field is `publishedAt` or `published_at` is a question
 * the page could have answered itself.
 *
 * Each field carries its explanation underneath rather than behind a hover:
 * on a page whose job is to teach an API, the description is the content, and
 * a tooltip is the one place a reader will not look for it.
 *
 * @module components/entries/APIPlayground/QueryBuilder
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
} from "@nextlyhq/ui";
import { useCallback } from "react";

import { ArrowDown, ArrowUp, Plus, X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { QueryParams } from "./APIPlayground";
import type { PlaygroundField, WhereCondition } from "./query-fields";
import {
  ALWAYS_RETURNED,
  fieldLabel,
  formatSelect,
  formatSort,
  LIST_OPERATORS,
  parseSelect,
  parseSort,
  selectableFields,
  sortableFields,
} from "./query-fields";

// ============================================================================
// Types
// ============================================================================

export interface QueryBuilderProps {
  /** Current query parameters */
  params: QueryParams;
  /** Callback when parameters change */
  onChange: (params: QueryParams) => void;
  /**
   * The where rows.
   *
   * Held by the parent because they are part of the request the parent sends,
   * and because a Reset has to clear them along with everything else. Kept as
   * rows rather than as the `where` string: a half-written row has no
   * representation in the wire format.
   */
  conditions: WhereCondition[];
  onConditionsChange: (conditions: WhereCondition[]) => void;
  /** The collection's fields, so every picker offers what exists. */
  fields?: PlaygroundField[];
  /** Whether Draft/Published is enabled, which makes `status` a real column. */
  hasStatus?: boolean;
  /** Is this query builder for a single? If true, some parameters are hidden. */
  isSingle?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Where clause operators.
 *
 * Kept in step with the server's own map in `query-operators.ts`. `search` is
 * left out because it is an alias of `contains`, and the geo operators because
 * they need a shape this row cannot express.
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
  { value: "not_in", label: "not in (comma-separated)" },
  { value: "exists", label: "exists" },
] as const;

/**
 * Radix reserves the empty string, so "no choice" needs a value of its own.
 */
const NO_SORT = "__none__";

/** The server clamps a limit into this range; the input says so up front. */
const LIMIT_MAX = 500;
/** Relationship population is bounded server-side at 10. */
const DEPTH_MAX = 10;

// ============================================================================
// Helpers
// ============================================================================

const generateId = () => Math.random().toString(36).substring(2, 9);

// ============================================================================
// Field shell
// ============================================================================

/**
 * A labelled control with its explanation under it.
 *
 * `aria-describedby` rather than a plain paragraph: the hint is the part that
 * makes the control usable, so it should reach a screen reader with the field
 * and not as loose text nearby.
 */
function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      {children}
      <p
        id={`${id}-hint`}
        className="text-xs leading-relaxed text-muted-foreground"
      >
        {hint}
      </p>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export function QueryBuilder({
  params,
  onChange,
  conditions,
  onConditionsChange,
  fields = [],
  hasStatus = false,
  isSingle = false,
}: QueryBuilderProps) {
  const sort = parseSort(params.sort);
  const selected = parseSelect(params.select);

  const sortable = sortableFields(fields, hasStatus);
  const selectable = selectableFields(fields);

  /**
   * Set or clear one parameter.
   *
   * An empty value drops the key instead of sending `limit=`, which is not the
   * same request and would show up in the URL and every generated snippet.
   */
  const updateParam = useCallback(
    (key: keyof QueryParams, value: string) => {
      const next = { ...params };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      onChange(next);
    },
    [params, onChange]
  );

  const addCondition = useCallback(() => {
    onConditionsChange([
      ...conditions,
      {
        id: generateId(),
        // Pre-filled with the first available field: the picker has to land
        // somewhere, and an unset one cannot be sent.
        field: sortable[0] ?? "",
        operator: "equals",
        value: "",
      },
    ]);
  }, [onConditionsChange, conditions, sortable]);

  const updateCondition = useCallback(
    (id: string, updates: Partial<WhereCondition>) => {
      onConditionsChange(
        conditions.map(c => (c.id === id ? { ...c, ...updates } : c))
      );
    },
    [onConditionsChange, conditions]
  );

  const removeCondition = useCallback(
    (id: string) => {
      onConditionsChange(conditions.filter(c => c.id !== id));
    },
    [onConditionsChange, conditions]
  );

  const toggleSelected = useCallback(
    (name: string) => {
      const next = selected.includes(name)
        ? selected.filter(n => n !== name)
        : [...selected, name];
      updateParam("select", formatSelect(next));
    },
    [selected, updateParam]
  );

  return (
    <div className="space-y-6">
      {/* ── Query parameters ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <Label className="text-sm font-medium text-foreground">
          Query parameters
        </Label>

        {/* Depth stands alone for a single: there is one document, so paging,
            ordering and searching have nothing to act on. */}
        <div
          className={cn("grid gap-4", isSingle ? "grid-cols-1" : "grid-cols-3")}
        >
          <Field
            id="param-depth"
            label="Depth"
            hint="How many levels of related entries to embed. 0 returns their IDs only."
          >
            <Input
              id="param-depth"
              aria-describedby="param-depth-hint"
              type="number"
              min={0}
              max={DEPTH_MAX}
              value={params.depth ?? ""}
              onChange={e => updateParam("depth", e.target.value)}
              placeholder="0"
              className="font-mono text-xs"
            />
          </Field>

          {!isSingle && (
            <>
              <Field
                id="param-limit"
                label="Limit"
                hint={`Entries per page. Capped at ${LIMIT_MAX}.`}
              >
                <Input
                  id="param-limit"
                  aria-describedby="param-limit-hint"
                  type="number"
                  min={1}
                  max={LIMIT_MAX}
                  value={params.limit ?? ""}
                  onChange={e => updateParam("limit", e.target.value)}
                  placeholder="10"
                  className="font-mono text-xs"
                />
              </Field>

              <Field
                id="param-page"
                label="Page"
                hint="Which page to return. The first page is 1."
              >
                <Input
                  id="param-page"
                  aria-describedby="param-page-hint"
                  type="number"
                  min={1}
                  value={params.page ?? ""}
                  onChange={e => updateParam("page", e.target.value)}
                  placeholder="1"
                  className="font-mono text-xs"
                />
              </Field>
            </>
          )}
        </div>

        {!isSingle && (
          <>
            <Field
              id="param-sort"
              label="Sort"
              hint="Order the results by one field. Structured fields are left out — there is no meaningful order for them."
            >
              <div className="flex gap-2">
                <Select
                  value={sort?.field ?? NO_SORT}
                  onValueChange={v =>
                    updateParam(
                      "sort",
                      v === NO_SORT
                        ? ""
                        : formatSort({
                            field: v,
                            descending: sort?.descending ?? false,
                          })
                    )
                  }
                >
                  <SelectTrigger
                    id="param-sort"
                    aria-describedby="param-sort-hint"
                    className="flex-1"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SORT}>Default order</SelectItem>
                    {sortable.map(name => (
                      <SelectItem key={name} value={name}>
                        <span className="font-mono text-xs">{name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Only meaningful once a field is chosen, and the `-` prefix
                    it stands for is not something to have to remember. */}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!sort?.field}
                  aria-label={
                    sort?.descending
                      ? "Sorting descending. Switch to ascending."
                      : "Sorting ascending. Switch to descending."
                  }
                  title={sort?.descending ? "Descending" : "Ascending"}
                  onClick={() =>
                    sort?.field &&
                    updateParam(
                      "sort",
                      formatSort({
                        field: sort.field,
                        descending: !sort.descending,
                      })
                    )
                  }
                  className="shrink-0"
                >
                  {sort?.descending ? (
                    <ArrowDown className="h-4 w-4" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </Field>

            <Field
              id="param-search"
              label="Search"
              hint="Matches the fields the collection marks as searchable."
            >
              <Input
                id="param-search"
                aria-describedby="param-search-hint"
                value={params.search ?? ""}
                onChange={e => updateParam("search", e.target.value)}
                placeholder="search term"
                className="text-xs"
              />
            </Field>
          </>
        )}

        {/* ── select ──────────────────────────────────────────────────── */}
        {selectable.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm font-medium text-foreground">
                Fields to return
              </Label>
              {selected.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updateParam("select", "")}
                  className="h-6 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {selectable.map(name => {
                const on = selected.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSelected(name)}
                    title={fieldLabel(name, fields)}
                    className={cn(
                      "cursor-pointer border px-2 py-1 font-mono text-[11px] transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {selected.length === 0
                ? "Nothing selected returns every field."
                : `${ALWAYS_RETURNED.join(", ")} are always returned as well.`}
            </p>
          </div>
        )}
      </div>

      {/* ── where ────────────────────────────────────────────────────── */}
      {!isSingle && (
        <div className="space-y-3 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-foreground">Where</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={addCondition}
              className="gap-2"
            >
              <Plus className="h-3.5 w-3.5" />
              Add condition
            </Button>
          </div>
          {/* One name for one thing: the section, the button, the empty state
              and the generated snippet all say `where`, which is also what the
              API calls it. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Conditions an entry must match. Sent as the{" "}
            <code className="font-mono">where</code> parameter.
          </p>

          {conditions.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-none border border-dashed border-border bg-muted/30 py-8">
              <p className="text-xs text-muted-foreground">
                No conditions. Every entry is returned.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {conditions.map(condition => (
                <div
                  key={condition.id}
                  className="flex items-center gap-2 rounded-none border border-border bg-muted/30 p-3"
                >
                  <Select
                    value={condition.field}
                    onValueChange={v =>
                      updateCondition(condition.id, { field: v })
                    }
                  >
                    <SelectTrigger className="w-32" aria-label="Field">
                      <SelectValue placeholder="field" />
                    </SelectTrigger>
                    <SelectContent>
                      {sortable.map(name => (
                        <SelectItem key={name} value={name}>
                          <span className="font-mono text-xs">{name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={condition.operator}
                    onValueChange={v =>
                      updateCondition(condition.id, { operator: v })
                    }
                  >
                    <SelectTrigger className="w-40" aria-label="Operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map(op => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* `exists` asks whether the column is set, so its value is
                      the question itself rather than something to type. */}
                  {condition.operator === "exists" ? (
                    <Select
                      value={
                        condition.value.toLowerCase() === "false"
                          ? "false"
                          : "true"
                      }
                      onValueChange={v =>
                        updateCondition(condition.id, { value: v })
                      }
                    >
                      <SelectTrigger className="flex-1" aria-label="Value">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">is set</SelectItem>
                        <SelectItem value="false">is not set</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={condition.value}
                      onChange={e =>
                        updateCondition(condition.id, { value: e.target.value })
                      }
                      placeholder={
                        LIST_OPERATORS.has(condition.operator)
                          ? "a, b, c"
                          : "value"
                      }
                      aria-label="Value"
                      className="flex-1 font-mono text-xs"
                    />
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCondition(condition.id)}
                    aria-label="Remove condition"
                    className="h-9 w-9 shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {params.where && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">
                Generated where clause
              </Label>
              <code className="block break-all rounded-none border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
                {params.where}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
