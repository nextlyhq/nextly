/**
 * That `registerBuiltInWidgetSources` WORKS (register-widgets.test.ts) is not
 * the same claim as that boot actually CALLS it. Before this wiring existed,
 * `clearWidgets()`/`clearSources()` had no caller anywhere in the repo, so the
 * widget-source registry was declared, validated and never populated at
 * runtime -- a gap a unit test of the extracted function cannot see, because
 * it calls the function directly rather than going through `registerServices`.
 *
 * This drives the real boot entry point instead. The fake adapter is deliberately
 * too thin to complete registration -- `publishStoredWebhookRecordingPolicies`
 * fails on it a few lines after the widget wiring runs -- so `registerServices`
 * always rejects. That is what makes the assertion honest: the registry is read
 * AFTER the rejection, so its population can only be explained by boot having
 * reached and executed the wiring before failing, not by some other path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");
const { getSource, clearSources, listSources } = await import(
  "../../domains/widgets/sources"
);
const { clearWidgets } = await import("../../domains/widgets/registry");

/** Reaches past adapter resolution and schema-registry init (both tolerant
 * of a minimal fake), through the widget wiring, then fails at
 * `publishStoredWebhookRecordingPolicies`'s first real adapter call. */
const thinAdapter = {
  connect: () => undefined,
  getDrizzle: () => ({}),
};

function boot(config: Record<string, unknown>): Promise<unknown> {
  return registerServices({
    adapter: thinAdapter,
    ...config,
  } as unknown as Parameters<typeof registerServices>[0]);
}

beforeEach(() => {
  clearSources();
  clearWidgets();
});

describe("widget-source registry population at boot", () => {
  it("is populated by registerServices before it fails later on the adapter", async () => {
    expect(listSources()).toHaveLength(0);

    await expect(
      boot({
        collections: [
          { slug: "posts", fields: [{ name: "title", type: "text" }] },
        ],
      })
    ).rejects.toThrow();

    // The rejection above proves boot did NOT complete -- so this can only be
    // explained by the widget wiring having run and completed before the
    // later failure, not by registerServices having somehow finished.
    expect(getSource("collection:posts")?.kind).toBe("collection");
    expect(listSources()).toHaveLength(1);
  });
});
