/**
 * Sending a card away from the card itself, outside customise mode, and
 * taking that back.
 *
 * The dismiss control is drawn outside customise mode and commits on its own,
 * because the editor's mutations write to a draft that does not exist there.
 * It leaves the same notice a Remove in customise mode does, and its Undo
 * writes the card back.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_HEADING_ID } from "@admin/components/features/dashboard/WelcomeHeader";
import { protectedApi } from "@admin/lib/api/protectedApi";
import type { AdminBranding } from "@admin/types/branding";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { WidgetGrid } from "../../WidgetGrid";
import {
  stubDashboardWidth,
  unstubDashboardWidth,
} from "../../__tests__/dashboard-width";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;

// `vi.hoisted`, because `vi.mock` is lifted above every other statement in the
// file and a plain `const` here is not yet initialised when the factory runs.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

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
/*
 * Spread over the real module rather than replacing it: the grid's own tree
 * draws from this package, so a wholesale mock would leave every card
 * unrenderable.
 */
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const api = vi.mocked(protectedApi);

/**
 * Two cards, only the first of which its author said may be sent away. Both
 * UNFRAMED, matching `core/onboarding-checklist`, the card this exists for.
 */
function branding(
  patch: Record<string, Record<string, unknown>> = {}
): AdminBranding {
  return {
    widgets: [
      {
        id: "core/onboarding",
        title: "Set up your project",
        archetype: "custom",
        defaultSize: "full",
        chrome: "none",
        component: "core#Whatever",
        dismissible: true,
        ...patch["core/onboarding"],
      },
      {
        id: "core/permanent",
        title: "Collections",
        archetype: "custom",
        defaultSize: "full",
        chrome: "none",
        component: "core#Whatever",
        ...patch["core/permanent"],
      },
    ],
  } as unknown as AdminBranding;
}

function layout(
  patch: Partial<DashboardLayoutResponse> = {}
): DashboardLayoutResponse {
  return {
    placements: [
      { id: "p1", widgetId: "core/onboarding", width: "full", removed: false },
      { id: "p2", widgetId: "core/permanent", width: "half", removed: false },
    ],
    widgets: {},
    available: [],
    defaultPlacements: [],
    version: 7,
    source: "own",
    scope: "tok",
    audience: "aud",
    ...patch,
  };
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: 0, retryDelay: 0 },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {/* The page's heading, which a closed notice returns focus to. */}
      <h1 id={DASHBOARD_HEADING_ID} tabIndex={-1}>
        Welcome
      </h1>
      {children}
    </QueryClientProvider>
  );
  return render(<WidgetGrid />, { wrapper: Wrapper });
}

/** Enters customise mode and waits for the per-card menus to exist. */
async function beginEditing() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("dashboard-edit-begin"));
  await screen.findAllByTestId("card-actions");
  return user;
}

function live(): HTMLElement {
  return screen.getByTestId("widget-grid-live");
}

beforeEach(() => {
  // jsdom lays nothing out; the grid asks nothing until its dashboard has a width.
  stubDashboardWidth();
  vi.clearAllMocks();
  mockBranding = branding();
  layoutResponse = layout();
  api.get.mockImplementation(() => Promise.resolve(layoutResponse));
  /*
   * 🔴 The stand-in APPLIES the write, so the next read answers with it. A
   * `put` that merely resolves leaves every later GET returning the original
   * arrangement, so a card is never actually removed and any assertion about
   * a dismissal having taken effect passes over a dashboard that did not
   * change.
   */
  api.put.mockImplementation((_path: string, body: unknown) => {
    const sent = body as { placements: WidgetPlacement[] };
    layoutResponse = {
      ...(layoutResponse as DashboardLayoutResponse),
      placements: sent.placements,
      version: (layoutResponse?.version ?? 0) + 1,
    };
    return Promise.resolve({ message: "ok", item: {} });
  });
});

afterEach(() => {
  unstubDashboardWidth();
});

