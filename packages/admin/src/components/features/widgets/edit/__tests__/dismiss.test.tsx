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
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

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
 * stays out of what is being measured. Both UNFRAMED, matching
 * `core/onboarding-checklist` -- the card this feature exists for draws its own
 * surface, which is the arm with no header to put a control in.
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
  /*
   * 🔴 The stand-in APPLIES the write, so the next read answers with it.
   *
   * A `put` that merely resolves leaves every later GET returning the original
   * arrangement, so a card is never actually removed and any assertion about a
   * dismissal having taken effect passes over a dashboard that did not change.
   * Announcement and focus were asserted against exactly that: both fired on
   * the write alone, and the card the reader was told had gone was still on
   * screen.
   */
  api.put.mockImplementation((_path: string, body: unknown) => {
    const sent = body as { placements: WidgetPlacement[]; columnCount: number };
    layoutResponse = {
      ...(layoutResponse as DashboardLayoutResponse),
      placements: sent.placements,
      columnCount: sent.columnCount,
      version: (layoutResponse?.version ?? 0) + 1,
      source: "own",
    };
    return Promise.resolve({ message: "ok", item: {} });
  });
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
    await screen.findByTestId("widget-dismiss");
    const cell = screen.getByTestId("widget-cell-core/onboarding");

    /*
     * The two halves of one mechanism, asserted rather than observed: jsdom
     * evaluates no CSS, so the collapse itself cannot be seen here.
     *
     * The cell collapses on `:empty`, and the floated control is an element
     * child drawn from the DECLARATION rather than from anything the body
     * produced -- so a card whose component returns null (which core's
     * conditional sections do) stops being empty the moment the control
     * exists, and holds a full-width row with a stray button in it. The cell's
     * companion rule asks the BODY SLOT instead, and it matches the attribute
     * below. Renaming either half alone reinstates the blank row.
     *
     * 🔴 `:empty` on the body, not `:only-child` on the control. `:only-child`
     * counts element siblings and ignores TEXT, so an unframed component
     * returning a bare string left the control as the only element and hid the
     * whole cell over real content.
     */
    expect(cell.querySelector("[data-widget-body]")).not.toBeNull();
    expect(cell).toHaveClass("has-[>[data-widget-body]:empty]:hidden");
  });

  it("keeps the restoration path in reach of the control that hides", async () => {
    renderGrid();

    // Editing is the only route to un-hiding, and `DashboardEditBar` offers it
    // from `md` up. Below that, a reader could hide a card permanently and
    // never reach the control that brings it back -- so the two share a
    // breakpoint. jsdom evaluates no CSS, so the class is the assertion.
    expect(await screen.findByTestId("widget-dismiss")).toHaveClass(
      "hidden",
      "md:inline-flex"
    );
  });

  it("puts the control in the header of a card the host frames", async () => {
    // An unframed card has no header, so the cell floats the control in the
    // corner. A FRAMED one already draws the declared icon in that same corner
    // and reserves no space beside it, so a floated control would sit on top of
    // the icon -- and on whatever an unframed plugin component drew there.
    mockBranding = branding({
      "core/onboarding": { chrome: "card", icon: "Rocket" },
    });
    renderGrid();

    const dismiss = await screen.findByTestId("widget-dismiss");
    // Not floated: the header is a flex row that reserves space for it, so it
    // takes its place beside the icon rather than on top of it.
    expect(dismiss).not.toHaveClass("absolute");
    // A SIBLING of the card's title, which is what puts it in the header row.
    // Asserting the absence of `absolute` alone would also pass for a control
    // that was never rendered at all.
    const header = dismiss.closest("div")?.parentElement;
    expect(header?.textContent).toContain("Set up your project");
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
      // 🔴 NOT an arrangement. Sending a card away is not taking charge of the
      // dashboard, and a write that claimed to be one would stop every widget
      // declared afterwards from reaching this reader.
      arranged: false,
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

  it("says the editor's save IS an arrangement", async () => {
    // The other half of the statement above, and the one that keeps a dismissed
    // row safe to follow the defaults: the editor is the only route that can
    // REMOVE a card, so every write that can drop one must say it arranges.
    // Without this, a save that stopped stating it would pass the case above.
    renderGrid();
    const user = await beginEditing();
    await user.click(screen.getAllByTestId("widget-toggle-hidden")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect((api.put.mock.calls[0][1] as { arranged?: unknown }).arranged).toBe(
      true
    );
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
  it("announces a dismiss once the card has actually gone", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    // 🔴 The CARD first. A write the server accepted is not the same as an
    // arrangement the reader is looking at -- the re-read that fills the cache
    // can fail on its own, and `invalidateQueries` swallows that -- so
    // asserting the sentence alone passes while the card sits there.
    await waitFor(() =>
      expect(screen.queryByTestId("widget-cell-core/onboarding")).toBeNull()
    );
    expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
      "Set up your project hidden. Edit the dashboard to bring it back."
    );
  });

  it("says nothing when the write landed but the re-read did not", async () => {
    const user = userEvent.setup();
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    // The PUT is accepted and every later GET fails, which is the shape that
    // leaves a dismissed card on screen: the cache keeps the answer it has, so
    // the reader is looking at the card they just sent away.
    api.put.mockResolvedValue({ message: "ok", item: {} });
    api.get.mockRejectedValue(new Error("layout unavailable"));
    await user.click(screen.getByTestId("widget-dismiss"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Set up your project was updated, but the dashboard could not be refreshed. Reload the page to see it."
      )
    );
    expect(screen.getByTestId("widget-grid-live")).toHaveTextContent("");
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

describe("a dismissal reports itself, and nothing else does", () => {
  it("leaves the editor's chrome alone when the write is refused", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("someone else saved first"), {
      status: 409,
    });
    api.put.mockRejectedValue(conflict);
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // 🔴 The editor's alert says the dashboard changed "while you were
    // editing" and warns that unsaved changes will be lost. A reader who
    // dismissed a card from the dashboard was never editing and has no draft,
    // so sharing the editor's mutation told them they were about to lose work
    // that does not exist.
    expect(screen.queryByTestId("dashboard-edit-conflict")).toBeNull();
    expect(screen.queryByTestId("dashboard-edit-error")).toBeNull();
  });

  it("still reports an editor save failure through the editor's chrome", async () => {
    // The control for the case above: routing dismissal elsewhere must not
    // stop the editor reporting its OWN failures, which is the regression the
    // previous version of this hook was written to close.
    api.put.mockRejectedValue(new Error("network down"));
    renderGrid();
    const user = await beginEditing();
    await user.click(screen.getAllByTestId("widget-toggle-hidden")[0]);
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-error")).toBeInTheDocument()
    );
  });

  it("refuses a second dismissal while the first is in flight", async () => {
    const user = userEvent.setup();
    // A write that never settles, so the pending state is observable.
    api.put.mockImplementation(() => new Promise(() => {}));
    renderGrid();
    const dismiss = await screen.findByTestId("widget-dismiss");
    await user.click(dismiss);

    // 🔴 Every dismissal builds a whole-layout snapshot against ONE cached
    // version, so a second in flight carries the same guard: the server can
    // honour only one, and the reader is told their own second click was a
    // conflict somebody else caused.
    await waitFor(() => expect(dismiss).toBeDisabled());
    await user.click(dismiss);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dashboard when the card that held it goes", async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    // The focused button is unmounted with its card. Left alone the browser
    // drops focus to `body`, so the reader's next Tab restarts at the top of
    // the page -- a whole-page relocation reported as one card being hidden.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Dashboard widgets")
      )
    );
  });
});

