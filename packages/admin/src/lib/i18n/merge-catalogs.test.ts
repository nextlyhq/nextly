import { describe, expect, it } from "vitest";

import { mergeCatalogs } from "./merge-catalogs";
import { translate, type Catalogs } from "./translate";

const base: Catalogs = {
  en: { "nextly.errors.page.title": "Something went wrong" },
};

describe("mergeCatalogs", () => {
  it("adds each plugin's strings under their languages, keeping the admin's", () => {
    const merged = mergeCatalogs(base, [
      {
        translations: {
          en: { "acme-shop.cart.title": "Cart" },
          fr: { "acme-shop.cart.title": "Panier" },
        },
      },
      { translations: { en: { "acme-blog.post.title": "Post" } } },
      {},
    ]);

    expect(merged.en).toEqual({
      "nextly.errors.page.title": "Something went wrong",
      "acme-shop.cart.title": "Cart",
      "acme-blog.post.title": "Post",
    });
    expect(merged.fr).toEqual({ "acme-shop.cart.title": "Panier" });
  });

  it("leaves the admin's catalog itself unchanged", () => {
    mergeCatalogs(base, [
      { translations: { en: { "acme-shop.cart.title": "Cart" } } },
    ]);
    expect(base.en).toEqual({
      "nextly.errors.page.title": "Something went wrong",
    });
  });

  it("falls back to a plugin's English for a language its catalog lacks", () => {
    const merged = mergeCatalogs(base, [
      {
        translations: {
          en: {
            "acme-shop.cart.title": "Cart",
            "acme-shop.cart.empty": "Empty",
          },
          fr: { "acme-shop.cart.title": "Panier" },
        },
      },
    ]);

    expect(translate(merged, "fr", "acme-shop.cart.title")).toBe("Panier");
    expect(translate(merged, "fr", "acme-shop.cart.empty")).toBe("Empty");
  });
});
