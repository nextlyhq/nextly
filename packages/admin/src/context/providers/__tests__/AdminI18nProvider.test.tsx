import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, render, screen } from "@admin/__tests__/utils";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";
import { currentUserKey } from "@admin/hooks/useDashboardUser";
import { usePluginTranslate, useT } from "@admin/lib/i18n/I18nProvider";

const branding = vi.hoisted(() => ({
  plugins: undefined as
    | undefined
    | Array<{
        name: string;
        translations?: Record<string, Record<string, string>>;
      }>,
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
}));

/** What `GET /me` answers for the signed-in person, and every path asked. */
const me = vi.hoisted(() => ({
  interfaceLanguage: null as string | null,
  asked: [] as string[],
}));

vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({
    api: {
      protected: {
        get: async (path: string) => {
          me.asked.push(path);
          return {
            id: "u1",
            name: "Ada",
            email: "ada@example.com",
            interfaceLanguage: me.interfaceLanguage,
          };
        },
      },
    },
  }),
}));

/** What the shared session query answers: signed in unless a test says not. */
const session = vi.hoisted(() => ({
  data: { isSetup: true, isAuthenticated: true } as
    | undefined
    | { isSetup: boolean; isAuthenticated: boolean },
}));

vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => session,
}));

afterEach(() => {
  me.interfaceLanguage = null;
  me.asked = [];
  session.data = { isSetup: true, isAuthenticated: true };
  vi.restoreAllMocks();
});

/** A plugin whose cart title the admin has in English and French. */
const SHOP_IN_TWO_LANGUAGES = [
  {
    name: "@acme/shop",
    translations: {
      en: { "acme-shop.cart.title": "Cart" },
      fr: { "acme-shop.cart.title": "Panier" },
    },
  },
];

function CartTitle() {
  const pluginT = usePluginTranslate();
  return <p>{pluginT("acme-shop.cart.title")}</p>;
}

function browserLanguage(language: string) {
  vi.spyOn(navigator, "language", "get").mockReturnValue(language);
}

import { AdminI18nProvider } from "../AdminI18nProvider";

function Screen() {
  const t = useT();
  const pluginT = usePluginTranslate();
  return (
    <>
      <h1>{t("nextly.errors.page.title")}</h1>
      <p>{pluginT("acme-shop.cart.title")}</p>
    </>
  );
}

describe("AdminI18nProvider", () => {
  it("translates an installed plugin's strings beside the admin's own", () => {
    branding.plugins = [
      {
        name: "@acme/shop",
        translations: { en: { "acme-shop.cart.title": "Cart" } },
      },
    ];

    render(
      <AdminI18nProvider>
        <Screen />
      </AdminI18nProvider>
    );

    expect(
      screen.getByRole("heading", { name: "Something went wrong" })
    ).toBeTruthy();
    expect(screen.getByText("Cart")).toBeTruthy();
  });

  it("shows the admin's own strings while the plugins have not arrived", () => {
    branding.plugins = undefined;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <AdminI18nProvider>
        <Screen />
      </AdminI18nProvider>
    );

    expect(
      screen.getByRole("heading", { name: "Something went wrong" })
    ).toBeTruthy();
    expect(screen.getByText("acme-shop.cart.title")).toBeTruthy();
  });
});

/**
 * Render signed in, and wait until `/me` has ANSWERED, not merely been asked:
 * before the answer the browser's language is in effect, which is also what
 * several of the right answers look like.
 */
async function renderSettled(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  const rendered = render(ui, { queryClient });
  await vi.waitFor(() =>
    expect(queryClient.getQueryData(currentUserKey)).toBeDefined()
  );
  return rendered;
}

describe("AdminI18nProvider, each person's own interface language", () => {
  it("the stored language wins over the browser's", async () => {
    branding.plugins = SHOP_IN_TWO_LANGUAGES;
    browserLanguage("en-US");
    me.interfaceLanguage = "fr";

    await renderSettled(
      <AdminI18nProvider signedIn>
        <CartTitle />
      </AdminI18nProvider>
    );

    expect(screen.getByText("Panier")).toBeTruthy();
    expect(me.asked).toEqual(["/me"]);
  });

  it("null follows the browser", async () => {
    branding.plugins = SHOP_IN_TWO_LANGUAGES;
    browserLanguage("fr-FR");
    me.interfaceLanguage = null;

    await renderSettled(
      <AdminI18nProvider signedIn>
        <CartTitle />
      </AdminI18nProvider>
    );

    expect(screen.getByText("Panier")).toBeTruthy();
  });

  it("a stored language with no catalog falls back to the browser's, then English", async () => {
    branding.plugins = SHOP_IN_TWO_LANGUAGES;
    me.interfaceLanguage = "de";

    browserLanguage("fr-FR");
    const first = await renderSettled(
      <AdminI18nProvider signedIn>
        <CartTitle />
      </AdminI18nProvider>
    );
    expect(screen.getByText("Panier")).toBeTruthy();
    first.unmount();

    browserLanguage("es-ES");
    await renderSettled(
      <AdminI18nProvider signedIn>
        <CartTitle />
      </AdminI18nProvider>
    );
    expect(screen.getByText("Cart")).toBeTruthy();
  });

  it("asks for no stored language on a signed-out screen", async () => {
    branding.plugins = SHOP_IN_TWO_LANGUAGES;
    browserLanguage("en-US");
    me.interfaceLanguage = "fr";

    render(
      <AdminI18nProvider signedIn={false}>
        <CartTitle />
      </AdminI18nProvider>
    );

    expect(screen.getByText("Cart")).toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(me.asked).toEqual([]);
  });

  it("asks nothing of /me on a private screen until the session is known to be signed in", async () => {
    // A signed-out visitor opening a private address: the route is private
    // while the guard decides where to send them, and the session is not.
    branding.plugins = SHOP_IN_TWO_LANGUAGES;
    browserLanguage("en-US");
    me.interfaceLanguage = "fr";

    for (const answer of [
      undefined,
      { isSetup: true, isAuthenticated: false },
    ]) {
      session.data = answer;
      const rendered = render(
        <AdminI18nProvider signedIn>
          <CartTitle />
        </AdminI18nProvider>
      );
      expect(screen.getByText("Cart")).toBeTruthy();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(me.asked, JSON.stringify(answer)).toEqual([]);
      rendered.unmount();
    }
  });

  it("editing French content leaves the interface language alone", async () => {
    // The language an entry is being edited in is the content's, held by the
    // editor; the interface keeps the person's own, here the browser's.
    branding.plugins = SHOP_IN_TWO_LANGUAGES;
    browserLanguage("en-US");
    me.interfaceLanguage = null;

    await renderSettled(
      <AdminI18nProvider signedIn>
        <EntryLocaleProvider
          value={{
            locale: "fr",
            rtl: false,
            collectionLocalized: true,
            isNonDefaultLocale: true,
          }}
        >
          <CartTitle />
        </EntryLocaleProvider>
      </AdminI18nProvider>
    );

    expect(screen.getByText("Cart")).toBeTruthy();
  });
});
