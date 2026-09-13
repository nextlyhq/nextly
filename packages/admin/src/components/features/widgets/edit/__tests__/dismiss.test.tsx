/**
 * Sending a card away from the card, and saying so when a card is put away.
 *
 * Two subjects that share a code path and a harness. The dismiss control is
 * drawn outside edit mode and commits on its own, because the editor's
 * mutations write to a draft that does not exist there; the announcements
 * cover hide and remove, which changed the grid silently until now.
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
 * unrenderable and the test would pass or fail for reasons that have nothing
 * to do with dismissal.
 */
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const api = vi.mocked(protectedApi);

/**
 * Two cards, only the first of which its author said may be sent away.
 *
 * Both drawn by a component, so neither issues a query and the grid's batch
 * stays out of what is being measured.
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
        component: "core#Whatever",
        dismissible: true,
        ...patch["core/onboarding"],
      },
      {
        id: "core/permanent",
        title: "Collections",
        archetype: "custom",
        defaultSize: "full",
        component: "core#Whatever",
        ...patch["core/permanent"],
      },
    ],
  } as unknown as AdminBranding;
}

function layout(patch: Partial<DashboardLayoutResponse> = {}) {
  return {
    placements: [
      { id: "p1", widgetId: "core/onboarding", order: 0, hidden: false },
      { id: "p2", widgetId: "core/permanent", order: 10, hidden: false },
    ],
    available: [],
    version: 7,
    columnCount: 2,
    source: "own",
    scope: "tok",
    audience: "aud",
    ...patch,
  } as DashboardLayoutResponse;
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
  return render(<WidgetGrid />, { wrapper: Wrapper });
}

/** Enters edit mode and waits for the per-card controls to exist. */
async function beginEditing() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("dashboard-edit-begin"));
  await screen.findAllByTestId("widget-edit-controls");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBranding = branding();
  layoutResponse = layout();
  api.get.mockImplementation(() => Promise.resolve(layoutResponse));
  api.put.mockResolvedValue({ message: "ok", item: {} });
});

describe("the control a card carries itself", () => {
  it("is drawn for a card that declared it, without entering edit mode", async () => {
    renderGrid();

    // 🔴 The point of the feature. Hiding any card is already possible from
    // the edit toolbar, and a first-run card addresses a reader who has no
    // reason to know the dashboard can be edited at all.
    const dismiss = await screen.findByTestId("widget-dismiss");
    expect(dismiss).toHaveAccessibleName(
      "Dismiss Set up your project. You can bring it back by editing the dashboard."
    );
  });

  it("is drawn only for the card that declared it", async () => {
    renderGrid();
    await screen.findByTestId("widget-dismiss");

    // Two cards are on the grid and one control, so the control is keyed on the
    // declaration rather than drawn for every card. Asserting a count rather
    // than the absence of a second: "no second control" is also what a grid
    // drawing none at all looks like.
    expect(screen.getAllByTestId("widget-dismiss")).toHaveLength(1);
  });

  it("is withheld until an arrangement has been read", async () => {
    // The grid draws the DECLARATIONS while the layout request is in flight,
    // and those rows carry no stored placement -- so a control drawn then
    // answers a click by doing nothing, and the card the reader just asked to
    // be rid of stays on screen with no error to explain it.
    api.get.mockImplementation(() =>
      Promise.reject(new Error("layout unavailable"))
    );
    renderGrid();

    // The card itself MUST be drawn, or the absence below is satisfied by a
    // grid that rendered nothing at all -- which is the state this very
    // fallback exists to prevent.
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-core/onboarding")).toBeVisible()
    );
    expect(screen.queryByTestId("widget-dismiss")).toBeNull();
  });

  it("does not leave a blank row when the widget itself draws nothing", async () => {
    renderGrid();
    const dismiss = await screen.findByTestId("widget-dismiss");

    /*
     * The two halves of one mechanism, asserted rather than observed: jsdom
     * evaluates no CSS, so the collapse itself cannot be seen here.
     *
     * The cell collapses on `:empty`, and this control is an element child
     * drawn from the DECLARATION rather than from anything the body produced
     * -- so a card whose component returns null (which core's conditional
     * sections do) stops being empty the moment the control exists, and holds
     * a full-width row with a stray button in it. The cell's companion rule
     * hides a cell whose only child is this control, and it matches on the
     * attribute below. Renaming either half alone reinstates the blank row.
     */
    expect(dismiss).toHaveAttribute("data-widget-chrome");
    expect(screen.getByTestId("widget-cell-core/onboarding")).toHaveClass(
      "has-[>[data-widget-chrome]:only-child]:hidden"
    );
  });

  it("gives way to the toolbar while editing", async () => {
    renderGrid();
    await screen.findByTestId("widget-dismiss");
    await beginEditing();

    // Hide and show are already on the toolbar there, and two controls doing
    // one thing in one cell is a reader choosing between synonyms.
    expect(screen.queryByTestId("widget-dismiss")).toBeNull();
  });
});

