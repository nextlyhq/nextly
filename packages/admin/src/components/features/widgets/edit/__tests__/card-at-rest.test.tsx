/**
 * A card's menu and quick popover on the dashboard, outside customise mode.
 *
 * Remove takes any card off at once, asking nothing, with Undo in the removal notice. A Size or a
 * quick setting is saved for the reader at once, with Undo in a toast, through the one layout
 * write: a size saved at rest sends what customise mode's Save sends for the same change, apart
 * from saying it does not arrange the dashboard.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
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

/** Chooses a width from an open card menu's Width submenu, by keyboard: jsdom has no geometry. */
async function chooseWidthIn(user: User, menu: HTMLElement, name: string) {
  await user.click(within(menu).getByRole("menuitem", { name: /Width/ }));
  const widths = await waitFor(() => {
    const menus = screen.getAllByRole("menu");
    expect(menus.length).toBe(2);
    return menus[1];
  });
  within(widths).getByRole("menuitemradio", { name }).focus();
  await user.keyboard("{Enter}");
}

/** Chooses a width from the card menu at rest. */
async function chooseWidthAtRest(user: User, title: string, name: string) {
  await chooseWidthIn(user, await openMenu(user, title), name);
}

/** The same width chosen from the customise menu, then saved: the write customise mode sends. */
async function chooseWidthAndSave(user: User, title: string, name: string) {
  await user.click(await screen.findByTestId("dashboard-edit-begin"));
  await user.click(
    await screen.findByRole("button", { name: `Card actions for ${title}` })
  );
  await chooseWidthIn(user, await screen.findByRole("menu"), name);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
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

/** The Undo of the latest toast, as the reader would press it. */
function pressUndo() {
  const options = toast.success.mock.calls.at(-1)?.[1] as
    | { action?: { label: string; onClick: () => void } }
    | undefined;
  if (options?.action?.label !== "Undo") throw new Error("no Undo offered");
  options.action.onClick();
}

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

describe("Size in the card menu at rest", () => {
  it("sends what customise mode's Save sends for the same change, as not arranged", async () => {
    const atRest = renderGrid();
    const user = userEvent.setup();
    // The first card, so a write that put the resized card anywhere else would differ.
    await chooseWidthAtRest(user, "Styled", "Half width, 6 columns");
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const rest = sent(0);
    const restPath = api.put.mock.calls[0]?.[0];
    atRest.unmount();

    // The same change from the same dashboard, made in customise mode and saved.
    vi.clearAllMocks();
    layoutResponse = layout();
    renderGrid();
    await chooseWidthAndSave(user, "Styled", "Half width, 6 columns");
    const saved = sent(0);

    expect(api.put.mock.calls[0]?.[0]).toBe(restPath);
    // The one difference, on purpose: resizing one card is not taking charge of the dashboard.
    expect({ ...rest, arranged: true }).toEqual(saved);
    expect(rest).toMatchObject({ arranged: false });
    expect(saved).toMatchObject({ arranged: true });
    expect(rest?.placements[0]).toMatchObject({ id: "p1", w: 6, h: 3 });
  });

  it("offers Undo, which puts the card back at the size it had", async () => {
    renderGrid();
    const user = userEvent.setup();
    await chooseWidthAtRest(user, "Plain", "Half width, 6 columns");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls.at(-1)?.[0]).toBe(
      "Plain: Size set to 6 columns by 3 rows."
    );
    pressUndo();
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(
      sent(1)?.placements.find(placement => placement.id === "p2")
    ).toMatchObject({ w: 4, h: 3 });
  });
});

describe("the quick popover at rest", () => {
  it("opens from the card's title, saves a change at once with it still open, and Undo restores the value before", async () => {
    renderGrid();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Styled" }));
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Styled",
    });
    await user.click(within(popover).getByRole("combobox", { name: "Accent" }));
    await user.click(await screen.findByRole("option", { name: "Bold" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(
      sent(0)?.placements.find(placement => placement.id === "p1")?.config
    ).toEqual({ accent: "bold" });
    expect(
      screen.getByRole("dialog", { name: "Quick settings for Styled" })
    ).toBeInTheDocument();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    pressUndo();
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    // What the card had before this change, not the widget's default.
    expect(
      sent(1)?.placements.find(placement => placement.id === "p1")?.config
    ).toEqual({ accent: "soft" });
  });

  it("opens from Settings in the card menu", async () => {
    renderGrid();
    const user = userEvent.setup();
    const menu = await openMenu(user, "Styled");
    await user.click(within(menu).getByRole("menuitem", { name: /Settings/ }));
    expect(
      await screen.findByRole("dialog", { name: "Quick settings for Styled" })
    ).toBeInTheDocument();
  });
});

describe("what a card's own write says it is", () => {
  it("names the card by the title its reader gave it, as the card shows it", async () => {
    // Two copies of one widget are told apart by their own titles: so is what a write says.
    layoutResponse = {
      ...layout(),
      placements: [
        layout().placements[0]!,
        { ...DEFAULTS[1]!, title: "Drafts board" },
      ],
    };
    // The write fails, so what is said comes from the write itself.
    api.put.mockRejectedValue(new Error("network down"));
    renderGrid();
    const user = userEvent.setup();
    await chooseWidthAtRest(user, "Drafts board", "Half width, 6 columns");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls.at(-1)?.[0]).toMatch(
      /^Could not save Drafts board's size/
    );
  });
});

describe("Settings for a card whose widget declares none", () => {
  it("opens the card's settings panel, where its own title is set", async () => {
    // Every card has a title its reader can give it, so every card has Settings.
    renderGrid();
    const user = userEvent.setup();
    const menu = await openMenu(user, "Plain");
    await user.click(within(menu).getByRole("menuitem", { name: /Settings/ }));
    // Its popover holds its Size, and More settings leads on to the panel.
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Plain",
    });
    await user.click(
      within(popover).getByRole("button", { name: "More settings" })
    );
    const panel = await screen.findByRole("dialog", { name: "Plain settings" });
    expect(within(panel).getByLabelText("Title")).toBeInTheDocument();
  });
});
