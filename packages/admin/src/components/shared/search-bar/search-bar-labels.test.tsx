import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

import { SearchBar } from "./index";

const french = {
  ...BUILT_IN_CATALOGS,
  fr: {
    "nextly.search.placeholder": "Rechercher...",
    "nextly.search.clear": "Effacer la recherche",
  },
};

// A value, so the clear button is shown beside the placeholder's input.
const searching = { value: "posts", onChange: () => undefined };

describe("the search bar's own words", () => {
  it("read as they always have in English", () => {
    render(<SearchBar {...searching} />);

    expect(screen.getByPlaceholderText("Search...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("read in the interface language when the admin has its catalog", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <SearchBar {...searching} />
      </I18nProvider>
    );

    expect(screen.getByPlaceholderText("Rechercher...")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Effacer la recherche" })
    ).toBeTruthy();
  });

  it("shows a caller's own placeholder as given, in any interface language", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <SearchBar {...searching} placeholder="Search users..." />
      </I18nProvider>
    );

    expect(screen.getByPlaceholderText("Search users...")).toBeTruthy();
  });
});
