/**
 * The write decisions the dashboard's cards offer actions by: whether a reader
 * may create in a collection, and whether they may update a Single. Each asks
 * the gate a real write is judged by (`callerMayPerform`), for its own action
 * and slug, in the language the write the card's link opens is judged in, so a
 * card never offers what the write would refuse, nor refuses what it allows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callerMayPerform, localization } = vi.hoisted(() => ({
  /** The site's languages, as the registered configuration answers them. */
  localization: vi.fn<() => unknown>(),
  callerMayPerform:
    vi.fn<
      (
        scope: unknown,
        action: string,
        resource: string,
        user: unknown
      ) => Promise<boolean>
    >(),
}));
vi.mock("../../../auth/access/route-gate-adapters", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../auth/access/route-gate-adapters")
  >()),
  callerMayPerform,
}));

vi.mock("../../i18n/configured-locales", async importOriginal => ({
  ...(await importOriginal<typeof import("../../i18n/configured-locales")>()),
  appLocalization: () => localization(),
}));

import { currentRuleLanguage } from "../../../auth/access/rule-language";
import { createVerdict, updateVerdict } from "../reader-content";

/** A site in English, its default, and French. */
const ENGLISH_AND_FRENCH = {
  defaultLocale: "en",
  fallback: false,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "fr", label: "French", rtl: false, fallbackLocale: [] },
  ],
};

const user = { id: "reader-1", roles: ["editor"] };

beforeEach(() => {
  vi.clearAllMocks();
  localization.mockReturnValue(undefined);
  // A reader who may update "home" and nothing else.
  callerMayPerform.mockImplementation((_scope, action, resource) =>
    Promise.resolve(action === "update" && resource === "home")
  );
});

describe("the write decisions behind a card's actions", () => {
  it("asks the write's own gate whether the reader may update a Single", async () => {
    const mayUpdate = updateVerdict({ user });

    expect(await mayUpdate("home")).toBe(true);
    // 🔴 Readable is not updatable: the gate says no, and so does the verdict.
    expect(await mayUpdate("about")).toBe(false);
    expect(callerMayPerform).toHaveBeenCalledWith(
      undefined,
      "update",
      "about",
      user
    );
  });

  it("asks for creating, not updating, when deciding create", async () => {
    // The control: the same reader may not create in "home", so a verdict
    // that asked the wrong action would answer yes.
    expect(await createVerdict({ user })("home")).toBe(false);
    expect(callerMayPerform).toHaveBeenCalledWith(
      undefined,
      "create",
      "home",
      user
    );
  });

  it("judges a localized Single's update in the default language, as its editor's save is", async () => {
    localization.mockReturnValue(ENGLISH_AND_FRENCH);
    // An update rule that allows this reader the default language only: it
    // answers yes only when the languages it is told are English alone.
    callerMayPerform.mockImplementation(() => {
      const { locale, locales } = currentRuleLanguage();
      return Promise.resolve(
        locale === "en" && locales.length === 1 && locales[0] === "en"
      );
    });

    // 🔴 Told every language, the rule refuses, and the row would offer View
    // on a page this reader can edit; told the editor's language, it allows.
    expect(await updateVerdict({ user })("home")).toBe(true);
    // Creating is judged in the same language, for the same reason.
    expect(await createVerdict({ user })("posts")).toBe(true);
  });

  it("is told every language outside a verdict, so the case above is the verdict's doing", async () => {
    // The control: the same rule asked with no language set refuses.
    localization.mockReturnValue(ENGLISH_AND_FRENCH);
    expect(currentRuleLanguage().locales).toEqual(["en", "fr"]);
  });
});
