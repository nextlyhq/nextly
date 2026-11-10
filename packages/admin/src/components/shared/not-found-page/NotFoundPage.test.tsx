import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

import { NotFoundPage } from ".";

const french = {
  ...BUILT_IN_CATALOGS,
  fr: {
    "nextly.status.notFound.label": "Page introuvable",
    "nextly.status.notFound.title": "Oups ! Cette page n'existe pas",
    "nextly.status.notFound.description":
      "La page que vous cherchez a peut-être été déplacée ou supprimée.",
    "nextly.status.back": "Retour",
    "nextly.status.dashboard": "Aller au tableau de bord",
  },
};

describe("NotFoundPage", () => {
  it("reads as it always has in English", () => {
    render(<NotFoundPage />);

    expect(screen.getByText("Page Not Found")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Oops! This page doesn't exist" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The page you're looking for may have been moved, deleted, or the URL might be incorrect."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Go to dashboard" })
    ).toBeTruthy();
  });

  it("reads in the interface language when the admin has its catalog", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <NotFoundPage />
      </I18nProvider>
    );

    expect(screen.getByText("Page introuvable")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Oups ! Cette page n'existe pas" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "La page que vous cherchez a peut-être été déplacée ou supprimée."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retour" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Aller au tableau de bord" })
    ).toBeTruthy();
  });
});
