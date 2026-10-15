/**
 * The app refuses to start on a plugin's limit rule outside its bounds,
 * naming the plugin and the rule, through the same resolution every boot
 * runs; and a plugin's context carries `ctx.limits` only when it declares a
 * rule.
 */
import { describe, expect, it } from "vitest";

import type { LimitRule } from "../../domains/limits/limit-rules";
import type { PluginDefinition } from "../plugin-context";
import { resolvePlugins } from "../resolve";

import { createPluginLimits } from "./plugin-limits";

/** A plugin declaring `limits`. */
function plugin(
  limits: Record<string, unknown> | undefined,
  enabled = true
): PluginDefinition {
  return {
    name: "@test/accounts",
    version: "1.0.0",
    nextly: "*",
    enabled,
    contributes:
      limits === undefined
        ? {}
        : { limits: limits as Record<string, LimitRule> },
  };
}

/** What resolution refused with, or "not refused". */
function refusal(plugins: PluginDefinition[]): unknown {
  try {
    resolvePlugins(plugins, { coreVersion: "1.0.0" });
  } catch (error) {
    const { code, logContext, logMessage } = error as {
      code?: string;
      logMessage?: string;
      logContext?: { reason?: string; plugin?: string; rule?: string };
    };
    return {
      code,
      reason: logContext?.reason,
      plugin: logContext?.plugin,
      rule: logContext?.rule,
      logMessage,
    };
  }
  return "not refused";
}

const backoff = (free: number, waitsMs: number[]) => ({
  type: "backoff",
  free,
  waitsMs,
  forgetAfterMs: 60 * 60 * 1000,
});

describe("contributes.limits at start", () => {
  it("accepts rules within their bounds", () => {
    expect(
      refusal([
        plugin({
          tries: { type: "window", windows: [{ max: 5, perMs: 86_400_000 }] },
          signIn: backoff(5, [1000, 2000]),
        }),
      ])
    ).toBe("not refused");
  });

  it.each([
    ["a backoff rule with no free attempts", backoff(0, [1000])],
    ["waits that shorten", backoff(5, [4000, 1000])],
    [
      "a window over 30 days",
      { type: "window", windows: [{ max: 1, perMs: 31 * 86_400_000 }] },
    ],
    ["an unknown kind", { type: "bucket" }],
  ])("refuses %s, naming the plugin and the rule", (_label, rule) => {
    expect(refusal([plugin({ signIn: rule })])).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "limit-rule-invalid",
      plugin: "@test/accounts",
      rule: "signIn",
      logMessage: expect.stringContaining('the limit rule "signIn"'),
    });
  });

  it("does not check a disabled plugin's rules", () => {
    expect(refusal([plugin({ signIn: backoff(0, [1000]) }, false)])).toBe(
      "not refused"
    );
  });

  it("gives a plugin a limiter only when it declares a rule", () => {
    expect(createPluginLimits(plugin(undefined))).toBeUndefined();
    expect(createPluginLimits(plugin({}))).toBeUndefined();
    expect(
      createPluginLimits(
        plugin({
          tries: { type: "window", windows: [{ max: 5, perMs: 60_000 }] },
        })
      )
    ).toBeDefined();
  });
});
