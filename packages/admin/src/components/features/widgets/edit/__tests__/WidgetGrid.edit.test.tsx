/**
 * Editing the dashboard: what the reader can do, what is sent when they save,
 * and what happens when the arrangement is not there.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import { registerCoreComponent } from "@admin/lib/plugins/component-registry-internal";
import type { AdminBranding } from "@admin/types/branding";
import type { DashboardLayoutResponse } from "@admin/types/dashboard/widgets";
import { MAX_PLACEMENTS } from "nextly/config";

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
function branding(
  ids: string[],
  patch: Record<string, Record<string, unknown>> = {}
): AdminBranding {
  return {
    widgets: ids.map(id => ({
      id,
      title: `Widget ${id}`,
      archetype: "custom",
      defaultSize: "full",
      component: "core#Whatever",
      ...patch[id],
    })),
  } as unknown as AdminBranding;
}

function layout(
  placements: Array<{
    id: string;
    widgetId: string;
    order: number;
    hidden?: boolean;
    size?: string;
    column?: number;
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
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      // 🔴 Mirrors the app's own `QueryProvider`, which sets
      // `mutations.retry: MUTATION_RETRY_COUNT`. TanStack does not retry
      // mutations by default, so a test client that stayed silent here could
      // never observe an unwanted retry — the guard against one would read as
      // covered while nothing exercised it. `retryDelay: 0` so the attempts
      // happen in milliseconds rather than in backoff seconds.
      mutations: { retry: 2, retryDelay: 0 },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(<WidgetGrid />, { wrapper: Wrapper }) };
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

describe("the guards a save is sent against", () => {
  it("uses the version the DRAFT was taken from, not the newest one", async () => {
    // 🔴 The silent-overwrite bug. The query refetches on window focus, so
    // another tab can save while this one is editing: the version advances
    // underneath an untouched draft, and a save that reads it fresh then
    // SUCCEEDS against a version its arrangement was never derived from —
    // overwriting the other tab with no conflict reported. The guard was
    // configured out of existence by the refresh policy beside it.
    const { client } = renderGrid();
    const user = await beginEditing();
    await user.click(screen.getAllByTestId("widget-move-down")[0]);

    // Another tab saves, and this tab's layout refreshes underneath the draft.
    // Driven through the client rather than a focus event, because what matters
    // is that a refetch LANDED while editing -- `refetchOnWindowFocus` is one
    // way to reach that state and not the property under test.
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", order: 0 }], {
      version: 99,
      scope: "moved-on",
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["dashboard", "layout"] });
    });
    expect(api.get).toHaveBeenCalledTimes(2);

    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const body = api.put.mock.calls[0][1] as { version: number; scope: string };
    expect(body.version).toBe(3);
    expect(body.scope).toBe("tok");
  });

  it("does not retry a failed save", async () => {
    // A version-guarded write is not idempotent under an AMBIGUOUS failure: if
    // the server commits and the response is lost, a retry sends the same
    // now-stale version, is refused, and tells the reader another editor
    // changed their dashboard — when their own save had already succeeded. The
    // retry manufactures the very conflict the guard exists to report honestly.
    api.put.mockRejectedValue(new Error("network"));
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await screen.findByTestId("dashboard-edit-error");
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("says so when a save fails for a reason that is not a conflict", async () => {
    // Previously only conflicts rendered, so a network error or a 500 left the
    // reader in edit mode with the spinner stopped and nothing said, believing
    // their arrangement had been stored.
    api.put.mockRejectedValue(new Error("boom"));
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await screen.findByTestId("dashboard-edit-error");
    expect(screen.queryByTestId("dashboard-edit-conflict")).toBeNull();
    // And the work is still there.
    expect(
      screen.getAllByTestId("widget-edit-controls").length
    ).toBeGreaterThan(0);
  });
});

describe("a card the reader resized", () => {
  it("renders at its STORED size, not the declaration's", async () => {
    // The stored size IS the arrangement — the layout API preserves it so a
    // card the reader resized stays resized. Reading the declaration instead
    // silently re-sized their dashboard whenever a plugin changed its default.
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", order: 0, size: "sm" },
    ]);
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");

    // `core/a` declares `full`; the placement says `sm`.
    expect(screen.getByTestId("widget-cell-core/a").className).toContain(
      "lg:col-span-3"
    );
  });

  it("falls back to the declaration when the placement stored none", async () => {
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByTestId("widget-cell-core/a").className).toContain(
      "col-span-12"
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

  it("Reload takes the server's arrangement and dismisses itself", async () => {
    // 🔴 Reload only invalidated the query. The editor still preferred its
    // local draft, so the refetched arrangement was never drawn, and the failed
    // mutation kept the alert up -- the reader pressed the one control offered,
    // lost nothing, gained nothing, and was told again to reload.
    const conflict = Object.assign(new Error("changed"), { status: 409 });
    api.put.mockRejectedValue(conflict);
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await screen.findByTestId("dashboard-edit-conflict");

    // What the other tab stored while this one was editing.
    layoutResponse = layout([
      { id: "p3", widgetId: "core/c", order: 0 },
      { id: "p1", widgetId: "core/a", order: 10 },
      { id: "p2", widgetId: "core/b", order: 20 },
    ]);
    await user.click(screen.getByTestId("dashboard-edit-reload"));

    await waitFor(() =>
      expect(
        screen
          .getAllByTestId(/^widget-cell-/)
          .map(node => node.getAttribute("data-testid"))
      ).toEqual([
        "widget-cell-core/c",
        "widget-cell-core/a",
        "widget-cell-core/b",
      ])
    );
    expect(screen.queryByTestId("dashboard-edit-conflict")).toBeNull();
    // The draft is gone, so the reader is out of edit mode rather than looking
    // at server rows they believe are still theirs to save.
    expect(screen.getByTestId("dashboard-edit-begin")).toBeInTheDocument();
  });
});

describe("a widget that draws nothing", () => {
  it("leaves its grid cell with no children, so `empty:hidden` can collapse it", () => {
    // 🔴 The cell hides itself through CSS `:empty`, which counts ELEMENT
    // CHILDREN rather than rendered output -- so an always-present wrapper
    // around the body made every cell non-empty and a widget that drew nothing
    // became a full-width blank slot with its margins. jsdom applies no
    // stylesheet, so the assertion is on the property the rule keys off rather
    // than on the resulting visibility: childless is exactly what `:empty`
    // means.
    registerCoreComponent("core#Nothing", () => null);
    mockBranding = {
      widgets: [
        {
          id: "core/silent",
          title: "Silent",
          archetype: "custom",
          defaultSize: "full",
          // Unframed, which is the only way a body reaches the cell without a
          // card around it -- and the case core's conditional sections use.
          chrome: "none",
          component: "core#Nothing",
        },
      ],
    } as unknown as AdminBranding;
    layoutResponse = layout([{ id: "p1", widgetId: "core/silent", order: 0 }]);
    renderGrid();

    const cell = screen.getByTestId("widget-cell-core/silent");
    expect(cell.childElementCount).toBe(0);
  });

  it("DOES fill its cell when the same widget is framed", () => {
    // The control. Without it the assertion above is satisfied by a grid that
    // rendered nothing at all, or by a testid pointing at the wrong element.
    registerCoreComponent("core#Nothing", () => null);
    mockBranding = {
      widgets: [
        {
          id: "core/framed",
          title: "Framed",
          archetype: "custom",
          defaultSize: "full",
          component: "core#Nothing",
        },
      ],
    } as unknown as AdminBranding;
    layoutResponse = layout([{ id: "p1", widgetId: "core/framed", order: 0 }]);
    renderGrid();

    expect(
      screen.getByTestId("widget-cell-core/framed").childElementCount
    ).toBeGreaterThan(0);
  });
});

describe("re-adding a card the reader removed", () => {
  it("brings back the DECLARED height, not just the width", async () => {
    // 🔴 `defaultPlacements` copies a declared `defaultHeight` onto the initial
    // placement, and the geometry source handed to `addPlacement` returned only
    // the size -- so removing a tall card and adding it back produced one with
    // no stated height, and the next save persisted that. A declared geometry
    // was lost permanently through a gesture that reads as undoable.
    mockBranding = branding(["core/a", "core/b"], {
      "core/b": { defaultHeight: "tall" },
    });
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", order: 0 },
      { id: "p2", widgetId: "core/b", order: 10, size: "full" },
    ]);
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-remove")[1]);
    await user.click(await screen.findByTestId("add-widget-core/b"));
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const sent = api.put.mock.calls[0][1] as {
      placements: Array<{ widgetId: string; height?: string }>;
    };
    const readded = sent.placements.find(p => p.widgetId === "core/b");
    expect(readded).toBeDefined();
    expect(readded?.height).toBe("tall");
  });
});

describe("cancelling after a write failed", () => {
  it("takes the failure message with the draft", async () => {
    // 🔴 The message says "your changes are still here -- try again", which
    // describes the draft. Cancel discarded the draft and left the sentence on
    // screen pointing at nothing, and it was still there the next time the
    // reader entered edit mode.
    api.put.mockRejectedValue(new Error("network"));
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-move-down")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await screen.findByTestId("dashboard-edit-error");

    await user.click(screen.getByTestId("dashboard-edit-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("dashboard-edit-error")).toBeNull()
    );
  });
});

describe("when the schema changes underneath an open dashboard", () => {
  it("re-reads the arrangement, so the picker knows what exists now", () => {
    // 🔴 The layout endpoint answers which cards are PLACED and which are
    // OFFERED, and a schema change moves both: a collection created a moment ago
    // has cards to add, one just deleted no longer does. Nothing else
    // invalidates this key -- `refetchOnWindowFocus` is the only other route --
    // so a dashboard left open kept a picker that could not add the new card and
    // still offered the removed one, whose save is then refused.
    renderGrid();

    return waitFor(() => expect(api.get).toHaveBeenCalledTimes(1)).then(() => {
      act(() => {
        window.dispatchEvent(new Event("nextly:schema-updated"));
      });
      return waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    });
  });

  it("does not re-read on an unrelated event", () => {
    // The control: without it the assertion above is satisfied by a query that
    // refetches on anything at all, including its own render.
    renderGrid();

    return waitFor(() => expect(api.get).toHaveBeenCalledTimes(1)).then(() => {
      act(() => {
        window.dispatchEvent(new Event("nextly:something-else"));
      });
      expect(api.get).toHaveBeenCalledTimes(1);
    });
  });
});

describe("an arrangement that already holds as many cards as a write may carry", () => {
  /** `MAX_PLACEMENTS` placed cards, with one more offered by the picker. */
  function atCapacity() {
    const ids = Array.from({ length: MAX_PLACEMENTS }, (_, i) => `core/w${i}`);
    mockBranding = branding([...ids, "core/surplus"]);
    layoutResponse = layout(
      ids.map((id, i) => ({ id: `p${i}`, widgetId: id, order: i * 10 })),
      { available: ["core/surplus"] }
    );
  }

  it("refuses the add rather than building a draft that cannot be saved", async () => {
    // 🔴 An install declaring more widgets than one submission may hold offers
    // the surplus through `available`, so every picker button built a
    // 201-placement draft the server was always going to refuse -- and the
    // reader met a generic "could not be saved" naming no limit they knew about.
    atCapacity();
    renderGrid();
    const user = await beginEditing();

    const add = await screen.findByTestId("add-widget-core/surplus");
    expect(add).toBeDisabled();
    expect(screen.getByTestId("add-widget-at-capacity")).toBeInTheDocument();

    // The surplus is still LISTED. Hiding it would remove the widget from the
    // one place it is discoverable, which is what the picker exists to prevent.
    expect(add).toBeInTheDocument();
  });

  // The REFUSAL itself is asserted against `addPlacement` in
  // `layout-editor.test.ts`, not here. A test driving the disabled button
  // cannot reach the guard -- the click never fires -- so it passed with the
  // guard deleted, which is no coverage at all. The control that can fail is
  // the one on the pure function.
});

