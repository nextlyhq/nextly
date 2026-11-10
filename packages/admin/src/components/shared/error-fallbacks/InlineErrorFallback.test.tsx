import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

import { InlineErrorFallback } from "./InlineErrorFallback";

const french = {
  ...BUILT_IN_CATALOGS,
  fr: {
    "nextly.errors.inline.message": "Erreur de chargement du contenu",
    "nextly.errors.inline.development": "Erreur : {message}",
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("InlineErrorFallback", () => {
  it("reads as it always has in English", () => {
    render(<InlineErrorFallback />);

    expect(screen.getByText("Error loading content")).toBeTruthy();
  });

  it("names the error as it always has in English, in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<InlineErrorFallback error={new Error("boom")} />);

    expect(screen.getByText("Error: boom")).toBeTruthy();
  });

  it("reads in the interface language when the admin has its catalog", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <InlineErrorFallback />
      </I18nProvider>
    );

    expect(screen.getByText("Erreur de chargement du contenu")).toBeTruthy();
  });

  it("names the error in the interface language, in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <InlineErrorFallback error={new Error("boom")} />
      </I18nProvider>
    );

    expect(screen.getByText("Erreur : boom")).toBeTruthy();
  });

  it("shows a caller's own message as given, in any interface language", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <InlineErrorFallback message="Unable to load avatar" />
      </I18nProvider>
    );

    expect(screen.getByText("Unable to load avatar")).toBeTruthy();
  });
});
