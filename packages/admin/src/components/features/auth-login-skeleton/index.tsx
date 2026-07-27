import { Skeleton } from "@nextlyhq/ui";

export function LoginLoading() {
  return (
    <div className="w-full max-w-[420px] mx-auto">
      <div className="space-y-8">
        {/* Header */}
        <div className="text-left space-y-2 mt-12 mb-8">
          <Skeleton className="h-12 w-12 bg-primary/5 mb-10 rounded-md" />
          <div className="space-y-3">
            <Skeleton className="w-40 rounded-md" />
            <Skeleton className="h-5 w-64 rounded-sm" />
          </div>
        </div>

        {/* Form skeleton */}
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24 rounded-sm" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>

          <div className="space-y-2">
            <Skeleton className="h-4 w-24 rounded-sm" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>

          <Skeleton className="h-10 w-full rounded-md bg-primary/20" />
        </div>

        {/* Footer link */}
        <div className="text-left pt-2">
          <Skeleton className="h-5 w-48 rounded-sm" />
        </div>
      </div>
    </div>
  );
}