describe("an arrangement with nothing left on it", () => {
  it("KEEPS the way back when every card is put away", async () => {
    // 🔴 The dead end. Deriving the grid's rows from the arrangement meant an
    // all-hidden layout produced no rows, and the early return that draws the
    // three no-widgets states unmounted the edit bar, Reset and the picker
    // along with them -- a blank dashboard with no control left that could undo
    // it. An arrangement must never reach a state it cannot leave.
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", order: 0, hidden: true },
      { id: "p2", widgetId: "core/b", order: 10, hidden: true },
      { id: "p3", widgetId: "core/c", order: 20, hidden: true },
    ]);
    renderGrid();

    expect(
      await screen.findByTestId("dashboard-edit-begin")
    ).toBeInTheDocument();
    expect(screen.getByTestId("widget-grid-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^widget-cell-/)).toHaveLength(0);

    // And the way back WORKS, rather than merely being on screen: editing
    // reveals the put-away cards, which is the only route to bringing one back.
    await beginEditing();
    expect(screen.getAllByTestId(/^widget-cell-/)).toHaveLength(3);
  });

  it("offers Reset and the picker when the arrangement holds no placements", async () => {
    // The other way to reach nothing: every card removed and saved. `available`
    // then lists all three, so the picker is a real way back and not only a
    // control that happens to be mounted.
    layoutResponse = layout([], {
      version: 4,
      available: ["core/a", "core/b", "core/c"],
    });
    const user = userEvent.setup();
    renderGrid();

    await user.click(await screen.findByTestId("dashboard-edit-begin"));

    expect(screen.getByTestId("dashboard-edit-reset")).toBeInTheDocument();
    expect(await screen.findByTestId("add-widget-picker")).toBeInTheDocument();
  });
});

