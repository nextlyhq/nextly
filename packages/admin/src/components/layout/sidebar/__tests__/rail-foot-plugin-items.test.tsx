// @vitest-environment jsdom
/**
 * A plugin that chose the rail's foot (`header.place: "rail-foot"`) draws its
 * component there, before the Inbox, and the component stays mounted for as
 * long as the layout is: with the person's menu closed, and at every width.
 *
 * The layout mounts the rail in three ways, which this shell reproduces:
 * - at 1024px and 1440px, the rail beside the page;
 * - at 390px, the same rail, hidden by CSS but still mounted, and a second
 *   copy in the drawer while the menu button has it open;
 * - while a surface takes the rail away, the Inbox in the top bar instead.
 * The plugin's component is mounted once, by the provider, and moved into the
 * foot that is showing; its effect runs once and is never cleaned up.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

let mockWorkspacePending = false;
const mockBranding = {
  plugins: [
    {
      name: "@acme/bar",
      collections: [],
      header: { slot: "@acme/bar/admin#Badge" },
    },
    {
      name: "@acme/helper",
      collections: [],
      header: { slot: "@acme/helper/admin#Helper", place: "rail-foot" },
    },
    {
      name: "@acme/menu",
      collections: [],
      header: {
        place: "menu",
        item: {
          id: "acme-menu.user-menu",
          label: "Help",
          icon: "BookOpen",
          to: "/x",
        },
      },
    },
  ],
} as AdminBranding;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => ({
    isPending: mockWorkspacePending,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ isLoading: false }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: null }),
}));
vi.mock("@admin/hooks/useLogout", () => ({ useLogout: () => () => {} }));
vi.mock("@admin/hooks/useInterfaceLanguage", () => ({
  useStoredInterfaceLanguage: () => null,
  useSetInterfaceLanguage: () => () => {},
}));
vi.mock("@admin/lib/i18n/I18nProvider", () => ({
  useT: () => (key: string) => key,
  useInterfaceLanguages: () => ["en"],
}));
vi.mock("@admin/components/features/notifications", () => ({
  NotificationBell: () => (
    <button type="button" aria-label="Notifications" data-testid="bell" />
  ),
}));

import { RailAccount } from "../RailAccount";
import { RailFootPluginItemsProvider } from "../RailFootPluginItems";

/** What the fixture component's effect recorded. */
const effects = { runs: 0, cleanups: 0 };

/** Draws a button, and registers something a page needs, as a helper does. */
function Helper(): JSX.Element {
  useEffect(() => {
    effects.runs += 1;
    return () => {
      effects.cleanups += 1;
    };
  }, []);
  return <button type="button">Helper</button>;
}

/** The layout's three ways of mounting a rail foot, as props. */
function Shell({
  drawerOpen = false,
  railTaken = false,
}: {
  drawerOpen?: boolean;
  railTaken?: boolean;
}): JSX.Element {
  return (
    <RailFootPluginItemsProvider>
      {!railTaken && (
        <aside data-testid="rail" className="hidden lg:flex">
          <RailAccount />
        </aside>
      )}
      {drawerOpen && (
        <div data-testid="drawer">
          <RailAccount />
        </div>
      )}
      {railTaken && (
        <header data-testid="bar">
          <RailAccount placement="bar" />
        </header>
      )}
    </RailFootPluginItemsProvider>
  );
}

const helper = () => screen.getByRole("button", { name: "Helper" });

beforeEach(() => {
  // Here rather than after each test: the previous test's unmount, which
  // cleans its effect up, runs after this file's own after-each hooks.
  effects.runs = 0;
  effects.cleanups = 0;
  registerComponent("@acme/helper/admin#Helper", Helper);
  registerComponent("@acme/bar/admin#Badge", () => <span>Bar badge</span>);
});

afterEach(() => {
  clearRegistry();
  mockWorkspacePending = false;
});

describe("a plugin's item at the rail's foot", () => {
  it("is drawn at the foot before the Inbox, and only the rail-foot plugin's", () => {
    render(<Shell />);
    const rail = screen.getByTestId("rail");
    expect(rail).toContainElement(helper());
    expect(
      helper().compareDocumentPosition(screen.getByTestId("bell")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText("Bar badge")).toBeNull();
  });

  it("comes before the Inbox and the account menu in the tab order", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.tab();
    expect(document.activeElement).toBe(helper());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("bell"));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "User profile menu" })
    );
  });

  it("registers its effect while the person's menu is closed", () => {
    render(<Shell />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(effects).toEqual({ runs: 1, cleanups: 0 });
  });

  it("stays mounted at 1440px, 1024px and 390px, moving to the foot that shows", () => {
    // 1440px and 1024px: the rail beside the page.
    const { rerender } = render(<Shell />);
    expect(screen.getByTestId("rail")).toContainElement(helper());
    const drawn = helper();

    // 390px: the rail is hidden by CSS and stays mounted; the drawer opens.
    rerender(<Shell drawerOpen />);
    expect(screen.getByTestId("drawer")).toContainElement(helper());
    rerender(<Shell />);
    expect(screen.getByTestId("rail")).toContainElement(helper());

    // A surface takes the rail away: the Inbox, and the item, go to the bar.
    rerender(<Shell railTaken />);
    expect(screen.getByTestId("bar")).toContainElement(helper());
    rerender(<Shell />);

    // The same element throughout, and the effect ran once, never cleaned up.
    expect(helper()).toBe(drawn);
    expect(effects).toEqual({ runs: 1, cleanups: 0 });
  });

  it("sits in a box of its own above the account's box in the rail, so the account's box keeps the size its outline drew", () => {
    // The rail's foot is held to the window's bottom: an item drawn inside
    // the account's box grows that box upwards as the answers arrive, which
    // the browser records as the shell moving. Its own box appears whole.
    const { rerender } = render(<Shell />);
    const account = screen.getByTestId("rail-account");
    expect(account).not.toContainElement(helper());
    expect(account).toContainElement(screen.getByTestId("bell"));
    const box = screen.getByTestId("rail-foot-plugin-box");
    expect(box).toContainElement(helper());
    expect(box.nextElementSibling).toBe(account);
    // The space above the foot is the items' box's while it shows.
    expect(account.className).toContain("mt-0");

    // In the bar the controls sit in one row, so the item stays in it.
    rerender(<Shell railTaken />);
    expect(screen.getByTestId("bar-account")).toContainElement(helper());
  });

  it("is hidden with the rest of the foot until the answers are in, and mounted all the while", () => {
    mockWorkspacePending = true;
    const { rerender } = render(<Shell />);
    const drawn = screen.getByText("Helper");
    expect(drawn.closest("[hidden]")).not.toBeNull();
    expect(effects.runs).toBe(1);

    mockWorkspacePending = false;
    act(() => rerender(<Shell />));
    expect(helper().closest("[hidden]")).toBeNull();
    expect(effects).toEqual({ runs: 1, cleanups: 0 });
  });
});
