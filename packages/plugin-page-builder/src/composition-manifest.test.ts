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
  TEMPLATE_ACTION_KINDS,
} from "@nextlyhq/builder/ops";
import { describe, expect, it } from "vitest";

import {
  componentFacts,
  compositionManifestSchema,
  manifestActions,
  manifestNamedQuery,
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
      templates: "templates",
    },
    patterns: tier,
    components: { ...tier, items: [component] },
    layouts: { ...tier, defaultLayout: null },
    actions: manifestActions(),
    namedQueries: [],
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

  it("requires the templates collection, where template ids live", () => {
    const manifest = manifestWith(card);
    const { templates: _templates, ...withoutTemplates } =
      manifest.collections as Record<string, unknown>;
    expect(
      compositionManifestSchema.safeParse({
        ...manifest,
        collections: withoutTemplates,
      }).success
    ).toBe(false);
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

describe("the manifest's named queries", () => {
  const query = {
    name: "events.upcoming",
    label: "Upcoming events",
    params: { type: "object", properties: {} },
    rows: { key: "id", fields: [{ name: "id", type: "text" }] },
    total: false,
  };
  const card = { id: "c", title: "Card", fields: [], slots: [], variants: [] };

  it("accepts a query listed by its declaration", () => {
    expect(
      compositionManifestSchema.safeParse({
        ...manifestWith(card),
        namedQueries: [
          query,
          { ...query, name: "b", rows: { collection: "posts" } },
        ],
      }).success
    ).toBe(true);
  });

  it("lists a group's own row fields, however deep, and accepts them", () => {
    const listed = manifestNamedQuery({
      name: "pages.seo",
      label: "Pages with SEO",
      reads: { collections: ["pages"] },
      rows: {
        key: "id",
        fields: [
          { name: "id", type: "text" },
          {
            name: "seo",
            type: "group",
            fields: [
              {
                name: "image",
                type: "group",
                fields: [{ name: "alt", type: "text" }],
              },
            ],
          },
        ],
      },
    });
    expect(listed.rows).toEqual({
      key: "id",
      fields: [
        { name: "id", type: "text" },
        {
          name: "seo",
          type: "group",
          fields: [
            {
              name: "image",
              type: "group",
              fields: [{ name: "alt", type: "text" }],
            },
          ],
        },
      ],
    });
    expect(
      compositionManifestSchema.safeParse({
        ...manifestWith(card),
        namedQueries: [listed],
      }).success
    ).toBe(true);
    // A nested field is held to the same shape as a top-level one.
    expect(
      compositionManifestSchema.safeParse({
        ...manifestWith(card),
        namedQueries: [
          {
            ...query,
            rows: {
              key: "id",
              fields: [{ name: "seo", type: "group", fields: [{ name: "" }] }],
            },
          },
        ],
      }).success
    ).toBe(false);
  });

  it("refuses a query carrying anything but its declaration, such as its run function", () => {
    expect(
      compositionManifestSchema.safeParse({
        ...manifestWith(card),
        namedQueries: [{ ...query, run: "() => {}" }],
      }).success
    ).toBe(false);
  });
});

describe("the manifest's actions", () => {
  it("lists every kind each action takes, with a request schema naming its fields", () => {
    const [page, definition, template] = manifestActions();
    expect(page?.kinds).toEqual(PAGE_ACTION_KINDS);
    expect(definition?.kinds).toEqual(DEFINITION_ACTION_KINDS);
    expect(template?.kinds).toEqual(TEMPLATE_ACTION_KINDS);
    expect(template?.path).toBe("/templates/actions");
    const templateRequest = template?.request as {
      properties: Record<string, { oneOf?: unknown[] }>;
      required: string[];
    };
    expect(templateRequest.required).toEqual(["action"]);
    expect(templateRequest.properties.action?.oneOf).toHaveLength(
      TEMPLATE_ACTION_KINDS.length
    );

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