describe("reset", () => {
  it("is not offered when there is no stored row at all", async () => {
    // Version 0 is what "no row" means on the wire; `source: "default"` alone
    // does not, which is the next case.
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", order: 0 }], {
      source: "default",
      version: 0,
    });
    renderGrid();
    await beginEditing();
    expect(screen.queryByTestId("dashboard-edit-reset")).toBeNull();
  });

  it("IS offered when a stored row exists but could not be decoded", async () => {
    // 🔴 The state that had no way out. A row the service cannot decode is
    // reported as `source: "default"` — the dashboard falls back to the
    // registry's order — while keeping its real, non-zero version. Gating Reset
    // on the source hid the one control that could clear it, and with an
    // untouched draft Save is disabled too, so every read went on logging the
    // same decode failure with the reader unable to do anything about it.
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", order: 0 }], {
      source: "default",
      version: 7,
    });
    renderGrid();
    await beginEditing();
    expect(screen.getByTestId("dashboard-edit-reset")).toBeInTheDocument();
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

describe("the dashboard draws columns", () => {
  it("renders one column per the count the SERVER reported", async () => {
    // 🔴 The count comes from the arrangement, not from a client default. A
    // grid that picked its own would draw a dashboard the reader never made
    // and then save that back on their next edit.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 4 }
    );
    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-column-3")).toBeInTheDocument()
    );
  });

  it("draws an EMPTY column, so a card can be moved back into it", async () => {
    // 🔴 A column is a drop target only while it is rendered. Collapsing the
    // empty ones would let a reader move the last card out of a column and
    // never move one back.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 3 }
    );
    renderGrid();
    // 🔴 Waited on the ARRANGEMENT, not on a column. Every column exists from
    // the first paint, so waiting for one is satisfied before the stored
    // layout has arrived — and the default arrangement drawn in the meantime
    // has a card in every column, which is what a weaker wait asserts against.
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    // "Holds no card" rather than an empty DOM node: the column legitimately
    // carries its own drop-target chrome while editing, and a node-level
    // emptiness check would fail on that rather than on a card.
    expect(
      screen
        .getByTestId("widget-column-2")
        .querySelector("[data-testid^='widget-cell-']")
    ).toBeNull();
  });

  it("KEEPS a card whose column is past the count", async () => {
    // 🔴 The property that decides whether narrowing the dashboard destroys
    // work: a card stored in column 3 must still be drawn when the reader has
    // asked for two columns.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 3, order: 0 }],
      { columnCount: 2 }
    );
    renderGrid();
    // 🔴 Wait for the ARRANGEMENT first. Until the stored layout arrives the
    // grid draws the declared defaults, which include core/a in a column that
    // exists — so asserting core/a directly passes whether or not the
    // out-of-range card was kept, and the test certifies nothing. core/b is
    // absent only once the single-placement arrangement is the one on screen.
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    expect(screen.getByText("Widget core/a")).toBeInTheDocument();
    // And it is drawn in the LAST column that exists, not left nowhere.
    expect(
      screen
        .getByTestId("widget-column-1")
        .querySelector("[data-testid^='widget-cell-']")
    ).not.toBeNull();
  });
});

