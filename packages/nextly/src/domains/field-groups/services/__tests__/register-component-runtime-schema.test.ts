/**
 * Runtime registration must point the process at BOTH of a localized field group's tables.
 *
 * A localized group's translated reads and writes go through the companion, so registering only the
 * main table leaves the half that actually serves those values stale. That matters more now that
 * the function REPORTS its outcome: a partial registration returning `registered: true` tells a
 * caller the refresh completed, and the caller passes that on to an operator as "the group is
 * usable again".
 *
 * There are two sinks — the DI registry and the adapter's own resolver — and they must answer this
 * identically. The fallback is exercised here because it is the one that diverged: it registered
 * the main table alone while returning the same verdict as the branch that registered both.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSchemaRegistryFromDI = vi.fn();
vi.mock("../../../dispatcher/helpers/di", () => ({
  getSchemaRegistryFromDI: () => mockGetSchemaRegistryFromDI(),
  getConfigFromDI: () => null,
}));

/** A localized text field, which is what makes a companion table exist at all. */
const LOCALIZED_FIELDS = [
  { name: "title", type: "text", localized: true },
] as unknown as Parameters<
  typeof import("../field-group-table-provisioning").registerComponentRuntimeSchema
>[3];

/** An adapter carrying only the resolver seam the fallback reads. */
function adapterWithResolver(): {
  adapter: unknown;
  registered: Array<{ name: string }>;
} {
  const registered: Array<{ name: string }> = [];
  return {
    adapter: {
      tableResolver: {
        registerDynamicSchema: (name: string) => {
          registered.push({ name });
        },
      },
    },
    registered,
  };
}

beforeEach(() => {
  // No DI registry, so the fallback is the branch under test. Asserted below by the registration
  // arriving on the resolver at all — without that, a silent no-op would satisfy every check here.
  mockGetSchemaRegistryFromDI.mockReturnValue(null);
});

describe("registerComponentRuntimeSchema through the adapter resolver", () => {
  it("registers the companion alongside the main table for a localized group", async () => {
    const { registerComponentRuntimeSchema } = await import(
      "../field-group-table-provisioning"
    );
    const { adapter, registered } = adapterWithResolver();

    const result = registerComponentRuntimeSchema(
      adapter as Parameters<typeof registerComponentRuntimeSchema>[0],
      "postgresql",
      "comp_hero",
      LOCALIZED_FIELDS,
      "_component_type",
      true
    );

    expect(result.registered).toBe(true);
    // By IDENTITY rather than by count: a count of two is also what registering the main table
    // twice would produce, and the companion is the name this test exists for.
    expect(registered.map(r => r.name).sort()).toEqual([
      "comp_hero",
      "comp_hero_locales",
    ]);
  });

  // The negative control. A non-localized group has no companion, so exactly one registration is
  // correct — this is what keeps the fix from being "always register a second table".
  it("registers only the main table when the group is not localized", async () => {
    const { registerComponentRuntimeSchema } = await import(
      "../field-group-table-provisioning"
    );
    const { adapter, registered } = adapterWithResolver();

    const result = registerComponentRuntimeSchema(
      adapter as Parameters<typeof registerComponentRuntimeSchema>[0],
      "postgresql",
      "comp_hero",
      [{ name: "title", type: "text" }] as unknown as typeof LOCALIZED_FIELDS,
      "_component_type",
      false
    );

    expect(result.registered).toBe(true);
    expect(registered.map(r => r.name)).toEqual(["comp_hero"]);
  });

  // With neither sink available the answer must be a REFUSAL, not a claim: this is the state that
  // previously reported success while nothing had been registered anywhere.
  it("reports an unrefreshed runtime when no sink exists", async () => {
    const { registerComponentRuntimeSchema } = await import(
      "../field-group-table-provisioning"
    );

    const result = registerComponentRuntimeSchema(
      {} as Parameters<typeof registerComponentRuntimeSchema>[0],
      "postgresql",
      "comp_hero",
      LOCALIZED_FIELDS,
      "_component_type",
      true
    );

    expect(result.registered).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
