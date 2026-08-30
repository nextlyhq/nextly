/**
 * That `resetWidgetRegistries` WORKS (register-widgets.test.ts) is not the same
 * claim as that boot actually CALLS it. Before this wiring existed,
 * `clearWidgets()`/`clearSources()` had no caller anywhere in the repo, so the
 * registries were declared, validated and never reset at runtime -- a gap a
 * unit test of the extracted function cannot see, because it calls the function
 * directly rather than going through `registerServices`.
 *
 * This drives the real boot entry point instead. The fake adapter is
 * deliberately too thin to complete registration --
 * `publishStoredWebhookRecordingPolicies` fails on it a few lines after the
 * widget wiring runs -- so `registerServices` always rejects. That is what
 * makes the assertion honest: the registries are read AFTER the rejection, so
 * their state can only be explained by boot having reached and executed the
 * wiring before failing, not by `registerServices` having somehow finished.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");
const { getSource, clearSources, listSources, registerSource } = await import(
  "../../domains/widgets/sources"
);
const { clearWidgets, listWidgets, registerWidget } = await import(
  "../../domains/widgets/registry"
);

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

/** A previous boot's rows, which a hot reload would otherwise collide with. */
function seedPreviousBoot(): void {
  registerSource({
    id: "plugin:stripe/revenue",
    label: "Revenue",
    kind: "plugin",
    supports: ["count"],
    fields: [{ name: "total", type: "number" }],
  });
  registerWidget(
    {
      id: "stripe/revenue",
      title: "Revenue",
      archetype: "metric",
      defaultSize: "sm",
      query: { source: "plugin:stripe/revenue", op: "count" },
    },
    { source: "@acme/stripe" }
  );
}

beforeEach(() => {
  clearSources();
  clearWidgets();
});

describe("widget-registry reset at boot", () => {
  it("is run by registerServices before it fails later on the adapter", async () => {
    seedPreviousBoot();
    expect(listSources()).toHaveLength(1);
    expect(listWidgets()).toHaveLength(1);

    await expect(boot({ collections: [] })).rejects.toThrow();

    // The rejection above proves boot did NOT complete -- so an emptied store
    // can only be explained by the widget wiring having run and completed
    // before the later failure, not by `registerServices` having finished.
    expect(getSource("plugin:stripe/revenue")).toBeUndefined();
    expect(listSources()).toHaveLength(0);
    expect(listWidgets()).toHaveLength(0);
  });

  it("does not publish a collection source from the boot config", async () => {
    // The control that pins WHY the reset is all boot does. A code-first
    // collection is in `transformedConfig.collections`; a Builder-authored one
    // never is. Deriving sources from the config here covered only the first,
    // so the derivation moved to the collection registry, which holds both and
    // is read where a query needs it.
    await expect(
      boot({
        collections: [
          { slug: "posts", fields: [{ name: "title", type: "text" }] },
        ],
      })
    ).rejects.toThrow();

    expect(getSource("collection:posts")).toBeUndefined();
  });
});
