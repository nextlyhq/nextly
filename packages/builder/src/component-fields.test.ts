/**
 * The component's own view: what each prop row offers, the op an exposure edit
 * becomes, and the sentences the removal dialog reads.
 *
 * The properties a plausible implementation gets wrong: a field re-minted
 * under an id the live definition still uses (so placements' old values land
 * on it), an envelope op that leaves a removed field behind or writes one that
 * did not change, and a removal sentence that hides the variants it prunes.
 */
import {
  applyOp,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  registryBlockSource,
  type ComponentDocument,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyFieldEdit,
  envelopeOpFor,
  exposedFields,
  exposeOffer,
  exposeProp,
  exposeVisibility,
  idsIn,
  planFieldRemoval,
  propExposure,
  reachPhrase,
  removalSentences,
  renameField,
  reservedIds,
  visibilityExposure,
  type FieldEditContext,
} from "./component-fields";
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/card",
        version: 1,
        description: "A card.",
        example: { props: {} },
        render: () => null,
        props: {
          title: { type: "text", role: "content" },
          tone: { type: "select", options: ["light", "dark"] },
          count: { type: "number" },
        },
      },
      {
        name: "acme/sealed",
        version: 1,
        description: "A sealed area.",
        example: { props: {} },
        render: () => null,
        slots: {
          body: { defaultBlock: [{ type: "acme/card" }], lock: "contentOnly" },
        },
      },
    ] as never,
    { source: "component-fields-test" }
  );
});

afterEach(() => {
  clearBlocks();
});

function component(
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      { id: "c1", type: "acme/card", version: 1, props: {} },
      {
        id: "s1",
        type: "acme/sealed",
        version: 1,
        props: {},
        slots: {
          body: [{ id: "c2", type: "acme/card", version: 1, props: {} }],
        },
      },
    ],
    ...envelope,
  };
}

/** An editor whose apply is the engine's, recording the document it reaches. */
function editorOver(start: ComponentDocument) {
  const state = {
    document: start as ComponentDocument,
    ops: [] as BuilderOp[],
  };
  const editor = {
    apply: (op: BuilderOp) => {
      state.ops.push(op);
      state.document = applyOp(state.document, op)
        .document as ComponentDocument;
      return state.document;
    },
    lockDefinitions: registryBlockSource(),
    limits: DEFAULT_LIMITS,
  };
  return { state, editor };
}

function context(
  start: ComponentDocument,
  reserved = { properties: [] as string[], slots: [] as string[] }
) {
  const { state, editor } = editorOver(start);
  const at: FieldEditContext = { editor, component: start, reserved };
  return { state, at };
}

describe("exposing a prop", () => {
  it("adds the field as ONE envelope op the editor can undo", () => {
    const { state, at } = context(component());
    const outcome = exposeProp(at, "c1", "title", "Title");
    expect(outcome.applied).toBe(true);
    expect(state.ops).toHaveLength(1);
    expect(state.ops[0]?.kind).toBe("envelope");
    expect(propExposure(state.document, "c1", "title")).toMatchObject({
      label: "Title",
      type: "text",
    });
  });

  it("never mints an id the host reserved, though the document no longer holds it", () => {
    // The live definition still exposes `title`; the draft open in the editor
    // dropped it. A new "Title" must not take the live field's id.
    const { state, at } = context(component(), {
      properties: ["title"],
      slots: [],
    });
    exposeProp(at, "c1", "title", "Title");
    const field = propExposure(state.document, "c1", "title");
    expect(field?.id).toBeDefined();
    expect(field?.id).not.toBe("title");
  });

  it("adds nothing while the live definition's ids are not known, and says why", () => {
    const { state, editor } = editorOver(component());
    const waiting: FieldEditContext = {
      editor,
      component: component(),
      reserved: { unavailable: "Still checking this component's fields." },
    };
    expect(exposeProp(waiting, "c1", "title", "Title")).toEqual({
      applied: false,
      reason: "Still checking this component's fields.",
    });
    expect(exposeVisibility(waiting, "c1", "Show card")).toEqual({
      applied: false,
      reason: "Still checking this component's fields.",
    });
    expect(state.ops).toHaveLength(0);
    expect(
      reservedIds({ unavailable: "x" }, { properties: ["a"], slots: [] })
    ).toEqual({ unavailable: "x" });
  });

  it("refuses a non-content prop inside a contentOnly area when it is picked, saying why", () => {
    const { state, at } = context(component());
    const outcome = exposeProp(at, "c2", "tone", "Tone");
    expect(outcome).toEqual({
      applied: false,
      reason: expect.stringMatching(/locked to its content/),
    });
    expect(state.ops).toHaveLength(0);
  });

  it("offers a prop by its type, and says why one cannot be", () => {
    expect(exposeOffer({ type: "text" })).toEqual({ type: "text" });
    expect(exposeOffer({ type: "select", options: ["a"] })).toEqual({
      type: "select",
    });
    expect(exposeOffer({ type: "number" })).toEqual({
      reason: expect.stringMatching(/number value/),
    });
  });

  it("lets placements hide a block through a visibility field", () => {
    const { state, at } = context(component());
    expect(exposeVisibility(at, "c1", "Show card").applied).toBe(true);
    expect(visibilityExposure(state.document, "c1")).toMatchObject({
      type: "visibility",
      label: "Show card",
    });
    // A visibility field is not the field of any prop.
    expect(propExposure(state.document, "c1", "visibility")).toBeUndefined();
  });
});

