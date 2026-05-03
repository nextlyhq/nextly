/**
 * TableSkeleton Component
 *
 * Generic loading skeleton for data tables.
 * Renders header, body, and footer skeleton bars inside a card.
 * Unified with EntryTable skeleton pattern for consistency across all tables.
 */

import * as React from "react";

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

export interface TableSkeletonProps {
  columns?: number;
  rowCount?: number;
  hideWrapper?: boolean;
  hideFooter?: boolean;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  columns = 5,
  rowCount = 8,
  hideWrapper = false,
  hideFooter = false,
}) => {
  const content = (
    <>
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
                      <Skeleton className="h-4 w-4 rounded-none" />
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
              <TableRow key={rowIdx} className="border-b border-primary/5">
                {Array.from({ length: columns }).map((_, colIdx) => (
                  <TableCell key={colIdx} className="py-3">
                    {colIdx === 0 ? (
                      <GrayBar className="h-4 w-4" />
                    ) : colIdx === columns - 1 ? (
                      <div className="flex justify-center">
                        <Skeleton className="h-8 w-8 rounded-none" />
                      </div>
                    ) : colIdx === 1 ? (
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-9 rounded-none shrink-0" />
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
        <div className="table-footer  border-t border-primary/5">
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
      )}
    </>
  );

  if (hideWrapper) {
    return content;
  }

  return (
    <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
      {content}
    </div>
  );
};

TableSkeleton.displayName = "TableSkeleton";
