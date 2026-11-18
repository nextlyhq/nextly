/**
 * What "Make this a setting of the component" offers for a placement: the
 * component's own text, link and image props that are not settings yet, read
 * from each block's declared props, named as the panel lists them.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { settingCandidates } from "./make-component-setting";

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/card-title",
        version: 1,
        description: "A title.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: {
          text: { label: "Text", role: "content", type: "text" },
          href: { label: "Address", role: "content", type: "url" },
          picture: { label: "Picture", role: "content", type: "media" },
          entryId: { label: "Linked entry", role: "content", type: "text" },
          rel: { label: "Link relationship", type: "text" },
          body: { label: "Body", role: "content", type: "richText" },
          tone: { label: "Tone", type: "select", options: ["light", "dark"] },
          count: { label: "Count", type: "number" },
        },
        defaultProps: {},
        render: () => null,
      },
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: {},
        defaultProps: {},
        render: () => null,
        slots: { children: {} },
      },
    ] as never,
    { source: "make-component-setting-test" }
  );
});

afterEach(() => clearBlocks());

function card(extra: Partial<ComponentDocument> = {}): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "box",
        type: "acme/box",
        version: 1,
        props: {},
        slots: {
          children: [
            {
              id: "t",
              type: "acme/card-title",
              version: 1,
              props: { text: "Card title" },
            },
            {
              id: "named",
              type: "acme/card-title",
              name: "Kicker",
              version: 1,
              props: { text: "New" },
              bindings: { text: { $bind: "title" } },
            },
            {
              id: "nested",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: "other" },
            },
            { id: "u", type: "acme/unknown", version: 1, props: {} },
          ],
        },
      },
    ],
    exposed: [
      {
        id: "goes",
        label: "Goes to",
        nodeId: "t",
        propPath: "href",
        type: "link",
      },
    ],
    ...extra,
  } as ComponentDocument;
}

describe("the props a placement may make a setting of its component", () => {
  it("lists each text, link and image prop not yet a setting, inside slots too", () => {
    expect(
      settingCandidates(card()).map(each => [
        each.nodeId,
        each.propPath,
        each.label,
        each.schema.type,
      ])
    ).toEqual([
      ["t", "text", "Heading · Text", "text"],
      // `href` is a setting already.
      ["t", "picture", "Heading · Picture", "media"],
      // A block bound to a field already shows data, so its text is not
      // offered; its address and picture are. Named by its own name.
      ["named", "href", "Kicker · Address", "url"],
      ["named", "picture", "Kicker · Picture", "media"],
    ]);
  });

  it("carries each prop's current value", () => {
    const first = settingCandidates(card())[0];
    expect(first?.value).toBe("Card title");
  });

  it("offers nothing for a definition with no blocks this build knows", () => {
    expect(
      settingCandidates(
        card({
          nodes: [{ id: "u", type: "acme/unknown", version: 1, props: {} }],
        })
      )
    ).toEqual([]);
  });

  it("reads a definition whose exposed list is not a list as exposing nothing", () => {
    const offered = settingCandidates(
      card({ exposed: "broken" as unknown as ComponentDocument["exposed"] })
    );
    expect(offered.map(each => `${each.nodeId}.${each.propPath}`)).toContain(
      "t.href"
    );
  });
});
