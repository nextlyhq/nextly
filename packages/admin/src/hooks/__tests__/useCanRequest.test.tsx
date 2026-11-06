/**
 * A read sent in the default language, as quick edit sends one, asks every
 * language's translation state only where the answer in hand speaks for it:
 * while the default language is the one on screen, whose answer a rule that
 * answers by language gave.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { onScreen } = vi.hoisted(() => ({
  onScreen: {
    locale: undefined as string | undefined,
    readTranslations: true,
  },
}));

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    canAccessCollection: (_slug: string, request: string) =>
      request === "readTranslations" ? onScreen.readTranslations : true,
  }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: true, defaultLocale: "en" }),
}));
vi.mock("@admin/hooks/useLocaleParam", () => ({
  useLocaleParam: () => onScreen.locale,
}));

import { useDefaultLanguageAsksTranslationStatus } from "../useCanRequest";

const asks = () =>
  renderHook(() => useDefaultLanguageAsksTranslationStatus("posts")).result
    .current;

beforeEach(() => {
  onScreen.locale = undefined;
  onScreen.readTranslations = true;
});

describe("useDefaultLanguageAsksTranslationStatus", () => {
  it("asks on the default language, named or not", () => {
    expect(asks()).toBe(true);
    onScreen.locale = "en";
    expect(asks()).toBe(true);
  });

  it("asks nothing while another language is on screen, whose answer may differ", () => {
    onScreen.locale = "fr";
    expect(asks()).toBe(false);
  });

  it("asks nothing for a user who may not read every language's state", () => {
    onScreen.readTranslations = false;
    expect(asks()).toBe(false);
  });
});
