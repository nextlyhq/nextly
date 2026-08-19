/**
 * `schemaDraftsEnabled` resolves the admin's `draftsEnabled` flag from the same
 * eligibility predicate the write path gates on. When a drafts-configured
 * collection embeds components, it must resolve their schemas from the registry,
 * and a lookup failure there is PROPAGATED rather than swallowed into `false`:
 * false is the destructive answer (the admin would send an explicit published
 * save that overwrites the live row instead of storing a working draft), so an
 * unknown verdict has to fail closed and be retried. These pin that contract and
 * the cheap-path short-circuits that avoid touching the registry at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getComponentBySlugSpy } = vi.hoisted(() => ({
  getComponentBySlugSpy: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    if (name === "fieldGroupRegistryService") {
      return { getComponentBySlug: getComponentBySlugSpy };
    }
    return {};
  }),
}));

import type { FieldConfig } from "../../../collections/fields/types";
import { schemaDraftsEnabled } from "../draft-split-eligibility";

const draftsCollection = (fields: FieldConfig[]) => ({
  status: true,
  versions: { drafts: { enabled: true } },
  localized: false,
  fields,
});

const componentFields = [
  { name: "hero", type: "fieldGroup", component: "hero" },
] as unknown as FieldConfig[];

const plainFields = [
  { name: "title", type: "text" },
] as unknown as FieldConfig[];

describe("schemaDraftsEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates a component lookup failure instead of defaulting to false", async () => {
    getComponentBySlugSpy.mockRejectedValue(new Error("registry unavailable"));

    await expect(
      schemaDraftsEnabled(draftsCollection(componentFields))
    ).rejects.toThrow();
  });

  it("is true for a drafts collection whose component resolves clean and non-localized", async () => {
    getComponentBySlugSpy.mockResolvedValue({
      fields: [{ name: "heading", type: "text" }],
      localized: false,
    });

    await expect(
      schemaDraftsEnabled(draftsCollection(componentFields))
    ).resolves.toBe(true);
  });

  it("is true for a localized component", async () => {
    getComponentBySlugSpy.mockResolvedValue({
      fields: [{ name: "heading", type: "text" }],
      localized: true,
    });

    // A localized component is representable: a snapshot holds one locale's
    // values and the draft is keyed by that locale.
    await expect(
      schemaDraftsEnabled(draftsCollection(componentFields))
    ).resolves.toBe(true);
  });

  it("never touches the registry when the collection has no components", async () => {
    await expect(
      schemaDraftsEnabled(draftsCollection(plainFields))
    ).resolves.toBe(true);
    expect(getComponentBySlugSpy).not.toHaveBeenCalled();
  });

  it("never touches the registry when the drafts lifecycle is off", async () => {
    await expect(
      schemaDraftsEnabled({
        status: true,
        versions: null,
        localized: false,
        fields: componentFields,
      })
    ).resolves.toBe(false);
    expect(getComponentBySlugSpy).not.toHaveBeenCalled();
  });
});
