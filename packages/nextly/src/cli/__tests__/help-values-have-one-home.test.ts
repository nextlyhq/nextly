/**
 * Two values a command's help is written from live in modules that import
 * nothing, so declaring the command loads none of the code around them; their
 * former homes re-export them. Each has one definition: the re-export is the
 * value itself, never a copy that could drift.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCEPT_DATA_LOSS_HELP as consentHelp } from "../../domains/schema/migrate/data-loss-consent";
import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { DEFAULT_TYPESCRIPT_CONFIG as configDefault } from "../../shared/types/config";
import { DEFAULT_TYPESCRIPT_CONFIG } from "../../shared/types/typescript-config-defaults";

describe("the values a command's help is written from have one home", () => {
  it("the configuration's TypeScript defaults are the light module's object", () => {
    // Identity, not equality: a copy with the same fields would pass `toEqual`.
    expect(configDefault).toBe(DEFAULT_TYPESCRIPT_CONFIG);
  });

  it("the data-loss consent's help is the light module's string, re-exported", () => {
    expect(consentHelp).toBe(ACCEPT_DATA_LOSS_HELP);
    // Two equal strings are indistinguishable at run time, so a copy would
    // pass the line above; the consent module must name the light module as
    // the value's source.
    const consent = readFileSync(
      fileURLToPath(
        new URL(
          "../../domains/schema/migrate/data-loss-consent.ts",
          import.meta.url
        )
      ),
      "utf8"
    );
    expect(consent).toMatch(
      /export \{[^}]*\bACCEPT_DATA_LOSS_HELP\b[^}]*\} from "\.\/data-loss-consent-help";/
    );
    expect(consent).not.toMatch(/const ACCEPT_DATA_LOSS_HELP\b/);
  });
});
