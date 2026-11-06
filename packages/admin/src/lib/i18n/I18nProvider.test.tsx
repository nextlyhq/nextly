import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, usePluginTranslate, useT } from "./I18nProvider";

function Title() {
  const t = useT();
  return <h1>{t("nextly.errors.page.title")}</h1>;
}

const french = {
  fr: { "nextly.errors.page.title": "Un problème est survenu" },
};

describe("I18nProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the English string by default, and the language's own when a catalog is given", () => {
    const { unmount } = render(<Title />);
    expect(
      screen.getByRole("heading", { name: "Something went wrong" })
    ).toBeTruthy();
    unmount();

    render(
      <I18nProvider
        interfaceLanguage="fr"
        catalogs={{
          ...french,
          en: { "nextly.errors.page.title": "Something went wrong" },
        }}
      >
        <Title />
      </I18nProvider>
    );
    expect(
      screen.getByRole("heading", { name: "Un problème est survenu" })
    ).toBeTruthy();
  });

  it("uses the browser's language when it has a catalog for it", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");

    render(
      <I18nProvider
        catalogs={{
          ...french,
          en: { "nextly.errors.page.title": "Something went wrong" },
        }}
      >
        <Title />
      </I18nProvider>
    );

    expect(
      screen.getByRole("heading", { name: "Un problème est survenu" })
    ).toBeTruthy();
  });

  it("gives a plugin's component its own strings in the interface language, then English, then the key", () => {
    function Cart() {
      const t = usePluginTranslate();
      return (
        <ul>
          <li>{t("acme-shop.cart.title")}</li>
          <li>{t("acme-shop.cart.count", { count: 3 })}</li>
          <li>{t("acme-shop.cart.missing")}</li>
        </ul>
      );
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <I18nProvider
        interfaceLanguage="fr"
        catalogs={{
          en: {
            "acme-shop.cart.title": "Cart",
            "acme-shop.cart.count": "{count} items",
          },
          fr: { "acme-shop.cart.title": "Panier" },
        }}
      >
        <Cart />
      </I18nProvider>
    );

    expect(
      screen.getAllByRole("listitem").map(item => item.textContent)
    ).toEqual(["Panier", "3 items", "acme-shop.cart.missing"]);
  });
});
