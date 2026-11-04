/**
 * Changing what an existing component lets its placements set.
 *
 * Each planner is asked what a designer does in a component's own view:
 * expose a prop, rename the field, point it somewhere else, remove it. The
 * properties under test are the ones a plausible implementation gets wrong:
 * an id reused after it was retired, a type change that keeps the old id (so
 * every placement's old value lands on a prop of another type), a removal
 * that leaves a variant naming the field, and an exposure that lets
 * placements past a `"contentOnly"` lock.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
  type ComponentDocument,
} from "./document";
import {
  exposureTypeForProp,
  planExposeProperty,
  planRemoveExposedSlot,
  planRemoveExposure,
  planRenameExposure,
  planRetargetExposure,
  type ExposureEditResult,
  type ExposureSources,
} from "./exposure-planners";
import { clearBlocks, registerBlocks, registryBlockSource } from "./registry";
import { componentEnvelopeIssues } from "./validation";

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
          body: { type: "richText", role: "content" },
          photo: { type: "media", role: "content" },
          href: { type: "url", role: "content" },
          tone: {
            type: "select",
            options: ["light", { value: "dark", label: "Dark" }],
          },
          shade: { type: "select", options: ["light", "dark", "dim"] },
          size: { type: "select", options: ["small", "large"] },
          as: {
            type: "select",
            options: ["div", "main"],
            optionLabels: { div: "Generic box", main: "Main content" },
          },
          count: { type: "number" },
        },
      },
      { ...base, name: "acme/box", slots: { children: {} } },
      {
        ...base,
        name: "acme/sealed",
        slots: {
          body: { defaultBlock: [{ type: "acme/card" }], lock: "contentOnly" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

const card = (id: string): BlockNode => ({
  id,
  type: "acme/card",
  version: 1,
  props: {},
});

/** A card, a box with an exposed slot, and a sealed card under `contentOnly`. */
function component(
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      card("c1"),
      {
        id: "b1",
        type: "acme/box",
        version: 1,
        props: {},
        slots: { children: [] },
      },
      {
        id: "s1",
        type: "acme/sealed",
        version: 1,
        props: {},
        slots: { body: [card("c2")] },
      },
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "c1",
        propPath: "title",
        type: "text",
      },
      {
        id: "link",
        label: "Link",
        nodeId: "c1",
        propPath: "href",
        type: "link",
      },
    ],
    slots: { extra: { label: "Extra", nodeId: "b1", slot: "children" } },
    variants: {
      bold: { label: "Bold", overrides: { title: "Hi", link: "/a" } },
      quiet: { label: "Quiet", overrides: { title: "Hush" } },
    },
    ...envelope,
  };
}

const sources = (retired?: ExposureSources["retired"]): ExposureSources => ({
  definitions: registryBlockSource(),
  ...(retired === undefined ? {} : { retired }),
});

/** The edit, or a failure naming the problem the test did not expect. */
function edited(result: ExposureEditResult) {
  if ("problem" in result) {
    throw new Error(`expected an edit, got "${result.problem}"`);
  }
  return result;
}

const errorsOf = (doc: ComponentDocument) =>
  componentEnvelopeIssues(doc).filter(issue => issue.severity === "error");

