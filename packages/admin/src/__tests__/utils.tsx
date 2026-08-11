import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, RenderOptions, RenderResult } from "@testing-library/react";
import { ReactElement, ReactNode } from "react";

/**
 * Creates a fresh QueryClient for testing
 * Disables retries and error logging for faster, cleaner tests
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
}

/**
 * Custom render function that wraps components with necessary providers
 *
 * Includes QueryClient for TanStack Query hooks, and the shortcut provider that owns the
 * application's single keydown listener: a component registering a shortcut needs an owner to
 * register WITH, exactly as one running a query needs a client, and the admin shell mounts both.
 * Attached to `null` so no listener touches the shared jsdom document — a suite that dispatched a
 * key would otherwise reach every component an earlier test left mounted.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: CustomRenderOptions
): RenderResult {
  const queryClient = options?.queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <ShortcutProvider target={null}>{children}</ShortcutProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

// Re-export everything from React Testing Library
export * from "@testing-library/react";
export { renderWithProviders as render };
