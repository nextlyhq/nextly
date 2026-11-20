/**
 * A response to a request that names a language by its older spelling says so, whichever parameter
 * names it: the language asked for (`locale`) and the one to fall back to (`fallback-locale`) are
 * both read as the configured code for one release, so either one sent the older way earns the
 * notice. The plausible broken check reads `locale` alone, and a client using the older spelling
 * only as its fallback is never told before it stops being accepted.
 */
import { describe, expect, it } from "vitest";

import { normalizeLocalization } from "../domains/i18n/config/normalize";

import { withLanguageCodeDeprecation } from "./language-code-deprecation";

const localization = normalizeLocalization({
  locales: ["en", "pt-BR", "zh-Hans"],
  defaultLocale: "en",
});

/** The headers a response to `query` carries. */
function headersFor(query: string): Headers {
  return withLanguageCodeDeprecation(
    new Request(
      `http://localhost/admin/api/collections/posts/entries?${query}`
    ),
    new Response("{}", { status: 200 }),
    localization
  ).headers;
}

describe("the language-code deprecation notice", () => {
  it("is given for an older spelling named only as the fallback", () => {
    const headers = headersFor("locale=en&fallback-locale=pt_BR");
    expect(headers.get("Deprecation")).toBe("true");
    expect(headers.get("Warning")).toMatch(/pt_BR[\s\S]*pt-BR/);
  });

  it("names both where the language and its fallback are each sent the older way", () => {
    const warning = headersFor("locale=pt_BR&fallback-locale=zh_Hans").get(
      "Warning"
    );
    expect(warning).toMatch(/pt_BR[\s\S]*pt-BR/);
    expect(warning).toMatch(/zh_Hans[\s\S]*zh-Hans/);
  });

  // The controls: the language alone sent the older way still earns it; standard codes earn none.
  it("is given for an older spelling named as the language", () => {
    expect(headersFor("locale=pt_BR").get("Deprecation")).toBe("true");
  });

  it("is not given where every code is in standard form", () => {
    const headers = headersFor("locale=pt-BR&fallback-locale=en");
    expect(headers.get("Deprecation")).toBeNull();
    expect(headers.get("Warning")).toBeNull();
  });
});
