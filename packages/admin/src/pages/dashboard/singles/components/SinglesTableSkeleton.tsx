/**
 * SinglesTableSkeleton Component
 *
 * Loading skeleton for SinglesTable.
 * Renders header, 8 rows, and footer skeleton bars inside a card matching the singles table structure.
 * Unified with EntryTable skeleton pattern for consistency.
 *
 * Columns: Single (label) | Source | Status | Fields | Created | Actions
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@revnixhq/ui";
import React from "react";

/** Shared animated gray bar */
const GrayBar = ({ className }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={`animate-pulse rounded bg-gray-50 dark:bg-gray-400 ${className ?? ""}`}
  />
);

export const SinglesTableSkeleton: React.FC = () => {
  const SKELETON_ROW_COUNT = 8;
  const columns = ["label", "source", "status", "fields", "created", "actions"];

  return (
    <div className="table-wrapper rounded-md border border-border bg-card overflow-hidden">
      <div className="border-0 rounded-none shadow-none">
        <Table>
          {/* Header Skeleton */}
          <TableHeader>
            <TableRow>
              {columns.map(col => (
                <TableHead key={`skeleton-header-${col}`} className="py-3">
                  {col === "actions" ? (
                    <div className="h-4 w-8 rounded opacity-0" />
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
                    {col === "actions" ? (
                      <div className="h-4 w-8 rounded opacity-0" />
                    ) : col === "label" ? (
                      <GrayBar className="h-4 w-[70%] max-w-[200px]" />
                    ) : (
                      <GrayBar className="h-4 w-[60%] max-w-[130px]" />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Footer Skeleton */}
      <div className="table-footer border-t border-border">
        <div className="flex items-center justify-between px-2 py-4 p-4">
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

SinglesTableSkeleton.displayName = "SinglesTableSkeleton";