describe("one layout write at a time", () => {
  it("locks the editor's own controls while a dismissal is in flight", async () => {
    const user = userEvent.setup();
    api.put.mockImplementation(() => new Promise(() => {}));
    renderGrid();
    await user.click(await screen.findByTestId("widget-dismiss"));

    // 🔴 Every control here starts a whole-layout write against ONE cached
    // version. A reader who dismisses and immediately edits and saves puts two
    // in flight against the same guard, so one of their OWN actions comes back
    // as a conflict somebody else caused -- and a reset racing a dismissal can
    // land in either order, reversing what they asked for.
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-begin")).toBeDisabled()
    );
  });

  it("keeps them locked until the dashboard has been read again", async () => {
    // 🔴 The write finishing is not the end of it. The re-read that follows is
    // what puts the new version in the cache, and a draft opened before it
    // lands is seeded with the version the write just replaced -- so the lock
    // has to outlast the re-read, not merely the PUT. It does because the
    // mutation's own `onSuccess` RETURNS the invalidation and TanStack awaits
    // it before reporting success; one that fired it and returned nothing
    // would release the lock early.
    const user = userEvent.setup();
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    const readsBefore = api.get.mock.calls.length;
    // The write lands at once; the re-read it triggers never does.
    api.get.mockImplementation(() => new Promise(() => {}));
    await user.click(screen.getByTestId("widget-dismiss"));

    // Past the PUT for certain: the re-read starts only once the write has
    // succeeded, so asserting the lock without this could be satisfied by the
    // write's own pending phase.
    await waitFor(() =>
      expect(api.get.mock.calls.length).toBeGreaterThan(readsBefore)
    );
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dashboard-edit-begin")).toBeDisabled();
  });
});

describe("a declaration that is not a boolean", () => {
  it("draws no control for a truthy non-boolean", async () => {
    // `validateWidgetDefinition` refuses this at boot, but a registration
    // arrives over the wire from a server that may be a different version and
    // the admin copies the field verbatim -- so the reading here has to be the
    // declaration's own answer rather than whether it happens to be truthy.
    mockBranding = branding({
      "core/onboarding": { dismissible: "false" },
    });
    renderGrid();

    // 🔴 Waits for the EDIT BUTTON, which is rendered only once an arrangement
    // has been read. The cell exists before then too -- the grid draws the
    // declarations while the layout request is in flight -- so waiting on the
    // cell is satisfied by the state in which no control is drawn for ANY
    // card, and the assertion below would pass without reading the field at
    // all.
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.queryByTestId("widget-dismiss")).toBeNull();
    // The control that makes that absence mean something: the same fixture
    // with a real `true` DOES draw one.
    expect(screen.getAllByTestId("widget-cell-core/onboarding")).toHaveLength(
      1
    );
  });

  it("draws the control when the declaration really says true", async () => {
    // The positive half of the case above, on the same path: without it, a
    // resolver that dropped the field entirely would satisfy the refusal.
    renderGrid();

    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByTestId("widget-dismiss")).toBeInTheDocument();
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
