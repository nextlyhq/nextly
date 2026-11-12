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
 *
 * Options are written into the `pluginOptions` container. Directly on the field
 * a name is safe only while it differs from every key the field schema
 * declares, and a field stored that way still loads, so nothing breaks until it
 * is saved and moved.
 */
const STORED_LEGACY = {
  name: "rating",
  type: "star-rating",
  label: "Rating",
  ratingScale: { max: 5, allowHalf: true },
} as unknown as Parameters<typeof convertToBuilderField>[0];

const STORED_CONTAINED = {
  name: "rating",
  type: "star-rating",
  label: "Rating",
  pluginOptions: { ratingScale: { max: 5, allowHalf: true } },
} as unknown as Parameters<typeof convertToBuilderField>[0];

const SCALE = { max: 5, allowHalf: true };

describe("plugin field options round-trip through the builder", () => {
  it("loads an option held in the container", () => {
    expect(convertToBuilderField(STORED_CONTAINED, 0).pluginOptions).toEqual({
      ratingScale: SCALE,
    });
  });

  it("still loads an option stored directly on the field", () => {
    expect(convertToBuilderField(STORED_LEGACY, 0).pluginOptions).toEqual({
      ratingScale: SCALE,
    });
  });

  it("lets the container win over a same-named key on the field", () => {
    const conflicting = {
      name: "rating",
      type: "star-rating",
      ratingScale: { max: 1 },
      pluginOptions: { ratingScale: SCALE },
    } as unknown as Parameters<typeof convertToBuilderField>[0];

    expect(convertToBuilderField(conflicting, 0).pluginOptions).toEqual({
      ratingScale: SCALE,
    });
  });

  it("writes the option back as a field definition, in the container", () => {
    const loaded = convertToBuilderField(STORED_LEGACY, 0);
    const definition = convertToFieldDefinition(loaded) as unknown as Record<
      string,
      unknown
    >;

    expect(definition.pluginOptions).toEqual({ ratingScale: SCALE });
  });

  it("writes the option back into the manifest field's container", () => {
    const loaded = convertToBuilderField(STORED_LEGACY, 0);
    const manifest = mapBuilderFieldToManifest(
      loaded as unknown as BuilderFieldInput
    ) as unknown as Record<string, unknown>;

    expect(manifest.pluginOptions).toEqual({ ratingScale: SCALE });
  });

  it("survives a field nested in a container type", () => {
    const stored = {
      name: "reviews",
      type: "repeater",
      fields: [STORED_LEGACY],
    } as unknown as Parameters<typeof convertToBuilderField>[0];

    const manifest = mapBuilderFieldToManifest(
      convertToBuilderField(stored, 0) as unknown as BuilderFieldInput
    );
    const nested = manifest.fields?.[0] as unknown as Record<string, unknown>;

    expect(nested.pluginOptions).toEqual({ ratingScale: SCALE });
  });

  it("carries an option named after an Object.prototype member", () => {
    const stored = {
      name: "rating",
      type: "star-rating",
      constructor: { shape: "star" },
    } as unknown as Parameters<typeof convertToBuilderField>[0];

    expect(convertToBuilderField(stored, 0).pluginOptions).toEqual({
      constructor: { shape: "star" },
    });
  });

  it("carries an option named after a key the field schema declares", () => {
    // The reason the container exists: directly on the field this would be
    // read as a select's choice array and refused.
    const stored = {
      name: "rating",
      type: "star-rating",
      pluginOptions: { options: { presets: ["a", "b"] } },
    } as unknown as Parameters<typeof convertToBuilderField>[0];

    const manifest = mapBuilderFieldToManifest(
      convertToBuilderField(stored, 0) as unknown as BuilderFieldInput
    ) as unknown as Record<string, unknown>;

    expect(manifest.pluginOptions).toEqual({
      options: { presets: ["a", "b"] },
    });
  });

  it("carries a container option named after a prototype accessor", () => {
    // A manifest deserialized from JSON can hold this as an own key. Assigning
    // it while collecting would set the bag's prototype instead, and the option
    // would disappear on the next save from the container that promises any
    // name is legal.
    const stored = JSON.parse(
      '{"name":"rating","type":"star-rating","pluginOptions":{"__proto__":{"tainted":true}}}'
    ) as Parameters<typeof convertToBuilderField>[0];

    const carried = convertToBuilderField(stored, 0).pluginOptions ?? {};

    expect(Object.prototype.hasOwnProperty.call(carried, "__proto__")).toBe(
      true
    );
    expect(Object.getPrototypeOf(carried)).toBe(Object.prototype);
  });

  it("ignores a container that is not a plain object", () => {
    // Core reads only plain objects, so the builder has to agree or a field
    // round-trips differently through each.
    const stored = {
      name: "rating",
      type: "star-rating",
      pluginOptions: ["ratingScale"],
    } as unknown as Parameters<typeof convertToBuilderField>[0];

    expect(convertToBuilderField(stored, 0).pluginOptions).toBeUndefined();
  });

  it("leaves the bag off a field that declares nothing extra", () => {
    const plain = {
      name: "title",
      type: "text",
    } as unknown as Parameters<typeof convertToBuilderField>[0];

    expect(convertToBuilderField(plain, 0).pluginOptions).toBeUndefined();
  });

  it("does not emit an empty container for an ordinary field", () => {
    const plain = {
      id: "f1",
      name: "title",
      type: "text",
      label: "Title",
    } as unknown as BuilderField;

    expect(
      mapBuilderFieldToManifest(plain as unknown as BuilderFieldInput)
    ).not.toHaveProperty("pluginOptions");
  });
});

