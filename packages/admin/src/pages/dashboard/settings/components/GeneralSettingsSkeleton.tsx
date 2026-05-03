import { Skeleton } from "@revnixhq/ui";
import type React from "react";

/**
 * GeneralSettingsSkeleton Component
 *
 * Loading skeleton for the General Settings page.
 * Replicates the structure of Locale & Formatting and Appearance sections.
 */
export const GeneralSettingsSkeleton: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Locale & Formatting Section */}
      <div className="rounded-none  border border-primary/5 bg-card overflow-hidden">
        {/* Card Header Skeleton */}
        <div className="flex items-center gap-4 px-6 py-5  border-b border-primary/5 bg-primary/5">
          <Skeleton className="h-9 w-9 rounded-none" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>

        {/* Card Body Rows Skeleton */}
        <div className="divide-y divide-border/60 px-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 py-5 items-start"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="h-9 w-9 rounded-none" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="h-10 w-full rounded-none" />
            </div>
          ))}
        </div>
      </div>

      {/* Appearance Section */}
      <div className="rounded-none  border border-primary/5 bg-card overflow-hidden">
        {/* Card Header Skeleton */}
        <div className="flex items-center gap-4 px-6 py-5  border-b border-primary/5 bg-primary/5">
          <Skeleton className="h-9 w-9 rounded-none" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>

        {/* Card Body Skeleton */}
        <div className="p-6 space-y-6">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-none" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-none" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

GeneralSettingsSkeleton.displayName = "GeneralSettingsSkeleton";
