/**
 * The composition actions as data: the schemas a route parses with, and the
 * definition planner each edit runs.
 *
 * The schemas are the API's boundary, so what is pinned is what they refuse
 * and how they normalise a target. The planner is pinned against the engine's
 * own planners, called directly: an edit routed to the wrong planner, or
 * handed the wrong sources, answers differently from the planner it names.
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  planDeleteVariant,
  planExposeProperty,
  planRemoveExposedSlot,
  planRemoveExposure,
  planRenameExposure,
  planRenameVariant,
  planResetVariantValue,
  planRetargetExposure,
  planSetVariantValue,
  registerBlocks,
  registryBlockSource,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFINITION_ACTION_KINDS,
  definitionActionJsonSchema,
  definitionActionSchema,
  PAGE_ACTION_KINDS,
  pageActionJsonSchema,
  pageActionSchema,
  planDefinitionAction,
  type DefinitionAction,
} from "./composition-actions";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/card",
        props: {
          title: { type: "text", role: "content" },
          blurb: { type: "textarea", role: "content" },
        },
      },
      { ...base, name: "acme/box", slots: { children: {} } },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

/** A card with one exposed field, one slot and one variant. */
function card(): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "c",
        type: "acme/card",
        version: 1,
        props: { title: "Title", blurb: "Blurb" },
      },
      {
        id: "b",
        type: "acme/box",
        version: 1,
        props: {},
        slots: { children: [] },
      },
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "c",
        propPath: "title",
        type: "text",
      },
    ],
    slots: { body: { label: "Body", nodeId: "b", slot: "children" } },
    variants: { dark: { label: "Dark", overrides: { title: "Dark title" } } },
  };
}

describe("the page action schema", () => {
  it("takes each kind it lists, and nothing else", () => {
    const accepted = [
      { kind: "insert-pattern", patternId: "p", at: { index: 0 } },
      { kind: "place-component", componentId: "c", variant: "dark" },
      { kind: "set-placement-values", instanceId: "i", reset: ["title"] },
      { kind: "choose-variant", instanceId: "i", variant: null },
      { kind: "set-list-query", listId: "l", query: { limit: null } },
      {
        kind: "set-conditions",
        nodeId: "n",
        conditions: [[{ field: "title", op: "exists" }]],
      },
      { kind: "set-layout", layout: null },
    ];
    expect(accepted.map(action => action.kind)).toEqual(PAGE_ACTION_KINDS);
    for (const action of accepted) {
      expect(pageActionSchema.safeParse(action).success).toBe(true);
    }

    expect(
      pageActionSchema.safeParse({ kind: "delete-page", id: "p" }).success
    ).toBe(false);
    // Strict: a field no action takes is refused, not dropped in silence.
    expect(
      pageActionSchema.safeParse({
        kind: "choose-variant",
        instanceId: "i",
        variant: "dark",
        publish: true,
      }).success
    ).toBe(false);
    // An empty id names nothing.
    expect(
      pageActionSchema.safeParse({ kind: "insert-pattern", patternId: "" })
        .success
    ).toBe(false);
  });
});

