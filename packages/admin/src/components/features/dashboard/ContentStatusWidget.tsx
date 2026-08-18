import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@nextlyhq/ui";
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
    <div className="flex items-center justify-between p-3 rounded-md hover:bg-primary/[0.03] transition-all duration-500 group/item  border border-border border-transparent hover:border-border">
      <div className="flex items-center gap-3.5">
        <div
          /*
           * The ring is a fixed decorative halo rather than a tint of `color`.
           * It was `ringColor: `${color}20``, which never rendered: `ringColor`
           * is not a CSS property — Tailwind's ring colour comes from
           * `--tw-ring-color` — and the value was invalid regardless, because
           * appending `20` to a `var()` is not the hex-alpha it looks like. Both
           * halves failed silently, so the halo has always drawn in the default
           * ring colour. Stated as a class the theme can move.
           */
          className="h-2 w-2 rounded-full ring-4 ring-primary/20 ring-offset-2 ring-offset-transparent transition-all duration-500 group-hover/item:scale-125"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-bold text-muted-foreground group-hover/item:text-foreground transition-colors tracking-tight">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-black tabular-nums text-foreground/80">
          {count}
        </span>
        <span className="text-xs font-black text-muted-foreground bg-primary/5 px-2 py-0.5 rounded-sm  border border-border min-w-[36px] text-center">
          {percentage}%
        </span>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col items-center gap-8 py-6" aria-busy="true">
      <Skeleton className="h-[160px] w-[160px] rounded-lg ring-8 ring-muted/5" />
      <div className="w-full space-y-3 px-2">
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
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

  // Both swatches come from theme tokens so a rebrand moves the chart with the
  // rest of the admin; the draft segment uses the amber slot of the chart ramp.
  const segments = [
    { label: "Published", value: published, color: "var(--nx-primary)" },
    { label: "Draft", value: draft, color: "var(--nx-chart-4)" },
  ];

  return (
    <Card className="border-border bg-card/60 backdrop-blur-md rounded-lg overflow-hidden transition-all duration-500 hover:border-border">
      <CardHeader
        noBorder
        className="flex flex-row items-center justify-between space-y-0 px-8 pt-8 pb-4"
      >
        <div className="space-y-1">
          <CardTitle className="text-xs font-black uppercase tracking-[0.25em] text-muted-foreground">
            Lifecycle Overview
          </CardTitle>
          <div className="h-1 w-6 bg-primary/30 rounded-sm" />
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-8">
        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex items-center gap-3 py-10 text-xs font-bold uppercase tracking-widest text-destructive justify-center bg-destructive/5 rounded-md">
            <AlertCircle className="h-4 w-4" />
            <span>Health synchronization failed</span>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="p-6 rounded-lg bg-primary/5  border border-border">
              <FileText className="h-10 w-10 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-bold text-foreground">
                No active content detected
              </p>
              <Link
                href={ROUTES.BUILDER_COLLECTIONS}
                className="text-xs font-black uppercase tracking-[0.2em] text-primary hover:underline group flex items-center justify-center gap-2"
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
                <span className="text-xs font-black uppercase tracking-widest text-muted-foreground mt-1">
                  Total
                </span>
              </div>
            </div>

            <div className="w-full space-y-1.5 bg-primary/5 p-2 rounded-md  border border-border">
              <StatusItem
                label="Published"
                count={published}
                percentage={publishedPct}
                color="var(--nx-primary)"
              />
              <StatusItem
                label="Draft"
                count={draft}
                percentage={draftPct}
                color="var(--nx-chart-4)"
              />
            </div>
            <p className="text-xs text-center text-muted-foreground font-black uppercase tracking-[0.2em] opacity-80 px-4">
              Consolidated health status across production clusters
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
