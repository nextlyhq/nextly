/**
 * FieldGroupTableSkeleton Component
 *
 * Loading skeleton for FieldGroupTable.
 * Renders header, 8 rows, and footer skeleton bars inside a card matching the component table structure.
 * Unified with EntryTable skeleton pattern for consistency.
 *
 * Columns: Checkbox | Component (label) | Category | Source | Status | Fields | Created | Actions
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nextlyhq/ui";
import type React from "react";

/** Shared animated gray bar */
const GrayBar = ({ className }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={`animate-pulse rounded-md bg-primary/5 ${className ?? ""}`}
  />
);

export const FieldGroupTableSkeleton: React.FC = () => {
  const SKELETON_ROW_COUNT = 8;
  const columns = [
    "select",
    "label",
    "category",
    "source",
    "status",
    "fields",
    "created",
    "actions",
  ];

  return (
    <div className="table-wrapper rounded-md  border border-border bg-card overflow-hidden">
      {/* Square corners: this fills the bordered table wrapper edge to edge. */}
      <div className="border-0 rounded-none shadow-none">
        <Table>
          {/* Header Skeleton */}
          <TableHeader>
            <TableRow>
              {columns.map(col => (
                <TableHead key={`skeleton-header-${col}`} className="py-3">
                  {col === "select" ? (
                    <GrayBar className="h-4 w-4" />
                  ) : col === "actions" ? (
                    <div className="h-4 w-8 rounded-sm opacity-0" />
                  ) : col === "label" ? (
                    <GrayBar className="h-4 w-[70%] max-w-[180px]" />
                  ) : (
                    <GrayBar className="h-4 w-[60%] max-w-[120px]" />
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          {/* Body Skeleton */}
          <TableBody>
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIdx) => (
              <TableRow key={rowIdx} className="border-b border-border">
                {columns.map(col => (
                  <TableCell key={col} className="py-3">
                    {col === "select" ? (
                      <GrayBar className="h-4 w-4" />
                    ) : col === "actions" ? (
                      <div className="h-4 w-8 rounded-sm opacity-0" />
                    ) : col === "label" ? (
                      <GrayBar className="h-4 w-[70%] max-w-[200px]" />
                    ) : (
                      <GrayBar className="h-4 w-[60%] max-w-[120px]" />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Footer Skeleton */}
      <div className="table-footer border-t border-border bg-[var(--nx-table-header-bg)]">
        {/* One padding utility: the footer sits inside the card, so its inset is
           uniform. An axis-specific pair alongside `p-4` is inert -- `p-4` sets
           both axes and wins on equal specificity. */}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2 text-sm">
            <GrayBar className="h-4 w-[120px]" />
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <GrayBar className="h-4 w-20" />
              <GrayBar className="h-8 w-[70px]" />
            </div>
            <div className="flex items-center gap-1">
              <GrayBar className="h-8 w-8" />
              <GrayBar className="h-8 w-8" />
              <GrayBar className="h-8 w-8" />
              <GrayBar className="h-8 w-8" />
              <GrayBar className="h-8 w-8" />
            </div>
            <GrayBar className="h-4 w-[120px]" />
          </div>
        </div>
      </div>
    </div>
  );
};

FieldGroupTableSkeleton.displayName = "FieldGroupTableSkeleton";