describe("crossing columns without dragging", () => {
  it("offers a CLICKABLE control for every column move a drag can make", async () => {
    // 🔴 WCAG 2.2 SC 2.5.7: anything a drag achieves needs a single-pointer
    // route, and the Understanding document states that a keyboard equivalent
    // does not satisfy it on its own. Dragging a card into another column is
    // new functionality, so these buttons are the conformance — without them
    // the column layout regresses what this toolbar already established.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 3 }
    );
    renderGrid();
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    await beginEditing();
    expect(screen.getByTestId("widget-move-right")).toBeEnabled();
    // Left is refused in the first column: a control that looks available and
    // does nothing is worse than one that says it cannot act.
    expect(screen.getByTestId("widget-move-left")).toBeDisabled();
  });

  it("actually moves the card, rather than only enabling a button", async () => {
    // 🔴 The control the assertion above needs. Rendering an enabled button
    // satisfies "a single-pointer route exists" while clicking it does
    // nothing — which is the shape of a conformance claim that is not true.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 3 }
    );
    renderGrid();
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    const user = await beginEditing();
    expect(
      screen
        .getByTestId("widget-column-0")
        .querySelector("[data-testid^='widget-cell-']")
    ).not.toBeNull();
    await user.click(screen.getByTestId("widget-move-right"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("widget-column-1")
          .querySelector("[data-testid^='widget-cell-']")
      ).not.toBeNull()
    );
  });

  it("hides the sideways controls when there is only ONE column", async () => {
    // A control that can never be enabled is noise in a toolbar a reader tabs
    // through card by card.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 1 }
    );
    renderGrid();
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    await beginEditing();
    expect(screen.queryByTestId("widget-move-right")).toBeNull();
  });
});

