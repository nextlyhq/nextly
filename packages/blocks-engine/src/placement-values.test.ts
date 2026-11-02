/**
 * What a write may store as a placement's own values.
 *
 * The rule has two halves that a plausible wrong version gets backwards: a
 * value the write SETS is judged, and a value the stored document already held
 * is kept, however it reads now. Each case below is built so that one half
 * alone would answer it wrongly.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "./document";
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { exposedValueFits, placementValueIssues } from "./placement-values";

const HEADER: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "Site", href: "/", tone: "light" },
    },
  ],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "h",
      propPath: "text",
      type: "text",
    },
    { id: "link", label: "Link", nodeId: "h", propPath: "href", type: "link" },
    {
      id: "tone",
      label: "Tone",
      nodeId: "h",
      propPath: "tone",
      type: "select",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
    {
      id: "shown",
      label: "Shown",
      nodeId: "h",
      propPath: "",
      type: "visibility",
    },
  ],
};

const LOOKUP = new Map<string, BlockDocument>([["header", HEADER]]);

function placed(overrides: Record<string, unknown>, id = "p1"): BlockNode {
  return {
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "header", overrides },
  };
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

describe("placementValueIssues", () => {
  it("accepts a value of each field's own type, and a cleared field", () => {
    const issues = placementValueIssues(
      page(
        placed({
          title: "Hello",
          link: "https://example.com",
          tone: "dark",
          shown: false,
        }),
        placed({ title: { $unset: true }, link: { $unset: true } }, "p2")
      ),
      LOOKUP
    );
    expect(issues).toEqual([]);
  });

  it("refuses a newly set value of the wrong type, naming the field", () => {
    const issues = placementValueIssues(page(placed({ title: 42 })), LOOKUP);
    expect(issues).toEqual([
      expect.objectContaining({
        nodeId: "p1",
        exposureId: "title",
        problem: "wrong-type",
        message: "Title needs text.",
      }),
    ]);
  });

  it("refuses a link the renderer would not draw, a choice not offered and a non-boolean visibility", () => {
    const issues = placementValueIssues(
      page(placed({ link: "javascript:alert(1)", tone: "neon", shown: "no" })),
      LOOKUP
    );
    expect(issues.map(issue => [issue.exposureId, issue.problem])).toEqual([
      ["link", "wrong-type"],
      ["tone", "wrong-type"],
      ["shown", "wrong-type"],
    ]);
    expect(issues[1]?.message).toBe("Tone needs one of: light, dark.");
  });

  it("refuses an id the component does not expose when the write newly sets it", () => {
    const issues = placementValueIssues(
      page(placed({ subtitle: "Hi" })),
      LOOKUP
    );
    expect(issues).toEqual([
      expect.objectContaining({
        exposureId: "subtitle",
        problem: "unknown-field",
      }),
    ]);
  });

  it("keeps an unknown id and a wrongly typed value the stored page already held", () => {
    const stored = page(placed({ subtitle: "Hi", title: 42 }));
    expect(
      placementValueIssues(
        page(placed({ subtitle: "Hi", title: 42 })),
        LOOKUP,
        [stored]
      )
    ).toEqual([]);
  });

  it("judges a stale id again once the write changes its value", () => {
    const stored = page(placed({ subtitle: "Hi" }));
    expect(
      placementValueIssues(page(placed({ subtitle: "Changed" })), LOOKUP, [
        stored,
      ])
    ).toEqual([expect.objectContaining({ problem: "unknown-field" })]);
  });

  it("keeps a held value only for the same placement of the same component", () => {
    const stored = page(placed({ subtitle: "Hi" }, "other"));
    expect(
      placementValueIssues(page(placed({ subtitle: "Hi" })), LOOKUP, [stored])
    ).toHaveLength(1);
  });

  it("keeps a draft's own baseline when the forms place different components under one id", () => {
    const footer: ComponentDocument = { ...HEADER, exposed: [] };
    const lookup = new Map<string, BlockDocument>([
      ["header", HEADER],
      ["footer", footer],
    ]);
    const onFooter = (overrides: Record<string, unknown>): BlockNode => ({
      id: "p1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "footer", overrides },
    });
    // Published places the header; the draft already moved p1 to the footer,
    // whose field has since gone. Read published first, as a publish does.
    const published = page(placed({ title: "Hi" }));
    const draft = page(onFooter({ old: "Kept" }));
    expect(
      placementValueIssues(page(onFooter({ old: "Kept" })), lookup, [
        published,
        draft,
      ])
    ).toEqual([]);
  });

  it("refuses more values than the resolver reads, unless the stored page held them", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_ENVELOPE_ENTRIES + 1 }, (_, i) => [
        `k${String(i)}`,
        "x",
      ])
    );
    expect(placementValueIssues(page(placed(many)), LOOKUP)).toEqual([
      expect.objectContaining({ problem: "too-many-values", exposureId: "" }),
    ]);
    expect(
      placementValueIssues(page(placed(many)), LOOKUP, [page(placed(many))])
    ).toEqual([]);
  });

  it("reaches a placement inside another block's slot", () => {
    const box: BlockNode = {
      id: "box",
      type: "core/box",
      version: 1,
      props: {},
      slots: { children: [placed({ title: 1 })] },
    };
    expect(placementValueIssues(page(box), LOOKUP)).toHaveLength(1);
  });

  it("leaves a placement whose component cannot be read to the composition", () => {
    expect(
      placementValueIssues(page(placed({ anything: 1 })), new Map())
    ).toEqual([]);
  });
});

describe("exposedValueFits", () => {
  it("takes a rich-text field's document or plain string, and an image's media id", () => {
    expect(exposedValueFits({ type: "richText" }, "Plain")).toBe(true);
    expect(exposedValueFits({ type: "richText" }, 3)).toBe(false);
    expect(exposedValueFits({ type: "image" }, "media-1")).toBe(true);
    expect(exposedValueFits({ type: "image" }, "")).toBe(false);
  });
});
