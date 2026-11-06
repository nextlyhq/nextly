import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";
import type { AccessSubject } from "@admin/types/access-subject";

import { NoAccessPage } from ".";

const french = {
  ...BUILT_IN_CATALOGS,
  fr: {
    "nextly.status.noAccess.label": "Accès refusé",
    "nextly.status.noAccess.title.collection":
      "Vous n'avez pas accès à cette collection",
    "nextly.status.noAccess.title.single": "Vous n'avez pas accès à ce Single",
    "nextly.status.noAccess.title.page": "Vous n'avez pas accès à cette page",
    "nextly.status.noAccess.description":
      "Votre compte n'a pas l'autorisation de l'ouvrir.",
    "nextly.status.back": "Retour",
    "nextly.status.dashboard": "Aller au tableau de bord",
  },
};

// Each subject's title is a sentence of its own, so a language can agree it
// with the noun rather than splice the noun into one sentence.
const TITLES: ReadonlyArray<
  [AccessSubject | undefined, english: string, french: string]
> = [
  [
    "collection",
    "You don't have access to this collection",
    "Vous n'avez pas accès à cette collection",
  ],
  [
    "single",
    "You don't have access to this Single",
    "Vous n'avez pas accès à ce Single",
  ],
  [
    undefined,
    "You don't have access to this page",
    "Vous n'avez pas accès à cette page",
  ],
];

describe("NoAccessPage", () => {
  it.each(TITLES)(
    "reads as it always has in English, for %s",
    (subject, english) => {
      render(<NoAccessPage subject={subject} />);

      expect(screen.getByText("No access")).toBeTruthy();
      expect(screen.getByRole("heading", { name: english })).toBeTruthy();
      expect(
        screen.getByText(
          "Your account doesn't have permission to open it. If you need it, ask an admin."
        )
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Go to dashboard" })
      ).toBeTruthy();
    }
  );

  it.each(TITLES)(
    "reads in the interface language when the admin has its catalog, for %s",
    (subject, _english, translated) => {
      render(
        <I18nProvider interfaceLanguage="fr" catalogs={french}>
          <NoAccessPage subject={subject} />
        </I18nProvider>
      );

      expect(screen.getByText("Accès refusé")).toBeTruthy();
      expect(screen.getByRole("heading", { name: translated })).toBeTruthy();
      expect(
        screen.getByText("Votre compte n'a pas l'autorisation de l'ouvrir.")
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retour" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Aller au tableau de bord" })
      ).toBeTruthy();
    }
  );
});