describe("choosing how many columns", () => {
  it("REDRAWS the dashboard at the count the reader picked", async () => {
    // 🔴 The whole point of the control. A picker that stores a preference the
    // grid does not read is a setting that appears to work and changes
    // nothing — so this asserts the new column exists, not that a button
    // became selected.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 2 }
    );
    renderGrid();
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    const user = await beginEditing();
    expect(screen.queryByTestId("widget-column-3")).toBeNull();
    await user.click(screen.getByTestId("dashboard-column-choice-4"));
    await waitFor(() =>
      expect(screen.getByTestId("widget-column-3")).toBeInTheDocument()
    );
  });

  it("lets the new count be SAVED", async () => {
    // 🔴 Changing only the count touches no placement, so an unsaved-changes
    // check that compares placements alone leaves Save disabled and the
    // reader cannot keep the layout they are looking at.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 2 }
    );
    renderGrid();
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    const user = await beginEditing();
    expect(screen.getByTestId("dashboard-edit-save")).toBeDisabled();
    await user.click(screen.getByTestId("dashboard-column-choice-3"));
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-save")).toBeEnabled()
    );
  });

  it("SENDS the count with the arrangement", async () => {
    // A placement's `column` only means anything against a count, so saving
    // one without the other leaves a row whose cards name columns it lacks.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 0, order: 0 }],
      { columnCount: 2 }
    );
    renderGrid();
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    const user = await beginEditing();
    await user.click(screen.getByTestId("dashboard-column-choice-4"));
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1]).toMatchObject({ columnCount: 4 });
  });
});

