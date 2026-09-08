"use client";

import type React from "react";

/**
 * Props for the PageContainer component
 *
 * Extends all standard HTML div attributes to allow full flexibility while
 * providing type-safe props for the container component.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <PageContainer>
 *   <h1>Page Title</h1>
 * </PageContainer>
 *
 * // Remove vertical padding
 * <PageContainer className="py-0">
 *   <h1>Page Title</h1>
 * </PageContainer>
 *
 * // Custom max-width
 * <PageContainer className="max-w-4xl">
 *   <h1>Page Title</h1>
 * </PageContainer>
 *
 * // With data-testid for testing
 * <PageContainer data-testid="dashboard-container">
 *   <h1>Dashboard</h1>
 * </PageContainer>
 * ```
 */
export type PageContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Content to be rendered inside the container.
   *
   * Can be any valid React node including strings, numbers, elements,
   * or arrays of these types.
   *
   * @example
   * ```tsx
   * <PageContainer>
   *   <h1>Title</h1>
   *   <p>Content</p>
   * </PageContainer>
   * ```
   */
  children: React.ReactNode;

  /**
   * Optional CSS classes to override or extend default styles.
   *
   * Uses `cn()` utility (tailwind-merge + clsx) for intelligent class merging,
   * so later classes override earlier ones.
   *
   * @example
   * ```tsx
   * // Remove vertical padding
   * <PageContainer className="py-0">...</PageContainer>
   *
   * // Override max-width
   * <PageContainer className="max-w-4xl">...</PageContainer>
   *
   * // Remove horizontal padding
   * <PageContainer className="px-0">...</PageContainer>
   *
   * // Combine multiple overrides
   * <PageContainer className="py-0 max-w-6xl">...</PageContainer>
   * ```
   */
  className?: string;

  /**
   * Bound the content to a reading measure and centre it, instead of letting it
   * run the full width of the panel.
   *
   * `form` is the narrower measure a labelled form reads best at; `wide` suits
   * a page of cards or a table. A child opts back out to the panel's full width
   * with `Bleed`.
   *
   * OMITTING it is not the same as asking for the full width, and the
   * difference is deliberate. With a measure the container becomes a CSS grid
   * whose outer columns are the inset; without one it stays the padded block it
   * has always been. Four pages depend on the block behaviour and would break
   * silently under a grid, because they hand their own height down through a
   * `height: 100%` chain, and a percentage height resolves against a grid area
   * that `align-content: start` has already sized to its content:
   *
   *  - `APIPlayground/ApiPlaygroundPage.tsx` — `flex h-full min-h-0 flex-col
   *    overflow-hidden`, which is what lets its two panes scroll independently
   *    while the request bar stays put
   *  - `schema-builder/BuilderPageLayout.tsx` — `flex-1 pb-0`
   *  - `shared/not-found-page/index.tsx` — centres itself in the full height
   *  - `pages/dashboard/media/index.tsx` — `overflow-hidden`
   *
   * jsdom computes no layout, so no test on those pages can observe the
   * collapse. The default is therefore pinned by a test on THIS component
   * instead: a container given no width must render no grid.
   *
   * `full` removes the cap while KEEPING the gutter, so the column takes
   * whatever the panel gives it and the page still reads as inset rather than
   * edge-to-edge. It is what a page uses when its CONTENT carries the measure
   * instead — an entry editor bounds its own field column and seats the
   * document rail beside it, and a page-level cap there would bound the two
   * together and spend the rail's width out of the author's.
   *
   * That is not the same as omitting `width`, per the paragraph above: `full`
   * is still the grid, so the inset stays a column and a child can leave it
   * with `Bleed`. Omitting stays the padded block.
   *
   * @example
   * ```tsx
   * <PageContainer width="form">
   *   <PageHeader title="Webhooks" />
   *   <WebhookForm />
   * </PageContainer>
   * ```
   */
  width?: "form" | "wide" | "full";
};

/**
 * Ref type for PageContainer component
 *
 * Allows forwarding refs to the underlying div element for
 * imperative operations like scrolling or focus management.
 *
 * @example
 * ```tsx
 * const containerRef = useRef<PageContainerRef>(null);
 *
 * useEffect(() => {
 *   containerRef.current?.scrollIntoView({ behavior: 'smooth' });
 * }, []);
 *
 * return <PageContainer ref={containerRef}>...</PageContainer>;
 * ```
 */
export type PageContainerRef = HTMLDivElement;
