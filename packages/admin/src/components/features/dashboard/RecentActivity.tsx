/**
 * RecentActivity Component
 *
 * Displays a feed of recent activity on the dashboard.
 * Shows user actions like create, update, delete with avatars and timestamps.
 *
 * @module components/features/dashboard/RecentActivity
 */

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Spinner,
} from "@revnixhq/ui";
import { Clock, ChevronRight } from "lucide-react";
import type React from "react";

import { AlertCircle } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useRecentActivity } from "@admin/hooks/queries/useRecentActivity";
import { cn } from "@admin/lib/utils";
import type { Activity } from "@admin/types/dashboard/activity";

/**
 * Props for RecentActivity component
 */
export interface RecentActivityProps {
  /** Maximum number of activities to display (default: 5) */
  limit?: number;
}

/**
 * Single Activity Item Component
 *
 * Displays a single activity entry with avatar, description, and badge.
 */
const ActivityItem: React.FC<{ activity: Activity }> = ({ activity }) => {
  const getBadgeStyle = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("create"))
      return "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20";
    if (t.includes("update"))
      return "bg-primary/5 text-primary ring-1 ring-primary/20";
    if (t.includes("delete"))
      return "bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20";
    return "bg-primary/5 text-muted-foreground ring-1 ring-border/50";
  };

  return (
    <div className="flex items-center gap-5 p-3 rounded-none hover:bg-primary/[0.03] transition-all duration-500 group/item">
      <div className="relative">
        <Avatar className="h-11 w-11 rounded-none border-2 border-background shadow-sm ring-1 ring-border/10">
          <AvatarImage src={activity.user.avatar} alt={activity.user.name} />
          <AvatarFallback className="bg-primary/5 text-primary text-xs font-black">
            {activity.user.initials}
          </AvatarFallback>
        </Avatar>
        <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-none bg-background p-0.5 shadow-sm ring-1 ring-border/10">
          <div
            className={cn(
              "h-full w-full rounded-none ring-1 ring-inset",
              activity.type.toLowerCase().includes("create")
                ? "bg-emerald-500 ring-emerald-500/40"
                : activity.type.toLowerCase().includes("delete")
                  ? "bg-rose-500 ring-rose-500/40"
                  : "bg-primary ring-primary/40"
            )}
          />
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-[13px] text-foreground/80 leading-snug">
          <span className="font-bold text-foreground tracking-tight">
            {activity.user.name}
          </span>{" "}
          <span className="text-muted-foreground/60 font-medium">
            {activity.action}
          </span>{" "}
          {activity.entryTitle ? (
            <>
              <span className="font-bold text-foreground tracking-tight underline decoration-primary/20 underline-offset-4">
                {activity.entryTitle}
              </span>{" "}
              <span className="text-muted-foreground/40 font-bold uppercase text-[9px] tracking-widest ml-1 bg-primary/5 px-1.5 py-0.5 rounded-none">
                {activity.collectionLabel}
              </span>
            </>
          ) : (
            <span className="font-bold text-foreground tracking-tight">
              {activity.target}
            </span>
          )}
        </p>

        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/30">
          <Clock className="w-3 h-3 opacity-60" />
          <time dateTime={activity.timestamp}>{activity.relativeTime}</time>
        </div>
      </div>

      <Badge
        className={cn(
          "uppercase text-[9px] px-2.5 py-0.5 rounded-none font-black tracking-[0.15em] border-none shadow-none transition-all duration-500 group-hover/item:scale-105",
          getBadgeStyle(activity.type)
        )}
      >
        {activity.type}
      </Badge>
    </div>
  );
};

const EmptyState: React.FC = () => (
  <div className="py-20 text-center space-y-4">
    <div className="inline-flex p-6 rounded-none] bg-primary/5  border border-primary/5">
      <Clock className="h-10 w-10 text-muted-foreground/10" />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-bold text-foreground tracking-tight">
        Activity log is currently silent
      </p>
      <p className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-widest">
        Actions will appear here as you work
      </p>
    </div>
  </div>
);

export const RecentActivity: React.FC<RecentActivityProps> = ({
  limit = 5,
}) => {
  const { data, isLoading, error } = useRecentActivity(limit);

  return (
    <Card className="border-primary/5 bg-card/40 backdrop-blur-md rounded-none] overflow-hidden transition-all duration-500 hover:border-primary/5">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-8 py-7  border-b border-primary/5">
        <div className="space-y-1">
          <CardTitle className="text-[11px] font-black uppercase tracking-[0.25em] text-muted-foreground/40">
            System Event Log
          </CardTitle>
          <div className="h-1 w-8 bg-primary/20 rounded-none" />
        </div>
        <Link
          href={ROUTES.DASHBOARD}
          className="text-[10px] font-black uppercase tracking-[0.2em] text-primary hover-unified transition-all flex items-center gap-2 px-4 py-2 rounded-none bg-primary/5 hover-unified"
        >
          Detailed Log <ChevronRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="p-3">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Spinner size="md" className="text-primary/40" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30 animate-pulse">
              Syncing events...
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 py-12 justify-center text-sm text-destructive bg-destructive/5 rounded-none mx-3 mb-3">
            <AlertCircle className="h-4 w-4" />
            <span className="font-bold uppercase tracking-wider text-[11px]">
              Failed to fetch activity stream
            </span>
          </div>
        )}

        {data && !isLoading && !error && (
          <div className="space-y-1 p-2">
            {data.activities.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <div className="space-y-1">
                  {data.activities.map(activity => (
                    <ActivityItem key={activity.id} activity={activity} />
                  ))}
                </div>
                <div className="mt-6 pt-4  border-t border-primary/5 text-center">
                  <button className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/30 hover-unified transition-all duration-500 py-3 px-8 rounded-none hover-unified">
                    Sync Previous Events
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

RecentActivity.displayName = "RecentActivity";
