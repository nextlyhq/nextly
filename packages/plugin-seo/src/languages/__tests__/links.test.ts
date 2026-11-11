/**
 * A page's language links, from the versions of it that stand for
 * themselves: one for each, itself included, and `x-default` at the default
 * language's; none where there is no other language to link to.
 */
import { describe, expect, it } from "vitest";

import { languageLinks } from "../links";

describe("a page's language links", () => {
  it("names every version, the default language first, and x-default at its address", () => {
    const { links, problems } = languageLinks(
      [
        { language: "fr", href: "/fr/a-propos" },
        { language: "en", href: "/en/about" },
        { language: "de", href: "/de/ueber" },
      ],
      "en"
    );
    expect(links).toEqual([
      { hreflang: "en", href: "/en/about" },
      { hreflang: "fr", href: "/fr/a-propos" },
      { hreflang: "de", href: "/de/ueber" },
      { hreflang: "x-default", href: "/en/about" },
    ]);
    expect(problems).toEqual([]);
  });

  it("names none for a page with one version", () => {
    expect(
      languageLinks([{ language: "en", href: "/en/about" }], "en").links
    ).toEqual([]);
  });

  it("has no x-default where the default language has no version", () => {
    expect(
      languageLinks(
        [
          { language: "fr", href: "/fr/a-propos" },
          { language: "de", href: "/de/ueber" },
        ],
        "en"
      ).links
    ).toEqual([
      { hreflang: "fr", href: "/fr/a-propos" },
      { hreflang: "de", href: "/de/ueber" },
    ]);
  });

  it("names a language by its mapped code, and leaves a refused one out as a problem", () => {
    const { links, problems } = languageLinks(
      [
        { language: "en", href: "/en/about" },
        { language: "pt_BR", href: "/pt_BR/sobre" },
        { language: "es-419", href: "/es-419/acerca" },
      ],
      "en"
    );
    expect(links.map(link => link.hreflang)).toEqual([
      "en",
      "pt-BR",
      "x-default",
    ]);
    expect(problems.map(problem => problem.language)).toEqual(["es-419"]);
  });

  it("names none where every other version is refused", () => {
    const { links } = languageLinks(
      [
        { language: "en", href: "/en/about" },
        { language: "es-419", href: "/es-419/acerca" },
      ],
      "en"
    );
    expect(links).toEqual([]);
  });
});
