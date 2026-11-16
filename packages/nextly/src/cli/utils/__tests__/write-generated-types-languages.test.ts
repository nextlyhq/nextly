/**
 * `generate:types` and `build` write the languages a configuration locks into the types, exactly
 * as configured, and none where the configuration declares no languages (Settings manages them,
 * or there are none), so a read's language is then any code.
 */
import { describe, expect, it } from "vitest";

import { generateTypesFile } from "../write-generated-types";

function typesFor(config: Parameters<typeof generateTypesFile>[0]["config"]) {
  return generateTypesFile({
    cwd: "/app",
    outputFile: "nextly-types.ts",
    config,
    plugins: [],
    collections: [],
    singles: [],
    components: [],
    userFields: [],
    moduleAugmentation: true,
  }).code;
}

describe("the generated types file and the site's languages", () => {
  it("lists the languages a configuration declares, as configured", () => {
    const locale = (code: string) => ({
      code,
      label: code,
      rtl: false,
      fallbackLocale: [],
    });
    const code = typesFor({
      localization: { locales: [locale("fr"), locale("en_US")] },
    });
    expect(code).toContain(
      '  locales: {\n    "en_US": true;\n    "fr": true;\n  };'
    );
  });

  it("lists none where the configuration declares no languages", () => {
    expect(typesFor({})).not.toContain("locales:");
  });
});