describe("the exposure's type is inferred from the prop it drives", () => {
  it.each([
    ["title", "text"],
    ["blurb", "text"],
    ["body", "richText"],
    ["photo", "image"],
    ["href", "link"],
    ["tone", "select"],
  ])("exposes %s as %s", (prop, type) => {
    const edit = edited(
      planExposeProperty(
        component(),
        { label: "Field", nodeId: "c1", propPath: prop },
        sources()
      )
    );

    const added = edit.document.exposed?.find(entry => entry.id === edit.id);
    expect(added).toMatchObject({ nodeId: "c1", propPath: prop, type });
    expect(errorsOf(edit.document)).toEqual([]);
  });

  it("carries a select's choices, a bare string becoming value and label", () => {
    const edit = edited(
      planExposeProperty(
        component(),
        { label: "Tone", nodeId: "c1", propPath: "tone" },
        sources()
      )
    );

    expect(edit.document.exposed?.at(-1)?.options).toEqual([
      { value: "light", label: "light" },
      { value: "dark", label: "Dark" },
    ]);
  });

  it("carries a select's words, from the block's option labels", () => {
    // A placement offers the choice in the words the block's own inspector
    // uses, not the raw values.
    const edit = edited(
      planExposeProperty(
        component(),
        { label: "Tag", nodeId: "c1", propPath: "as" },
        sources()
      )
    );

    expect(edit.document.exposed?.at(-1)?.options).toEqual([
      { value: "div", label: "Generic box" },
      { value: "main", label: "Main content" },
    ]);
  });

  it("exposes a node's visibility when asked for it, not a prop", () => {
    const edit = edited(
      planExposeProperty(
        component(),
        { label: "Show card", nodeId: "c1", visibility: true },
        sources()
      )
    );

    expect(edit.document.exposed?.at(-1)).toMatchObject({
      type: "visibility",
      nodeId: "c1",
      propPath: "visibility",
    });
  });

  it("refuses a prop no exposure type can edit", () => {
    expect(
      planExposeProperty(
        component(),
        { label: "Count", nodeId: "c1", propPath: "count" },
        sources()
      )
    ).toEqual({ problem: "not-exposable" });
    expect(exposureTypeForProp({ type: "number" })).toBeUndefined();
  });

  it("refuses a prop the block does not declare, and a node that is not there", () => {
    expect(
      planExposeProperty(
        component(),
        { label: "X", nodeId: "c1", propPath: "nothing" },
        sources()
      )
    ).toEqual({ problem: "unknown-prop" });
    expect(
      planExposeProperty(
        component(),
        { label: "X", nodeId: "gone", propPath: "title" },
        sources()
      )
    ).toEqual({ problem: "unknown-node" });
    // A name every object inherits is not a prop the block declares.
    expect(
      planExposeProperty(
        component(),
        { label: "X", nodeId: "c1", propPath: "toString" },
        sources()
      )
    ).toEqual({ problem: "unknown-prop" });
  });

  it("refuses a blank label", () => {
    expect(
      planExposeProperty(
        component(),
        { label: "  ", nodeId: "c1", propPath: "title" },
        sources()
      )
    ).toEqual({ problem: "invalid-label" });
  });
});

describe("a new exposure's id has never been live or retired", () => {
  it("is minted from the label, past the live and the retired ids", () => {
    // `title` is live and `title-2` was retired: a placement may still hold a
    // value under `title-2`, so handing the id out again would revive it.
    const edit = edited(
      planExposeProperty(
        component(),
        { label: "Title", nodeId: "c1", propPath: "blurb" },
        sources({ properties: ["title-2"], slots: [] })
      )
    );

    expect(edit.id).toBe("title-3");
  });

  it("does not change the document it was given", () => {
    const before = component();
    const snapshot = structuredClone(before);

    planExposeProperty(
      before,
      { label: "Body", nodeId: "c1", propPath: "body" },
      sources()
    );

    expect(before).toEqual(snapshot);
  });
});

describe("a `contentOnly` lock is judged when the exposure is added", () => {
  it("refuses a design prop of a node inside the locked area", () => {
    expect(
      planExposeProperty(
        component(),
        { label: "Tone", nodeId: "c2", propPath: "tone" },
        sources()
      )
    ).toEqual({ problem: "content-only" });
  });

  it("refuses the visibility of a node inside the locked area", () => {
    expect(
      planExposeProperty(
        component(),
        { label: "Show", nodeId: "c2", visibility: true },
        sources()
      )
    ).toEqual({ problem: "content-only" });
  });

  it("accepts a content prop inside the locked area", () => {
    const edit = edited(
      planExposeProperty(
        component(),
        { label: "Locked title", nodeId: "c2", propPath: "title" },
        sources()
      )
    );

    expect(edit.document.exposed?.at(-1)?.nodeId).toBe("c2");
  });
});

describe("renaming keeps the id and every value", () => {
  it("changes the label only", () => {
    const edit = edited(planRenameExposure(component(), "title", "Headline"));

    expect(edit.document.exposed?.[0]).toMatchObject({
      id: "title",
      label: "Headline",
    });
    expect(edit.document.variants?.bold.overrides.title).toBe("Hi");
    expect(edit.retired).toEqual({ properties: [], slots: [] });
  });

  it("refuses an unknown id and a blank label", () => {
    expect(planRenameExposure(component(), "nope", "X")).toEqual({
      problem: "unknown-exposure",
    });
    expect(planRenameExposure(component(), "title", "")).toEqual({
      problem: "invalid-label",
    });
  });
});

