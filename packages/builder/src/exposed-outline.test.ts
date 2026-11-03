// @vitest-environment jsdom

/**
 * Which canvas elements carry the exposed-part outline for a selected
 * placement: its exposed values, read from the composed page's exposure map,
 * and nothing else.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  resolveComponentInstances,
  type BlockDocument,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

import { EXPOSED_ATTRIBUTE, markExposedParts } from "./exposed-outline";

afterEach(() => {
  document.body.innerHTML = "";
});

const HEADER: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "h",
      type: "acme/heading",
      version: 1,
      props: { text: "Site name", kicker: "Hello" },
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
    {
      id: "shown",
      label: "Shown",
      nodeId: "h",
      propPath: "visibility",
      type: "visibility",
    },
  ],
};

function setUp() {
  const page: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: ["p1", "p2"].map(id => ({
      id,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "header" },
    })),
  };
  const composed = resolveComponentInstances(
    page,
    new Map([["header", HEADER as BlockDocument]]),
    { exposures: true }
  ).document;
  const idOf = (placement: string) =>
    composed.nodes.find(node => node.instanceOf === placement)?.id ?? "";
  document.body.innerHTML = ["p1", "p2"]
    .map(
      placement => `
      <h2 data-nx-node="${idOf(placement)}" data-nx-instance="${placement}">
        <small data-nx-prop="kicker">Hello</small>
        <span data-nx-prop="text">Site name</span>
      </h2>`
    )
    .join("");
  const part = (placement: string, prop: string) =>
    document.querySelector(
      `[data-nx-instance="${placement}"] [data-nx-prop="${prop}"]`
    );
  return { composed, part };
}

describe("markExposedParts", () => {
  it("outlines the selected placement's exposed values only", () => {
    const { composed, part } = setUp();
    markExposedParts(document, "p1", composed);

    expect(part("p1", "text")?.hasAttribute(EXPOSED_ATTRIBUTE)).toBe(true);
    expect(part("p1", "kicker")?.hasAttribute(EXPOSED_ATTRIBUTE)).toBe(false);
    // Another placement of the same component is not the one selected.
    expect(part("p2", "text")?.hasAttribute(EXPOSED_ATTRIBUTE)).toBe(false);
  });

  it("moves with the selection and clears when there is none", () => {
    const { composed, part } = setUp();
    markExposedParts(document, "p1", composed);
    markExposedParts(document, "p2", composed);
    expect(part("p1", "text")?.hasAttribute(EXPOSED_ATTRIBUTE)).toBe(false);
    expect(part("p2", "text")?.hasAttribute(EXPOSED_ATTRIBUTE)).toBe(true);

    markExposedParts(document, null, undefined);
    expect(document.querySelectorAll(`[${EXPOSED_ATTRIBUTE}]`)).toHaveLength(0);
  });
});
