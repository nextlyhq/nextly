/**
 * The workspace payload is built for one audience -- the cards a reader may
 * see and the shortcut gates inside them -- and held fresh for minutes. Each
 * layout read reports the audience the payload SHOULD be built for, and the
 * payload is read again whenever the one it holds says otherwise, including on
 * the first layout read of a visit.
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

/** A layout answer reporting the audience the workspace should be built for. */
function layout(audience: string) {
  return {
    placements: [],
    available: [],
    version: 1,
    source: "default",
    columnCount: 3,
    scope: "scope",
    audience,
  };
}

/** Successive answers from a list, the last one repeating. */
function answers<T>(list: readonly T[]): () => T {
  let read = 0;
  return () => list[Math.min(read++, list.length - 1)];
}

/**
 * A workspace payload cached BEFORE the dashboard is visited -- as it is when
 * a reader signs in elsewhere in the admin first -- and then the dashboard
 * mounted beside the live consumer of that payload.
 */
async function visit(options: {
  layoutAudiences: readonly string[];
  /** `undefined` for a payload that carries no token at all. */
  workspaceAudiences: ReadonlyArray<string | undefined>;
}) {
  const nextLayout = answers(options.layoutAudiences);
  let layoutReads = 0;
  get.mockImplementation(async (path: string) => {
    if (path === "/dashboard/layout") {
      layoutReads += 1;
      return layout(nextLayout());
    }
    throw new Error(`unexpected GET ${path}`);
  });
  const nextWorkspace = answers(options.workspaceAudiences);
  const readWorkspace = vi.fn(async () => {
    const widgetAudience = nextWorkspace();
    return widgetAudience === undefined
      ? { widgets: [] }
      : { widgets: [], widgetAudience };
  });
  let reload: (() => Promise<unknown>) | undefined;
  // The audience the dashboard has DRAWN, not the one it has asked for: a
  // read in flight can be superseded before it renders, and counting calls
  // would take a read nobody saw for one the hook compared.
  let drawn: string | undefined;

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
    drawn = result.layout?.audience;
    return null;
  };
  const qc = client();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  const view = render(<WorkspaceConsumer />, { wrapper });
  await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(1));
  view.rerender(
    <>
      <WorkspaceConsumer />
      <Dashboard />
    </>
  );
  await waitFor(() => expect(drawn).toBe(options.layoutAudiences[0]));
  expect(layoutReads).toBe(1);

  return {
    readWorkspace,
    drawn: () => drawn,
    reload: async () => {
      await act(async () => {
        await reload?.();
      });
    },
    /** Lets any refetch already started settle before counting. */
    settle: async () => {
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the workspace payload follows the audience the layout reports", () => {
  it("is read again on the FIRST layout read when the payload it holds was built for another audience", async () => {
    // 🔴 A grant landed before the reader's first dashboard visit. Remembering
    // the layout's previous token could not see this: there was none, so the
    // first one was taken to describe the cached payload, and a card the
    // server now placed had no declaration to draw with.
    const { readWorkspace, settle } = await visit({
      workspaceAudiences: ["before", "after"],
      layoutAudiences: ["after"],
    });

    await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(2));
    // And once: the payload read again agrees, so nothing reads it a third time.
    await settle();
    expect(readWorkspace).toHaveBeenCalledTimes(2);
  });

  it("is read again when a LATER layout read reports a different audience", async () => {
    const { readWorkspace, reload, drawn, settle } = await visit({
      workspaceAudiences: ["a", "b"],
      layoutAudiences: ["a", "b"],
    });
    // The first read was drawn and agreed, so nothing was read again for it.
    await settle();
    expect(readWorkspace).toHaveBeenCalledTimes(1);

    await reload();

    await waitFor(() => expect(drawn()).toBe("b"));
    await waitFor(() => expect(readWorkspace).toHaveBeenCalledTimes(2));
  });

  it("is NOT read again while the payload was built for the layout's audience", async () => {
    // The control, and it has to be capable of the outcome ruled out: a
    // re-read on every layout read would satisfy both cases above and read
    // the workspace on every focus and every save.
    const { readWorkspace, reload, settle } = await visit({
      workspaceAudiences: ["same"],
      layoutAudiences: ["same"],
    });

    await reload();
    await reload();
    await settle();

    expect(readWorkspace).toHaveBeenCalledTimes(1);
  });

  it("leaves a payload that carries no token alone, whatever the layout reports", async () => {
    // A payload without a token says nothing about the audience it was built
    // for, which is not the same as saying it was built for another one.
    const { readWorkspace, reload, settle } = await visit({
      workspaceAudiences: [undefined],
      layoutAudiences: ["x", "y"],
    });

    await reload();
    await settle();

    expect(readWorkspace).toHaveBeenCalledTimes(1);
  });
});
