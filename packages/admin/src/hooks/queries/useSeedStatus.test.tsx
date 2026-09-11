import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedApi, type SeedResult } from "@admin/services/seedApi";

import { DASHBOARD_LAYOUT_KEY } from "./useDashboardLayout";
import { useSeedStatus } from "./useSeedStatus";

/** One successful seed, shared by every case that needs the mutation to land. */
function seedResult(): SeedResult {
  return {
    message: "Demo content seeded.",
    summary: {
      rolesCreated: 3,
      usersCreated: 3,
      categoriesCreated: 5,
      tagsCreated: 8,
      postsCreated: 12,
      mediaUploaded: 14,
      mediaSkipped: 0,
      collectionsRegistered: 0,
      singlesRegistered: 0,
      permissionsSynced: 0,
    },
    warnings: [],
  };
}

vi.mock("@admin/services/seedApi", () => ({
  seedApi: {
    probe: vi.fn(),
    runSeed: vi.fn(),
    getStatus: vi.fn(),
    setSkipped: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSeedStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in 'loading' state while the probe is in flight", () => {
    vi.mocked(seedApi.probe).mockImplementation(() => new Promise(() => {}));
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    expect(result.current.status.kind).toBe("loading");
  });

  it("transitions to 'hidden' when probe returns unavailable", async () => {
    vi.mocked(seedApi.probe).mockResolvedValue({ available: false });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("hidden"));
  });

  it("transitions to 'hidden' when seed.completedAt is set", async () => {
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: "2026-05-04T00:00:00.000Z",
      skippedAt: null,
    });
    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("hidden"));
  });

  it("transitions to 'hidden' when seed.skippedAt is set", async () => {
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: "2026-05-04T00:00:00.000Z",
    });
    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("hidden"));
  });

  it("transitions to 'idle' when probe ok and no meta flags set", async () => {
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("idle"));
    if (result.current.status.kind === "idle") {
      expect(result.current.status.template).toEqual({
        slug: "blog",
        label: "Blog",
      });
    }
  });

  it("startSeed transitions idle → seeding → success", async () => {
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    vi.mocked(seedApi.runSeed).mockResolvedValue(seedResult());

    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("idle"));

    act(() => {
      result.current.startSeed();
    });

    await waitFor(() => expect(result.current.status.kind).toBe("success"));
    if (result.current.status.kind === "success") {
      expect(result.current.status.result.summary.postsCreated).toBe(12);
    }
  });

  it("seed error transitions to 'error' with server message", async () => {
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    vi.mocked(seedApi.runSeed).mockRejectedValue(
      new Error("Permission sync failed: posts:create")
    );

    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("idle"));

    act(() => {
      result.current.startSeed();
    });

    await waitFor(() => expect(result.current.status.kind).toBe("error"));
    if (result.current.status.kind === "error") {
      expect(result.current.status.message).toContain("Permission sync failed");
    }
  });

  it("refetches the dashboard layout once seeding succeeds", async () => {
    // 🔴 Seeding is the moment the get-started card's condition stops holding,
    // so the widget set the server offers -- and the scope token guarding a
    // save of it -- both change. The layout query does not poll, so the open
    // dashboard kept the stale arrangement and the next save was refused with a
    // scope conflict the reader did nothing to cause.
    //
    // Asserted as a REFETCH by a live consumer of the key rather than as a call
    // on `invalidateQueries`: a spy is satisfied by any key at all, including
    // one no query is mounted under.
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    vi.mocked(seedApi.runSeed).mockResolvedValue(seedResult());

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const readLayout = vi.fn().mockResolvedValue({ placements: [] });

    const { result } = renderHook(
      () => ({
        seed: useSeedStatus(),
        layout: useQuery({
          queryKey: DASHBOARD_LAYOUT_KEY,
          queryFn: readLayout,
        }),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );

    await waitFor(() => expect(result.current.seed.status.kind).toBe("idle"));
    await waitFor(() => expect(readLayout).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.seed.startSeed();
    });

    await waitFor(() => expect(readLayout).toHaveBeenCalledTimes(2));
  });

  it("refetches the dashboard layout once the offer is DECLINED", async () => {
    // 🔴 Declining now closes `seed:unanswered`, so the server stops offering
    // this card exactly as it does after a successful seed. Skip used to change
    // nothing the host could see, which is why only the seed path invalidated
    // -- and that made this the one gesture that left the open dashboard
    // holding a placement the server had dropped. Entering edit mode then
    // surfaces it, and saving is refused on the scope token.
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    vi.mocked(seedApi.setSkipped).mockResolvedValue(undefined);

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const readLayout = vi.fn().mockResolvedValue({ placements: [] });

    const { result } = renderHook(
      () => ({
        seed: useSeedStatus(),
        layout: useQuery({
          queryKey: DASHBOARD_LAYOUT_KEY,
          queryFn: readLayout,
        }),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );

    await waitFor(() => expect(result.current.seed.status.kind).toBe("idle"));
    await waitFor(() => expect(readLayout).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.seed.skip();
    });

    await waitFor(() => expect(readLayout).toHaveBeenCalledTimes(2));
  });

  it("skip writes skippedAt and transitions to hidden", async () => {
    vi.mocked(seedApi.probe).mockResolvedValue({
      available: true,
      template: { slug: "blog", label: "Blog" },
    });
    vi.mocked(seedApi.getStatus).mockResolvedValue({
      completedAt: null,
      skippedAt: null,
    });
    vi.mocked(seedApi.setSkipped).mockResolvedValue(undefined);

    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("idle"));

    act(() => {
      result.current.skip();
    });

    await waitFor(() => expect(result.current.status.kind).toBe("hidden"));
    expect(seedApi.setSkipped).toHaveBeenCalledTimes(1);
  });
});
