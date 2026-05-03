import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@revnixhq/ui";
import type React from "react";

/** Shared animated gray bar */
const GrayBar = ({ className }: { className?: string }) => (
  <Skeleton className={className} />
);

export const PluginsTableSkeleton: React.FC = () => {
  const SKELETON_ROW_COUNT = 8;
  const columns = ["select", "label", "version", "placement"];

  return (
    <div className="space-y-4">
      {/* Toolbar Skeleton */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <Skeleton className="w-full md:max-w-sm rounded-none" />
        <div className="flex items-center gap-2">
          <Skeleton className="w-24 rounded-none" />
        </div>
      </div>

      <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
        <div className="border-0 rounded-none shadow-none">
          <Table>
            {/* Header Skeleton */}
            <TableHeader>
              <TableRow>
                {columns.map(col => (
                  <TableHead key={`skeleton-header-${col}`} className="py-3">
                    {col === "select" ? (
                      <Skeleton className="h-4 w-4 rounded-none" />
                    ) : col === "label" ? (
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-9 rounded-none] shrink-0" />
                        <div className="space-y-1.5 flex-1">
                          <Skeleton className="h-4 w-[140px]" />
                          <Skeleton className="h-3 w-[100px]" />
                        </div>
                      </div>
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
                <TableRow key={rowIdx} className="border-b border-primary/5">
                  {columns.map(col => (
                    <TableCell key={col} className="py-3">
                      {col === "select" ? (
                        <Skeleton className="h-4 w-4 rounded-none" />
                      ) : col === "label" ? (
                        <div className="flex items-center gap-3">
                          <Skeleton className="w-9 rounded-none] shrink-0" />
                          <div className="space-y-1.5 flex-1">
                            <Skeleton className="h-4 w-[160px]" />
                            <Skeleton className="h-3 w-[120px]" />
                          </div>
                        </div>
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
        <div className="table-footer border-t border-primary/5 bg-[hsl(var(--table-header-bg))]">
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
    </div>
  );
};

PluginsTableSkeleton.displayName = "PluginsTableSkeleton";
