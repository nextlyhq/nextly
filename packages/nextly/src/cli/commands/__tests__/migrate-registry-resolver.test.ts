/**
 * `nextly migrate` can resolve the registry tables it is about to read.
 *
 * 🔴 The defect this guards shipped and was invisible. `adapter.select` maps a
 * table NAME through a resolver and refuses with "not found in schema registry"
 * when none is installed; a CLI run has no boot to install one. The metadata
 * reconciliation therefore threw on every registry, its per-registry guard
 * caught all three, and the command announced success having repaired nothing
 * — a no-op in exactly the production case the phase was written for.
 *
 * Asserted by OUTCOME rather than by watching for a `setTableResolver` call:
 * what matters is that `dynamic_collections` resolves afterwards, which is the
 * property the sweep depends on. A spy would also pass on a resolver that
 * registered the wrong dialect's tables, or none at all.
 */
import { describe, expect, it, vi } from "vitest";

import { installRegistryResolver } from "../migrate";

function adapterFor(dialect: "postgresql" | "mysql" | "sqlite") {
  const setTableResolver = vi.fn();
  return {
    adapter: {
      getCapabilities: () => ({ dialect }),
      setTableResolver,
    } as never,
    setTableResolver,
  };
}

describe("installRegistryResolver", () => {
  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "resolves the registry tables the sweep reads, on %s",
    dialect => {
      const { adapter } = adapterFor(dialect);

      const registry = installRegistryResolver(adapter);

      // The three the reconciliation sweeps. A resolver that answered for none
      // of them is what the shipped defect looked like from the sweep's side.
      for (const table of [
        "dynamic_collections",
        "dynamic_singles",
        "dynamic_components",
      ]) {
        expect(
          registry.getTable(table),
          `${table} does not resolve`
        ).toBeTruthy();
      }
    }
  );

  it("installs the resolver on the adapter", () => {
    // The other half: a registry built and never handed over resolves
    // perfectly in the test and not at all in the command.
    const { adapter, setTableResolver } = adapterFor("sqlite");

    const registry = installRegistryResolver(adapter);

    expect(setTableResolver).toHaveBeenCalledWith(registry);
  });

  /*
   * The field-group registry under BOTH spellings. A database whose storage
   * migration has run answers to one name and a database that predates it to
   * the other, and this command is the one that runs while that name changes.
   */
  it("resolves both spellings of the field-group registry", () => {
    const { adapter } = adapterFor("postgresql");

    const registry = installRegistryResolver(adapter);

    expect(registry.getTable("dynamic_components")).toBeTruthy();
    expect(registry.getTable("dynamic_field_groups")).toBeTruthy();
  });
});
