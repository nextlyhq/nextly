/**
 * TableSkeleton Component
 *
 * Generic loading skeleton for data tables.
 * Renders header, body, and footer skeleton bars inside a card.
 * Unified with EntryTable skeleton pattern for consistency across all tables.
 */

import type * as React from "react";

import { Skeleton } from "./skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

/** Shared animated gray bar — Unified with design system Skeleton */
const GrayBar = ({ className }: { className?: string }) => (
  <Skeleton className={className} />
);

/** @experimental */
export interface TableSkeletonProps {
  columns?: number;
  rowCount?: number;
  hideWrapper?: boolean;
  hideFooter?: boolean;
}

/** @experimental */
export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  columns = 5,
  rowCount = 8,
  hideWrapper = false,
  hideFooter = false,
}) => {
  const content = (
    <>
      {/* Square corners: this fills the bordered table wrapper edge to edge. */}
      <div className="border-0 rounded-none shadow-none">
        <Table>
          {/* Header Skeleton */}
          <TableHeader>
            <TableRow>
              {Array.from({ length: columns }).map((_, colIdx) => (
                <TableHead key={`skeleton-header-${colIdx}`} className="py-3">
                  {colIdx === 0 ? (
                    <GrayBar className="h-4 w-4" />
                  ) : colIdx === columns - 1 ? (
                    <div className="flex justify-center">
                      <Skeleton className="h-4 w-4 rounded-sm" />
                    </div>
                  ) : colIdx === 1 ? (
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
            {Array.from({ length: rowCount }).map((_, rowIdx) => (
              <TableRow key={rowIdx} className="border-b border-border">
                {Array.from({ length: columns }).map((_, colIdx) => (
                  <TableCell key={colIdx} className="py-3">
                    {colIdx === 0 ? (
                      <GrayBar className="h-4 w-4" />
                    ) : colIdx === columns - 1 ? (
                      <div className="flex justify-center">
                        <Skeleton className="h-8 w-8 rounded-md" />
                      </div>
                    ) : colIdx === 1 ? (
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-9 rounded-md shrink-0" />
                        <div className="space-y-1.5 flex-1">
                          <Skeleton className="h-4 w-[120px]" />
                          <Skeleton className="h-3 w-[80px]" />
                        </div>
                      </div>
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
      {!hideFooter && (
        <div className="table-footer  border-t border-border">
          {/* Axis utilities rather than the `p-4` shorthand: Tailwind emits `.px-2`
              and `.py-4` AFTER `.p-4`, so at equal specificity the shorthand loses
              both axes and contributes nothing. The footer is deliberately tighter
              horizontally than vertically. */}
          <div className="flex items-center justify-between px-2 py-4">
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
      )}
    </>
  );

  if (hideWrapper) {
    return content;
  }

  return (
    <div className="table-wrapper rounded-md  border border-border bg-card overflow-hidden">
      {content}
    </div>
  );
};

TableSkeleton.displayName = "TableSkeleton";
