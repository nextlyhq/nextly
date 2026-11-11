"use client";

import type React from "react";

import { ChevronRight, LayoutDashboard } from "@admin/components/icons";
import { BarTrail } from "@admin/components/layout/header/HeaderTrail";
import {
  TopBarPlace,
  useInTopBar,
} from "@admin/components/layout/header/TopBarPlaces";
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
  /**
   * `bar` (the default): the page's own place, drawn in the admin's top bar.
   * `inline`: navigation inside the page's content, such as a folder path in
   * the media library or its picker dialog, drawn where it stands.
   */
  placement?: "bar" | "inline";
}

/**
 * Reusable Breadcrumbs Component
 *
 * Where the page sits. Inside the admin shell it is drawn in the top bar's
 * left part, as the trail every page shows there (the last item is the page
 * itself, the one before it the way back); the page draws nothing of it in
 * its own body. Outside the shell (a page rendered on its own) it is drawn
 * where it stands, with its icons.
 *
 * @example
 * <Breadcrumbs
 *   items={[
 *     { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
 *     { label: "Collections", href: ROUTES.BUILDER_COLLECTIONS },
 *     { label: "Users" }
 *   ]}
 * />
 */
export function Breadcrumbs({
  items,
  className,
  placement = "bar",
}: BreadcrumbsProps): React.JSX.Element {
  const inBar = useInTopBar();
  if (inBar && placement === "bar") {
    const current = items.at(-1);
    return (
      <TopBarPlace name="start">
        <BarTrail
          steps={items.slice(0, -1).map(({ label, href, onClick }) => ({
            label,
            ...(href === undefined ? {} : { href }),
            ...(onClick === undefined ? {} : { onClick }),
          }))}
          current={current?.label ?? null}
        />
      </TopBarPlace>
    );
  }
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-2", className)}>
      <ol className="flex items-center gap-2 text-sm text-muted-foreground">
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
                  className="flex items-center gap-1 hover:text-foreground hover:underline transition-colors cursor-pointer"
                >
                  {content}
                </Link>
              ) : item.onClick ? (
                <button
                  onClick={item.onClick}
                  className="flex items-center gap-1 hover:text-foreground hover:underline transition-colors cursor-pointer"
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-1">{content}</span>
              )}
              {!isLast && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
