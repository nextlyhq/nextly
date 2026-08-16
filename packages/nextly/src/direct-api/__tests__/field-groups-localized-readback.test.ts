/**
 * `localized` survives the round trip out of the Direct API.
 *
 * The write half already worked — `fieldGroups.update()` forwards the flag — so a caller could
 * change the setting and then had no way to observe it. Three layers dropped it independently: the
 * public `FieldGroupDefinition`, the mapper's input shape, and the mapper itself.
 *
 * Asserted on what the NAMESPACE returns rather than on the mapper in isolation. The mapper is the
 * only place the field could be added and still not reach a caller, and a unit test of the mapper
 * cannot see that: it would go green while the namespace returned something else, or while the
 * public type still refused to carry the property.
 */
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../../shared/types";
import { createFieldGroupsNamespace } from "../namespaces/field-groups";

/**
 * A registry holding one field group at the requested localization state.
 *
 * The `true` fixture is the load-bearing one. A non-localized group maps to `false` whether the
 * mapper reads the record or invents the default, so it cannot separate a mapper that carries the
 * field from one that drops it — the two answers coincide.
 */
function ctxWith(localized: boolean) {
  const record = {
    id: "comp-1",
    slug: "hero",
    label: "Hero",
    tableName: "comp_hero",
    fields: [{ name: "heading", type: "text" }],
    admin: undefined,
    source: "ui",
    locked: false,
    schemaHash: "hash",
    schemaVersion: 3,
    migrationStatus: "applied",
    localized,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    fieldGroupRegistryService: {
      getComponentBySlug: vi.fn().mockResolvedValue(record),
      getComponent: vi.fn().mockResolvedValue(record),
      listComponents: vi.fn().mockResolvedValue({ data: [record], total: 1 }),
      getAllComponents: vi.fn().mockResolvedValue([record]),
    },
    logger,
  };
}

function namespaceOver(localized: boolean) {
  return createFieldGroupsNamespace(
    ctxWith(localized) as unknown as Parameters<
      typeof createFieldGroupsNamespace
    >[0]
  );
}

describe("the Direct API reports whether a field group is localized", () => {
  it("carries it on a single read", async () => {
    const definition = await namespaceOver(true).findBySlug({ slug: "hero" });

    expect(definition?.localized).toBe(true);
  });

  it("carries it on a list read", async () => {
    // The two reads map through the same function, and that is the point of covering both: a change
    // that stopped one of them calling the mapper would leave the other's assertion green.
    const { items } = await namespaceOver(true).find();

    expect(items[0]?.localized).toBe(true);
  });

  it("reports false for a field group that is not localized", async () => {
    // The negative control. Without it a mapper hard-coding `true` would satisfy both cases above.
    const definition = await namespaceOver(false).findBySlug({ slug: "hero" });

    expect(definition?.localized).toBe(false);
  });
});
