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
