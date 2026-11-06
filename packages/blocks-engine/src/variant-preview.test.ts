/**
 * A component's own tree as one of its variants draws it, for the editor's
 * canvas to preview the variant open in the component's view.
 *
 * The properties a plausible implementation gets wrong: re-identifying nodes
 * (the canvas selects by id, so a preview that renamed them could not be
 * edited), applying a value the resolver would ignore, leaving a node the
 * variant hides on the canvas, and disagreeing with what a placement choosing
 * the variant actually renders.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type ComponentDocument,
} from "./document";
import { resolveComponentInstances, variantPreview } from "./resolve-instances";

const component: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "box",
      type: "core/box",
      version: 1,
      props: {},
      slots: {
        children: [
          {
            id: "title",
            type: "core/heading",
            version: 1,
            props: { text: "Plain", level: "h2" },
          },
          {
            id: "cta",
            type: "core/button",
            version: 1,
            props: { label: "Go" },
          },
        ],
      },
    },
  ],
  exposed: [
    {
      id: "headline",
      label: "Headline",
      nodeId: "title",
      propPath: "text",
      type: "text",
    },
    {
      id: "level",
      label: "Level",
      nodeId: "title",
      propPath: "level",
      type: "select",
    },
    {
      id: "show",
      label: "Show button",
      nodeId: "cta",
      propPath: "visibility",
      type: "visibility",
    },
  ],
  variants: {
    featured: {
      label: "Featured",
      overrides: { headline: "Big news", level: "h3", show: false },
    },
    quiet: { label: "Quiet", overrides: {} },
    // A non-boolean visibility the resolver ignores.
    odd: { label: "Odd", overrides: { show: "false" } },
  },
};

const heading = (document: BlockDocument) =>
  document.nodes[0]?.slots?.children?.find(node => node.id === "title");

describe("a variant's preview", () => {
  it("writes the variant's values onto the component's own nodes, keeping their ids", () => {
    const previewed = variantPreview(component, "featured");
    expect(heading(previewed)).toMatchObject({
      id: "title",
      props: { text: "Big news", level: "h3" },
    });
    // The component itself is untouched.
    expect(heading(component)?.props).toEqual({ text: "Plain", level: "h2" });
  });

  it("drops a node the variant hides, inside a slot too", () => {
    const children = variantPreview(component, "featured").nodes[0]?.slots
      ?.children;
    expect(children?.map(node => node.id)).toEqual(["title"]);
  });

  it("is the component as it is for a variant that sets nothing, or none it has", () => {
    expect(variantPreview(component, "quiet")).toBe(component);
    expect(variantPreview(component, "gone")).toBe(component);
  });

  it("ignores a value the resolver would ignore", () => {
    const children = variantPreview(component, "odd").nodes[0]?.slots?.children;
    expect(children?.map(node => node.id)).toEqual(["title", "cta"]);
  });

  it("draws what a placement choosing the variant renders", () => {
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "placed",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "card", variant: "featured" },
        },
      ],
    };
    const rendered = resolveComponentInstances(
      page,
      new Map([["card", component]])
    ).document;
    const previewed = variantPreview(component, "featured");
    // The same tree once the placement's scoped ids are set aside.
    const shape = (
      nodes: readonly { type: string; props: unknown; slots?: unknown }[]
    ): unknown =>
      nodes.map(node => ({
        type: node.type,
        props: node.props,
        slots:
          node.slots === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(node.slots as Record<string, typeof nodes>).map(
                  ([name, inner]) => [name, shape(inner)]
                )
              ),
      }));
    expect(shape(previewed.nodes)).toEqual(shape(rendered.nodes));
  });
});
