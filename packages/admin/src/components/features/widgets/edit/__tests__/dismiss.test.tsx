/**
 * Sending a card away from the card itself, outside customise mode, and
 * taking that back.
 *
 * Remove in every card's menu at rest is the reader's dismissal of it, for
 * every card alike: it commits on its own, because the
 * editor's mutations write to a draft that does not exist there, as a write
 * that does not arrange the dashboard, so a reader on the default stays on it.
 * It leaves the same notice a Remove in customise mode does, and its Undo
 * writes the card back.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardChromeProvider } from "@admin/components/features/dashboard/header/dashboard-chrome";
import {
  DASHBOARD_HEADING_ID,
  WelcomeHeader,
} from "@admin/components/features/dashboard/WelcomeHeader";
import { protectedApi } from "@admin/lib/api/protectedApi";
import { registerCoreComponent } from "@admin/lib/plugins/component-registry-internal";
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

import { galleryFromLayout, isGalleryPath } from "./gallery-read";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;

// `vi.hoisted`, because `vi.mock` is lifted above every other statement in the
// file and a plain `const` here is not yet initialised when the factory runs.
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));

// The header's New button reads collections and permissions of its own,
// which this test does not set up; it is a marker here.
vi.mock("@admin/components/features/dashboard/header/NewSplitButton", () => ({
  NewSplitButton: () => <div data-testid="dashboard-new" />,
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useAppName: () => "Acme Site",
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
// The page's header beside the grid holds Customize: its own reads stubbed.
vi.mock("@admin/hooks/queries/useDashboardSummary", () => ({
  DASHBOARD_SUMMARY_KEY: ["dashboard", "summary"],
  useDashboardSummary: () => ({ data: undefined }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({
    user: { id: "u1", name: "Dev User", email: "dev@example.com" },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);
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

// The cards' own component, so each card draws its answer rather than a missing component's
// error, which the grid would count as a failure.
registerCoreComponent("core#Whatever", () => <p>Body</p>);

/** Two cards, each of which a reader may send away from its menu. */
function branding(
  patch: Record<string, Record<string, unknown>> = {}
): AdminBranding {
  return {
    widgets: [
      {
        id: "core/onboarding",
        title: "Set up your project",
        archetype: "custom",
        size: { default: { w: 12, h: 3 } },
        component: "core#Whatever",
        ...patch["core/onboarding"],
      },
      {
        id: "core/permanent",
        title: "Collections",
        archetype: "custom",
        size: { default: { w: 12, h: 3 } },
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
      { id: "p1", widgetId: "core/onboarding", w: 12, h: 3, removed: false },
      { id: "p2", widgetId: "core/permanent", w: 6, h: 3, removed: false },
    ],
    widgets: {},
    available: [],
    defaultPlacements: [],
    version: 7,
    source: "own",
    // A row of dismissals at most: the reader still follows the default.
    arranged: false,
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
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  // The page's header, whose heading a closed notice returns focus to and which holds
  // Customize, beside the grid.
  return render(
    <DashboardChromeProvider>
      <WelcomeHeader />
      <WidgetGrid />
    </DashboardChromeProvider>,
    { wrapper: Wrapper }
  );
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
  api.get.mockImplementation((path: string) =>
    // The gallery read the layout fixture implies, read when the add panel opens.
    Promise.resolve(
      isGalleryPath(path) && layoutResponse !== undefined
        ? galleryFromLayout(layoutResponse, mockBranding?.widgets ?? [])
        : layoutResponse
    )
  );
  // Every card is asked for by its id; each is answered, so its component draws and its menu
  // holds nothing a failed card would add.
  api.post.mockImplementation((_path: string, body: unknown) =>
    Promise.resolve({
      results: (body as { queries: unknown[] }).queries.map(() => ({
        ok: true,
        result: { op: "data", data: null },
      })),
    })
  );
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

/** The card menu's button at rest. */
function menuButton(title = "Set up your project"): HTMLElement {
  return screen.getByRole("button", { name: `Card menu for ${title}` });
}

/** Opens a card's menu at rest and returns it. */
async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  title = "Set up your project"
) {
  await user.click(
    await screen.findByRole("button", { name: `Card menu for ${title}` })
  );
  return screen.findByRole("menu");
}

/** Removes a card from its menu at rest, as a reader does. */
async function removeFromMenu(
  user: ReturnType<typeof userEvent.setup>,
  title = "Set up your project"
) {
  const menu = await openMenu(user, title);
  await user.click(within(menu).getByRole("menuitem", { name: "Remove" }));
}

describe("the control a card carries itself", () => {
  it("is Remove in every card's menu, without entering customise mode", async () => {
    const user = userEvent.setup();
    renderGrid();
    for (const title of ["Set up your project", "Collections"]) {
      const menu = await openMenu(user, title);
      expect(
        within(menu).getByRole("menuitem", { name: "Remove" })
      ).toBeInTheDocument();
      await user.keyboard("{Escape}");
    }
    // The menu is the one control: no button of its own beside it.
    expect(screen.queryByRole("button", { name: /^Dismiss/ })).toBeNull();
  });

  it("is withheld until an arrangement has been read", async () => {
    // The grid draws the DECLARATIONS while the layout request is in flight,
    // and those rows carry no stored placement to remove.
    api.get.mockImplementation(() =>
      Promise.reject(new Error("layout unavailable"))
    );
    const user = userEvent.setup();
    renderGrid();

    // The menu is drawn for the card's Refresh, so the absence of Remove
    // below is not satisfied by a card that drew no menu at all.
    const menu = await openMenu(user);
    expect(
      within(menu).getByRole("menuitem", { name: /Refresh/ })
    ).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  it("gives way to the customise menu while customising", async () => {
    renderGrid();
    await screen.findByRole("button", {
      name: "Card menu for Set up your project",
    });
    await beginEditing();
    // Remove is in the customise menu there, and two menus doing one thing in
    // one card is a reader choosing between synonyms.
    expect(
      screen.queryByRole("button", {
        name: "Card menu for Set up your project",
      })
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Card actions for Set up your project",
      })
    ).toBeInTheDocument();
  });
});

describe("what a dismiss writes", () => {
  it("marks a card removed, carrying the read's own guards, as NOT an arrangement", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][1]).toEqual({
      placements: [
        { id: "p1", widgetId: "core/onboarding", w: 12, h: 3, removed: true },
        { id: "p2", widgetId: "core/permanent", w: 6, h: 3, removed: false },
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

describe("Remove for a second card", () => {
  it("is the same dismissal: marked removed, nothing dropped, NOT an arrangement", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user, "Collections");

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][1]).toEqual({
      placements: [
        { id: "p1", widgetId: "core/onboarding", w: 12, h: 3, removed: false },
        { id: "p2", widgetId: "core/permanent", w: 6, h: 3, removed: true },
      ],
      version: 7,
      scope: "tok",
      arranged: false,
    });
  });
});

describe("Remove for a reader who has arranged their dashboard", () => {
  /** An arranged reader's list, the first card carrying settings of its own. */
  const ARRANGED: WidgetPlacement[] = [
    {
      id: "p1",
      widgetId: "core/onboarding",
      w: 12,
      h: 3,
      removed: false,
      config: { note: "mine" },
    },
    { id: "p2", widgetId: "core/permanent", w: 6, h: 3, removed: false },
  ];

  beforeEach(() => {
    layoutResponse = layout({ arranged: true, placements: ARRANGED });
  });

  it("takes the card out of their list, leaving no hidden copy, as an arrangement", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const sent = api.put.mock.calls[0][1] as {
      placements: WidgetPlacement[];
    };
    expect(sent).toEqual({
      placements: [ARRANGED[1]],
      version: 7,
      scope: "tok",
      // A write that drops a card from the list is an arranged one.
      arranged: true,
    });
    expect(sent.placements.some(placement => placement.removed)).toBe(false);
  });

  it("Undo puts the card back where it was, with its settings", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    await user.click(await screen.findByTestId("removal-notice-undo"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put.mock.calls[1][1]).toEqual({
      placements: ARRANGED,
      version: 8,
      scope: "tok",
      arranged: true,
    });
    await waitFor(() => expect(document.activeElement).toBe(menuButton()));
  });
});

describe("a card dismissed from the default dashboard", () => {
  it("can be added back from the gallery, and draws again", async () => {
    layoutResponse = layout({ source: "default", version: 0 });
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user, "Collections");
    await waitFor(() =>
      expect(screen.queryByTestId("widget-cell-core/permanent")).toBeNull()
    );
    await user.click(await screen.findByTestId("removal-notice-close"));

    await beginEditing();
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    const panel = await screen.findByRole("dialog", { name: "Add widget" });
    // Its hidden card is what the gallery offers back, not a second copy.
    await user.click(
      within(panel).getByRole("button", { name: "Add back Collections" })
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    const saved = api.put.mock.calls[1][1] as {
      placements: WidgetPlacement[];
    };
    expect(
      saved.placements.filter(p => p.widgetId === "core/permanent")
    ).toEqual([
      { id: "p2", widgetId: "core/permanent", w: 6, h: 3, removed: false },
    ]);
    await waitFor(() =>
      expect(
        screen.getByTestId("widget-cell-core/permanent")
      ).toBeInTheDocument()
    );
  });
});

describe("the notice a dismiss leaves", () => {
  beforeEach(() => {
    // The dashboard's first batch answers; any batch after it stays on its way, so the grid's
    // live region says only what the dismiss did, never a later batch's news beside it.
    api.post.mockImplementation((_path: string, body: unknown) =>
      api.post.mock.calls.length > 1
        ? new Promise(() => undefined)
        : Promise.resolve({
            results: (body as { queries: unknown[] }).queries.map(() => ({
              ok: true,
              result: { op: "data", data: null },
            })),
          })
    );
  });

  it("says the card was removed once it has actually gone, and offers Undo", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);

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
    await removeFromMenu(user);

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("removal-notice-undo")
      )
    );
  });

  it("Undo writes the card back, and returns focus to the card's menu", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    await user.click(await screen.findByTestId("removal-notice-undo"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put.mock.calls[1][1]).toEqual({
      placements: [
        {
          id: "p1",
          widgetId: "core/onboarding",
          w: 12,
          h: 3,
          removed: false,
        },
        { id: "p2", widgetId: "core/permanent", w: 6, h: 3, removed: false },
      ],
      // The version the dismissal produced, read back from the cache.
      version: 8,
      scope: "tok",
      arranged: false,
    });
    await waitFor(() => expect(document.activeElement).toBe(menuButton()));
    expect(
      screen.getByTestId("widget-cell-core/onboarding")
    ).toBeInTheDocument();
    expect(live()).toHaveTextContent("Set up your project restored.");
    expect(screen.queryByTestId("removal-notice")).toBeNull();
  });

  it("sends focus to the dashboard's heading when it is closed", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
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
    await removeFromMenu(user);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Set up your project was updated, but the dashboard could not be refreshed. Reload the page to see it."
      )
    );
    // The region says only the batch's own news, nothing of a removal that did not show.
    expect(live()).not.toHaveTextContent(/removed/i);
    expect(screen.queryByTestId("removal-notice")).toBeNull();
  });

  it("says nothing, and reports the failure, when the write is refused", async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValue(new Error("version conflict"));
    renderGrid();
    await removeFromMenu(user);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not dismiss Set up your project: version conflict"
      )
    );
    // The region says only the batch's own news, nothing of a removal that did not happen.
    expect(live()).not.toHaveTextContent(/removed/i);
  });
});

