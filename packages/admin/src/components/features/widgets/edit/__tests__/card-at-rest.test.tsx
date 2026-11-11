/**
 * A card's menu and settings drawer on the dashboard, outside customise mode.
 *
 * Remove takes any card off at once, asking nothing, with Undo in the removal notice. Settings…
 * opens the card's one settings drawer; a click on its title opens nothing. The drawer's Save
 * keeps its settings and width for the reader in one layout write, the one customise mode's Save
 * sends for the same change, apart from saying it does not arrange the dashboard; until then the
 * card is untouched, and Cancel, Escape and the close button discard the change.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { DashboardChromeProvider } from "@admin/components/features/dashboard/header/dashboard-chrome";
import { WelcomeHeader } from "@admin/components/features/dashboard/WelcomeHeader";
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
import { preloadWidgetSettingsSheet } from "../settings-sheet-code";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));

// The header's New button reads collections and permissions of its own,
// which this test does not set up; it is a marker here.
vi.mock("@admin/components/features/new-menu/NewMenu", () => ({
  NewMenu: () => <div data-testid="dashboard-new" />,
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
  protectedApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const api = vi.mocked(protectedApi);

function Body() {
  return <p>Body</p>;
}
registerCoreComponent("core#AtRestBody", Body);

/** Resizable from 3 by 2 up to 12 by 6. */
const RESIZABLE = {
  default: { w: 4, h: 3 },
  min: { w: 3, h: 2 },
  max: { w: 12, h: 6 },
};

/** Two cards: one with a quick setting, and one with no settings that never declared `dismissible`. */
function branding(): AdminBranding {
  return {
    widgets: [
      {
        id: "core/styled",
        title: "Styled",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#AtRestBody",
        settings: [
          {
            name: "accent",
            type: "select",
            label: "Accent",
            quick: true,
            defaultValue: "plain",
            options: [
              { label: "Plain", value: "plain" },
              { label: "Bold", value: "bold" },
              { label: "Soft", value: "soft" },
            ],
          },
        ],
      },
      {
        id: "core/plain",
        title: "Plain",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#AtRestBody",
      },
    ],
  } as unknown as AdminBranding;
}

/** The default dashboard both cards are on, at their widgets' default size. */
const DEFAULTS: WidgetPlacement[] = [
  { id: "p1", widgetId: "core/styled", w: 4, h: 3, removed: false },
  { id: "p2", widgetId: "core/plain", w: 4, h: 3, removed: false },
];

/**
 * What the server reads back for a reader still following the default, as its layout read does
 * (`dismissalsApplied`, tested with the layout endpoint in nextly's own suite): the default's
 * cards in the default's order, each with the removal and settings the reader stored, and the
 * size they stored only where it departs from the default's, which is the size they chose. The
 * admin's tests do not import the server's modules, so the rule is stated here for this card list.
 */
function followedDefault(
  written: readonly WidgetPlacement[]
): WidgetPlacement[] {
  return DEFAULTS.map(card => {
    const choice = written.find(placement => placement.id === card.id);
    if (choice === undefined) return card;
    return {
      ...card,
      w: choice.w,
      h: choice.h,
      removed: choice.removed,
      ...(choice.config === undefined ? {} : { config: choice.config }),
      ...(choice.title === undefined ? {} : { title: choice.title }),
    };
  });
}

