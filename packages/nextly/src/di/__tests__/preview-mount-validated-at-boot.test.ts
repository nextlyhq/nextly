/**
 * The preview mount is resolved where a bad value can still be acted on.
 *
 * Deferring it to the minting endpoint puts the refusal in front of an editor
 * clicking "Copy shareable link", who cannot edit `nextly.config.ts` — and puts
 * it there only for an app that has a previewable collection and someone who
 * happened to click. A mount that cannot produce a link is a property of the
 * configuration, so it is settled when the configuration is read.
 *
 * Asserted through `registerServices` rather than through the config builder,
 * because a plugin's `setup` transformer may add or replace `preview` and runs
 * AFTER that builder — so a check placed there vouches for a value the plugin
 * then changes. `emailRetention` beside it had exactly that defect.
 *
 * The adapter here cannot connect, which is what makes the positive controls
 * necessary: registration fails either way, so a test asserting only that it
 * rejects would pass with the resolution deleted entirely.
 */
import { describe, expect, it, vi } from "vitest";

import type { PluginDefinition } from "../../plugins/plugin-context";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

/** An adapter that fails LATER than the config resolution under test. */
const failingAdapter = { connect: () => undefined };

function boot(config: Record<string, unknown>): Promise<unknown> {
  return registerServices({
    adapter: failingAdapter,
    ...config,
  } as unknown as Parameters<typeof registerServices>[0]);
}

/** A plugin whose `setup` replaces the preview block, as the API permits. */
function pluginSetting(preview: unknown): PluginDefinition[] {
  return [
    {
      name: "@acme/preview",
      version: "1.0.0",
      nextly: "*",
      setup: (config: Record<string, unknown>) => ({ ...config, preview }),
    },
  ] as unknown as PluginDefinition[];
}

/** The message, or whatever the rejection turned out to be. */
async function bootError(config: Record<string, unknown>): Promise<string> {
  try {
    await boot(config);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "<resolved>";
}

describe("resolving the preview mount at boot", () => {
  it.each([
    ["another origin", "https://elsewhere.example/preview"],
    ["a protocol-relative URL", "//elsewhere.example"],
    ["a query", "/api/preview?tenant=a"],
    ["a parent segment", "/api/../evil"],
  ])("refuses %s in the config", async (_label, route) => {
    expect(await bootError({ preview: { route } })).toMatch(/preview\.route/);
  });

  // The half a check before the transformers cannot see. Without this the
  // plugin's mount reaches the container unresolved and first fails at a click.
  it("refuses a mount a plugin's setup transformer introduced", async () => {
    expect(
      await bootError({
        plugins: pluginSetting({ route: "//elsewhere.example" }),
      })
    ).toMatch(/preview\.route/);
  });

  // The positive controls. Boot fails on the adapter either way, so without
  // these the refusals above are satisfied by any rejection at all.
  it("carries a valid mount past the resolution, failing later instead", async () => {
    expect(
      await bootError({ preview: { route: "/next/preview" } })
    ).not.toMatch(/preview\.route/);
  });

  it("carries a valid mount a plugin introduced", async () => {
    expect(
      await bootError({ plugins: pluginSetting({ route: "/next/preview" }) })
    ).not.toMatch(/preview\.route/);
  });
});