describe("renaming a field", () => {
  it("keeps its id, so every placement's value stays", () => {
    const start = component({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "c1",
          propPath: "title",
          type: "text",
        },
      ],
    });
    const { state, at } = context(start);
    expect(renameField(at, "title", "Headline").applied).toBe(true);
    expect(state.document.exposed).toEqual([
      {
        id: "title",
        label: "Headline",
        nodeId: "c1",
        propPath: "title",
        type: "text",
      },
    ]);
  });

  it("refuses a blank name with the sentence to show", () => {
    const start = component({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "c1",
          propPath: "title",
          type: "text",
        },
      ],
    });
    const { at } = context(start);
    expect(renameField(at, "title", "  ")).toEqual({
      applied: false,
      reason: "Give the field a name.",
    });
  });
});

describe("removing a field", () => {
  const withVariants = component({
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "c1",
        propPath: "title",
        type: "text",
      },
      {
        id: "tone",
        label: "Tone",
        nodeId: "c1",
        propPath: "tone",
        type: "select",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
    ],
    variants: {
      night: { label: "Night", overrides: { title: "Late", tone: "dark" } },
      quiet: { label: "Quiet", overrides: { title: "Hush" } },
      bold: { label: "Bold", overrides: { tone: "dark" } },
    },
  });

  it("names every variant that loses a value, and says which are left with none", () => {
    const planned = planFieldRemoval(
      withVariants,
      { kind: "field", id: "title" },
      DEFAULT_LIMITS
    );
    if ("problem" in planned) throw new Error(planned.problem);
    const said = removalSentences(planned, { kind: "field" }, undefined);
    expect(said.variants).toEqual([
      { variant: "night", sentence: "Night: loses its value" },
      {
        variant: "quiet",
        sentence:
          "Quiet: loses its value, and with nothing left it shows the defaults",
      },
    ]);
  });

  it("applies the planned removal as one op, pruning the variants with it", () => {
    const { state, editor } = editorOver(withVariants);
    const planned = planFieldRemoval(
      withVariants,
      { kind: "field", id: "title" },
      DEFAULT_LIMITS
    );
    expect(applyFieldEdit(editor, withVariants, planned).applied).toBe(true);
    expect(state.ops).toHaveLength(1);
    expect(state.document.exposed?.map(field => field.id)).toEqual(["tone"]);
    expect(state.document.variants?.night?.overrides).toEqual({ tone: "dark" });
    expect(state.document.variants?.quiet?.overrides).toEqual({});
  });

  it("says how many documents place it, and when that is only a floor", () => {
    const planned = planFieldRemoval(
      withVariants,
      { kind: "field", id: "tone" },
      DEFAULT_LIMITS
    );
    if ("problem" in planned) throw new Error(planned.problem);
    expect(
      removalSentences(
        planned,
        { kind: "field" },
        { count: 3, complete: false }
      ).placements
    ).toMatch(/placed directly in at least 3 documents\.$/);
    expect(
      removalSentences(planned, { kind: "field" }, { count: 1, complete: true })
        .placements
    ).toMatch(/placed directly in 1 document\.$/);
  });
});

describe("the envelope op", () => {
  it("names only the fields that changed, and removes one the edit dropped", () => {
    const before = component({
      exposed: [],
      slots: { body: { label: "Body", nodeId: "s1", slot: "body" } },
    });
    const after = component({ exposed: [] });
    expect(envelopeOpFor(before, after)).toEqual({
      kind: "envelope",
      patch: {},
      unset: ["slots"],
    });
    expect(envelopeOpFor(before, before)).toBeUndefined();
  });
});

describe("a component holding a malformed field entry", () => {
  it("is read without it, so its view still opens", () => {
    const stored = component({
      exposed: [
        null,
        { id: 4 },
        { id: "nopath", label: "No path", nodeId: "c1", type: "text" },
        {
          id: "odd",
          label: "Odd",
          nodeId: "c1",
          propPath: "title",
          type: "odd",
        },
        {
          id: "title",
          label: "Title",
          nodeId: "c1",
          propPath: "title",
          type: "text",
        },
      ] as never,
    });
    expect(exposedFields(stored).map(field => field.id)).toEqual(["title"]);
    expect(propExposure(stored, "c1", "title")?.id).toBe("title");
    expect(visibilityExposure(stored, "c1")).toBeUndefined();
  });
});

describe("the ids a new field is kept clear of", () => {
  it("joins what the host reserved with every id the session has seen", () => {
    expect(
      reservedIds(
        { properties: ["live", "both"], slots: ["s"] },
        { properties: ["both", "seen"], slots: [] }
      )
    ).toEqual({ properties: ["live", "both", "seen"], slots: ["s"] });
    expect(
      idsIn(
        component({
          exposed: [
            {
              id: "a",
              label: "A",
              nodeId: "c1",
              propPath: "title",
              type: "text",
            },
          ],
        })
      )
    ).toEqual({ properties: ["a"], slots: [] });
  });
});

describe("the reach phrase", () => {
  it("is a floor while the count is incomplete", () => {
    expect(reachPhrase({ count: 4, complete: false })).toBe(
      "at least 4 documents"
    );
    expect(reachPhrase({ count: 4, complete: true })).toBe("4 documents");
    expect(reachPhrase(undefined)).toBeUndefined();
    expect(reachPhrase({ count: 0, complete: false })).toBeUndefined();
  });
});
