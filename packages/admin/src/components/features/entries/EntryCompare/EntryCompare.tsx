"use client";

/**
 * Entry Compare Component
 *
 * Side-by-side comparison view for two entries from the same collection.
 * Allows users to select entries and view field-level differences with
 * color-coded highlighting.
 *
 * @module components/entries/EntryCompare/EntryCompare
 * @since 1.0.0
 */

import {
  Badge,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@revnixhq/ui";
import { useState, useMemo } from "react";

import { ArrowLeftRight } from "@admin/components/icons";
import { useCollection } from "@admin/hooks/queries";
import { useEntries } from "@admin/hooks/queries/useEntries";
import { useEntry } from "@admin/hooks/queries/useEntry";
import type { Entry } from "@admin/types/collection";

import { FieldDiff, type FieldForDiff } from "./FieldDiff";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryCompare component.
 */
export interface EntryCompareProps {
  /** Collection slug to compare entries from */
  collectionSlug: string;
  /** Optional initial left entry ID */
  initialLeftId?: string;
  /** Optional initial right entry ID */
  initialRightId?: string;
}

/**
 * System fields that can be hidden via toggle.
 */
const SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extracts a display label from an entry for the selector dropdown.
 *
 * @param entry - The entry to extract a label from
 * @returns Display label string
 */
function getEntryLabel(entry: Entry): string {
  const record = entry as Record<string, unknown>;

  // Try common title fields
  if (typeof record.title === "string" && record.title) return record.title;
  if (typeof record.name === "string" && record.name) return record.name;
  if (typeof record.label === "string" && record.label) return record.label;
  if (typeof record.subject === "string" && record.subject)
    return record.subject;
  if (typeof record.email === "string" && record.email) return record.email;

  // Fallback to ID
  return entry.id;
}

/**
 * Extracts field definitions from collection schema, including system fields.
 *
 * @param schemaFields - Fields from collection schema
 * @returns Array of field definitions for comparison
 */
function getFieldsForComparison(
  schemaFields: Array<{ name?: string; label?: string; type?: string }>
): FieldForDiff[] {
  const fields: FieldForDiff[] = [];

  // Add system fields first
  fields.push({ name: "id", label: "ID", type: "text" });

  // Add user-defined fields (only those with names - skip layout fields)
  for (const field of schemaFields) {
    if (field.name && !SYSTEM_FIELDS.has(field.name)) {
      fields.push({
        name: field.name,
        label: field.label || field.name,
        type: field.type,
      });
    }
  }

  // Add timestamp fields at the end
  fields.push({ name: "createdAt", label: "Created At", type: "date" });
  fields.push({ name: "updatedAt", label: "Updated At", type: "date" });

  return fields;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryCompare - Side-by-side entry comparison view
 *
 * Features:
 * - Two dropdowns to select entries for comparison
 * - Difference count badge summary
 * - Toggle to show/hide system fields
 * - Grid layout with color-coded field cards
 * - Supports all field types via JSON comparison
 *
 * @param props - Component props
 * @returns Entry comparison UI
 *
 * @example
 * ```tsx
 * <EntryCompare
 *   collectionSlug="posts"
 *   initialLeftId="abc123"
 *   initialRightId="def456"
 * />
 * ```
 */
export function EntryCompare({
  collectionSlug,
  initialLeftId,
  initialRightId,
}: EntryCompareProps) {
  // State for selected entry IDs
  const [leftId, setLeftId] = useState<string | undefined>(initialLeftId);
  const [rightId, setRightId] = useState<string | undefined>(initialRightId);
  const [showSystemFields, setShowSystemFields] = useState(true);

  // Fetch collection schema (useCollection only takes collectionName, it auto-disables when undefined)
  const { data: collection, isLoading: isLoadingCollection } =
    useCollection(collectionSlug);

  // Fetch entries for dropdown (limit to 100)
  const { data: entriesList, isLoading: isLoadingEntries } = useEntries({
    collectionSlug,
    params: { limit: 100 },
    enabled: !!collectionSlug,
  });

  // Fetch selected entries
  const { data: leftEntry, isLoading: isLoadingLeft } = useEntry({
    collectionSlug,
    entryId: leftId,
    enabled: !!leftId,
  });

  const { data: rightEntry, isLoading: isLoadingRight } = useEntry({
    collectionSlug,
    entryId: rightId,
    enabled: !!rightId,
  });

  // Get entries for dropdowns
  const entries = entriesList?.docs || [];

  // Get fields for comparison from schema
  const allFields = useMemo(() => {
    const schemaFields =
      collection?.fields || collection?.schemaDefinition?.fields || [];
    return getFieldsForComparison(schemaFields);
  }, [collection]);

  // Filter fields based on system field toggle
  const visibleFields = useMemo(() => {
    if (showSystemFields) return allFields;
    return allFields.filter(field => !SYSTEM_FIELDS.has(field.name));
  }, [allFields, showSystemFields]);

  // Calculate differences
  const { differences, differenceCount } = useMemo(() => {
    if (!leftEntry || !rightEntry) {
      return { differences: new Set<string>(), differenceCount: 0 };
    }

    const diffSet = new Set<string>();
    const leftRecord = leftEntry as Record<string, unknown>;
    const rightRecord = rightEntry as Record<string, unknown>;

    for (const field of allFields) {
      const leftValue = leftRecord[field.name];
      const rightValue = rightRecord[field.name];

      if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
        diffSet.add(field.name);
      }
    }

    return { differences: diffSet, differenceCount: diffSet.size };
  }, [leftEntry, rightEntry, allFields]);

  // Get difference names for summary
  const differenceNames = useMemo(() => {
    if (differenceCount === 0) return "";

    const diffFields = allFields
      .filter(f => differences.has(f.name))
      .map(f => f.label || f.name);

    if (diffFields.length <= 3) {
      return diffFields.join(", ");
    }

    return `${diffFields.slice(0, 3).join(", ")} +${diffFields.length - 3} more`;
  }, [allFields, differences, differenceCount]);

  // Loading state
  const isLoading = isLoadingCollection || isLoadingEntries;

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Selector skeletons */}
        <div className="flex items-center gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-6 w-6 mt-6" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        {/* Content skeleton */}
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Entry Selectors */}
      <div className="flex items-end gap-4">
        {/* Left Entry Selector */}
        <div className="flex-1 space-y-2">
          <Label htmlFor="left-entry-select">Left Entry</Label>
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger id="left-entry-select">
              <SelectValue placeholder="Select entry..." />
            </SelectTrigger>
            <SelectContent>
              {entries.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No entries found
                </div>
              ) : (
                entries.map(entry => (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                    disabled={entry.id === rightId}
                  >
                    {getEntryLabel(entry)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Swap indicator */}
        <div className="pb-2">
          <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
        </div>

        {/* Right Entry Selector */}
        <div className="flex-1 space-y-2">
          <Label htmlFor="right-entry-select">Right Entry</Label>
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger id="right-entry-select">
              <SelectValue placeholder="Select entry..." />
            </SelectTrigger>
            <SelectContent>
              {entries.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No entries found
                </div>
              ) : (
                entries.map(entry => (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                    disabled={entry.id === leftId}
                  >
                    {getEntryLabel(entry)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Controls Row: Difference Summary + System Fields Toggle */}
      <div className="flex items-center justify-between">
        {/* Difference Summary */}
        {leftEntry && rightEntry && (
          <div className="flex items-center gap-2">
            <Badge variant={differenceCount > 0 ? "destructive" : "default"}>
              {differenceCount} difference{differenceCount !== 1 ? "s" : ""}
            </Badge>
            {differenceCount > 0 && (
              <span className="text-sm text-muted-foreground">
                in: {differenceNames}
              </span>
            )}
          </div>
        )}
        {(!leftEntry || !rightEntry) && <div />}

        {/* System Fields Toggle */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-system-fields"
            checked={showSystemFields}
            onCheckedChange={checked => setShowSystemFields(checked === true)}
          />
          <Label
            htmlFor="show-system-fields"
            className="text-sm font-normal cursor-pointer"
          >
            Show system fields
          </Label>
        </div>
      </div>

      {/* Loading individual entries */}
      {(isLoadingLeft || isLoadingRight) && (
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {/* Empty state - no entries selected */}
      {!leftId && !rightId && !isLoadingLeft && !isLoadingRight && (
        <div className="text-center py-12 text-muted-foreground">
          <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Select two entries to compare</p>
          <p className="text-sm">
            Choose entries from the dropdowns above to see their differences
          </p>
        </div>
      )}

      {/* Partial selection state */}
      {((leftId && !rightId) || (!leftId && rightId)) &&
        !isLoadingLeft &&
        !isLoadingRight && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">Select another entry</p>
            <p className="text-sm">
              Choose a second entry to compare with the selected one
            </p>
          </div>
        )}

      {/* Field Comparisons Grid */}
      {leftEntry && rightEntry && !isLoadingLeft && !isLoadingRight && (
        <div className="grid grid-cols-2 gap-4">
          {/* Column headers */}
          <div className="font-medium text-sm text-muted-foreground px-1 pb-2  border-b border-primary/5">
            {getEntryLabel(leftEntry)}
          </div>
          <div className="font-medium text-sm text-muted-foreground px-1 pb-2  border-b border-primary/5">
            {getEntryLabel(rightEntry)}
          </div>

          {/* Field comparisons */}
          {visibleFields.map(field => {
            const leftRecord = leftEntry as Record<string, unknown>;
            const rightRecord = rightEntry as Record<string, unknown>;
            const leftValue = leftRecord[field.name];
            const rightValue = rightRecord[field.name];
            const isDifferent = differences.has(field.name);

            return (
              <FieldDiff
                key={field.name}
                field={field}
                leftValue={leftValue}
                rightValue={rightValue}
                isDifferent={isDifferent}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
