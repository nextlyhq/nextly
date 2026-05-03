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
          "group relative overflow-hidden transition-all duration-300",
          "border-primary/5 bg-card",
          href &&
            "hover-subtle-row hover:border-primary/5 active:scale-[0.985] active:translate-y-0.5",
          className
        )}
      >
        <CardContent className={isCompact ? "p-5" : "p-8"}>
          {isCompact ? (
            <div className="flex items-start justify-between gap-4 relative z-10">
              <div className="space-y-1">
                <p className="text-2xl font-bold tracking-[-0.03em] text-primary/50 leading-none group-hover:text-primary transition-colors">
                  {typeof value === "number" ? value.toLocaleString() : value}
                </p>
                <span className="block text-[11px] font-semibold tracking-tight text-primary/50 truncate group-hover:text-primary transition-colors pt-1">
                  {title}
                </span>
              </div>
              {icon && (
                <div className="text-primary/50 shrink-0 group-hover:text-primary transition-colors pt-1">
                  {icon}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6 relative z-10">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-fluid-4xl font-bold tracking-[-0.05em] text-primary/50 leading-[0.9] transition-all duration-500 group-hover:text-primary group-hover:translate-x-0.5">
                    {typeof value === "number" ? value.toLocaleString() : value}
                  </p>
                  <div className="flex items-center gap-2.5 pt-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary/50 group-hover:text-primary transition-colors">
                      {title}
                    </span>
                  </div>
                </div>

                {icon && (
                  <div className="text-primary/50 shrink-0 group-hover:text-primary transition-all duration-500 pt-1">
                    {icon}
                  </div>
                )}
              </div>

              {(footer || change !== undefined) && (
                <div className="flex items-center justify-between pt-5  border-t border-primary/5">
                  <div className="flex items-center gap-2">
                    {change !== undefined && (
                      <div
                        className={cn(
                          "flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider ring-1 transition-all duration-500",
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

                  {sparklineData && (
                    <div className="group-hover:scale-110 transition-transform duration-700">
                      <Sparkline
                        data={sparklineData}
                        width={80}
                        height={30}
                        className="text-primary/20 group-hover-unified transition-colors duration-700"
                      />
                    </div>
                  )}
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