describe("the control a card carries itself", () => {
  it("is drawn for a card that declared it, without entering customise mode", async () => {
    renderGrid();
    const dismiss = await screen.findByTestId("widget-dismiss");
    expect(dismiss).toHaveAccessibleName(
      "Dismiss Set up your project. You can bring it back from Customize."
    );
  });

  it("is drawn only for the card that declared it", async () => {
    renderGrid();
    await screen.findByTestId("widget-dismiss");
    expect(screen.getAllByTestId("widget-dismiss")).toHaveLength(1);
  });

  it("is withheld until an arrangement has been read", async () => {
    // The grid draws the DECLARATIONS while the layout request is in flight,
    // and those rows carry no stored placement to remove.
    api.get.mockImplementation(() =>
      Promise.reject(new Error("layout unavailable"))
    );
    renderGrid();

    // The card itself MUST be drawn, or the absence below is satisfied by a
    // grid that rendered nothing at all.
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-core/onboarding")).toBeVisible()
    );
    expect(screen.queryByTestId("widget-dismiss")).toBeNull();
  });

  it("does not leave a blank row when the widget itself draws nothing", async () => {
    renderGrid();
    await screen.findByTestId("widget-dismiss");
    const cell = screen.getByTestId("widget-cell-core/onboarding");

    // jsdom evaluates no CSS, so the two halves of the collapse are asserted:
    // the body has its own slot, and the cell's rule asks that slot.
    expect(cell.querySelector("[data-widget-body]")).not.toBeNull();
    expect(cell).toHaveClass("has-[>[data-widget-body]:empty]:hidden");
  });

  it("keeps the way back in reach of the control that removes", async () => {
    renderGrid();
    expect(await screen.findByTestId("widget-dismiss")).toHaveClass(
      "hidden",
      "md:inline-flex"
    );
  });

  it("puts the control in the header of a card the host frames", async () => {
    mockBranding = branding({
      "core/onboarding": { chrome: "card", icon: "Rocket" },
    });
    renderGrid();

    const dismiss = await screen.findByTestId("widget-dismiss");
    expect(dismiss).not.toHaveClass("absolute");
    const header = dismiss.closest("div")?.parentElement;
    expect(header?.textContent).toContain("Set up your project");
  });

  it("gives way to the card menu while customising", async () => {
    renderGrid();
    await screen.findByTestId("widget-dismiss");
    await beginEditing();
    // Remove is in the card's menu there, and two controls doing one thing in
    // one card is a reader choosing between synonyms.
    expect(screen.queryByTestId("widget-dismiss")).toBeNull();
  });
});

describe("what a dismiss writes", () => {
  it("marks the placement removed, carrying the read's own guards, as NOT an arrangement", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][1]).toEqual({
      placements: [
        { id: "p1", widgetId: "core/onboarding", width: "full", removed: true },
        { id: "p2", widgetId: "core/permanent", width: "half", removed: false },
      ],
      // 🔴 From the READ: nothing was being customised.
      version: 7,
      scope: "tok",
      // 🔴 NOT an arrangement. Sending a card away is not taking charge of the
      // dashboard, and a write claiming to be one would stop every widget
      // declared afterwards from reaching this reader.
      arranged: false,
    });
  });

  it("says the customise save IS an arrangement", async () => {
    // The other half: the editor's save, which can remove cards too, must say
    // it arranges, or the case above passes for a client that never says.
    renderGrid();
    const user = await beginEditing();
    await user.click(
      screen.getByRole("button", { name: "Card actions for Collections" })
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Remove",
      })
    );
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect((api.put.mock.calls[0][1] as { arranged?: unknown }).arranged).toBe(
      true
    );
  });

  it("joins the draft instead of committing, while customising", async () => {
    renderGrid();
    const user = await beginEditing();
    await user.click(
      screen.getByRole("button", {
        name: "Card actions for Set up your project",
      })
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Remove",
      })
    );

    // 🔴 No write. Committing here would advance the version underneath the
    // reader's own unsaved arrangement.
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe("the notice a dismiss leaves", () => {
  it("says the card was removed once it has actually gone, and offers Undo", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    // 🔴 The CARD first: the re-read that fills the cache can fail on its own.
    await waitFor(() =>
      expect(screen.queryByTestId("widget-cell-core/onboarding")).toBeNull()
    );
    expect(live()).toHaveTextContent("Set up your project removed.");
    expect(screen.getByTestId("removal-notice")).toHaveTextContent(
      "Set up your project removed."
    );
  });

  it("moves focus to its Undo, since the control that had focus is gone", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("removal-notice-undo")
      )
    );
  });

  it("Undo writes the card back, and returns focus to its dismiss control", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));
    await user.click(await screen.findByTestId("removal-notice-undo"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put.mock.calls[1][1]).toEqual({
      placements: [
        {
          id: "p1",
          widgetId: "core/onboarding",
          width: "full",
          removed: false,
        },
        { id: "p2", widgetId: "core/permanent", width: "half", removed: false },
      ],
      // The version the dismissal produced, read back from the cache.
      version: 8,
      scope: "tok",
      arranged: false,
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("widget-dismiss"))
    );
    expect(
      screen.getByTestId("widget-cell-core/onboarding")
    ).toBeInTheDocument();
    expect(live()).toHaveTextContent("Set up your project restored.");
    expect(screen.queryByTestId("removal-notice")).toBeNull();
  });

  it("sends focus to the dashboard's heading when it is closed", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));
    await user.click(await screen.findByTestId("removal-notice-close"));

    expect(screen.queryByTestId("removal-notice")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.getElementById(DASHBOARD_HEADING_ID)
      )
    );
  });

  it("says nothing when the write landed but the re-read did not", async () => {
    const user = userEvent.setup();
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    api.put.mockResolvedValue({ message: "ok", item: {} });
    api.get.mockRejectedValue(new Error("layout unavailable"));
    await user.click(screen.getByTestId("widget-dismiss"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Set up your project was updated, but the dashboard could not be refreshed. Reload the page to see it."
      )
    );
    expect(live()).toHaveTextContent("");
    expect(screen.queryByTestId("removal-notice")).toBeNull();
  });

  it("says nothing, and reports the failure, when the write is refused", async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValue(new Error("version conflict"));
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not dismiss Set up your project: version conflict"
      )
    );
    expect(live()).toHaveTextContent("");
  });
});

