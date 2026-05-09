/**
 * TanStack Query Constants
 *
 * Centralized configuration values for React Query setup.
 * These values are used across query hooks and the QueryClient provider.
 *
 * ## Rationale
 *
 * - Extracted from inline magic numbers for maintainability
 * - Single source of truth for query configuration
 * - Easy to adjust behavior globally (e.g., increase cache time for production)
 * - Self-documenting with clear naming
 *
 * @see context/providers/QueryProvider.tsx - Global QueryClient configuration
 */

/**
 * Time in milliseconds that data is considered fresh before refetching.
 *
 * **5 minutes (300,000 ms)** - Balances data freshness with performance for admin CMS.
 *
 * @default 300000 (5 minutes)
 */
export const QUERY_STALE_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Time in milliseconds before unused query data is garbage collected from memory.
 *
 * **10 minutes (600,000 ms)** - Keeps recently viewed data in cache for fast navigation.
 * Set higher than staleTime for memory efficiency.
 *
 * @default 600000 (10 minutes)
 */
export const QUERY_GC_TIME = 10 * 60 * 1000; // 10 minutes

/**
 * Number of retry attempts for failed query requests.
 *
 * **1 retry** - Conservative retry for faster error feedback in admin UI.
 *
 * @default 1
 */
export const QUERY_RETRY_COUNT = 1;

/**
 * Number of retry attempts for failed mutation requests.
 *
 * **2 retries** - Write operations are more critical, handle transient issues.
 *
 * @default 2
 */
export const MUTATION_RETRY_COUNT = 2;