describe("the definition action schema", () => {
  it("takes each kind it lists", () => {
    const accepted = [
      { kind: "expose", label: "Blurb", nodeId: "c", propPath: "blurb" },
      { kind: "rename-exposure", exposureId: "title", label: "Heading" },
      {
        kind: "retarget-exposure",
        exposureId: "title",
        nodeId: "c",
        visibility: true,
      },
      { kind: "remove-exposure", exposureId: "title" },
      { kind: "remove-exposed-slot", slotId: "body" },
      { kind: "add-variant", label: "Light" },
      { kind: "rename-variant", variantId: "dark", label: "Night" },
      { kind: "delete-variant", variantId: "dark" },
      {
        kind: "set-variant-value",
        variantId: "dark",
        exposureId: "title",
        value: "x",
      },
      { kind: "reset-variant-value", variantId: "dark", exposureId: "title" },
    ];
    expect(accepted.map(action => action.kind)).toEqual(
      DEFINITION_ACTION_KINDS
    );
    for (const action of accepted) {
      expect(definitionActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("refuses a target naming both a prop and the visibility switch, or neither, in words", () => {
    for (const target of [{ propPath: "blurb", visibility: true }, {}]) {
      const parsed = definitionActionSchema.safeParse({
        kind: "expose",
        label: "Blurb",
        nodeId: "c",
        ...target,
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(/`propPath`.*not both/);
    }
  });

  it("answers a target as exactly the one it names", () => {
    expect(
      definitionActionSchema.parse({
        kind: "retarget-exposure",
        exposureId: "title",
        nodeId: "c",
        visibility: true,
      })
    ).toEqual({
      kind: "retarget-exposure",
      exposureId: "title",
      nodeId: "c",
      visibility: true,
    });
    expect(
      definitionActionSchema.parse({
        kind: "expose",
        label: "Blurb",
        nodeId: "c",
        propPath: "blurb",
      })
    ).toEqual({
      kind: "expose",
      label: "Blurb",
      nodeId: "c",
      propPath: "blurb",
    });
  });

  it("requires exactly one target in its JSON Schema form, as the parse does", () => {
    const options = definitionActionJsonSchema().oneOf as {
      properties: { kind: { const: string } };
      oneOf?: unknown;
    }[];
    const exactlyOne = [
      { required: ["propPath"], not: { required: ["visibility"] } },
      { required: ["visibility"], not: { required: ["propPath"] } },
    ];
    for (const option of options) {
      const kind = option.properties.kind.const;
      if (kind === "expose" || kind === "retarget-exposure") {
        expect(option.oneOf, kind).toEqual(exactlyOne);
      } else {
        expect(option.oneOf, kind).toBeUndefined();
      }
    }
  });

  it("has a JSON Schema form listing every kind", () => {
    // The manifest carries this form; a schema the converter cannot express
    // would fail there, at a request, rather than here.
    const kinds = (schema: Record<string, unknown>) =>
      (schema.oneOf as { properties: { kind: { const: string } } }[]).map(
        option => option.properties.kind.const
      );
    expect(kinds(definitionActionJsonSchema())).toEqual(
      DEFINITION_ACTION_KINDS
    );
    expect(kinds(pageActionJsonSchema())).toEqual(PAGE_ACTION_KINDS);
  });
});

describe("planDefinitionAction", () => {
  const sources = () => ({ definitions: registryBlockSource() });

  it("runs the engine's own planner for each edit", () => {
    const definitions = registryBlockSource();
    const cases: [DefinitionAction, unknown][] = [
      [
        { kind: "expose", label: "Blurb", nodeId: "c", propPath: "blurb" },
        planExposeProperty(
          card(),
          { nodeId: "c", propPath: "blurb", label: "Blurb" },
          { definitions }
        ),
      ],
      [
        { kind: "rename-exposure", exposureId: "title", label: "Heading" },
        planRenameExposure(card(), "title", "Heading", undefined),
      ],
      [
        {
          kind: "retarget-exposure",
          exposureId: "title",
          nodeId: "c",
          propPath: "blurb",
        },
        planRetargetExposure(
          card(),
          "title",
          { nodeId: "c", propPath: "blurb" },
          { definitions }
        ),
      ],
      [
        { kind: "remove-exposure", exposureId: "title" },
        planRemoveExposure(card(), "title", undefined),
      ],
      [
        { kind: "remove-exposed-slot", slotId: "body" },
        planRemoveExposedSlot(card(), "body", undefined),
      ],
      [
        { kind: "rename-variant", variantId: "dark", label: "Night" },
        planRenameVariant(card(), "dark", "Night", undefined),
      ],
      [
        { kind: "delete-variant", variantId: "dark" },
        planDeleteVariant(card(), "dark", undefined),
      ],
      [
        {
          kind: "set-variant-value",
          variantId: "dark",
          exposureId: "title",
          value: "Night title",
        },
        planSetVariantValue(card(), "dark", "title", "Night title", undefined),
      ],
      [
        { kind: "reset-variant-value", variantId: "dark", exposureId: "title" },
        planResetVariantValue(card(), "dark", "title", undefined),
      ],
    ];
    for (const [action, expected] of cases) {
      const planned = planDefinitionAction(card(), action, sources());
      expect(planned, action.kind).toEqual(expected);
      expect("problem" in planned, action.kind).toBe(false);
    }
  });

  it("adds a variant under a new stable id, keeping the others", () => {
    const planned = planDefinitionAction(
      card(),
      { kind: "add-variant", label: "Light" },
      sources()
    );
    if ("problem" in planned) throw new Error(planned.problem);
    expect(planned.id).not.toBe("dark");
    expect(planned.document.variants).toMatchObject({
      dark: { label: "Dark" },
      [planned.id]: { label: "Light", overrides: {} },
    });
  });

  it("never hands out a retired id to a new field", () => {
    const planned = planDefinitionAction(
      card(),
      { kind: "expose", label: "Blurb", nodeId: "c", propPath: "blurb" },
      { ...sources(), retired: { properties: ["blurb"], slots: [] } }
    );
    if ("problem" in planned) throw new Error(planned.problem);
    expect(planned.id).not.toBe("blurb");
    const unretired = planDefinitionAction(
      card(),
      { kind: "expose", label: "Blurb", nodeId: "c", propPath: "blurb" },
      sources()
    );
    if ("problem" in unretired) throw new Error(unretired.problem);
    expect(unretired.id).toBe("blurb");
  });

  it("answers a planner's refusal rather than throwing", () => {
    expect(
      planDefinitionAction(
        card(),
        { kind: "rename-variant", variantId: "missing", label: "Night" },
        sources()
      )
    ).toMatchObject({ problem: "unknown-variant" });
  });
});
