"use client";

import React from "react";

import { ChevronRight, LayoutDashboard } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

export interface BreadcrumbItem {
  label: string | React.ReactNode;
  href?: string;
  onClick?: () => void;
  /**
   * If true, this item will show as the dashboard item (with icon)
   * This is usually the first item.
   */
  isDashboard?: boolean;
  /**
   * Custom icon to show before the label
   */
  icon?: React.ReactNode;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Reusable Breadcrumbs Component
 *
 * Provides a standardized navigation trail with consistent icons,
 * spacing, and interactivity.
 *
 * @example
 * <Breadcrumbs
 *   items={[
 *     { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
 *     { label: "Collections", href: ROUTES.COLLECTIONS },
 *     { label: "Users" }
 *   ]}
 * />
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-2", className)}>
      <ol className="flex items-center gap-2 text-sm text-primary/50">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isDashboard =
            item.isDashboard || (index === 0 && item.label === "Dashboard");

          const content = (
            <div className="flex items-center gap-1">
              {item.icon
                ? item.icon
                : isDashboard && <LayoutDashboard className="h-4 w-4" />}
              <span>{item.label}</span>
            </div>
          );

          return (
            <li key={index} className="flex items-center gap-2">
              {isLast ? (
                <span className="text-foreground font-medium">
                  {item.label}
                </span>
              ) : item.href ? (
                <Link
                  href={item.href}
                  className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                >
                  {content}
                </Link>
              ) : item.onClick ? (
                <button
                  onClick={item.onClick}
                  className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-1">{content}</span>
              )}
              {!isLast && (
                <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
