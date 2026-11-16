import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

import { PageErrorFallback } from "./PageErrorFallback";

const french = {
  ...BUILT_IN_CATALOGS,
  fr: {
    "nextly.errors.page.title": "Un problème est survenu",
    "nextly.errors.page.reload": "Recharger la page",
    "nextly.errors.page.retry": "Réessayer",
    "nextly.errors.page.home": "Accueil",
  },
};

describe("PageErrorFallback", () => {
  it("reads as it always has in English", () => {
    render(<PageErrorFallback reset={() => {}} />);

    expect(
      screen.getByRole("heading", { name: "Something went wrong" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go home" })).toBeTruthy();
  });

  it("reads in the interface language when the admin has its catalog", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <PageErrorFallback reset={() => {}} />
      </I18nProvider>
    );

    expect(
      screen.getByRole("heading", { name: "Un problème est survenu" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Recharger la page" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accueil" })).toBeTruthy();
  });

  it("shows a caller's own title as given, in any interface language", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <PageErrorFallback title="Failed to load users" />
      </I18nProvider>
    );

    expect(
      screen.getByRole("heading", { name: "Failed to load users" })
    ).toBeTruthy();
  });
});
