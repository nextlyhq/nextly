import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@revnixhq/ui";
import { AlertCircle, FileText, ChevronRight } from "lucide-react";
import type React from "react";

import { RingChart } from "@admin/components/shared/charts/RingChart";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useDashboardStats } from "@admin/hooks/queries/useDashboardStats";

function StatusItem({
  label,
  count,
  percentage,
  color,
}: {
  label: string;
  count: number;
  percentage: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-none hover:bg-primary/[0.03] transition-all duration-500 group/item border border-transparent hover:border-primary/10">
      <div className="flex items-center gap-3.5">
        <div
          className="h-2 w-2 rounded-none ring-4 ring-offset-2 ring-offset-transparent transition-all duration-500 group-hover/item:scale-125"
          style={
            {
              backgroundColor: color,
              ringColor: `${color}20`,
            } as React.CSSProperties
          }
        />
        <span className="text-[12px] font-bold text-muted-foreground/80 group-hover/item:text-foreground transition-colors tracking-tight">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-black tabular-nums text-foreground/80">
          {count}
        </span>
        <span className="text-[10px] font-black text-primary/60 bg-primary/5 px-2 py-0.5 rounded-none border border-primary/10 min-w-[36px] text-center">
          {percentage}%
        </span>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col items-center gap-8 py-6" aria-busy="true">
      <Skeleton className="h-[160px] w-[160px] rounded-none ring-8 ring-muted/5" />
      <div className="w-full space-y-3 px-2">
        <Skeleton className="h-12 w-full rounded-none" />
        <Skeleton className="h-12 w-full rounded-none" />
      </div>
    </div>
  );
}

export const ContentStatusWidget: React.FC = () => {
  const { data, isLoading, error } = useDashboardStats();

  const published = data?.status.published ?? 0;
  const draft = data?.status.draft ?? 0;
  const total = published + draft;

  const publishedPct = total > 0 ? Math.round((published / total) * 100) : 0;
  const draftPct = total > 0 ? Math.round((draft / total) * 100) : 0;

  const segments = [
    { label: "Published", value: published, color: "var(--primary)" },
    { label: "Draft", value: draft, color: "#f59e0b" }, // Amber
  ];

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-md rounded-none] overflow-hidden transition-all duration-500 hover:border-primary/20">
      <CardHeader
        noBorder
        className="flex flex-row items-center justify-between space-y-0 px-8 pt-8 pb-4"
      >
        <div className="space-y-1">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground/40">
            Lifecycle Overview
          </CardTitle>
          <div className="h-1 w-6 bg-primary/30 rounded-none" />
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-8">
        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex items-center gap-3 py-10 text-[11px] font-bold uppercase tracking-widest text-destructive/60 justify-center bg-destructive/5 rounded-none]">
            <AlertCircle className="h-4 w-4" />
            <span>Health synchronization failed</span>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="p-6 rounded-none] bg-primary/5 border border-border/10">
              <FileText className="h-10 w-10 text-muted-foreground/10" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-bold text-foreground">
                No active content detected
              </p>
              <Link
                href={ROUTES.COLLECTIONS}
                className="text-[11px] font-black uppercase tracking-[0.2em] text-primary hover:underline group flex items-center justify-center gap-2"
              >
                Launch Initial Entry{" "}
                <ChevronRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-8">
            <div className="relative group/chart transition-transform duration-700 hover:scale-105">
              <RingChart
                total={total}
                segments={segments}
                size={180}
                strokeWidth={16}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-black text-foreground tracking-tighter tabular-nums leading-none">
                  {total}
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 mt-1">
                  Total
                </span>
              </div>
            </div>

            <div className="w-full space-y-1.5 bg-primary/5 p-2 rounded-none] border border-border/5">
              <StatusItem
                label="Published"
                count={published}
                percentage={publishedPct}
                color="var(--primary)"
              />
              <StatusItem
                label="Draft"
                count={draft}
                percentage={draftPct}
                color="#f59e0b"
              />
            </div>
            <p className="text-[9px] text-center text-muted-foreground/40 font-black uppercase tracking-[0.2em] opacity-80 px-4">
              Consolidated health status across production clusters
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
