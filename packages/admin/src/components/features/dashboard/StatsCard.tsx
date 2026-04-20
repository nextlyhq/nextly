/**
 * StatsCard Component
 *
 * Displays a statistic card with optional trend indicator and icon.
 * Supports default (large) and compact (small) variants.
 * Used on the dashboard to show metrics like total entries, media, etc.
 *
 * @module components/features/dashboard/StatsCard
 */

import { Card, CardContent } from "@revnixhq/ui";
import React from "react";

import { TrendingUp, TrendingDown } from "@admin/components/icons";
import { Sparkline } from "@admin/components/shared/charts/Sparkline";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";
import type { StatsCardProps } from "@admin/types/dashboard/stats";

export const StatsCard = React.forwardRef<HTMLDivElement, StatsCardProps>(
  (
    {
      title,
      value,
      change,
      trend,
      icon,
      variant = "default",
      href,
      sparklineData,
      footer,
      className,
    },
    ref
  ) => {
    const isCompact = variant === "compact";

    const card = (
      <Card
        ref={ref}
        variant={href ? "interactive" : "default"}
        className={cn(
          "group relative overflow-hidden transition-all duration-500",
          "border-border/60 bg-card/60 backdrop-blur-sm",
          href &&
            "hover:border-primary/40 hover:shadow-[0_8px_30px_rgb(var(--primary-rgb),0.06)] active:scale-[0.985] active:translate-y-0.5",
          className
        )}
      >
        {/* Subtle Accent Gradient on Hover */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

        {/* Top Sharp Border Accent */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-primary/80 transform origin-left scale-x-0 transition-transform duration-500 ease-out group-hover:scale-x-100" />

        <CardContent className={isCompact ? "p-5" : "p-8"}>
          {isCompact ? (
            <div className="flex items-center justify-between gap-4 relative z-10">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-2">
                  {icon && (
                    <div className="p-1.5 rounded-lg bg-primary/5 text-primary/70 shrink-0 group-hover-unified transition-colors">
                      {icon}
                    </div>
                  )}
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60 truncate group-hover:text-muted-foreground/90 transition-colors">
                    {title}
                  </span>
                </div>
                <p className="text-2xl font-bold tracking-[-0.03em] text-foreground leading-none">
                  {typeof value === "number" ? value.toLocaleString() : value}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6 relative z-10">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="p-2 rounded-xl bg-primary/5 text-primary/80 ring-1 ring-primary/10 group-hover:ring-primary/20 transition-all duration-500">
                      {icon}
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors">
                      {title}
                    </span>
                  </div>
                  <p className="text-[clamp(1.75rem,5vw,2.5rem)] font-bold tracking-[-0.05em] text-foreground leading-[0.9] transition-transform duration-500 group-hover:translate-x-0.5">
                    {typeof value === "number" ? value.toLocaleString() : value}
                  </p>
                </div>

                {sparklineData && (
                  <div className="pt-1 pr-1 group-hover:scale-110 transition-transform duration-700">
                    <Sparkline
                      data={sparklineData}
                      width={120}
                      height={40}
                      className="text-primary/20 group-hover-unified transition-colors duration-700"
                    />
                  </div>
                )}
              </div>

              {(footer || change !== undefined) && (
                <div className="flex items-center justify-between pt-5 border-t border-border/10">
                  <div className="flex items-center gap-2">
                    {change !== undefined && (
                      <div
                        className={cn(
                          "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 transition-all duration-500",
                          trend === "up"
                            ? "bg-emerald-500/5 text-emerald-500 ring-emerald-500/20 group-hover:bg-emerald-500/10"
                            : "bg-rose-500/5 text-rose-500 ring-rose-500/20 group-hover:bg-rose-500/10"
                        )}
                      >
                        {trend === "up" ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        <span>
                          {change > 0 ? "+" : ""}
                          {change}%
                        </span>
                      </div>
                    )}
                    {footer && (
                      <span className="text-[11px] font-semibold text-muted-foreground truncate opacity-60 group-hover:opacity-100 transition-opacity">
                        {footer}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );

    if (href) {
      return (
        <Link href={href} className="block">
          {card}
        </Link>
      );
    }

    return card;
  }
);

StatsCard.displayName = "StatsCard";

StatsCard.displayName = "StatsCard";