describe("while the stored dashboard cannot be read", () => {
  it("keeps the control on the card, unavailable, saying why", async () => {
    layoutResponse = layout({ source: "unreadable" });
    const user = userEvent.setup();
    renderGrid();

    const dismiss = await screen.findByTestId("widget-dismiss");
    expect(dismiss).toHaveAttribute("aria-disabled", "true");
    expect(dismiss).toHaveAccessibleDescription(
      "Unavailable: your saved dashboard couldn't be loaded. Save it from Customize first."
    );
    await user.click(dismiss);
    // 🔴 The server refuses any single-card write to an unreadable row; the
    // control must not try one.
    expect(api.put).not.toHaveBeenCalled();
  });

  it("is available again once the dashboard can be read", async () => {
    // The control: the reason is tied to the unreadable state, not drawn
    // always.
    renderGrid();
    const dismiss = await screen.findByTestId("widget-dismiss");
    expect(dismiss).not.toHaveAttribute("aria-disabled");
  });
});

describe("a dismissal reports itself, and nothing else does", () => {
  it("leaves the customise chrome alone when the write is refused", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("someone else saved first"), {
      status: 409,
    });
    api.put.mockRejectedValue(conflict);
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // 🔴 The customise alert speaks of unsaved changes; a reader who dismissed
    // a card from the dashboard has none.
    expect(screen.queryByTestId("dashboard-edit-conflict")).toBeNull();
    expect(screen.queryByTestId("dashboard-edit-error")).toBeNull();
  });

  it("still reports a customise save failure through the customise chrome", async () => {
    api.put.mockRejectedValue(new Error("network down"));
    renderGrid();
    const user = await beginEditing();
    await user.click(
      screen.getByRole("button", { name: "Card actions for Collections" })
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Remove",
      })
    );
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-error")).toBeInTheDocument()
    );
  });

  it("refuses a second dismissal while the first is in flight", async () => {
    const user = userEvent.setup();
    api.put.mockImplementation(() => new Promise(() => {}));
    renderGrid();
    const dismiss = await screen.findByTestId("widget-dismiss");
    await user.click(dismiss);

    // 🔴 Every dismissal builds a whole-layout snapshot against ONE cached
    // version, so a second in flight carries the same guard.
    await waitFor(() => expect(dismiss).toBeDisabled());
    await user.click(dismiss);
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});

describe("one layout write at a time", () => {
  it("locks customising while a dismissal is in flight", async () => {
    const user = userEvent.setup();
    api.put.mockImplementation(() => new Promise(() => {}));
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-begin")).toBeDisabled()
    );
  });

  it("keeps it locked until the dashboard has been read again", async () => {
    // 🔴 The re-read that follows the write is what puts the new version in
    // the cache; a draft opened before it lands carries a stale guard.
    const user = userEvent.setup();
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    const readsBefore = api.get.mock.calls.length;
    api.get.mockImplementation(() => new Promise(() => {}));
    await user.click(screen.getByTestId("widget-dismiss"));

    await waitFor(() =>
      expect(api.get.mock.calls.length).toBeGreaterThan(readsBefore)
    );
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dashboard-edit-begin")).toBeDisabled();
  });
});

describe("a declaration that is not a boolean", () => {
  it("draws no control for a truthy non-boolean", async () => {
    mockBranding = branding({
      "core/onboarding": { dismissible: "false" },
    });
    renderGrid();

    // Waits for the BEGIN button, rendered only once an arrangement has been
    // read: before then no card draws the control at all.
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.queryByTestId("widget-dismiss")).toBeNull();
    expect(screen.getAllByTestId("widget-cell-core/onboarding")).toHaveLength(
      1
    );
  });

  it("draws the control when the declaration really says true", async () => {
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByTestId("widget-dismiss")).toBeInTheDocument();
  });
});
