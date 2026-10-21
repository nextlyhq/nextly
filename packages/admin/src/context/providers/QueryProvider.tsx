"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

import {
  QUERY_GC_TIME,
  QUERY_RETRY_COUNT,
  QUERY_STALE_TIME,
} from "@admin/constants/query";
import { shouldRetryMutation } from "@admin/lib/api/mutation-retry";

/**
 * QueryProvider - Provides TanStack Query context to the application
 *
 * ## Configuration
 *
 * This provider sets up the QueryClient with optimized defaults for admin CMS use cases:
 *
 * ### Query Defaults
 * - **staleTime: 5 minutes** - Data is considered fresh for 5 minutes before refetching
 *   - Reduces unnecessary API calls for relatively static admin data (users, roles, etc.)
 *   - Balances data freshness with performance
 *
 * - **gcTime: 10 minutes** - Unused data is garbage collected after 10 minutes
 *   - Formerly called `cacheTime` in TanStack Query v4
 *   - Keeps recently viewed data in memory for faster navigation
 *   - Set higher than staleTime for memory efficiency
 *
 * - **retry: 1** - Failed queries retry once before showing error
 *   - Conservative retry for faster error feedback in admin UI
 *   - Prevents long waits on persistent failures
 *
 * - **refetchOnWindowFocus: false** - Prevents refetch when tab regains focus
 *   - Admin users frequently switch tabs (documentation, email, etc.)
 *   - Prevents unexpected refetches that could:
 *     - Cause unnecessary API load
 *     - Interfere with form editing
 *     - Create confusing UI flashes
 *   - Data stays fresh via staleTime, users can manually refresh if needed
 *
 * ### Mutation Defaults
 * - **retry: shouldRetryMutation** - A failed write is retried, up to twice, only
 *   when the server said nothing ran and to try again (`DATABASE_BUSY`,
 *   `RATE_LIMITED`, or a retry hint). Any other failure, a lost response
 *   included, may follow a saved change, and sending it again repeats it.
 *
 * **Note on throwOnError**: Not enabled globally to allow individual mutations
 * to handle errors locally (e.g., inline validation errors). Use per-mutation
 * opt-in with `throwOnError: true` for critical operations that should trigger
 * error boundaries (delete, bulk operations, etc.)
 *
 * ## Development Tools
 *
 * Includes ReactQueryDevtools for development (auto-excluded in production builds).
 * Access devtools via the floating icon in the bottom-right corner.
 *
 * @example
 * ```tsx
 * // In your root layout (already set up in dev app)
 * import { QueryProvider } from '@nextly/admin';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <QueryProvider>{children}</QueryProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/QueryClient - QueryClient docs
 * @see https://tanstack.com/query/v5/docs/react/guides/important-defaults - Important defaults
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Use useState with lazy initializer to ensure stable QueryClient instance
  // This prevents QueryClient recreation on re-renders (TanStack Query best practice)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: QUERY_STALE_TIME,
            gcTime: QUERY_GC_TIME,
            retry: QUERY_RETRY_COUNT,
            refetchOnWindowFocus: false, // Prevent refetch on tab switch (admin CMS UX)
          },
          mutations: {
            retry: shouldRetryMutation,
            // throwOnError: Not enabled globally - use per-mutation opt-in
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
