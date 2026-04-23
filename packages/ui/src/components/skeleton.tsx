import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Skeleton Loading Component
 *
 * A flexible loading placeholder component that provides visual feedback while content is loading.
 * Uses a subtle pulse animation to indicate ongoing loading state.
 *
 * @design_specs
 * - Background: bg-accent (slate-100 in light mode, slate-800 in dark mode)
 * - Animation: animate-pulse with motion-reduce:animate-none (respects prefers-reduced-motion)
 * - Border-radius: 0px (rounded-none)
 * - Contrast: 3:1 minimum for WCAG 1.4.11 (Non-text Contrast) compliance
 *
 * @accessibility
 * - Uses aria-hidden="true" to hide from screen readers (visual indicator only)
 * - Skeleton should be purely decorative - actual loading state must be conveyed via:
 *   1. aria-busy="true" on the parent content container
 *   2. Visually hidden loading text for screen readers
 * - Animation automatically disabled when user prefers reduced motion
 * - Reference: https://adrianroselli.com/2020/11/more-accessible-skeletons.html
 *
 * @usage_patterns
 *
 * **Text Line Skeleton:**
 * ```tsx
 * <Skeleton className="h-4 w-[250px]" />
 * ```
 *
 * **Avatar Skeleton:**
 * ```tsx
 * <Skeleton className="h-12 w-12 rounded-full" />
 * ```
 *
 * **Card Skeleton:**
 * ```tsx
 * <div className="space-y-3">
 *   <Skeleton className="h-[125px] w-[250px] rounded-none" />
 *   <div className="space-y-2">
 *     <Skeleton className="h-4 w-[250px]" />
 *     <Skeleton className="h-4 w-[200px]" />
 *   </div>
 * </div>
 * ```
 *
 * **Proper Accessible Loading Pattern:**
 * ```tsx
 * <div aria-busy={isLoading} aria-label="User profile">
 *   {isLoading ? (
 *     <>
 *       <span className="sr-only">Loading user profile...</span>
 *       <Skeleton className="h-12 w-12 rounded-full" />
 *       <Skeleton className="h-4 w-[200px]" />
 *     </>
 *   ) : (
 *     <UserProfile data={userData} />
 *   )}
 * </div>
 * ```
 *
 * @important
 * - DO: Use aria-busy="true" on the parent container while loading
 * - DO: Provide visually hidden loading text for screen readers
 * - DO: Control dimensions via className (h-* w-* utilities)
 * - DON'T: Use aria-live, role="alert", or role="progressbar" on skeleton
 * - DON'T: Use skeleton without aria-busy on parent container
 *
 * @wcag_compliance WCAG 2.2 Level AA
 * - 1.4.11 Non-text Contrast: ✅ 3:1 minimum contrast ratio
 * - 2.3.3 Animation from Interactions: ✅ Respects prefers-reduced-motion
 * - 4.1.3 Status Messages: ✅ When used with aria-busy on parent
 *
 * @see {@link https://ui.shadcn.com/docs/components/skeleton shadcn/ui Skeleton}
 * @see {@link https://adrianroselli.com/2020/11/more-accessible-skeletons.html More Accessible Skeletons}
 */
const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="skeleton"
        aria-hidden="true"
        className={cn(
          "bg-muted dark:bg-muted/20 animate-pulse rounded-none motion-reduce:animate-none",
          className
        )}
        {...props}
      />
    );
  }
);

Skeleton.displayName = "Skeleton";

export type SkeletonProps = React.ComponentProps<"div">;

export { Skeleton };
