/**
 * Editing the dashboard: what the reader can do, what is sent when they save,
 * and what happens when the arrangement is not there.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { AdminBranding } from "@admin/types/branding";
import type { DashboardLayoutResponse } from "@admin/types/dashboard/widgets";

import { WidgetGrid } from "../../WidgetGrid";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;
let layoutRejects = false;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const api = vi.mocked(protectedApi);

/** Three registered widgets, drawn by a component so no query is issued. */
function branding(ids: string[]): AdminBranding {
  return {
    widgets: ids.map(id => ({
      id,
      title: `Widget ${id}`,
      archetype: "custom",
      defaultSize: "full",
      component: "core#Whatever",
    })),
  } as unknown as AdminBranding;
}

function layout(
  placements: Array<{
    id: string;
    widgetId: string;
    order: number;
    hidden?: boolean;
  }>,
  patch: Partial<DashboardLayoutResponse> = {}
): DashboardLayoutResponse {
  return {
    placements: placements.map(p => ({ ...p, hidden: p.hidden ?? false })),
    available: [],
    version: 3,
    source: "own",
    scope: "tok",
    ...patch,
  };
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<WidgetGrid />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  layoutRejects = false;
  mockBranding = branding(["core/a", "core/b", "core/c"]);
  layoutResponse = layout([
    { id: "p1", widgetId: "core/a", order: 0 },
    { id: "p2", widgetId: "core/b", order: 10 },
    { id: "p3", widgetId: "core/c", order: 20 },
  ]);
  api.get.mockImplementation(() =>
    layoutRejects
      ? Promise.reject(new Error("layout unavailable"))
      : Promise.resolve(layoutResponse)
  );
  api.put.mockResolvedValue({ message: "ok", item: {} });
  api.delete.mockResolvedValue({ message: "ok" });
});

/** Enters edit mode and waits for the per-card controls to exist. */
async function beginEditing() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("dashboard-edit-begin"));
  await screen.findAllByTestId("widget-edit-controls");
  return user;
}

describe("when the arrangement has not been read", () => {
  it("still draws the declared widgets", async () => {
    // 🔴 The regression this guards. Deriving the grid from the layout alone
    // blanked the entire dashboard while the request was in flight — every page
    // load — and for the whole of any outage. A personalization feature must
    // not be able to take the page down when its own endpoint is unavailable.
    layoutRejects = true;
    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-core/a")).toBeInTheDocument()
    );
    expect(screen.getByTestId("widget-cell-core/b")).toBeInTheDocument();
    expect(screen.getByTestId("widget-cell-core/c")).toBeInTheDocument();
  });

  it("does not offer editing, because a write would have nothing to guard it", async () => {
    layoutRejects = true;
    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-core/a")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("dashboard-edit-begin")).toBeNull();
  });
});

describe("entering edit mode", () => {
  it("shows controls on every card", async () => {
    renderGrid();
    await beginEditing();
    expect(screen.getAllByTestId("widget-edit-controls")).toHaveLength(3);
  });

  it("orders cards by the arrangement, not the declaration order", async () => {
    layoutResponse = layout([
      { id: "p3", widgetId: "core/c", order: 0 },
      { id: "p1", widgetId: "core/a", order: 10 },
      { id: "p2", widgetId: "core/b", order: 20 },
    ]);
    renderGrid();
    // Waits for the EDIT BUTTON, not for a cell. Every cell exists in the
    // fallback too — the declared order renders before the arrangement lands —
    // so awaiting one is satisfied by the state this test exists to tell apart,
    // and the assertion ran against the fallback. The button is rendered only
    // once an arrangement has actually been read.
    await screen.findByTestId("dashboard-edit-begin");

    const cells = screen
      .getAllByTestId(/^widget-cell-/)
      .map(node => node.getAttribute("data-testid"));
    expect(cells).toEqual([
      "widget-cell-core/c",
      "widget-cell-core/a",
      "widget-cell-core/b",
    ]);
  });
});

describe("moving a card without a drag", () => {
  it("disables Move up on the first and Move down on the last", async () => {
    // The single-pointer alternative WCAG 2.5.7 requires. Its affordances have
    // to be right at the ends or a reader is offered a move that cannot happen.
    renderGrid();
    await beginEditing();

    const ups = screen.getAllByTestId("widget-move-up");
    const downs = screen.getAllByTestId("widget-move-down");
    expect(ups[0]).toBeDisabled();
    expect(downs[downs.length - 1]).toBeDisabled();
    expect(ups[1]).toBeEnabled();
    expect(downs[0]).toBeEnabled();
  });

  it("reorders the grid", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);

    const cells = screen
      .getAllByTestId(/^widget-cell-/)
      .map(node => node.getAttribute("data-testid"));
    expect(cells.slice(0, 2)).toEqual([
      "widget-cell-core/b",
      "widget-cell-core/a",
    ]);
  });

  it("says where the card landed", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);

    // Through the grid's ONE region -- a move is not worth a second announcer.
    expect(screen.getByTestId("widget-grid-live").textContent).toMatch(
      /Widget core\/a moved to position 2 of 3/
    );
  });

  it("names the position in each button, so a reader knows where they are", async () => {
    renderGrid();
    await beginEditing();

    expect(screen.getAllByTestId("widget-move-down")[0]).toHaveAttribute(
      "aria-label",
      "Move Widget core/a down, currently position 1 of 3"
    );
  });
});

