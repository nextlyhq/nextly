/**
 * The boot warning for a second-factor attempt budget kept per process.
 *
 * Without a shared rate-limit store each instance counts its own attempts, so
 * on a multi-instance deployment the cap is multiplied by the instance count.
 * The warning exists so an operator learns that at boot rather than never.
 */
import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "../../../plugins/plugin-context";
import { challengeBudgetWarning } from "../deps-bridge";

function plugin(over: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    name: "@test/totp",
    version: "0.0.0",
    nextly: ">=0.0.1",
    contributes: {
      auth: {
        challenges: [{ id: "totp", resolve: async () => ({ ok: true }) }],
      },
    },
    ...over,
  } as PluginDefinition;
}

const sharedStore = {
  increment: async () => ({ count: 1, resetTime: Date.now() }),
  reset: async () => {},
};

describe("challengeBudgetWarning", () => {
  it("warns when a challenge is registered and no shared store is configured", () => {
    expect(challengeBudgetWarning([plugin()], {})).toContain(
      "no shared rate-limit store"
    );
  });

  it("is silent when a shared store is configured", () => {
    expect(
      challengeBudgetWarning([plugin()], { rateLimit: { store: sharedStore } })
    ).toBeNull();
  });

  it("is silent when no enabled plugin registers a challenge", () => {
    // The control: a warning on every install would pass the first case and
    // teach operators to ignore it.
    expect(challengeBudgetWarning([], {})).toBeNull();
    expect(challengeBudgetWarning([plugin({ enabled: false })], {})).toBeNull();
  });
});
