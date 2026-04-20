import { useState, useEffect } from "react";

import type { NavigationItem } from "../constants/navigation";

/**
 * Custom hook to manage sidebar navigation state
 *
 * Handles:
 * - Accordion open/close state
 * - Active navigation item detection based on pathname
 * - Automatic accordion opening when navigating to sub-items
 *
 * @param items - Navigation items configuration
 * @param pathname - Current route pathname
 * @returns Navigation state and helpers
 *
 * @example
 * ```tsx
 * const { openAccordion, setOpenAccordion, isActive } = useSidebarNavigation(
 *   navigationItems,
 *   pathname
 * );
 * ```
 */
export function useSidebarNavigation(
  items: NavigationItem[],
  pathname: string
) {
  // Initialize accordion state based on current pathname
  const [openAccordion, setOpenAccordion] = useState<string | undefined>(() => {
    return items.find(item =>
      item.subItems?.some(sub => pathname.startsWith(sub.href))
    )?.title;
  });

  // Keep accordion open if pathname belongs to its subItems
  useEffect(() => {
    const activeAccordion = items.find(item =>
      item.subItems?.some(sub => pathname.startsWith(sub.href))
    );

    if (activeAccordion) {
      setOpenAccordion(activeAccordion.title);
    }
  }, [pathname, items]);

  /**
   * Check if a navigation item is active based on current pathname
   */
  const isActive = (href?: string, exactMatch: boolean = false): boolean => {
    if (!href) return false;

    // Normalize paths by removing trailing slashes for comparison
    const path = pathname.replace(/\/$/, "");
    const target = href.replace(/\/$/, "");

    // Exact match takes precedence
    if (path === target) return true;

    if (exactMatch) return false;

    // Sub-item match (e.g., /admin/users/create should match /admin/users)
    // Ensure we match whole segments to avoid /admin/user matching /admin/users
    return path.startsWith(target + "/") || path === target;
  };

  return {
    openAccordion,
    setOpenAccordion,
    isActive,
  };
}