describe("a write refused because the dashboard moved since it was read", () => {
  /** An arranged reader's list, as the reader the card menu's Remove takes a card out of. */
  const ARRANGED: WidgetPlacement[] = [
    { id: "p1", widgetId: "core/onboarding", w: 12, h: 3, removed: false },
    { id: "p2", widgetId: "core/permanent", w: 6, h: 3, removed: false },
  ];

  /** The server's refusal of a write made of a stale read, as a 409. */
  function refusal(): Error {
    return Object.assign(
      new Error(
        "The widgets available to you changed since you loaded the dashboard. Reload and try again."
      ),
      { status: 409 }
    );
  }

  /** What another person's change does to this reader's dashboard: a new scope token, no write. */
  function widgetsMoveElsewhere(): void {
    layoutResponse = {
      ...(layoutResponse as DashboardLayoutResponse),
      scope: "tok-after",
    };
  }

  beforeEach(() => {
    layoutResponse = layout({ arranged: true, placements: ARRANGED });
    /*
     * 🔴 The stand-in GUARDS, as the server does: a write carrying a version or a scope the
     * stored row no longer has is refused and changes nothing. A stand-in that applied every
     * write would accept a retry sent with the refused guards, and pass a client that never read
     * the dashboard again.
     */
    api.put.mockImplementation((_path: string, body: unknown) => {
      const sent = body as {
        placements: WidgetPlacement[];
        version: number;
        scope: string;
        arranged: boolean;
      };
      const now = layoutResponse as DashboardLayoutResponse;
      if (sent.version !== now.version || sent.scope !== now.scope) {
        return Promise.reject(refusal());
      }
      layoutResponse = {
        ...now,
        placements: sent.placements,
        version: now.version + 1,
        // As the server keeps it: a write that arranges makes the row arranged, and a row
        // already arranged stays so.
        arranged: now.arranged === true || sent.arranged,
      };
      return Promise.resolve({ message: "ok", item: {} });
    });
  });

  it("Undo still puts the card back when the widgets moved after the Remove", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    const undo = await screen.findByTestId("removal-notice-undo");
    widgetsMoveElsewhere();
    await user.click(undo);

    await waitFor(() =>
      expect(
        screen.getByTestId("widget-cell-core/onboarding")
      ).toBeInTheDocument()
    );
    // Refused once under the guards read before the change, then sent under those read since.
    expect(api.put).toHaveBeenCalledTimes(3);
    expect(api.put.mock.calls[1][1]).toMatchObject({
      version: 8,
      scope: "tok",
    });
    expect(api.put.mock.calls[2][1]).toEqual({
      placements: ARRANGED,
      version: 8,
      scope: "tok-after",
      arranged: true,
    });
    expect(live()).toHaveTextContent("Set up your project restored.");
    expect(screen.queryByTestId("removal-notice")).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Remove still takes the card off when the widgets moved since the dashboard was read", async () => {
    const user = userEvent.setup();
    renderGrid();
    await screen.findByRole("button", {
      name: "Card menu for Set up your project",
    });
    widgetsMoveElsewhere();
    await removeFromMenu(user);

    await waitFor(() =>
      expect(screen.getByTestId("removal-notice")).toHaveTextContent(
        "Set up your project removed."
      )
    );
    expect(screen.queryByTestId("widget-cell-core/onboarding")).toBeNull();
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put.mock.calls[1][1]).toEqual({
      placements: [ARRANGED[1]],
      version: 7,
      scope: "tok-after",
      arranged: true,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports a second refusal rather than sending again", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    const undo = await screen.findByTestId("removal-notice-undo");
    api.put.mockImplementation(() => Promise.reject(refusal()));
    await user.click(undo);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not undo removing Set up your project: The widgets available to you changed since you loaded the dashboard. Reload and try again."
      )
    );
    // The Remove, then Undo twice: the first refusal and the one retry.
    expect(api.put).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("removal-notice")).toBeInTheDocument();
  });

  it("Undo after a reset elsewhere writes no arrangement back, and says why", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    const undo = await screen.findByTestId("removal-notice-undo");
    // Another tab resets the dashboard: the row is gone, and the read is the default again,
    // whose cards are its own, so the removed card is not among them.
    const reset = layout({
      placements: [
        { id: "d1", widgetId: "core/onboarding", w: 12, h: 3, removed: false },
        { id: "d2", widgetId: "core/permanent", w: 6, h: 3, removed: false },
      ],
      source: "default",
      version: 0,
      scope: "tok-default",
      arranged: false,
    });
    layoutResponse = reset;
    await user.click(undo);

    await waitFor(() =>
      expect(screen.queryByTestId("removal-notice")).toBeNull()
    );
    // 🔴 The reset stands: no arranged row was made again. The one Undo sent was made of the
    // read before the reset, and refused; none followed it.
    expect(layoutResponse).toEqual(reset);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledWith(
      "Your dashboard was reset elsewhere, so there is nothing to undo."
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Undo of a card already put back elsewhere writes nothing more, quietly", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    const undo = await screen.findByTestId("removal-notice-undo");
    // Another tab put the same card back, at the same place.
    layoutResponse = {
      ...(layoutResponse as DashboardLayoutResponse),
      placements: ARRANGED,
      version: 9,
    };
    await user.click(undo);

    await waitFor(() =>
      expect(screen.queryByTestId("removal-notice")).toBeNull()
    );
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId("widget-cell-core/onboarding")
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("reports the refresh, sending nothing again, when the re-read after a refusal fails", async () => {
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    const undo = await screen.findByTestId("removal-notice-undo");
    widgetsMoveElsewhere();
    api.get.mockRejectedValue(new Error("layout unavailable"));
    await user.click(undo);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Set up your project was updated, but the dashboard could not be refreshed. Reload the page to see it."
      )
    );
    // 🔴 The refused guards are all the cache holds, so a second write would only be refused.
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("sends nothing again after a failure that is not a conflict", async () => {
    // A write that failed without the server's refusal may have landed, and a second one would
    // be sent under guards it already moved.
    const user = userEvent.setup();
    renderGrid();
    await removeFromMenu(user);
    const undo = await screen.findByTestId("removal-notice-undo");
    api.put.mockImplementation(() =>
      Promise.reject(Object.assign(new Error("Bad gateway"), { status: 502 }))
    );
    await user.click(undo);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not undo removing Set up your project: Bad gateway"
      )
    );
    expect(api.put).toHaveBeenCalledTimes(2);
  });
});

