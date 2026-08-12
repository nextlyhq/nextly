/**
 * A snapshot walk still recognises a zone row written under the legacy spelling.
 *
 * 🔴 This property is invisible before the rename. While the catalog still says `_componentType`,
 * a reader that consults only the catalog and one that tries every spelling behave identically, so
 * a test written against today's catalog passes whether or not the walk is dual and certifies
 * nothing. The catalog is mocked to the post-rename state to separate them.
 *
 * What the single-spelling version does here is not a cosmetic loss. `tagZoneRows` returns the row
 * untouched when it cannot read a type, so the components nested inside it are never tagged; the
 * snapshot records no type for them, and a later restore prunes those values against whichever
 * component the field names at restore time. The row survives and its contents do not.
 *
 * A separate file because the flip is simulated by mocking the catalog module, and `vi.mock` is
 * hoisted per file.
 */
import { describe, expect, it, vi } from "vitest";

// The post-rename world: the catalog has moved on, stored documents have not.
vi.mock("../../../schemas/storage-format", async () => {
  const actual = await vi.importActual<
    typeof import("../../../schemas/storage-format")
  >("../../../schemas/storage-format");
  return {
    ...actual,
    STORAGE_FORMAT: {
      ...actual.STORAGE_FORMAT,
      wireTypeKey: "_fieldGroupType",
    },
  };
});

import { currentFieldGroupTypeKey } from "../../field-groups/storage/field-group-type-key";
import { tagComponentTypes } from "../tag-component-types";

import type { FieldConfig } from "../../../collections/fields/types";

const zoneField = {
  name: "zone",
  type: "component",
  components: ["hero"],
} as unknown as FieldConfig;

/** `hero` holds a single `cta`, so a correct walk reaches one level below the zone row. */
const heroFields = [
  { name: "cta", type: "component", component: "cta" },
] as unknown as FieldConfig[];

const resolve = (slug: string): FieldConfig[] | undefined =>
  slug === "hero" ? heroFields : undefined;

describe("tagging a snapshot after the catalog has been renamed", () => {
  it("the catalog really has moved, or this file proves nothing", () => {
    // Without this precondition a mock that failed to apply would leave every assertion below
    // running against the pre-rename world, where both implementations agree.
    expect(currentFieldGroupTypeKey).toBe("_fieldGroupType");
  });

  it("tags a component nested inside a LEGACY-spelled zone row", () => {
    const entry = {
      zone: [{ _componentType: "hero", cta: { label: "Buy" } }],
    };

    const tagged = tagComponentTypes(entry, [zoneField], resolve) as {
      zone: { cta: Record<string, unknown> }[];
    };

    // The separating assertion: a single-spelling reader cannot resolve this row's type, returns
    // it untouched, and leaves `cta` with no record of the component it came from.
    expect(tagged.zone[0].cta._fieldGroupType).toBe("cta");
  });

  it("still tags one nested inside a row using the new spelling", () => {
    const entry = {
      zone: [{ _fieldGroupType: "hero", cta: { label: "Buy" } }],
    };

    const tagged = tagComponentTypes(entry, [zoneField], resolve) as {
      zone: { cta: Record<string, unknown> }[];
    };

    expect(tagged.zone[0].cta._fieldGroupType).toBe("cta");
  });

  it("leaves the row's own legacy discriminator in place", () => {
    // The walk reads the row's type; it does not restamp it. Rewriting the spelling here would
    // migrate content as a side effect of taking a snapshot, which is the migration's job and
    // subject to its own resumability and verification.
    const entry = {
      zone: [{ _componentType: "hero", cta: { label: "Buy" } }],
    };

    const tagged = tagComponentTypes(entry, [zoneField], resolve) as {
      zone: Record<string, unknown>[];
    };

    expect(tagged.zone[0]._componentType).toBe("hero");
  });

  it("tags a single component with ONE spelling when it already carried the old one", () => {
    // The production path for the accessor's canonicalisation. A single-component value that was
    // captured before the rename, restored, and captured again arrives already carrying the old
    // key; spreading it and adding the current one leaves the snapshot announcing its type twice.
    //
    // A double-tagged value still reads — `readFieldGroupType` prefers the current spelling — so
    // nothing surfaces at capture. It matters because the set of legacy-spelled documents stops
    // shrinking as snapshots are taken, which is the invariant that lets the rename finish.
    const entry = { hero: { _componentType: "hero", title: "Old" } };

    const tagged = tagComponentTypes(
      entry,
      [{ name: "hero", type: "component", component: "hero" }] as FieldConfig[],
      () => undefined
    ) as { hero: Record<string, unknown> };

    expect(tagged.hero._fieldGroupType).toBe("hero");
    expect(tagged.hero._componentType).toBeUndefined();
    expect(tagged.hero.title).toBe("Old");
  });

  it("still leaves a row alone when its type names a component the field forbids", () => {
    // The dual read widens which spellings are understood, not which components are allowed.
    const entry = {
      zone: [{ _componentType: "banner", cta: { label: "Buy" } }],
    };

    const tagged = tagComponentTypes(entry, [zoneField], resolve) as {
      zone: { cta: Record<string, unknown> }[];
    };

    expect(tagged.zone[0].cta._fieldGroupType).toBeUndefined();
  });
});
