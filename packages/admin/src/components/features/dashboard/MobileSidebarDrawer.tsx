"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetClose,
  SheetTitle,
} from "@revnixhq/ui";

import { Laptop, X } from "@admin/components/icons";
import { SidebarContent, SidebarGroup } from "@admin/components/layout/sidebar";
import { Link } from "@admin/components/ui/link";
import type { NavigationItem } from "@admin/constants/navigation";
import { MOBILE_DRAWER_WIDTH } from "@admin/constants/sidebar";

import { useBranding } from "../../../context/providers/BrandingProvider";
import { ThemeAwareLogo } from "../../shared/ThemeAwareLogo";

import { SidebarNavigation } from "./SidebarNavigation";

interface MobileSidebarDrawerProps {
  /** Whether the drawer is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Navigation items */
  navigationItems: NavigationItem[];
  /** Function to check if a route is active */
  isActive: (href?: string) => boolean;
}

/**
 * Mobile Sidebar Drawer Component
 *
 * Provides mobile navigation via a slide-in drawer (Sheet component).
 *
 * ## Design Specifications
 *
 * - **Breakpoint**: Visible on mobile only (< 768px via md:hidden)
 * - **Width**: 288px (MOBILE_DRAWER_WIDTH)
 * - **Side**: Left (drawer slides in from left)
 * - **Theme**: Dark (matches desktop sidebar using semantic tokens)
 * - **Close Behavior**: Closes on navigation, overlay click, or Escape key
 *
 * ## Features
 *
 * - Hamburger menu button (44×44px touch target for WCAG 2.2 AA)
 * - App logo and branding in header
 * - Navigation with accordion support
 * - User footer with profile information
 * - Automatic close on route navigation
 *
 * ## Close Behavior
 *
 * The drawer automatically closes when:
 * 1. **Navigation Link Click**: When any navigation link (via Link component)
 *    is clicked, the SPA routing triggers and the parent component should close
 *    the drawer by setting `open={false}`. This is typically handled by monitoring
 *    route changes in the parent layout component.
 * 2. **Overlay Click**: Clicking the semi-transparent backdrop closes the drawer
 *    (handled by Radix UI Dialog/Sheet primitive).
 * 3. **Escape Key**: Pressing Escape closes the drawer (handled by Radix UI).
 * 4. **Close Button**: Clicking the X button in the top-right closes the drawer.
 *
 * **Implementation Note**: The parent component (DashboardLayout) should listen
 * to route changes (via `useRouter` hook) and call `setMobileDrawerOpen(false)`
 * when the pathname changes to ensure the drawer closes after navigation.
 *
 * ## Accessibility
 *
 * - Focus trapping within drawer when open
 * - Escape key closes drawer
 * - Overlay click closes drawer
 * - Proper ARIA labels on trigger button
 * - 44×44px minimum touch targets
 *
 * ## Usage
 *
 * ```tsx
 * import { MobileSidebarDrawer } from '@nextly/admin';
 *
 * function Layout() {
 *   const [open, setOpen] = useState(false);
 *   const { user } = useDashboardUser();
 *
 *   return (
 *     <>
 *       <MobileSidebarDrawer
 *         open={open}
 *         onOpenChange={setOpen}
 *         user={user}
 *         navigationItems={SIDEBAR_NAVIGATION}
 *         openAccordion={openAccordion}
 *         onAccordionChange={setOpenAccordion}
 *         isActive={isActive}
 *       />
 *       <main>{children}</main>
 *     </>
 *   );
 * }
 * ```
 */
export function MobileSidebarDrawer({
  open,
  onOpenChange,
  navigationItems,
  isActive,
}: MobileSidebarDrawerProps) {
  const branding = useBranding();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="p-0 bg-sidebar-background text-sidebar-foreground border-sidebar-border flex flex-col h-full"
        style={{ width: `${MOBILE_DRAWER_WIDTH}px` }}
      >
        {/* Header */}
        <SheetHeader className="flex flex-row h-16 items-center justify-between gap-3 px-6 border-b border-sidebar-border space-y-0 text-left">
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <Link href="/admin" className="flex items-center gap-3">
            {branding.logoUrl ||
            branding.logoUrlLight ||
            branding.logoUrlDark ? (
              <ThemeAwareLogo
                alt={branding.logoText ?? "Logo"}
                className="h-6 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <>
                <div className="flex items-center justify-center rounded-lg bg-primary p-2.5">
                  <Laptop className="h-6 w-6 text-primary-foreground transition-colors duration-200" />
                </div>
                <span className="text-base font-semibold tracking-wide text-sidebar-foreground">
                  {branding.logoText ?? "Nextly"}
                </span>
              </>
            )}
          </Link>

          {/* Close button placed inside header so it aligns with logo */}
          <SheetClose className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4 text-sidebar-foreground" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </SheetHeader>

        {/* Navigation */}
        <SidebarContent
          className="flex-1 overflow-y-auto py-4 px-3
            [&::-webkit-scrollbar]:w-2
            [&::-webkit-scrollbar-track]:bg-transparent
            [&::-webkit-scrollbar-thumb]:rounded-full
            [&::-webkit-scrollbar-thumb]:bg-muted
            hover:[&::-webkit-scrollbar-thumb]:bg-accent"
        >
          <SidebarGroup>
            <SidebarNavigation
              items={navigationItems}
              isActive={isActive}
              hideLabels={["Main"]}
            />
          </SidebarGroup>
        </SidebarContent>

        {/* Footer Removed - Request from User */}
      </SheetContent>
    </Sheet>
  );
}
