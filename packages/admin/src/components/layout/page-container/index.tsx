import React from "react";

import { cn } from "@admin/lib/utils";
import type { PageContainerProps } from "@admin/types/layout/page-container";

/**
 * Page Container Component
 *
 * A responsive container component that provides consistent spacing and max-width
 * constraints for page content. Part of the layout primitives for building
 * consistent page layouts across the admin application.
 *
 * ## Design Specifications
 *
 * - **Max-width**: Responsive via Tailwind `container` utility
 *   - Mobile: 100% width
 *   - sm (640px+): max-width 640px
 *   - md (768px+): max-width 768px
 *   - lg (1024px+): max-width 1024px
 *   - xl (1280px+): max-width 1280px
 * - **Horizontal Padding**: Mobile-first responsive
 *   - Mobile (< 640px): 16px (px-4)
 *   - Tablet (640px-1023px): 24px (sm:px-6)
 *   - Desktop (1024px+): 32px (lg:px-8)
 * - **Vertical Padding**: Mobile-first responsive
 *   - Mobile (< 640px): 24px (py-6)
 *   - Desktop (640px+): 32px (sm:py-8)
 * - **Spacing System**: 8px grid (4, 6, 8 units = 16px, 24px, 32px)
 *
 * ## Usage
 *
 * ### Basic Usage
 *
 * ```tsx
 * import { PageContainer } from "@nextly/admin";
 *
 * export function DashboardPage() {
 *   return (
 *     <PageContainer>
 *       <h1>Dashboard</h1>
 *       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 *         <StatsCard title="Users" value="1,234" />
 *         <StatsCard title="Active" value="45" />
 *         <StatsCard title="Content" value="890" />
 *       </div>
 *     </PageContainer>
 *   );
 * }
 * ```
 *
 * ### With Custom ClassName
 *
 * Override default spacing or add additional styles:
 *
 * ```tsx
 * // No vertical padding
 * <PageContainer className="py-0">
 *   ...
 * </PageContainer>
 *
 * // Narrower max-width
 * <PageContainer className="max-w-4xl">
 *   ...
 * </PageContainer>
 * ```
 *
 * ### With Grid Layout
 *
 * ```tsx
 * <PageContainer>
 *   <div className="space-y-6">
 *     <h1 className="text-3xl font-semibold">Users</h1>
 *     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
 *       {users.map(user => (
 *         <UserCard key={user.id} user={user} />
 *       ))}
 *     </div>
 *   </div>
 * </PageContainer>
 * ```
 *
 * ## Accessibility
 *
 * - No specific accessibility concerns (pure layout component)
 * - Maintains proper reading width on large screens via max-width
 * - Responsive padding ensures touch targets aren't cut off on mobile
 *
 * ## Architecture Context
 *
 * This component is part of the Nextly admin package (`@nextly/admin`) which
 * will be published as an npm package. It provides consistent page layouts without
 * enforcing specific content structure - pages control their own layout (grid, flex, etc.).
 *
 * ## Design System
 *
 * Part of Layout Components from Sprint 1 design system implementation.
 * Follows the 8px grid spacing system and mobile-first responsive design principles.
 *
 * @see Tailwind Container utility: https://tailwindcss.com/docs/container
 *
 * @example
 * ```tsx
 * <PageContainer>
 *   <h1>My Page Title</h1>
 *   <p>Page content goes here...</p>
 * </PageContainer>
 * ```
 */
export const PageContainer = React.forwardRef<
  HTMLDivElement,
  PageContainerProps
>(({ children, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-testid="page-container"
      className={cn(
        // Responsive max-width container (Full width requested)
        "w-full max-w-full min-h-[calc(100vh-4rem)]",
        // Horizontal padding: 16px → 24px → 32px
        "px-4 sm:px-6 lg:px-8",
        // Vertical padding: 24px → 32px
        "py-6 sm:py-8",
        // Background (Use slate-100 as requested for full content bg)
        "admin-page-container",
        // Custom overrides
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});

PageContainer.displayName = "PageContainer";