describe("pointing an exposure elsewhere", () => {
  it("keeps the id and its values when the new prop has the same type", () => {
    const edit = edited(
      planRetargetExposure(
        component(),
        "title",
        { nodeId: "c1", propPath: "blurb" },
        sources()
      )
    );

    expect(edit.id).toBe("title");
    expect(edit.document.exposed?.[0]).toMatchObject({
      id: "title",
      propPath: "blurb",
      type: "text",
    });
    expect(edit.document.variants?.bold.overrides.title).toBe("Hi");
    expect(edit.retired.properties).toEqual([]);
  });

  it("retires the id and mints a new one when the type changes", () => {
    // Keeping the id would land every placement's text on a rich-text prop.
    const edit = edited(
      planRetargetExposure(
        component(),
        "title",
        { nodeId: "c1", propPath: "body" },
        sources()
      )
    );

    expect(edit.id).not.toBe("title");
    expect(edit.retired.properties).toEqual(["title"]);
    // Same place in the list, same label: the designer changed its type only.
    expect(edit.document.exposed?.[0]).toMatchObject({
      id: edit.id,
      label: "Title",
      type: "richText",
    });
    expect(edit.document.variants?.bold.overrides).toEqual({ link: "/a" });
    expect(errorsOf(edit.document)).toEqual([]);
  });

  it("is judged against the lock like an addition", () => {
    expect(
      planRetargetExposure(
        component(),
        "link",
        { nodeId: "c2", propPath: "tone" },
        sources()
      )
    ).toEqual({ problem: "content-only" });
  });
});

