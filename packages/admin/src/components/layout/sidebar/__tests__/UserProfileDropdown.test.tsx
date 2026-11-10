import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { AdminI18nProvider } from "@admin/context/providers/AdminI18nProvider";
import { navigateTo } from "@admin/lib/navigation";

import { UserProfileDropdown } from "../UserProfileDropdown";

/** The installed plugins: one with French strings, so French is offered. */
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    plugins: [
      {
        name: "@acme/shop",
        translations: {
          en: { "acme-shop.cart.title": "Cart" },
          fr: { "acme-shop.cart.title": "Panier" },
        },
      },
    ],
  }),
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

// Signed in, as the menu only ever is.
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({ data: { isSetup: true, isAuthenticated: true } }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

/** The signed-in person as the server holds them, and what was written. */
const me = vi.hoisted(() => ({
  interfaceLanguage: null as string | null,
  written: [] as Array<[string, unknown]>,
  reads: 0,
  /** The next save fails with this, as a network or server error would. */
  failNext: null as Error | null,
}));

vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({
    api: {
      protected: {
        get: async () => {
          me.reads += 1;
          return {
            id: "u1",
            name: "Ada",
            email: "ada@example.com",
            interfaceLanguage: me.interfaceLanguage,
          };
        },
        patch: async (path: string, body: { interfaceLanguage: unknown }) => {
          if (me.failNext) {
            const failure = me.failNext;
            me.failNext = null;
            throw failure;
          }
          me.written.push([path, body]);
          me.interfaceLanguage = body.interfaceLanguage as string | null;
          return { message: "Profile updated.", item: {} };
        },
      },
    },
  }),
}));

afterEach(() => {
  me.interfaceLanguage = null;
  me.written = [];
  me.reads = 0;
  me.failNext = null;
  toast.error.mockReset();
  vi.restoreAllMocks();
});

function renderMenu() {
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
  return render(
    <AdminI18nProvider signedIn>
      <UserProfileDropdown
        user={{ id: "u1", name: "Ada", email: "ada@example.com" }}
        onLogout={() => {}}
      />
    </AdminI18nProvider>
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "User profile menu" }));
}

describe("the user menu's interface language", () => {
  it("lists Follow the browser and every catalog's language, each named in itself", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    expect(await screen.findByText("Interface language")).toBeTruthy();
    const choices = screen
      .getAllByRole("menuitemradio")
      .map(item => item.textContent);
    expect(choices).toEqual(["Follow the browser", "English", "Français"]);
    expect(
      screen
        .getByRole("menuitemradio", { name: "Follow the browser" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("saves the choice through /me, and the menu then shows it chosen", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    const french = await screen.findByRole("menuitemradio", {
      name: "Français",
    });
    const readsBefore = me.reads;
    await user.click(french);

    await vi.waitFor(() =>
      expect(me.written).toEqual([["/me", { interfaceLanguage: "fr" }]])
    );
    // The save re-reads the person, so every reader of them is refreshed,
    // not only this menu.
    await vi.waitFor(() => expect(me.reads).toBeGreaterThan(readsBefore));
    await openMenu(user);
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("menuitemradio", { name: "Français" })
          .getAttribute("aria-checked")
      ).toBe("true")
    );
  });

  it("following the browser again clears the stored language", async () => {
    me.interfaceLanguage = "fr";
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    await user.click(
      await screen.findByRole("menuitemradio", { name: "Follow the browser" })
    );

    await vi.waitFor(() =>
      expect(me.written).toEqual([["/me", { interfaceLanguage: null }]])
    );
  });

  it("shows a stored language the admin has no catalog for as chosen, marked not available", async () => {
    // Its plugin removed, say: the admin falls back, and the menu still shows
    // what is stored, which returns if the catalog does.
    me.interfaceLanguage = "de";
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    const stored = await screen.findByRole("menuitemradio", {
      name: "Deutsch (not available)",
    });
    expect(stored.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getAllByRole("menuitemradio")
        .filter(item => item.getAttribute("aria-checked") === "true")
    ).toHaveLength(1);
  });

  it("tells the person when the choice could not be saved", async () => {
    me.failNext = new Error("The connection was lost.");
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    await user.click(
      await screen.findByRole("menuitemradio", { name: "Français" })
    );

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Your interface language could not be saved.",
        { description: "The connection was lost." }
      )
    );
    expect(me.written).toEqual([]);
  });
});

describe("the user menu's My Account", () => {
  it("My Account opens /admin/account", async () => {
    // The person's own page, which they may always open; the users edit page
    // asks a permission many of them lack.
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    await user.click(
      await screen.findByRole("menuitem", { name: "My Account" })
    );

    expect(navigateTo).toHaveBeenCalledWith("/admin/account");
  });
});