function layout(): DashboardLayoutResponse {
  return {
    placements: [{ ...DEFAULTS[0], config: { accent: "soft" } }, DEFAULTS[1]],
    widgets: {},
    available: [],
    defaultPlacements: DEFAULTS,
    version: 7,
    source: "own",
    // A row of dismissals at most: the reader still follows the default.
    arranged: false,
    scope: "tok",
    audience: "aud",
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
  // The page's header and grid, as the page composes them: the header holds the page's heading,
  // which a closed notice returns focus to, and Customize.
  return render(
    <DashboardChromeProvider>
      <WelcomeHeader />
      <WidgetGrid />
    </DashboardChromeProvider>,
    { wrapper: Wrapper }
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function openMenu(user: User, title: string) {
  await user.click(
    await screen.findByRole("button", { name: `Card menu for ${title}` })
  );
  return screen.findByRole("menu");
}

/** Opens a card's settings drawer from its menu at rest, once its form has loaded. */
async function openDrawer(user: User, title: string): Promise<HTMLElement> {
  const menu = await openMenu(user, title);
  await user.click(within(menu).getByRole("menuitem", { name: "Settings…" }));
  await screen.findByRole("radiogroup", { name: "Width" });
  return screen.getByRole("dialog", { name: title });
}

/** Styled's Accent made Bold and its width 50% in its drawer, then saved. */
async function boldAndHalf(user: User, drawer: HTMLElement) {
  await user.click(within(drawer).getByRole("radio", { name: "Bold" }));
  await user.click(within(drawer).getByRole("radio", { name: "50% width" }));
  await user.click(within(drawer).getByRole("button", { name: "Save" }));
}

/** The body of the `index`th layout write, in the order sent. */
function sent(index: number) {
  return api.put.mock.calls[index]?.[1] as
    | {
        placements: WidgetPlacement[];
        version: number;
        scope: string;
        arranged: boolean;
      }
    | undefined;
}

// The settings panel's code loads apart from the dashboard's, ahead of its opening, as a pointer
// over the card's menu fetches it. Fetched once here, so a test opening the panel meets the panel
// rather than its loading screen.
beforeAll(async () => {
  preloadWidgetSettingsSheet();
  await import("../CellSettings");
});

beforeEach(() => {
  stubDashboardWidth();
  vi.clearAllMocks();
  mockBranding = branding();
  layoutResponse = layout();
  api.get.mockImplementation(() => Promise.resolve(layoutResponse));
  // The stand-in answers the next read as the server would, not by echoing the write.
  api.put.mockImplementation((_path: string, body: unknown) => {
    const write = body as { placements: WidgetPlacement[]; arranged: boolean };
    const before = layoutResponse as DashboardLayoutResponse;
    const arranged = write.arranged || before.arranged;
    layoutResponse = {
      ...before,
      arranged,
      placements: arranged
        ? write.placements
        : followedDefault(write.placements),
      version: before.version + 1,
    };
    return Promise.resolve({ message: "ok", item: {} });
  });
});

afterEach(() => {
  unstubDashboardWidth();
});

describe("Remove in the card menu at rest", () => {
  it("takes off a card that never declared itself dismissible, asking nothing, and Undo puts it back", async () => {
    renderGrid();
    const user = userEvent.setup();
    const menu = await openMenu(user, "Plain");
    await user.click(within(menu).getByRole("menuitem", { name: "Remove" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      sent(0)?.placements.find(placement => placement.id === "p2")?.removed
    ).toBe(true);
    expect(sent(0)?.arranged).toBe(false);
    const undo = await screen.findByTestId("removal-notice-undo");
    await waitFor(() => expect(undo).toHaveFocus());

    await user.click(undo);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(
      sent(1)?.placements.find(placement => placement.id === "p2")?.removed
    ).toBe(false);
    // Back to the control it was removed with: its menu, as it has no dismiss control.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Card menu for Plain" })
      ).toHaveFocus()
    );
  });
});

describe("a card's title at rest", () => {
  it("opens nothing when clicked: the card's settings are in its menu alone", async () => {
    renderGrid();
    const user = userEvent.setup();
    const heading = await screen.findByRole("heading", { name: "Styled" });
    expect(within(heading).queryByRole("button")).toBeNull();
    await user.click(heading);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the settings drawer at rest", () => {
  it("keeps the card untouched until Save, then sends settings and width in one write, as customise mode's Save does, not arranged", async () => {
    const atRest = renderGrid();
    const user = userEvent.setup();
    // The first card, so a write that put the changed card anywhere else would differ.
    const drawer = await openDrawer(user, "Styled");
    await user.click(within(drawer).getByRole("radio", { name: "Bold" }));
    await user.click(within(drawer).getByRole("radio", { name: "50% width" }));
    // Shown in the preview at once; nothing written, so the card is as it was.
    expect(
      within(drawer).getByTestId("settings-preview-width")
    ).toHaveTextContent("At 50% of the dashboard");
    expect(api.put).not.toHaveBeenCalled();
    await user.click(within(drawer).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const rest = sent(0);
    const restPath = api.put.mock.calls[0]?.[0];
    atRest.unmount();

    // The same change from the same dashboard, made in customise mode and saved.
    vi.clearAllMocks();
    layoutResponse = layout();
    renderGrid();
    await user.click(await screen.findByTestId("dashboard-edit-begin"));
    await user.click(
      await screen.findByRole("button", { name: "Card actions for Styled" })
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Settings…",
      })
    );
    await screen.findByRole("radiogroup", { name: "Width" });
    await boldAndHalf(user, screen.getByRole("dialog", { name: "Styled" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Staged, not written, until the bar's Save.
    expect(api.put).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const saved = sent(0);

    expect(api.put.mock.calls[0]?.[0]).toBe(restPath);
    // The one difference, on purpose: changing one card is not taking charge of the dashboard.
    expect({ ...rest, arranged: true }).toEqual(saved);
    expect(rest).toMatchObject({ arranged: false });
    expect(rest?.placements[0]).toMatchObject({
      id: "p1",
      w: 6,
      h: 3,
      config: { accent: "bold" },
    });
  });

  it("discards the change on Cancel, Escape and the close button, writing nothing", async () => {
    renderGrid();
    const user = userEvent.setup();
    for (const by of ["Cancel", "Escape", "Close"]) {
      const drawer = await openDrawer(user, "Styled");
      await user.click(within(drawer).getByRole("radio", { name: "Bold" }));
      if (by === "Escape") {
        await user.keyboard("{Escape}");
      } else {
        await user.click(within(drawer).getByRole("button", { name: by }));
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    expect(api.put).not.toHaveBeenCalled();
    // Opened again, it holds what is stored.
    const drawer = await openDrawer(user, "Styled");
    expect(within(drawer).getByRole("radio", { name: "Soft" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("says in place, naming the card by its own title, why a save did not land, and stays open", async () => {
    // Two copies of one widget are told apart by their own titles: so is what a write says.
    layoutResponse = {
      ...layout(),
      placements: [
        layout().placements[0]!,
        { ...DEFAULTS[1]!, title: "Drafts board" },
      ],
    };
    api.put.mockRejectedValue(new Error("network down"));
    renderGrid();
    const user = userEvent.setup();
    const drawer = await openDrawer(user, "Drafts board");
    await user.click(within(drawer).getByRole("radio", { name: "50% width" }));
    await user.click(within(drawer).getByRole("button", { name: "Save" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent(
      /^Could not save Drafts board's settings/
    );
    expect(screen.getByRole("dialog", { name: "Drafts board" })).toBe(drawer);
    // Said in the drawer, not again in a toast.
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("Settings… for a card whose widget declares none", () => {
  it("opens the card's drawer, where its own title and width are set", async () => {
    // Every card has a title and a width its reader can set, so every card has Settings….
    renderGrid();
    const user = userEvent.setup();
    const drawer = await openDrawer(user, "Plain");
    expect(within(drawer).getByLabelText("Title")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("region", { name: "Size" })
    ).toBeInTheDocument();
    expect(
      within(drawer).queryByRole("region", { name: "Content" })
    ).toBeNull();
  });
});

describe("focus around the drawer at rest", () => {
  /** How the drawer is closed: Save keeps a change to the card's title; the rest do not. */
  async function close(user: User, drawer: HTMLElement, by: string) {
    if (by === "Save") {
      await user.type(within(drawer).getByLabelText("Title"), "Mine");
      await user.click(within(drawer).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    } else if (by === "Escape") {
      await user.keyboard("{Escape}");
    } else {
      await user.click(within(drawer).getByRole("button", { name: by }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  // Named either way: Save gives the card the title typed in the drawer.
  for (const by of ["Save", "Cancel", "Escape", "Close"]) {
    it(`takes focus in, and hands it back to the card's menu on ${by}`, async () => {
      renderGrid();
      const user = userEvent.setup();
      const drawer = await openDrawer(user, "Styled");
      await waitFor(() =>
        expect(drawer).toContainElement(document.activeElement as HTMLElement)
      );
      await close(user, drawer, by);
      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: /^Card menu for (Styled|Mine)$/,
          })
        ).toHaveFocus()
      );
    });
  }
});