describe("while the stored dashboard cannot be read", () => {
  it("keeps Remove in the menu, unavailable, saying why", async () => {
    layoutResponse = layout({ source: "unreadable" });
    const user = userEvent.setup();
    renderGrid();

    const menu = await openMenu(user);
    const remove = within(menu).getByRole("menuitem", { name: "Remove" });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAccessibleDescription(
      "Unavailable: your saved dashboard couldn't be loaded. Save it from Customize first."
    );
    await user.click(remove);
    // 🔴 The server refuses any single-card write to an unreadable row; the
    // control must not try one.
    expect(api.put).not.toHaveBeenCalled();
  });

  it("is available again once the dashboard can be read", async () => {
    // The control: the reason is tied to the unreadable state, not drawn
    // always.
    const user = userEvent.setup();
    renderGrid();
    const menu = await openMenu(user);
    expect(
      within(menu).getByRole("menuitem", { name: "Remove" })
    ).not.toHaveAttribute("aria-disabled");
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
    await removeFromMenu(user);

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
    await removeFromMenu(user);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));

    // 🔴 Every dismissal builds a whole-layout snapshot against ONE cached
    // version, so a second in flight carries the same guard.
    const menu = await openMenu(user, "Collections");
    const remove = within(menu).getByRole("menuitem", { name: "Remove" });
    await waitFor(() => expect(remove).toHaveAttribute("data-disabled"));
    await user.click(remove);
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});

describe("one layout write at a time", () => {
  it("locks customising while a dismissal is in flight", async () => {
    const user = userEvent.setup();
    api.put.mockImplementation(() => new Promise(() => {}));
    renderGrid();
    await removeFromMenu(user);

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
    await removeFromMenu(user);

    await waitFor(() =>
      expect(api.get.mock.calls.length).toBeGreaterThan(readsBefore)
    );
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dashboard-edit-begin")).toBeDisabled();
  });
});