/**
 * The server hands a field-group field out with the fields of the field groups
 * it names resolved onto it (`componentFields`, `componentSchemas`). They are
 * not part of the field's definition, so a save never writes them back: a copy
 * of another definition frozen into this one would go stale the moment that
 * field group changed.
 */
describe("a field group's resolved fields", () => {
  const RESOLVED = {
    componentFields: [{ name: "meta_title", type: "text" }],
    componentSchemas: { seo: { label: "SEO", fields: [] } },
  };

  it("are not written back by a save", () => {
    const loaded = convertToBuilderField(
      {
        name: "seo",
        type: "component",
        label: "SEO",
        component: "seo",
        ...RESOLVED,
      } as unknown as Parameters<typeof convertToBuilderField>[0],
      0
    );
    const saved = convertToFieldDefinition(loaded);
    expect(saved).not.toHaveProperty("componentFields");
    expect(saved).not.toHaveProperty("componentSchemas");
    expect(saved).not.toHaveProperty("pluginOptions");
    expect(saved).toMatchObject({ type: "component", component: "seo" });
  });

  it("leave another type's own option of the same name alone", () => {
    // Only a field-group field is resolved by the server. A plugin type may
    // name an option of its own `componentFields`, and must keep it.
    const own = { componentFields: ["heading", "image"] };
    const loaded = convertToBuilderField(
      {
        name: "gallery",
        type: "star-rating",
        label: "Gallery",
        pluginOptions: own,
      } as unknown as Parameters<typeof convertToBuilderField>[0],
      0
    );
    expect(
      (convertToFieldDefinition(loaded) as { pluginOptions?: unknown })
        .pluginOptions
    ).toEqual(own);
  });

  it("are dropped from a definition that was saved holding them", () => {
    const loaded = convertToBuilderField(
      {
        name: "seo",
        type: "component",
        label: "SEO",
        component: "seo",
        pluginOptions: { ratingScale: SCALE, ...RESOLVED },
      } as unknown as Parameters<typeof convertToBuilderField>[0],
      0
    );
    expect(
      (convertToFieldDefinition(loaded) as { pluginOptions?: unknown })
        .pluginOptions
    ).toEqual({ ratingScale: SCALE });
  });
});
