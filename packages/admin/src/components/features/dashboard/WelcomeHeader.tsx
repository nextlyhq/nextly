import { Button, Skeleton } from "@revnixhq/ui";
import { Plus } from "lucide-react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useCollections } from "@admin/hooks/queries/useCollections";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";

function getFirstName(name: string | undefined | null): string {
  if (!name) return "there";
  const first = name.split(" ")[0];
  return first || "there";
}

export function WelcomeHeader() {
  const { user, isLoading: userLoading } = useDashboardUser();
  const { data: collectionsData, isLoading: collectionsLoading } =
    useCollections(
      { pagination: { page: 0, pageSize: 100 }, sorting: [], filters: {} },
      { staleTime: 5 * 60 * 1000 }
    );

  const collections = collectionsData?.data ?? [];
  const hasCollections = collections.length > 0;

  if (userLoading || collectionsLoading) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between pb-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-[-0.04em] text-foreground leading-tight">
          Welcome,{" "}
          <span className="text-primary/90">{getFirstName(user?.name)}</span>
        </h1>
        <p className="text-sm font-medium text-muted-foreground/80 tracking-tight">
          {hasCollections
            ? "Your project is looking good. Here's what's happened since you left."
            : "Let's get started by building your first content structure."}
        </p>
      </div>

      {!hasCollections && (
        <div className="flex items-center gap-3">
          <Link href={ROUTES.COLLECTIONS_CREATE}>
            <Button
              variant="primary"
              size="sm"
              className="h-10 px-6 rounded-md font-bold uppercase tracking-[0.1em] text-[11px] shadow-elevation-primary"
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Create Collection
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
