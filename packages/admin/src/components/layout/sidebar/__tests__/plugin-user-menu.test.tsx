// @vitest-environment jsdom
/**
 * A plugin that chose the person's menu (`header.place: "menu"`) declares an
 * item there, never a component: a label, an icon, and a link or an action.
 * It is drawn under "Help and community", after the built-in links, only
 * while the menu is open, as a real menu item: reachable by the keyboard,
 * closing the menu when chosen, and Escape closes the menu around it.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";
import { registerComponent } from "@admin/lib/plugins/component-registry";
import { navigateTo } from "@admin/lib/navigation";

import type { PluginUserMenuEntry } from "../../header/header-visibility";
import { UserProfileDropdown } from "../UserProfileDropdown";

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/hooks/useInterfaceLanguage", () => ({
  useStoredInterfaceLanguage: () => null,
  useSetInterfaceLanguage: () => () => {},
}));
vi.mock("@admin/lib/i18n/I18nProvider", () => ({
  useT: () => (key: string) => key,
  useInterfaceLanguages: () => ["en"],
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));
/** The runner the entry list's declared actions use, watched. */
const runner = vi.hoisted(() => ({
  runDeclaredAction: vi.fn(
    async (
      _action: unknown,
      _rows: readonly unknown[]
    ): Promise<{ ran: true } | { open: string }> => ({ ran: true })
  ),
}));
vi.mock(
  "@admin/components/features/entries/EntryList/declared-actions",
  () => runner
);

const SUPPORT: PluginUserMenuEntry = {
  plugin: "@acme/support",
  id: "acme-support.user-menu",
  label: "Support desk",
  icon: "LifeBuoy",
  to: "/admin/plugins/acme-support",
};
const STATUS: PluginUserMenuEntry = {
  plugin: "@acme/status",
  id: "acme-status.user-menu",
  label: "Status page",
  icon: "Activity",
  to: "https://status.example.com",
};
const SYNC: PluginUserMenuEntry = {
  plugin: "@acme/sync",
  id: "acme-sync.user-menu",
  label: "Sync now",
  icon: "RefreshCw",
  action: { run: { method: "POST", path: "/sync" } },
};
const REPORT: PluginUserMenuEntry = {
  plugin: "@acme/report",
  id: "acme-report.user-menu",
  label: "Report a problem",
  icon: "BookOpen",
  action: { open: "@acme/report/admin#ReportDialog" },
};

afterEach(() => {
  vi.mocked(navigateTo).mockReset();
  runner.runDeclaredAction.mockClear();
  toast.success.mockReset();
});

function renderMenu(
  pluginItems: PluginUserMenuEntry[],
  hidden: ReadonlySet<
    "github" | "discord" | "docs" | "notifications"
  > = new Set()
) {
  return render(
    <UserProfileDropdown
      user={{ id: "u1", name: "Ada" }}
      onLogout={() => {}}
      hidden={hidden}
      pluginItems={pluginItems}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: "User profile menu" });

/** The menu's items in order, by their text. */
const itemNames = () =>
  within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map(item => item.textContent);

describe("a plugin's item in the person's menu", () => {
  it("is drawn only while the menu is open, under Help and community", async () => {
    const user = userEvent.setup();
    renderMenu([SUPPORT]);
    expect(screen.queryByText("Support desk")).toBeNull();

    await user.click(trigger());
    expect(screen.getByText("Help and community")).toBeTruthy();
    // After the built-in help links and before My Account.
    expect(itemNames()).toEqual([
      "Documentation",
      "GitHub",
      "Discord",
      "Support desk",
      "My Account",
      "Sign out",
    ]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("Support desk")).toBeNull();
  });

  it("keeps the group for the plugin's item when every built-in link is hidden", async () => {
    const user = userEvent.setup();
    renderMenu([SUPPORT], new Set(["docs", "github", "discord"]));
    await user.click(trigger());
    expect(screen.getByText("Help and community")).toBeTruthy();
    expect(itemNames()).toEqual(["Support desk", "My Account", "Sign out"]);
  });

  it("reaches the item from the keyboard, and Enter on a link navigates in place and closes the menu", async () => {
    const user = userEvent.setup();
    renderMenu([SUPPORT]);
    trigger().focus();
    await user.keyboard("{Enter}");
    const item = await screen.findByRole("menuitem", { name: "Support desk" });
    while (document.activeElement !== item) await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(navigateTo).toHaveBeenCalledWith("/admin/plugins/acme-support");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens an absolute URL in a new tab, as the help links do", async () => {
    const user = userEvent.setup();
    renderMenu([STATUS]);
    await user.click(trigger());
    const link = screen.getByRole("menuitem", { name: "Status page" });
    expect(link.getAttribute("href")).toBe("https://status.example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("runs an action through the declared-action runner on no rows, and closes the menu", async () => {
    const user = userEvent.setup();
    renderMenu([SYNC]);
    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Sync now" }));

    expect(runner.runDeclaredAction).toHaveBeenCalledWith(
      {
        plugin: "@acme/sync",
        id: "acme-sync.user-menu",
        action: SYNC.action,
      },
      []
    );
    expect(screen.queryByRole("menu")).toBeNull();
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Sync now: done.")
    );
  });

  it("draws the component an action opens in a dialog, outside the closed menu", async () => {
    registerComponent("@acme/report/admin#ReportDialog", () => (
      <p>Tell us what went wrong</p>
    ));
    runner.runDeclaredAction.mockResolvedValueOnce({
      open: "@acme/report/admin#ReportDialog",
    });
    const user = userEvent.setup();
    renderMenu([REPORT]);
    await user.click(trigger());
    await user.click(
      screen.getByRole("menuitem", { name: "Report a problem" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Report a problem")).toBeTruthy();
    expect(within(dialog).getByText("Tell us what went wrong")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("draws the plugins' items in the order it is handed", async () => {
    const user = userEvent.setup();
    renderMenu([SYNC, SUPPORT], new Set(["docs", "github", "discord"]));
    await user.click(trigger());
    expect(itemNames().slice(0, 2)).toEqual(["Sync now", "Support desk"]);
  });
});
