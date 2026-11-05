import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
