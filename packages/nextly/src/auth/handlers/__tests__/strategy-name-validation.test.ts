/**
 * Configured auth strategies are held to the name rule at boot.
 *
 * The audit writer admits a strategy to a success row only when its name
 * matches the rule, so a non-conforming name authenticated normally while
 * being dropped from every row — an install with a custom strategy was the
 * one install whose logins carried no attribution.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

import { assertConfiguredStrategyNames } from "../deps-bridge";

function named(name: string): { name: string } {
  return { name };
}

describe("assertConfiguredStrategyNames", () => {
  it("refuses a name the audit writer would drop, naming it and the rule", () => {
    let caught: unknown;
    try {
      assertConfiguredStrategyNames([named("MagicLink")]);
    } catch (err) {
      caught = err;
    }
    expect(NextlyError.is(caught)).toBe(true);
    const context = (caught as NextlyError).logContext as {
      reason?: string;
      strategy?: string;
      rule?: string;
    };
    expect(context.reason).toBe("auth-strategy-name-invalid");
    expect(context.strategy).toBe("MagicLink");
    // The rule travels with the refusal: the operator fixing a boot failure
    // should not have to find the pattern in source to satisfy it.
    expect(context.rule).toMatch(/lowercase/);
  });

  it.each(["MagicLink", "magic.link", "magic link", "x".repeat(65)])(
    "refuses %s",
    name => {
      expect(() => assertConfiguredStrategyNames([named(name)])).toThrow();
    }
  );

  it.each([
    "password",
    "magic-link",
    "magic_link",
    "org:magic",
    "x".repeat(64),
  ])("accepts %s", name => {
    // The control: the shapes the rule exists to allow, including the
    // built-in name and the full 64-character width.
    expect(() => assertConfiguredStrategyNames([named(name)])).not.toThrow();
  });

  it("accepts an empty strategy list", () => {
    expect(() => assertConfiguredStrategyNames([])).not.toThrow();
  });
});
