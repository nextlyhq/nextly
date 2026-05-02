import { Card, CardContent, CardHeader, Skeleton } from "@revnixhq/ui";
import type React from "react";

export const StatsGridSkeleton: React.FC = () => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="h-12 w-12 rounded-none" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

StatsGridSkeleton.displayName = "StatsGridSkeleton";

export const ActivitySkeleton: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-4">
              <Skeleton className="h-10 w-10 rounded-none" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

ActivitySkeleton.displayName = "ActivitySkeleton";

export const RecentEntriesSkeleton: React.FC = () => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-16" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-1 py-3">
              <Skeleton className="h-4 flex-1 max-w-[200px]" />
              <Skeleton className="h-4 w-16 hidden md:block" />
              <Skeleton className="h-[22px] w-16" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-4" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

RecentEntriesSkeleton.displayName = "RecentEntriesSkeleton";

export const ContentStatusSkeleton: React.FC = () => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-2 w-full rounded-none" />
            </div>
          ))}
          <Skeleton className="h-3 w-28 mt-2" />
        </div>
      </CardContent>
    </Card>
  );
};

ContentStatusSkeleton.displayName = "ContentStatusSkeleton";

export const CollectionQuickLinksSkeleton: React.FC = () => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-6 w-36" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-none" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

CollectionQuickLinksSkeleton.displayName = "CollectionQuickLinksSkeleton";

export const ProjectStatsSkeleton: React.FC = () => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-none" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

ProjectStatsSkeleton.displayName = "ProjectStatsSkeleton";

export const OnboardingChecklistSkeleton: React.FC = () => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-6 rounded-none" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5 mb-4">
          <Skeleton className="h-2 w-full rounded-none" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-5 rounded-none" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

OnboardingChecklistSkeleton.displayName = "OnboardingChecklistSkeleton";

export const DashboardPageSkeleton: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <StatsGridSkeleton />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <RecentEntriesSkeleton />
          <CollectionQuickLinksSkeleton />
        </div>
        <div className="space-y-6">
          <ContentStatusSkeleton />
          <ActivitySkeleton />
        </div>
      </div>

      <ProjectStatsSkeleton />
    </div>
  );
};

DashboardPageSkeleton.displayName = "DashboardPageSkeleton";