describe("hiding and removing", () => {
  it("keeps a hidden card on screen WHILE editing, so it can be brought back", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-toggle-hidden")[0]);

    expect(screen.getByTestId("widget-cell-core/a")).toBeInTheDocument();
  });

  it("removes a card from the grid entirely", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-remove")[0]);

    expect(screen.queryByTestId("widget-cell-core/a")).toBeNull();
    expect(screen.getByTestId("widget-cell-core/b")).toBeInTheDocument();
  });

  it("labels the two by their consequence, not their gesture", async () => {
    // The pair a reader confuses. "Hide" alone reads as a synonym for
    // "remove" to somebody deciding between them.
    renderGrid();
    await beginEditing();

    expect(screen.getAllByTestId("widget-toggle-hidden")[0]).toHaveAttribute(
      "aria-label",
      "Hide Widget core/a, keeping its position and settings"
    );
    expect(screen.getAllByTestId("widget-remove")[0]).toHaveAttribute(
      "aria-label",
      "Remove Widget core/a from the dashboard, losing its position and settings"
    );
  });
});

describe("adding a widget", () => {
  it("offers what the server said is available", async () => {
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", order: 0 }], {
      available: ["core/b"],
    });
    renderGrid();
    await beginEditing();

    expect(screen.getByTestId("add-widget-core/b")).toBeInTheDocument();
  });

  it("offers a card the reader just removed", async () => {
    // Recomputed against the DRAFT. The server's list was true when the read
    // landed; a card removed since is offerable again, and one just added is
    // not.
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-remove")[0]);

    expect(screen.getByTestId("add-widget-core/a")).toBeInTheDocument();
  });

  it("stops offering one that has been added", async () => {
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", order: 0 }], {
      available: ["core/b"],
    });
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getByTestId("add-widget-core/b"));

    expect(screen.queryByTestId("add-widget-core/b")).toBeNull();
    expect(screen.getByTestId("widget-cell-core/b")).toBeInTheDocument();
  });

  it("says so when everything is already placed", async () => {
    // An empty picker and a picker that failed to load look identical.
    renderGrid();
    await beginEditing();
    expect(screen.getByTestId("add-widget-empty")).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("sends renumbered placements with BOTH guards", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [path, body] = api.put.mock.calls[0] as [
      string,
      {
        placements: Array<{ id: string; order: number }>;
        version: number;
        scope: string;
      },
    ];
    expect(path).toBe("/dashboard/layout");
    expect(body.version).toBe(3);
    expect(body.scope).toBe("tok");
    // 🔴 Renumbered from the ARRAY. The editor reorders an array, so a moved
    // card still carries the order it had before -- sent as-is, the server
    // sorts by a number that no longer matches what the reader sees.
    expect(body.placements.map(p => p.id)).toEqual(["p2", "p1", "p3"]);
    expect(body.placements.map(p => p.order)).toEqual([0, 10, 20]);
  });

  it("cannot be pressed with nothing to save", async () => {
    renderGrid();
    await beginEditing();
    expect(screen.getByTestId("dashboard-edit-save")).toBeDisabled();
  });

  it("leaves edit mode when it lands", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() =>
      expect(screen.queryByTestId("widget-edit-controls")).toBeNull()
    );
  });
});

describe("cancelling", () => {
  it("puts the arrangement back", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-cancel"));

    const cells = screen
      .getAllByTestId(/^widget-cell-/)
      .map(node => node.getAttribute("data-testid"));
    expect(cells).toEqual([
      "widget-cell-core/a",
      "widget-cell-core/b",
      "widget-cell-core/c",
    ]);
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe("a conflict", () => {
  it("explains it and KEEPS the reader's work on screen", async () => {
    // Both guards refuse the same way and the remedy is a re-read, which
    // discards the draft. Doing that automatically would throw the reader's
    // work away at the exact moment they are told to try again.
    const conflict = Object.assign(new Error("changed"), { status: 409 });
    api.put.mockRejectedValue(conflict);
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await screen.findByTestId("dashboard-edit-conflict");
    const cells = screen
      .getAllByTestId(/^widget-cell-/)
      .map(node => node.getAttribute("data-testid"));
    expect(cells.slice(0, 2)).toEqual([
      "widget-cell-core/b",
      "widget-cell-core/a",
    ]);
  });
});

describe("reset", () => {
  it("is offered only to a reader who has an arrangement of their own", async () => {
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", order: 0 }], {
      source: "default",
    });
    renderGrid();
    await beginEditing();
    expect(screen.queryByTestId("dashboard-edit-reset")).toBeNull();
  });

  it("deletes the row rather than writing the current defaults", async () => {
    // A written snapshot freezes today's defaults, so a widget added later
    // never reaches a reader who has "reset".
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getByTestId("dashboard-edit-reset"));

    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    expect(api.put).not.toHaveBeenCalled();
  });
});
