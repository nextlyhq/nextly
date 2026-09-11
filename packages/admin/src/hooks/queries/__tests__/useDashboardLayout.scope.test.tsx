/**
 * The layout's `scope` token is a token of the visible set, and the workspace
 * payload is fetched for one visible set and held fresh for minutes. When the
 * token moves between two reads, the workspace is read again; when it does
 * not, nothing is.
 *
 * Asserted as a REFETCH by a LIVE consumer of the workspace key rather than
 * as a call on `invalidateQueries`: an invalidation refetches active queries
 * only, and a spy on the call is satisfied by any key at all.
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_WORKSPACE_KEY } from "@admin/hooks/useSchemaUpdateInvalidation";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get, put: vi.fn(), delete: vi.fn() },
}));

import { useDashboardLayout } from "../useDashboardLayout";

/** The defaults PRODUCTION uses: fresh for minutes, kept for longer, no focus refetch. */
function client() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** A layout answer whose visible set is named by `scope`. */
function layout(scope: string) {
  return {
    placements: [],
    available: [],
    version: 1,
    source: "default",
    columnCount: 3,
    scope,
  };
}

/**
 * The hook mounted beside a live consumer of the workspace key, the way the
 * dashboard sits inside the branding provider.
 */
async function mount(scopes: string[]) {
  let reads = 0;
  get.mockImplementation(async (path: string) => {
    if (path === "/dashboard/layout") {
      const scope = scopes[Math.min(reads, scopes.length - 1)];
      reads += 1;
      return layout(scope);
    }
    throw new Error(`unexpected GET ${path}`);
  });
  const readWorkspace = vi.fn().mockResolvedValue({ widgets: [] });
  let reload: (() => Promise<unknown>) | undefined;

  const WorkspaceConsumer = () => {
    useQuery({
      queryKey: [...ADMIN_WORKSPACE_KEY, true],
      queryFn: readWorkspace,
    });
    return null;
  };
  const Dashboard = () => {
    const result = useDashboardLayout();
    reload = result.reload;
    return null;
  };
  const qc = client();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <>
      <WorkspaceConsumer />
      <Dashboard />
    </>,
    { wrapper }
  );
  // Both first reads, so a later count is a refetch rather than the initial
  // fetch arriving late.
  await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(reads).toBe(1));
  return {
    readWorkspace,
    reload: async () => {
      await act(async () => {
        await reload?.();
      });
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the workspace payload follows the layout's visible set", () => {
  it("is read again when the layout's scope token moves", async () => {
    // 🔴 A grant during the session: the layout re-reads on demand and now
    // places a card whose declaration the cached workspace never carried, so
    // the card was skipped and the picker could offer only its id.
    const { readWorkspace, reload } = await mount(["before", "after"]);

    await reload();

    await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(2));
  });

  it("is NOT read again while the token stands", async () => {
    // The control, and it has to be capable of the outcome ruled out: an
    // invalidation on every layout read would satisfy the case above and
    // would re-read the workspace on every focus and every save.
    const { readWorkspace, reload } = await mount(["same", "same"]);

    await reload();
    await reload();

    expect(readWorkspace).toHaveBeenCalledTimes(1);
  });
});
