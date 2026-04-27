import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@revnixhq/ui";
import { AlertCircle, ChevronRight, FileText } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useRecentEntries } from "@admin/hooks/queries/useRecentEntries";
import { formatRelativeTime } from "@admin/lib/dashboard";
import type { RecentEntry } from "@admin/types/dashboard/recent-entries";

function truncateTitle(title: string, maxLength = 40): string {
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength) + "...";
}

function getStatusBadge(status: RecentEntry["status"]) {
  if (status === "draft") {
    return (
      <Badge
        variant="warning"
        className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] uppercase tracking-wider font-bold"
      >
        Draft
      </Badge>
    );
  }
  if (status === "published") {
    return (
      <Badge
        variant="success"
        className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] uppercase tracking-wider font-bold"
      >
        Published
      </Badge>
    );
  }
  return null;
}

function EntryRow({ entry }: { entry: RecentEntry }) {
  const editHref = buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, {
    slug: entry.collectionSlug,
    id: entry.id,
  });

  const firstLetter = entry.title?.charAt(0).toUpperCase() || "E";

  return (
    <Link href={editHref} className="block group">
      <div className="flex items-center gap-5 px-4 py-4.5 rounded-[1.25rem] transition-all duration-500 group-hover:bg-primary/[0.04] group-active:scale-[0.985] group-active:translate-y-0.5 relative overflow-hidden">
        {/* Hover Highlight Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

        <div className="h-12 w-12 shrink-0 rounded-2xl bg-muted/30 flex items-center justify-center border border-border/40 group-hover:border-primary/20 group-hover-unified group-hover:rotate-3 transition-all duration-500 relative z-10">
          <span className="text-sm font-black text-muted-foreground/60 group-hover-unified transition-colors">
            {firstLetter}
          </span>
        </div>

        <div className="min-w-0 flex-1 relative z-10">
          <p className="text-[14px] font-bold text-foreground tracking-[-0.01em] truncate group-hover-unified transition-colors duration-300">
            {truncateTitle(entry.title)}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-[0.15em]">
              {entry.collectionLabel}
            </span>
            <span className="h-0.5 w-0.5 rounded-full bg-border" />
            <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-[0.15em]">
              {formatRelativeTime(entry.updatedAt)}
            </span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-4 shrink-0 relative z-10">
          {getStatusBadge(entry.status)}
        </div>

        <div className="p-2 rounded-xl border border-transparent group-hover:border-primary/10 group-hover:bg-white group-hover:shadow-sm transition-all duration-500 relative z-10">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/20 group-hover-unified group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 p-2" aria-busy="true">
      <span className="sr-only">Loading recent entries...</span>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-5 px-4 py-4.5">
          <Skeleton className="h-12 w-12 rounded-2xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3 rounded-lg" />
            <Skeleton className="h-3 w-1/4 rounded-lg" />
          </div>
          <div className="hidden md:flex items-center gap-4">
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-8 w-8 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export const RecentEntriesWidget: React.FC = () => {
  const { data, isLoading, error } = useRecentEntries(7);

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-md overflow-hidden rounded-[2rem] transition-all duration-500 hover:border-primary/20">
      <CardHeader
        noBorder
        className="flex flex-row items-center justify-between space-y-0 px-8 py-7 border-b border-border/5"
      >
        <div className="space-y-1">
          <CardTitle className="text-[11px] font-black uppercase tracking-[0.25em] text-muted-foreground/40">
            Recent Editorial Activity
          </CardTitle>
          <div className="h-1 w-8 bg-primary/20 rounded-full" />
        </div>
        <Link
          href={ROUTES.COLLECTIONS}
          className="text-[10px] font-black uppercase tracking-[0.2em] text-primary hover-unified transition-all flex items-center gap-2 px-4 py-2 rounded-full bg-primary/5 hover-unified"
        >
          Explore All <ChevronRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="p-3">
        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex items-center gap-2 py-12 justify-center text-sm text-destructive bg-destructive/5 rounded-3xl mx-3 mb-3">
            <AlertCircle className="h-4 w-4" />
            <span className="font-bold uppercase tracking-wider text-[11px]">
              Failed to load recent activity stream
            </span>
          </div>
        ) : !data?.entries.length ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="p-6 rounded-[2rem] bg-muted/20 border border-border/40">
              <FileText className="h-10 w-10 text-muted-foreground/20" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-foreground tracking-tight">
                Your content stream is empty
              </p>
              <Link
                href={ROUTES.COLLECTIONS}
                className="text-[11px] font-black uppercase tracking-widest text-primary hover:underline mt-2 inline-block"
              >
                Create your first Entry
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {data.entries.map(entry => (
              <EntryRow
                key={`${entry.collectionSlug}-${entry.id}`}
                entry={entry}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