describe("the per-card controls act on the column a reader sees", () => {
  it("moves a card DOWN past its own column's neighbour, not the global one", async () => {
    // 🔴 The arrangement is interleaved across columns, so the card after this
    // one in the whole sequence usually sits in a different column. Resolved
    // globally, Move down swapped two entries and the reader saw nothing move
    // — an enabled control that is not the pointer equivalent of dragging.
    layoutResponse = layout(
      [
        { id: "p1", widgetId: "core/a", column: 0, order: 0 },
        { id: "p2", widgetId: "core/b", column: 1, order: 10 },
        { id: "p3", widgetId: "core/c", column: 0, order: 20 },
      ],
      { columnCount: 2 }
    );
    renderGrid();
    await waitFor(() =>
      expect(screen.getAllByTestId("widget-card-body").length).toBe(3)
    );
    const user = await beginEditing();
    const columnZero = () =>
      Array.from(
        screen
          .getByTestId("widget-column-0")
          .querySelectorAll("[data-testid^='widget-cell-']")
      ).map(node => node.getAttribute("data-testid"));
    expect(columnZero()).toEqual(["widget-cell-core/a", "widget-cell-core/c"]);
    const [firstDown] = screen.getAllByTestId("widget-move-down");
    await user.click(firstDown);
    await waitFor(() =>
      expect(columnZero()).toEqual(["widget-cell-core/c", "widget-cell-core/a"])
    );
  });

  it("offers Left from the column a card is DRAWN in, not its stored one", async () => {
    // 🔴 A card stored past the count is folded into the last column for
    // drawing. Computing from the stored value offered a Left that resolved
    // outside the dashboard and a label naming a column the reader cannot see.
    layoutResponse = layout(
      [{ id: "p1", widgetId: "core/a", column: 3, order: 0 }],
      { columnCount: 2 }
    );
    renderGrid();
    await waitFor(() => expect(screen.queryByText("Widget core/b")).toBeNull());
    const user = await beginEditing();
    const left = screen.getByTestId("widget-move-left");
    expect(left).toBeEnabled();
    await user.click(left);
    await waitFor(() =>
      expect(
        screen
          .getByTestId("widget-column-0")
          .querySelector("[data-testid^='widget-cell-']")
      ).not.toBeNull()
    );
  });
});

describe("a control is offered only where it can act", () => {
  it("DISABLES Up on the first card of every column, not just the first", async () => {
    // 🔴 Derived from the global sequence, the first card of columns 2 and 3
    // had an enabled Up whose neighbour does not exist in its own column — the
    // click resolved against `rowsInColumn` and found nothing, so the control
    // was enabled and inert. That is the SC 2.5.7 failure again, not a
    // cosmetic one.
    layoutResponse = layout(
      [
        { id: "p1", widgetId: "core/a", column: 0, order: 0 },
        { id: "p2", widgetId: "core/b", column: 1, order: 10 },
        { id: "p3", widgetId: "core/c", column: 2, order: 20 },
      ],
      { columnCount: 3 }
    );
    renderGrid();
    await waitFor(() =>
      expect(screen.getAllByTestId("widget-card-body").length).toBe(3)
    );
    await beginEditing();
    // Every card is alone in its column, so no card may move up or down.
    for (const up of screen.getAllByTestId("widget-move-up")) {
      expect(up).toBeDisabled();
    }
    for (const down of screen.getAllByTestId("widget-move-down")) {
      expect(down).toBeDisabled();
    }
  });
});
