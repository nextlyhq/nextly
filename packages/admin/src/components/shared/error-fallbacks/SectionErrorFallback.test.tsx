import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

import { SectionErrorFallback } from "./SectionErrorFallback";

const french = {
  ...BUILT_IN_CATALOGS,
  fr: {
    "nextly.errors.section.title": "Erreur de chargement de la section",
    "nextly.errors.section.description":
      "Une erreur est survenue lors du chargement de cette section.",
    "nextly.errors.section.details": "Détails de l'erreur",
    "nextly.errors.section.retry": "Réessayer",
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SectionErrorFallback", () => {
  it("reads as it always has in English", () => {
    // Development shows the details, so every string the fallback owns is on
    // screen at once.
    vi.stubEnv("NODE_ENV", "development");
    render(<SectionErrorFallback error={new Error("boom")} reset={() => {}} />);

    expect(screen.getByText("Error loading section")).toBeTruthy();
    expect(
      screen.getByText(
        "An error occurred while loading this section. Please try again."
      )
    ).toBeTruthy();
    expect(screen.getByText("Error details")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
  });

  it("reads in the interface language when the admin has its catalog", () => {
    vi.stubEnv("NODE_ENV", "development");
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <SectionErrorFallback error={new Error("boom")} reset={() => {}} />
      </I18nProvider>
    );

    expect(screen.getByText("Erreur de chargement de la section")).toBeTruthy();
    expect(
      screen.getByText(
        "Une erreur est survenue lors du chargement de cette section."
      )
    ).toBeTruthy();
    expect(screen.getByText("Détails de l'erreur")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });

  it("shows a caller's own title and description as given, in any interface language", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <SectionErrorFallback
          title="Failed to load table"
          description="Unable to fetch data."
        />
      </I18nProvider>
    );

    expect(screen.getByText("Failed to load table")).toBeTruthy();
    expect(screen.getByText("Unable to fetch data.")).toBeTruthy();
  });
});
