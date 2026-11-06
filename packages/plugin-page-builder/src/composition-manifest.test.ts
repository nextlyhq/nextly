/**
 * The manifest's shape: what a component offers a placement, read off its
 * definition, the schema a client validates the manifest with, and the
 * request schemas its actions list.
 *
 * The integration suite reads the manifest from a real instance. These pin
 * what it is made of where a broken reading would still produce a plausible
 * manifest: a variant listed under its label rather than its id, a component
 * with no variants left without the list, a request schema missing the field
 * an action needs.
 */
import {
  DEFINITION_ACTION_KINDS,
  PAGE_ACTION_KINDS,
} from "@nextlyhq/builder/ops";
import { describe, expect, it } from "vitest";

import {
  componentFacts,
  compositionManifestSchema,
  manifestActions,
  MANIFEST_FORMAT_VERSION,
  type CompositionManifest,
} from "./composition-manifest";

/** A manifest holding one component, as a reader would receive it. */
function manifestWith(
  component: Record<string, unknown>
): Record<string, unknown> {
  const tier = { readable: true, items: [], truncated: false };
  return {
    formatVersion: MANIFEST_FORMAT_VERSION,
    collections: {
      pages: "pages",
      patterns: "patterns",
      components: "components",
      componentField: "content",
      layouts: "layouts",
    },
    patterns: tier,
    components: { ...tier, items: [component] },
    layouts: { ...tier, defaultLayout: null },
    actions: manifestActions(),
  } satisfies Record<keyof CompositionManifest, unknown>;
}

describe("componentFacts", () => {
  it("lists each field, slot and variant by the id the actions take", () => {
    expect(
      componentFacts({
        formatVersion: 1,
        kind: "component",
        nodes: [],
        exposed: [
          {
            id: "tone",
            label: "Tone",
            nodeId: "n",
            propPath: "tone",
            type: "select",
            options: [{ value: "dark", label: "Dark" }],
          },
        ],
        slots: { body: { label: "Body", nodeId: "n", slot: "children" } },
        variants: {
          "v-1": { label: "Night", overrides: {} },
          // Stored without a label: offered by its id, as the picker does.
          "v-2": { label: "", overrides: {} },
        },
      })
    ).toEqual({
      fields: [
        {
          id: "tone",
          label: "Tone",
          type: "select",
          options: [{ value: "dark", label: "Dark" }],
        },
      ],
      slots: [{ id: "body", label: "Body" }],
      variants: [
        { id: "v-1", label: "Night" },
        { id: "v-2", label: "v-2" },
      ],
    });
  });

  it("offers nothing for a row holding no definition", () => {
    expect(componentFacts(null)).toEqual({
      fields: [],
      slots: [],
      variants: [],
    });
  });
});

describe("the manifest schema", () => {
  const card = {
    id: "card",
    title: "Card",
    fields: [],
    slots: [],
    variants: [{ id: "v-1", label: "Night" }],
  };

  it("accepts a manifest whose components list their variants", () => {
    expect(
      compositionManifestSchema.safeParse(manifestWith(card)).success
    ).toBe(true);
  });

  it("requires each component's variants, even when it has none", () => {
    const { variants: _variants, ...withoutVariants } = card;
    expect(
      compositionManifestSchema.safeParse(manifestWith(withoutVariants)).success
    ).toBe(false);
    // A variant must carry the id a placement stores, not only its name.
    expect(
      compositionManifestSchema.safeParse(
        manifestWith({ ...card, variants: [{ label: "Night" }] })
      ).success
    ).toBe(false);
  });
});

describe("the manifest's actions", () => {
  it("lists every kind each action takes, with a request schema naming its fields", () => {
    const [page, definition] = manifestActions();
    expect(page?.kinds).toEqual(PAGE_ACTION_KINDS);
    expect(definition?.kinds).toEqual(DEFINITION_ACTION_KINDS);

    const pageRequest = page?.request as {
      properties: Record<string, { oneOf?: unknown[] }>;
      required: string[];
    };
    expect(pageRequest.required.sort()).toEqual(["action", "page"]);
    // The route's own envelope, bounds and all: a page id the route refuses
    // is one the advertised schema refuses too.
    expect(
      (
        pageRequest.properties.page as {
          properties?: Record<string, { maxLength?: number }>;
        }
      ).properties?.collection?.maxLength
    ).toBe(512);
    expect(Object.keys(pageRequest.properties).sort()).toEqual([
      "action",
      "dryRun",
      "expect",
      "page",
      "publish",
    ]);
    // `action` is the builder's own schema, not the envelope's placeholder.
    expect(pageRequest.properties.action?.oneOf).toHaveLength(
      PAGE_ACTION_KINDS.length
    );

    const definitionRequest = definition?.request as {
      properties: Record<string, { oneOf?: unknown[] }>;
      required: string[];
    };
    expect(definitionRequest.required).toEqual(["action"]);
    expect(definitionRequest.properties.action?.oneOf).toHaveLength(
      DEFINITION_ACTION_KINDS.length
    );
  });
});
