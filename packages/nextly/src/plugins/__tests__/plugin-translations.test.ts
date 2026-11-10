import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";
import {
  ADMIN_TRANSLATION_SEGMENT,
  collectPluginTranslations,
} from "../plugin-translations";

function plugin(
  name: string,
  translations: unknown,
  enabled?: boolean
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    enabled,
    contributes: { translations },
  } as unknown as PluginDefinition;
}

/** The refusal's reason and context, or `undefined` when nothing is refused. */
function refusal(
  plugins: PluginDefinition[]
): ({ reason?: string } & Record<string, unknown>) | undefined {
  try {
    collectPluginTranslations(plugins);
    return undefined;
  } catch (error) {
    return (error as { logContext?: Record<string, unknown> }).logContext;
  }
}

describe("collectPluginTranslations", () => {
  it("accepts a namespaced catalog, in several languages", () => {
    const catalog = {
      en: { "acme-shop.cart.title": "Cart", "acme-shop.cart.empty": "Empty" },
      fr: { "acme-shop.cart.title": "Panier" },
      "pt-BR": { "acme-shop.cart.title": "Carrinho" },
    };

    expect(
      collectPluginTranslations([plugin("@acme/shop", catalog)]).get(
        "@acme/shop"
      )
    ).toEqual(catalog);
  });

  it("refuses a plugin slugged as the admin's own segment, naming it and the segment", () => {
    // The admin's own keys begin with this segment, so a plugin whose
    // namespace it is would share them.
    expect(
      refusal([
        plugin("nextly", {
          en: { [`${ADMIN_TRANSLATION_SEGMENT}.errors.page.title`]: "Oops" },
        }),
      ])
    ).toMatchObject({
      reason: "plugin-translations-reserved-slug",
      plugin: "nextly",
      segment: "nextly",
    });
  });

  it("lets a plugin slugged as the admin's segment boot when it declares no translations", () => {
    expect(collectPluginTranslations([plugin("nextly", undefined)]).size).toBe(
      0
    );
  });

  it("refuses a key under the admin's segment from any other plugin, by the namespace rule", () => {
    expect(
      refusal([
        plugin("@acme/shop", { en: { "nextly.errors.page.title": "Oops" } }),
      ])
    ).toMatchObject({
      reason: "plugin-translation-outside-namespace",
      plugin: "@acme/shop",
      key: "nextly.errors.page.title",
    });
  });

  it("refuses a key another plugin owns, naming both", () => {
    // Two plugins sharing a slug are refused earlier at boot; the catalogs
    // are still held to one owner per key on their own.
    expect(
      refusal([
        plugin("acme-shop", { en: { "acme-shop.cart.title": "Cart" } }),
        plugin("@acme/shop", { fr: { "acme-shop.cart.title": "Panier" } }),
      ])
    ).toMatchObject({
      reason: "plugin-translation-duplicate",
      plugin: "@acme/shop",
      otherPlugin: "acme-shop",
      key: "acme-shop.cart.title",
    });
  });

  it("refuses a key outside the plugin's namespace", () => {
    expect(
      refusal([plugin("@acme/shop", { en: { "billing.total": "Total" } })])
    ).toMatchObject({ reason: "plugin-translation-outside-namespace" });
  });

  it("refuses a malformed key", () => {
    for (const key of [
      "acme-shop",
      "acme-shop..title",
      "acme-shop.cart title",
    ]) {
      expect(
        refusal([plugin("@acme/shop", { en: { [key]: "x" } })]),
        key
      ).toMatchObject({ reason: "plugin-translation-malformed-key" });
    }
  });

  it("refuses a malformed catalog or language", () => {
    for (const translations of [
      "Cart",
      ["acme-shop.cart.title"],
      { English: { "acme-shop.cart.title": "Cart" } },
      { en: "Cart" },
    ]) {
      expect(
        refusal([plugin("@acme/shop", translations)]),
        JSON.stringify(translations)
      ).toMatchObject({ reason: "plugin-translations-malformed" });
    }
  });

  it("refuses a language not spelled canonically, naming the spelling browsers report", () => {
    // The admin matches a catalog to the browser's language by exact
    // spelling, so `pt-br` would never be chosen.
    for (const [language, expected] of [
      ["pt-br", "pt-BR"],
      ["zh-hant", "zh-Hant"],
    ]) {
      expect(
        refusal([
          plugin("@acme/shop", {
            [language]: { "acme-shop.cart.title": "Cart" },
          }),
        ]),
        language
      ).toMatchObject({
        reason: "plugin-translations-malformed",
        language,
        expected,
      });
    }
  });

  it("refuses a value that is not text", () => {
    for (const value of [42, { text: "Cart" }, null]) {
      expect(
        refusal([
          plugin("@acme/shop", { en: { "acme-shop.cart.title": value } }),
        ]),
        String(value)
      ).toMatchObject({ reason: "plugin-translation-not-text" });
    }
  });

  it("keeps and checks a disabled plugin's catalog, whose field editors still mount", () => {
    const catalog = { en: { "acme-shop.cart.title": "Cart" } };

    expect(
      collectPluginTranslations([plugin("@acme/shop", catalog, false)]).get(
        "@acme/shop"
      )
    ).toEqual(catalog);
    expect(
      refusal([plugin("@acme/shop", "not a catalog", false)])
    ).toMatchObject({ reason: "plugin-translations-malformed" });
  });
});
