import type { Meta, StoryObj } from "@storybook/react";

import { MediaLibrarySkeleton } from "./index";

/**
 * MediaLibrarySkeleton Component Stories
 *
 * Loading skeleton component for the Media Library.
 * Displays placeholder cards in responsive grid while media items are loading.
 *
 * ## Features
 *
 * - **Responsive grid**: Matches MediaGrid layout (2-6 columns)
 * - **Configurable count**: Default 12 cards, customizable via count prop
 * - **Accessible**: aria-busy="true" and aria-label for screen readers
 * - **Animated**: Subtle pulse animation (respects prefers-reduced-motion)
 * - **Consistent spacing**: Same gap-4 spacing as MediaGrid
 *
 * ## Responsive Columns
 *
 * | Breakpoint | Columns | Width |
 * |------------|---------|-------|
 * | Mobile | 2 | < 768px |
 * | Tablet | 4 | 768px - 1024px |
 * | Desktop | 6 | ≥ 1024px |
 *
 */
const meta = {
  title: "Components/Media Library/MediaLibrarySkeleton",
  component: MediaLibrarySkeleton,
  decorators: [
    Story => (
      <div className="w-full max-w-6xl">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Loading skeleton displaying placeholder cards in responsive grid. Shows 12 animated skeleton cards by default while media items are being fetched. Fully accessible with ARIA attributes.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MediaLibrarySkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default - shows 12 skeleton cards in responsive grid.
 * This is the standard loading state for the media library.
 * Skeleton cards pulse with subtle animation.
 */
export const Default: Story = {
  args: {},
};

/**
 * Custom count - shows 6 skeleton cards.
 * Useful for pagination (showing first page of 6 items per page).
 */
export const SixCards: Story = {
  args: {
    count: 6,
  },
};

/**
 * Small count - shows 4 skeleton cards.
 * Useful for limited previews or smaller sections.
 */
export const FourCards: Story = {
  args: {
    count: 4,
  },
};

/**
 * Large count - shows 24 skeleton cards.
 * Useful for high-density views or infinite scroll loading states.
 */
export const TwentyFourCards: Story = {
  args: {
    count: 24,
  },
};

/**
 * Responsive behavior - demonstrates responsive grid columns.
 * Use Storybook's viewport toolbar to test:
 * - Mobile (375px): 2 columns, cards stack 6 rows deep
 * - Tablet (768px): 4 columns, cards stack 3 rows deep
 * - Desktop (1024px+): 6 columns, cards stack 2 rows deep
 */
export const Responsive: Story = {
  render: () => {
    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            📱 Use the viewport toolbar to test responsive columns
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            <li>Mobile (&lt;768px): 2 columns</li>
            <li>Tablet (768px-1024px): 4 columns</li>
            <li>Desktop (≥1024px): 6 columns</li>
          </ul>
        </div>

        <MediaLibrarySkeleton count={12} />
      </div>
    );
  },
};

/**
 * With context - demonstrates skeleton in typical page context.
 * Shows how skeleton appears with header and description text.
 */
export const WithPageContext: Story = {
  render: () => {
    return (
      <div className="space-y-6">
        {/* Page header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-foreground">
            Media Library
          </h1>
          <p className="text-sm text-muted-foreground">
            Loading your media files...
          </p>
        </div>

        {/* Skeleton grid */}
        <MediaLibrarySkeleton count={12} />
      </div>
    );
  },
};

/**
 * Dark mode - demonstrates dark mode styling.
 * Skeleton cards adapt to dark background with appropriate contrast.
 * Toggle dark mode using Storybook's theme toolbar.
 */
export const DarkMode: Story = {
  render: () => {
    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            🌙 Toggle dark mode using the theme toolbar above
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Skeleton cards use bg-accent (slate-100/slate-800) for proper
            contrast
          </p>
        </div>

        <MediaLibrarySkeleton count={12} />
      </div>
    );
  },
  parameters: {
    backgrounds: { default: "dark" },
  },
};

/**
 * Animation disabled - demonstrates reduced motion support.
 * When user prefers reduced motion, pulse animation is disabled.
 * Skeleton cards remain static (no animation).
 *
 * Note: Storybook doesn't directly control prefers-reduced-motion,
 * but this story documents the behavior.
 */
export const ReducedMotion: Story = {
  render: () => {
    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-amber-100 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm text-amber-900 dark:text-amber-100">
            ⚠️ Animation behavior
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            When user has <code>prefers-reduced-motion: reduce</code>, the pulse
            animation is automatically disabled via Tailwind&apos;s{" "}
            <code>motion-reduce:animate-none</code> utility.
          </p>
        </div>

        <MediaLibrarySkeleton count={12} />

        <div className="rounded border border-border bg-muted p-4">
          <p className="text-xs text-muted-foreground">
            To test: Enable &quot;Reduce motion&quot; in your OS accessibility
            settings
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            <li>
              macOS: System Settings → Accessibility → Display → Reduce motion
            </li>
            <li>
              Windows: Settings → Accessibility → Visual effects → Animation
              effects
            </li>
            <li>Linux: Varies by desktop environment</li>
          </ul>
        </div>
      </div>
    );
  },
};

/**
 * Comparison with actual cards - side-by-side comparison.
 * Shows how skeleton aligns with actual MediaCard dimensions.
 */
export const ComparisonWithCards: Story = {
  render: () => {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="mb-3 text-sm font-semibold">
            Loading state (Skeleton)
          </h3>
          <MediaLibrarySkeleton count={6} />
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="mb-3 text-sm font-semibold">
            Loaded state (Would show actual MediaCards here)
          </h3>
          <div className="rounded border border-border bg-muted p-4">
            <p className="text-sm text-muted-foreground">
              After media loads, skeleton is replaced with MediaGrid containing
              MediaCard components. The grid layout remains identical.
            </p>
          </div>
        </div>
      </div>
    );
  },
};