describe("what a dismiss writes", () => {
  it("hides the placement, carrying the read's own guards", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [, body] = api.put.mock.calls[0];
    expect(body).toEqual({
      placements: [
        { id: "p1", widgetId: "core/onboarding", order: 0, hidden: true },
        { id: "p2", widgetId: "core/permanent", order: 10, hidden: false },
      ],
      // 🔴 From the READ, not from a draft. Nothing was being edited, so these
      // are what the arrangement in hand is a modification of -- and a write
      // that echoed anything else would overwrite another tab rather than
      // being refused.
      version: 7,
      scope: "tok",
      // The STORED count, which differs from the default this falls back to
      // when a row states none -- so a write that reached for the default
      // would narrow or widen the reader's dashboard as a side effect.
      columnCount: 2,
    });
  });

  it("leaves every other placement's order exactly as it was", async () => {
    const user = userEvent.setup();
    // Orders the editor's own commit would renumber, because `renumberForColumns`
    // rewrites them at the draft's column count. Hiding moves no card, so a
    // dismiss that renumbered would rewrite the whole arrangement as a side
    // effect of one flag.
    layoutResponse = layout({
      placements: [
        { id: "p1", widgetId: "core/onboarding", order: 3, hidden: false },
        { id: "p2", widgetId: "core/permanent", order: 99, hidden: false },
      ],
    });
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [, body] = api.put.mock.calls[0];
    expect((body as { placements: { order: number }[] }).placements).toEqual([
      expect.objectContaining({ id: "p1", order: 3, hidden: true }),
      expect.objectContaining({ id: "p2", order: 99, hidden: false }),
    ]);
  });

  it("joins the draft instead of committing, while the reader is editing", async () => {
    renderGrid();
    await screen.findByTestId("widget-dismiss");
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-toggle-hidden")[0]);

    // 🔴 No write. Committing here would advance the version underneath the
    // reader's own unsaved arrangement, so their eventual Save would be
    // refused as a lost race against themselves.
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe("what a reader is told", () => {
  it("announces a dismiss once the write has landed", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() =>
      expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
        "Set up your project hidden. Edit the dashboard to bring it back."
      )
    );
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
    // 🔴 The card is still on screen, so an announcement would describe an
    // arrangement the server refused. Silence here is the correct outcome and
    // the toast above is what proves the click was handled at all.
    expect(screen.getByTestId("widget-grid-live")).toHaveTextContent("");
  });

  it("announces a hide from the edit toolbar", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-toggle-hidden")[0]);

    // Hiding from the toolbar changed the grid in silence until now: the card
    // dims, the label flips, and a reader who cannot see either is told
    // nothing at all.
    expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
      "Set up your project hidden. Edit the dashboard to bring it back."
    );
  });

  it("announces bringing a hidden card back", async () => {
    layoutResponse = layout({
      placements: [
        { id: "p1", widgetId: "core/onboarding", order: 0, hidden: true },
        { id: "p2", widgetId: "core/permanent", order: 10, hidden: false },
      ],
    });
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-toggle-hidden")[0]);

    // The OTHER direction, which the same sentence would get wrong: an
    // announcement built from the stored flag rather than from its negation
    // says "hidden" for a card that just came back.
    expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
      "Set up your project shown again."
    );
  });

  it("announces a removal in its own words", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getAllByTestId("widget-remove")[0]);

    // Its own sentence rather than the hiding one: hiding keeps the placement
    // and removing drops it, and a reader deciding whether to undo needs to
    // hear which happened.
    expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
      "Set up your project removed from the dashboard."
    );
  });
});

describe("the toolbar's wording", () => {
  it("names dismissing, not position and settings, on a dismissible card", async () => {
    renderGrid();
    await beginEditing();

    const [dismissible, permanent] = screen.getAllByTestId(
      "widget-toggle-hidden"
    );
    // A dismissible card is transient by declaration: it has no settings worth
    // preserving and the install may withdraw it anyway, so promising that
    // hiding keeps "its position and settings" describes a permanence it does
    // not have.
    expect(dismissible).toHaveAccessibleName(
      "Dismiss Set up your project, keeping it available to bring back from here"
    );
    // The control on a permanent card is the one the copy was written for, and
    // it must not change. Without this the branch could return the dismissing
    // wording for every card and the assertion above would still pass.
    expect(permanent).toHaveAccessibleName(
      "Hide Collections, keeping its position and settings"
    );
  });
});