describe("removing an exposure", () => {
  it("drops it, prunes every variant and retires the id", () => {
    const edit = edited(planRemoveExposure(component(), "link"));

    expect(edit.document.exposed?.map(entry => entry.id)).toEqual(["title"]);
    expect(edit.retired).toEqual({ properties: ["link"], slots: [] });
    expect(
      Object.values(edit.document.variants ?? {}).some(
        variant => "link" in variant.overrides
      )
    ).toBe(false);
    expect(edit.prunedVariants).toEqual([
      { variant: "bold", label: "Bold", emptied: false },
    ]);
    expect(componentEnvelopeIssues(edit.document)).toEqual([]);
  });

  it("leaves a variant whose only value it was, warned about, not refused", () => {
    const edit = edited(planRemoveExposure(component(), "title"));

    expect(edit.document.variants?.quiet).toEqual({
      label: "Quiet",
      overrides: {},
    });
    expect(edit.prunedVariants).toContainEqual({
      variant: "quiet",
      label: "Quiet",
      emptied: true,
    });
    const issues = componentEnvelopeIssues(edit.document);
    expect(issues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(issues.map(issue => [issue.code, issue.path])).toEqual([
      ["variant-empty", "/variants/quiet/overrides"],
    ]);
  });

  it("refuses an id the component does not expose", () => {
    expect(planRemoveExposure(component(), "nope")).toEqual({
      problem: "unknown-exposure",
    });
  });
});

describe("removing an exposed slot", () => {
  it("drops it and retires the slot id", () => {
    const edit = edited(planRemoveExposedSlot(component(), "extra"));

    expect(edit.document.slots).toBeUndefined();
    expect(edit.retired).toEqual({ properties: [], slots: ["extra"] });
  });

  it("refuses a slot the component does not expose", () => {
    expect(planRemoveExposedSlot(component(), "nope")).toEqual({
      problem: "unknown-exposure",
    });
  });
});

describe("a select pointed at another select", () => {
  const withTone = () =>
    edited(
      planExposeProperty(
        component(),
        { label: "Tone", nodeId: "c1", propPath: "tone" },
        sources()
      )
    );

  it("keeps the id when every old choice is still offered", () => {
    const base = withTone();

    const edit = edited(
      planRetargetExposure(
        base.document,
        base.id,
        { nodeId: "c1", propPath: "shade" },
        sources()
      )
    );

    expect(edit.id).toBe(base.id);
    expect(edit.retired.properties).toEqual([]);
  });

  it("retires the id when a stored choice would no longer be one", () => {
    // `dark` stored on a placement would be written into a prop that offers
    // only sizes: the values belong to the old choices, so the field is new.
    const base = withTone();

    const edit = edited(
      planRetargetExposure(
        base.document,
        base.id,
        { nodeId: "c1", propPath: "size" },
        sources()
      )
    );

    expect(edit.id).not.toBe(base.id);
    expect(edit.retired.properties).toEqual([base.id]);
  });
});

describe("a malformed envelope is refused, not thrown on", () => {
  it.each([
    ["exposed", { exposed: { title: {} } }],
    ["variants", { variants: [] }],
    ["slots", { slots: "extra" }],
  ])("refuses a component whose %s is the wrong shape", (_, envelope) => {
    const broken = component(envelope as never);

    for (const result of [
      planExposeProperty(
        broken,
        { label: "Body", nodeId: "c1", propPath: "body" },
        sources()
      ),
      planRenameExposure(broken, "title", "X"),
      planRemoveExposure(broken, "title"),
      planRemoveExposedSlot(broken, "extra"),
    ]) {
      expect("problem" in result && result.problem).toBe("invalid-exposure");
    }
  });
});

describe("a host that raised its node cap", () => {
  it("finds a target past the default cap", () => {
    const filler = Array.from({ length: 5_000 }, (_, i) => card(`f${i}`));
    const large = component({
      nodes: [...filler, ...component().nodes],
    });

    const edit = edited(
      planExposeProperty(
        large,
        { label: "Body", nodeId: "c1", propPath: "body" },
        {
          ...sources(),
          limits: {
            maxDepth: 64,
            maxNodes: 10_000,
            maxBytes: 64 * 1024 * 1024,
          },
        }
      )
    );

    expect(edit.document.exposed?.at(-1)?.nodeId).toBe("c1");
  });
});

describe("a malformed stored exposure is refused, not thrown on", () => {
  it("refuses a type change of an exposure whose label is not text", () => {
    const broken = component({
      exposed: [
        {
          id: "title",
          label: 42,
          nodeId: "c1",
          propPath: "title",
          type: "text",
        },
      ] as never,
    });

    expect(
      planRetargetExposure(
        broken,
        "title",
        { nodeId: "c1", propPath: "body" },
        sources()
      )
    ).toMatchObject({ problem: "invalid-exposure" });
  });

  it("refuses re-pointing a select whose stored choices are not a list", () => {
    const broken = component({
      exposed: [
        {
          id: "tone",
          label: "Tone",
          nodeId: "c1",
          propPath: "tone",
          type: "select",
          options: "light",
        },
      ] as never,
    });

    expect(
      planRetargetExposure(
        broken,
        "tone",
        { nodeId: "c1", propPath: "shade" },
        sources()
      )
    ).toMatchObject({ problem: "invalid-exposure" });
  });
});

describe("an id two stored rows share", () => {
  // Imported data can carry a duplicate id. Removing one row must not retire
  // an id the other still drives, or every placement value under it is lost.
  const doubled = () =>
    component({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "c1",
          propPath: "title",
          type: "text",
        },
        {
          id: "title",
          label: "Blurb",
          nodeId: "c1",
          propPath: "blurb",
          type: "text",
        },
        {
          id: "link",
          label: "Link",
          nodeId: "c1",
          propPath: "href",
          type: "link",
        },
      ],
    });

  it("is not retired, nor pruned, by removing one of the rows", () => {
    const edit = edited(planRemoveExposure(doubled(), "title"));

    expect(edit.retired.properties).toEqual([]);
    expect(edit.document.variants?.bold.overrides.title).toBe("Hi");
  });

  it("is not retired by re-typing one of the rows", () => {
    const edit = edited(
      planRetargetExposure(
        doubled(),
        "title",
        { nodeId: "c1", propPath: "body" },
        sources()
      )
    );

    expect(edit.retired.properties).toEqual([]);
    expect(edit.document.variants?.bold.overrides.title).toBe("Hi");
  });
});

describe("an edit that would not fit", () => {
  it("is refused when it takes the definition past the byte cap", () => {
    const doc = component();
    const size = JSON.stringify(doc).length;

    expect(
      planRenameExposure(doc, "title", "x".repeat(200), {
        maxDepth: 64,
        maxNodes: 5_000,
        maxBytes: size + 50,
      })
    ).toEqual({ problem: "exceeds-limits" });
  });
});

describe("a planner refuses what is not a component", () => {
  it("refuses a pattern", () => {
    const pattern = { ...component(), kind: "pattern" } as never;
    expect(planRemoveExposure(pattern, "title")).toEqual({
      problem: "not-a-component",
    });
  });
});
