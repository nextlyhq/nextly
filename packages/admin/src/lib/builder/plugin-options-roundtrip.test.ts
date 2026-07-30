import { describe, expect, it } from "vitest";

import {
  convertToBuilderField,
  convertToFieldDefinition,
} from "./field-transformers";
import { mapBuilderFieldToManifest } from "./to-manifest-entity";

import type { BuilderFieldInput } from "./to-manifest-entity";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

/**
 * A plugin-contributed field type names its own options, so the builder cannot
 * model them. Every save rebuilds all fields through these serializers and
 * replaces the whole entity, so an option they drop is erased from storage by
 * an edit somewhere else in the schema — and a type whose own checks require
 * that option would then refuse every save.
 */
const STORED = {
  name: "rating",
  type: "star-rating",
  label: "Rating",
  ratingScale: { max: 5, allowHalf: true },
} as unknown as Parameters<typeof convertToBuilderField>[0];

describe("plugin field options round-trip through the builder", () => {
  it("loads an option the builder does not model", () => {
    const loaded = convertToBuilderField(STORED, 0);
    expect(loaded.pluginOptions).toEqual({
      ratingScale: { max: 5, allowHalf: true },
    });
  });

  it("writes the option back as a field definition", () => {
    const loaded = convertToBuilderField(STORED, 0);
    const definition = convertToFieldDefinition(loaded) as unknown as Record<
      string,
      unknown
    >;
    expect(definition.ratingScale).toEqual({ max: 5, allowHalf: true });
  });

  it("writes the option back into the manifest field", () => {
    const loaded = convertToBuilderField(STORED, 0);
    const manifest = mapBuilderFieldToManifest(
      loaded as unknown as BuilderFieldInput
    ) as unknown as Record<string, unknown>;
    expect(manifest.ratingScale).toEqual({ max: 5, allowHalf: true });
  });

  it("survives a field nested in a container", () => {
    const stored = {
      name: "reviews",
      type: "repeater",
      fields: [STORED],
    } as unknown as Parameters<typeof convertToBuilderField>[0];
    const manifest = mapBuilderFieldToManifest(
      convertToBuilderField(stored, 0) as unknown as BuilderFieldInput
    );
    const nested = manifest.fields?.[0] as unknown as Record<string, unknown>;
    expect(nested.ratingScale).toEqual({ max: 5, allowHalf: true });
  });

  it("carries an option named after an Object.prototype member", () => {
    const stored = {
      name: "rating",
      type: "star-rating",
      constructor: { shape: "star" },
    } as unknown as Parameters<typeof convertToBuilderField>[0];
    const loaded = convertToBuilderField(stored, 0);
    expect(loaded.pluginOptions).toEqual({ constructor: { shape: "star" } });
  });

  it("leaves the bag off a field that declares nothing extra", () => {
    const plain = {
      name: "title",
      type: "text",
    } as unknown as Parameters<typeof convertToBuilderField>[0];
    expect(convertToBuilderField(plain, 0).pluginOptions).toBeUndefined();
  });

  it("cannot displace a property the builder produced", () => {
    // `label` is modelled, so a carried entry of the same name must lose. The
    // bag is only ever populated from unmodelled keys; this pins the guard that
    // keeps a hand-built or stale bag from rewriting builder output.
    const field = {
      id: "f1",
      name: "rating",
      type: "star-rating",
      label: "Rating",
      pluginOptions: { label: "hijacked" },
    } as unknown as BuilderField;
    expect(convertToFieldDefinition(field).label).toBe("Rating");
    expect(
      mapBuilderFieldToManifest(field as unknown as BuilderFieldInput).label
    ).toBe("Rating");
  });
});
