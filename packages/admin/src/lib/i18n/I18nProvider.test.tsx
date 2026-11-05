import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useT } from "./I18nProvider";

function Title() {
  const t = useT();
  return <h1>{t("errors.page.title")}</h1>;
}

const french = { fr: { "errors.page.title": "Un problème est survenu" } };

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
          en: { "errors.page.title": "Something went wrong" },
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
          en: { "errors.page.title": "Something went wrong" },
        }}
      >
        <Title />
      </I18nProvider>
    );

    expect(
      screen.getByRole("heading", { name: "Un problème est survenu" })
    ).toBeTruthy();
  });
});
