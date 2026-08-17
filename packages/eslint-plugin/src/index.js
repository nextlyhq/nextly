import { createRequire } from "node:module";

import noHardcodedColors from "./rules/no-hardcoded-colors.js";
import noPaletteClasses from "./rules/no-palette-classes.js";
import noStaticInlineStyle from "./rules/no-static-inline-style.js";

// Read rather than hardcoded: the version is published metadata and a second
// copy of it drifts the moment the release tooling bumps one and not the other.
const { version } = createRequire(import.meta.url)("../package.json");

/**
 * ESLint rules that keep admin UI on Nextly's design-token system.
 *
 * Published so the rules reach plugin authors. A guard that runs only in this
 * repository governs the four first-party plugins and nothing anyone else
 * builds, which leaves the ecosystem the contract is written for as the only
 * part of it unenforced.
 *
 * Configs ship inside the plugin so a consumer installs one package and extends
 * one entry, rather than pairing a plugin with a separately versioned config
 * that can disagree with it.
 */
const plugin = {
  meta: { name: "@nextlyhq/eslint-plugin", version },
  rules: {
    "no-palette-classes": noPaletteClasses,
    "no-hardcoded-colors": noHardcodedColors,
    "no-static-inline-style": noStaticInlineStyle,
  },
  configs: {},
};

Object.assign(plugin.configs, {
  /**
   * Every rule at `error`.
   *
   * There is no graduated "strict" tier above this one: each rule marks code
   * that cannot follow a retheme, so a warning would describe the same defect
   * while letting it ship.
   */
  recommended: [
    {
      name: "@nextlyhq/recommended",
      plugins: { "@nextlyhq": plugin },
      rules: {
        "@nextlyhq/no-palette-classes": "error",
        "@nextlyhq/no-hardcoded-colors": "error",
        "@nextlyhq/no-static-inline-style": "error",
      },
    },
  ],
});

export default plugin;
